import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptLiveTreatmentPlan,
  applyFixtureCreateInvoice,
  applyFixtureCreatePaymentRequest,
  applyFixtureGenerateReceipt,
  applyFixtureRecordManualPayment,
  applyFixtureRecordProcedure,
  applyFixtureSignPrescription,
  classifyCp5EndpointFailures,
  createFixtureCp5WorkflowData,
  createLiveInstruction,
  createLiveInvoice,
  createLivePaymentRequest,
  createLiveReceipt,
  createLiveTreatmentPlan,
  getInvoicePaidAmountCents,
  getOutstandingAmountCents,
  readLiveInvoice,
  recordLiveManualPayment,
  recordLiveProcedure,
  signLivePrescription,
  updateLiveTreatmentPlan
} from "@/lib/cp5-workflow";

describe("CP5 checkout workflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates invoices only from completed procedure evidence and keeps payment requests unpaid", () => {
    const base = createFixtureCp5WorkflowData("2026-07-07");
    const procedureData = applyFixtureRecordProcedure(base, {
      actorName: "doctor fixture user",
      encounterId: "cp5SyntheticEncounter",
      patientId: "cp5SyntheticPatient",
      treatmentPlanId: "cp5TreatmentPlanAccepted"
    });
    const invoiceData = applyFixtureCreateInvoice(procedureData, {
      actorName: "receptionist fixture user",
      patientId: "cp5SyntheticPatient",
      procedurePerformedIds: [procedureData.proceduresPerformed[0]!.id],
      treatmentPlanId: "cp5TreatmentPlanAccepted"
    });
    const invoice = invoiceData.invoices[0]!;
    const requested = applyFixtureCreatePaymentRequest(invoiceData, {
      amountCents: getOutstandingAmountCents(invoice),
      channel: "payment_link",
      invoiceId: invoice.id
    });
    const requestedInvoice = requested.invoices[0]!;

    expect(requestedInvoice.state).toBe("payment_requested");
    expect(requestedInvoice.paymentRequests[0]).toMatchObject({
      state: "no_key",
      statusDetail: "Razorpay keys are missing; payment cannot be requested live."
    });
    expect(getInvoicePaidAmountCents(requestedInvoice)).toBe(0);
  });

  it("requires manual payment audit fields before receipt generation", () => {
    const procedureData = applyFixtureRecordProcedure(createFixtureCp5WorkflowData("2026-07-07"), {
      actorName: "doctor fixture user",
      encounterId: "cp5SyntheticEncounter",
      patientId: "cp5SyntheticPatient",
      treatmentPlanId: "cp5TreatmentPlanAccepted"
    });
    const invoiceData = applyFixtureCreateInvoice(procedureData, {
      actorName: "receptionist fixture user",
      patientId: "cp5SyntheticPatient",
      procedurePerformedIds: [procedureData.proceduresPerformed[0]!.id],
      treatmentPlanId: "cp5TreatmentPlanAccepted"
    });
    const invoice = invoiceData.invoices[0]!;

    expect(() =>
      applyFixtureRecordManualPayment(invoiceData, {
        actorName: "accountant fixture user",
        amountCents: invoice.totalAmountCents,
        invoiceId: invoice.id,
        method: "upi",
        reason: "",
        reference: ""
      })
    ).toThrow(/reference and audit reason/);

    const paid = applyFixtureRecordManualPayment(invoiceData, {
      actorName: "accountant fixture user",
      amountCents: invoice.totalAmountCents,
      invoiceId: invoice.id,
      method: "upi",
      reason: "Patient paid at front desk after provider unavailable state.",
      reference: "UPI-CP5-TEST"
    });
    const paidInvoice = paid.invoices[0]!;
    const receipted = applyFixtureGenerateReceipt(paid, {
      actorName: "receptionist fixture user",
      invoiceId: paidInvoice.id
    });

    expect(paidInvoice.state).toBe("manually_recorded");
    expect(paidInvoice.payments[0]).toMatchObject({
      auditStatus: "required_fields_recorded",
      reference: "UPI-CP5-TEST"
    });
    expect(receipted.invoices[0]?.receipts[0]).toMatchObject({
      amountCents: invoice.totalAmountCents,
      state: "print_ready"
    });
  });

  it("keeps prescription signing doctor-only in fixture helpers", () => {
    const data = createFixtureCp5WorkflowData("2026-07-07");

    expect(() =>
      applyFixtureSignPrescription(data, {
        actorName: "assistant fixture user",
        actorRoles: ["assistant"],
        prescriptionId: "cp5PrescriptionDraft"
      })
    ).toThrow(/doctor role/);

    const signed = applyFixtureSignPrescription(data, {
      actorName: "doctor fixture user",
      actorRoles: ["doctor"],
      prescriptionId: "cp5PrescriptionDraft"
    });

    expect(signed.prescriptions[0]).toMatchObject({
      signedBy: "doctor fixture user",
      state: "signed"
    });
    expect(signed.timeline.some((item) => item.kind === "prescription.signed")).toBe(true);
  });

  it("classifies missing CP5 endpoint registration before runtime debugging", () => {
    expect(
      classifyCp5EndpointFailures([
        {
          endpoint: "HTTP /v1/invoices",
          message: "Not found",
          status: 404
        }
      ])
    ).toMatchObject({
      code: "CP5_ENDPOINT_NOT_REGISTERED",
      message: "One or more CP5 checkout endpoints are not registered in this environment."
    });
  });

  it("uses the documented live checkout route family", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.endsWith("/v1/patients/patient-1/treatment-plans")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ treatmentPlan: { id: "plan-1" } });
      }

      if (url.endsWith("/v1/treatment-plans/plan-1")) {
        expect(init?.method).toBe("PATCH");
        return jsonResponse({ treatmentPlan: { id: "plan-1" } });
      }

      if (url.endsWith("/v1/treatment-plans/plan-1/accept")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ treatmentPlan: { id: "plan-1", status: "accepted" } });
      }

      if (url.endsWith("/v1/encounters/encounter-1/procedures")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ procedure: { id: "procedure-1" } });
      }

      if (url.endsWith("/v1/invoices") && init?.method === "POST") {
        return jsonResponse({ invoice: { id: "invoice-1" } });
      }

      if (url.endsWith("/v1/invoices/invoice-1") && !init?.method) {
        return jsonResponse({ invoice: { id: "invoice-1" } });
      }

      if (url.endsWith("/v1/invoices/invoice-1/payment-requests")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ paymentRequest: { id: "request-1" } });
      }

      if (url.endsWith("/v1/invoices/invoice-1/manual-payments")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ payment: { id: "payment-1" } });
      }

      if (url.endsWith("/v1/invoices/invoice-1/receipts")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ receipt: { id: "receipt-1" } });
      }

      if (url.endsWith("/v1/prescriptions/prescription-1/sign")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ prescription: { id: "prescription-1", state: "signed" } });
      }

      if (url.endsWith("/v1/patients/patient-1/instructions")) {
        expect(init?.method).toBe("POST");
        return jsonResponse({ instruction: { id: "instruction-1" } });
      }

      throw new Error(`Unexpected fetch URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createLiveTreatmentPlan("patient-1", {
      encounterId: "encounter-1",
      phases: [
        {
          items: [
            {
              amountCents: 50000,
              procedureId: "procedure-code-1",
              quantity: 1
            }
          ],
          name: "Phase 1",
          sequence: 1
        }
      ],
      title: "Plan"
    });
    await updateLiveTreatmentPlan("plan-1", { phases: [], title: "Updated plan" });
    await acceptLiveTreatmentPlan({
      acceptedBy: "doctor fixture user",
      acceptanceMethod: "chairside_confirmation",
      treatmentPlanId: "plan-1"
    });
    await recordLiveProcedure({
      actorName: "doctor fixture user",
      encounterId: "encounter-1",
      patientId: "patient-1",
      treatmentPlanId: "plan-1"
    });
    await createLiveInvoice({
      actorName: "receptionist fixture user",
      patientId: "patient-1",
      procedurePerformedIds: ["procedure-1"],
      treatmentPlanId: "plan-1"
    });
    await readLiveInvoice("invoice-1");
    await createLivePaymentRequest({
      amountCents: 50000,
      channel: "payment_link",
      invoiceId: "invoice-1"
    });
    await recordLiveManualPayment({
      actorName: "accountant fixture user",
      amountCents: 50000,
      invoiceId: "invoice-1",
      method: "upi",
      reason: "Front desk manual payment evidence.",
      reference: "UPI-LIVE-ROUTE"
    });
    await createLiveReceipt({ actorName: "receptionist fixture user", invoiceId: "invoice-1" });
    await signLivePrescription({
      actorName: "doctor fixture user",
      actorRoles: ["doctor"],
      prescriptionId: "prescription-1"
    });
    await createLiveInstruction({
      channel: "print",
      patientId: "patient-1",
      templateId: "instruction-template-1"
    });

    expect(fetchMock.mock.calls.map((call) => call[0].toString())).toEqual([
      "http://localhost/v1/patients/patient-1/treatment-plans",
      "http://localhost/v1/treatment-plans/plan-1",
      "http://localhost/v1/treatment-plans/plan-1/accept",
      "http://localhost/v1/encounters/encounter-1/procedures",
      "http://localhost/v1/invoices",
      "http://localhost/v1/invoices/invoice-1",
      "http://localhost/v1/invoices/invoice-1/payment-requests",
      "http://localhost/v1/invoices/invoice-1/manual-payments",
      "http://localhost/v1/invoices/invoice-1/receipts",
      "http://localhost/v1/prescriptions/prescription-1/sign",
      "http://localhost/v1/patients/patient-1/instructions"
    ]);

    const manualBody = JSON.parse(fetchMock.mock.calls[7]?.[1]?.body as string);
    expect(manualBody).toMatchObject({
      actorName: "accountant fixture user",
      amountCents: 50000,
      method: "upi",
      reason: "Front desk manual payment evidence.",
      reference: "UPI-LIVE-ROUTE"
    });
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status: 200
  });
}
