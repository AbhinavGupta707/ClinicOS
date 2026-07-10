import assert from "node:assert/strict";
import test from "node:test";
import { buildAccessContext } from "@clinic-os/auth";
import type { ClinicModuleTransactionContext } from "@clinic-os/db";
import type {
  ClinicRoleSlug,
  InvoiceDetail,
  PatientInstructionRecord,
  PaymentRequestRecord,
  PaymentTransactionRecord,
  ProcedurePerformedRecord,
  TreatmentPlanDetail,
  UUID
} from "@clinic-os/domain";
import type { PaymentProvider } from "@clinic-os/integrations";
import { ApiError } from "../src/errors.ts";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureOperationRequest
} from "../src/features/contracts.ts";
import { CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS } from "../src/features/cp13-operation-ownership.ts";
import {
  createTreatmentBillingHandlerMap,
  type TreatmentBillingClinicOperationId
} from "../src/features/treatment-billing/index.ts";

const TENANT_ID = "10000000-0000-4000-8000-000000000001" as UUID;
const CLINIC_ID = "10000000-0000-4000-8000-000000000101" as UUID;
const USER_ID = "10000000-0000-4000-8000-000000001001" as UUID;
const PATIENT_ID = "10000000-0000-4000-8000-000000002001" as UUID;
const ENCOUNTER_ID = "10000000-0000-4000-8000-000000003001" as UUID;
const PLAN_ID = "10000000-0000-4000-8000-000000004001" as UUID;
const PHASE_ID = "10000000-0000-4000-8000-000000004002" as UUID;
const ITEM_ID = "10000000-0000-4000-8000-000000004003" as UUID;
const PRICEBOOK_ID = "10000000-0000-4000-8000-000000005001" as UUID;
const PROCEDURE_ID = "10000000-0000-4000-8000-000000006001" as UUID;
const INVOICE_ID = "10000000-0000-4000-8000-000000007001" as UUID;
const PAYMENT_ID = "10000000-0000-4000-8000-000000008001" as UUID;
const PAYMENT_REQUEST_ID = "10000000-0000-4000-8000-000000008002" as UUID;
const RECEIPT_ID = "10000000-0000-4000-8000-000000008003" as UUID;
const INSTRUCTION_ID = "10000000-0000-4000-8000-000000009001" as UUID;
const FIXED_NOW = "2026-07-10T12:00:00.000Z";

test("CP13 treatment billing handler map covers the exact eleven frozen clinic operations", () => {
  const handlers = createTreatmentBillingHandlerMap({ paymentProvider: availableProvider() });
  assert.deepEqual(
    Object.keys(handlers).sort(),
    [...CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS].sort()
  );
  assert.equal(Object.isFrozen(handlers), true);
});

test("CP13 preserves clinical/accountant separation across plan, procedure, and invoice", async () => {
  const evidence = evidenceRecorder();
  const acceptedPlan = treatmentPlan("accepted");
  const procedure = performedProcedure(INVOICE_ID);
  const invoice = invoiceDetail({ procedure, paidMinor: 0 });
  const context = executionContext(
    {
      dentalTreatment: {
        acceptTreatmentPlan: async () => ({ detail: acceptedPlan }),
        createProcedurePerformed: async () => ({
          procedure: { ...procedure, invoiceId: null },
          treatmentPlan: {
            ...acceptedPlan,
            phases: acceptedPlan.phases.map((phase) => ({
              ...phase,
              estimateItems: phase.estimateItems.map((item) => ({ ...item, status: "completed" }))
            }))
          }
        })
      },
      billing: {
        createInvoice: async () => ({ invoiceDetail: invoice, procedures: [procedure] })
      }
    },
    evidence
  );
  const handlers = createTreatmentBillingHandlerMap({ paymentProvider: availableProvider() });

  await assert.rejects(
    handlers.acceptTreatmentPlan(
      operationRequest("acceptTreatmentPlan", "accountant", {
        path: { treatmentPlanId: PLAN_ID },
        headers: idempotencyHeaders("cp13-plan-accept-001"),
        body: { acceptedByName: "Synthetic Patient", acceptanceEvidence: { source: "paper_card" } }
      }),
      context
    ),
    permissionDenied("patient.read")
  );

  const accepted = await handlers.acceptTreatmentPlan(
    operationRequest("acceptTreatmentPlan", "doctor", {
      path: { treatmentPlanId: PLAN_ID },
      headers: idempotencyHeaders("cp13-plan-accept-002"),
      body: { acceptedByName: "Synthetic Patient", acceptanceEvidence: { source: "paper_card" } }
    }),
    context
  );
  assert.equal(accepted.status, 200);

  const completed = await handlers.createEncounterProcedurePerformed(
    operationRequest("createEncounterProcedurePerformed", "doctor", {
      path: { encounterId: ENCOUNTER_ID },
      headers: idempotencyHeaders("cp13-procedure-001"),
      body: {
        treatmentPlanId: PLAN_ID,
        treatmentPlanEstimateItemId: ITEM_ID,
        provenance: { source: "synthetic_clinician_entry" }
      }
    }),
    context
  );
  assert.equal(completed.status, 201);

  await assert.rejects(
    handlers.createEncounterProcedurePerformed(
      operationRequest("createEncounterProcedurePerformed", "accountant", {
        path: { encounterId: ENCOUNTER_ID },
        headers: idempotencyHeaders("cp13-procedure-002"),
        body: {
          treatmentPlanId: PLAN_ID,
          treatmentPlanEstimateItemId: ITEM_ID
        }
      }),
      context
    ),
    permissionDenied("patient.read")
  );

  const createdInvoice = await handlers.createInvoice(
    operationRequest("createInvoice", "accountant", {
      headers: idempotencyHeaders("cp13-invoice-001"),
      body: { treatmentPlanId: PLAN_ID, procedurePerformedIds: [PROCEDURE_ID] }
    }),
    context
  );
  assert.equal(createdInvoice.status, 201);
  assert.deepEqual(
    evidence.audit.map((event) => event.action),
    ["treatment_plan.accepted", "procedure.completed", "invoice.created"]
  );
  assert.deepEqual(
    evidence.outbox.map((event) => event.eventType),
    ["treatment_plan.accepted", "procedure.completed", "invoice.created"]
  );
});

test("CP13 pricebook, plan create/update, invoice read, and verified receipt handlers succeed", async () => {
  const evidence = evidenceRecorder();
  const draftPlan = treatmentPlan("draft");
  const updatedPlan = {
    ...draftPlan,
    treatmentPlan: { ...draftPlan.treatmentPlan, rowVersion: 2, status: "presented" as const }
  };
  const settledPayment: PaymentTransactionRecord = {
    ...manualPayment({ amountMinor: 10_000, idempotencyKey: "manual-payment-settled-001" }),
    receiptId: RECEIPT_ID
  };
  const settledInvoice = invoiceDetail({
    paidMinor: 10_000,
    balanceMinor: 0,
    payments: [settledPayment]
  });
  const receipt = {
    id: RECEIPT_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    invoiceId: INVOICE_ID,
    patientId: PATIENT_ID,
    receiptNumber: "SYN-RCP-001",
    status: "generated" as const,
    amountMinor: 10_000,
    currency: "INR" as const,
    paymentAllocations: [{ paymentTransactionId: PAYMENT_ID, amountMinor: 10_000 }],
    generatedByUserId: USER_ID,
    generatedAt: FIXED_NOW,
    voidedByUserId: null,
    voidedAt: null,
    voidReason: null
  };
  const context = executionContext(
    {
      dentalTreatment: {
        createTreatmentPlan: async () => ({ detail: draftPlan }),
        updateTreatmentPlan: async () => ({ detail: updatedPlan })
      },
      billing: {
        listPricebookProcedures: async () => [
          {
            id: PRICEBOOK_ID,
            tenantId: TENANT_ID,
            clinicId: CLINIC_ID,
            code: "SYN-PROC-001",
            displayName: "Synthetic procedure",
            category: "synthetic",
            description: null,
            defaultUnitPriceMinor: 10_000,
            currency: "INR",
            taxRateBasisPoints: 0,
            status: "active",
            createdAt: FIXED_NOW,
            updatedAt: FIXED_NOW
          }
        ],
        findInvoiceById: async () => settledInvoice,
        createReceipt: async () => ({ invoiceDetail: settledInvoice, receipt })
      }
    },
    evidence
  );
  const handlers = createTreatmentBillingHandlerMap({ paymentProvider: availableProvider() });

  assert.equal(
    (
      await handlers.listPricebookProcedures(
        operationRequest("listPricebookProcedures", "accountant", {}),
        context
      )
    ).status,
    200
  );
  assert.equal(
    (
      await handlers.createPatientTreatmentPlan(
        operationRequest("createPatientTreatmentPlan", "doctor", {
          path: { patientId: PATIENT_ID },
          headers: idempotencyHeaders("create-treatment-plan-001"),
          body: {
            encounterId: ENCOUNTER_ID,
            title: "Synthetic restorative plan",
            phases: [
              {
                title: "Synthetic phase",
                items: [{ pricebookProcedureId: PRICEBOOK_ID, toothNumber: "11" }]
              }
            ]
          }
        }),
        context
      )
    ).status,
    201
  );
  assert.equal(
    (
      await handlers.updateTreatmentPlan(
        operationRequest("updateTreatmentPlan", "doctor", {
          path: { treatmentPlanId: PLAN_ID },
          headers: {
            ...idempotencyHeaders("update-treatment-plan-001"),
            "if-match": '"rv-1"'
          },
          body: { status: "presented" }
        }),
        context
      )
    ).status,
    200
  );
  assert.equal(
    (
      await handlers.getInvoice(
        operationRequest("getInvoice", "accountant", { path: { invoiceId: INVOICE_ID } }),
        context
      )
    ).status,
    200
  );
  assert.equal(
    (
      await handlers.createInvoiceReceipt(
        operationRequest("createInvoiceReceipt", "accountant", {
          path: { invoiceId: INVOICE_ID },
          headers: idempotencyHeaders("receipt-create-001"),
          body: { paymentTransactionIds: [PAYMENT_ID] }
        }),
        context
      )
    ).status,
    201
  );
  assert.deepEqual(
    evidence.audit.map((event) => event.action),
    [
      "pricebook.procedure_catalog.viewed",
      "treatment_plan.created",
      "treatment_plan.updated",
      "invoice.viewed",
      "receipt.generated"
    ]
  );
});

test("CP13 maps wrong tenant and invalid workflow state without leaking another clinic record", async () => {
  const context = executionContext({
    billing: { findInvoiceById: async () => null },
    dentalTreatment: {
      createProcedurePerformed: async () => {
        throw new Error("Procedures can only be completed from an accepted treatment plan.");
      }
    }
  });
  const handlers = createTreatmentBillingHandlerMap({ paymentProvider: availableProvider() });

  await assert.rejects(
    handlers.getInvoice(
      operationRequest("getInvoice", "accountant", {
        path: { invoiceId: INVOICE_ID }
      }),
      context
    ),
    (error) => error instanceof ApiError && error.status === 404 && error.code === "NOT_FOUND"
  );
  await assert.rejects(
    handlers.createEncounterProcedurePerformed(
      operationRequest("createEncounterProcedurePerformed", "doctor", {
        path: { encounterId: ENCOUNTER_ID },
        headers: idempotencyHeaders("cp13-invalid-state-001"),
        body: {
          treatmentPlanId: PLAN_ID,
          treatmentPlanEstimateItemId: ITEM_ID
        }
      }),
      context
    ),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "CONFLICT"
  );
});

test("CP13 manual payment requires evidence and replays before revalidating a reduced balance", async () => {
  const existing = manualPayment({
    amountMinor: 4_000,
    idempotencyKey: "manual-payment-retry-001"
  });
  const originalInvoice = invoiceDetail({
    paidMinor: 4_000,
    payments: [existing],
    balanceMinor: 6_000
  });
  let recordCalls = 0;
  const context = executionContext({
    billing: {
      findInvoiceById: async () => originalInvoice,
      recordPaymentTransaction: async () => {
        recordCalls += 1;
        return existing;
      }
    }
  });
  const handlers = createTreatmentBillingHandlerMap({ paymentProvider: availableProvider() });

  const replay = await handlers.recordInvoiceManualPayment(
    operationRequest("recordInvoiceManualPayment", "accountant", {
      path: { invoiceId: INVOICE_ID },
      headers: idempotencyHeaders("manual-payment-retry-001"),
      body: {
        amountMinor: 9_000,
        currency: "INR",
        method: "cash",
        reason: "Synthetic counter register evidence.",
        reference: "SYN-CASH-001",
        evidence: { registerLine: "synthetic-001" }
      }
    }),
    context
  );
  assert.equal((replay.body as { replayed: boolean }).replayed, true);
  assert.equal(recordCalls, 0);

  await assert.rejects(
    handlers.recordInvoiceManualPayment(
      operationRequest("recordInvoiceManualPayment", "accountant", {
        path: { invoiceId: INVOICE_ID },
        headers: idempotencyHeaders("manual-payment-new-001"),
        body: {
          amountMinor: 1_000,
          currency: "INR",
          method: "cash",
          reason: "Evidence deliberately missing.",
          reference: "SYN-CASH-002",
          evidence: {}
        }
      }),
      context
    ),
    (error) =>
      error instanceof ApiError &&
      error.status === 400 &&
      /supporting evidence/u.test(error.message)
  );

  const newEvidence = evidenceRecorder();
  const unpaidInvoice = invoiceDetail({ paidMinor: 0 });
  const newPayment = manualPayment({
    amountMinor: 1_000,
    idempotencyKey: "manual-payment-new-002"
  });
  const partiallyPaidInvoice = invoiceDetail({
    paidMinor: 1_000,
    balanceMinor: 9_000,
    payments: [newPayment]
  });
  let reads = 0;
  const newContext = executionContext(
    {
      billing: {
        findInvoiceById: async () => (reads++ === 0 ? unpaidInvoice : partiallyPaidInvoice),
        recordPaymentTransaction: async () => newPayment
      }
    },
    newEvidence
  );
  const recorded = await handlers.recordInvoiceManualPayment(
    operationRequest("recordInvoiceManualPayment", "accountant", {
      path: { invoiceId: INVOICE_ID },
      headers: idempotencyHeaders("manual-payment-new-002"),
      body: {
        amountMinor: 1_000,
        currency: "INR",
        method: "upi",
        reason: "Synthetic accountant-verified UPI payment.",
        reference: "SYN-UPI-002",
        evidence: { registerLine: "synthetic-002" }
      }
    }),
    newContext
  );
  assert.equal((recorded.body as { replayed: boolean }).replayed, false);
  assert.equal(newEvidence.audit[0]?.action, "payment.manually_recorded");
  assert.equal(newEvidence.outbox[0]?.eventType, "payment.manually_recorded");
});

test("CP13 payment request uses the captured provider dependency and persists no invented amount", async () => {
  const invoice = invoiceDetail({ paidMinor: 2_500, balanceMinor: 7_500 });
  const paymentRequest = paymentRequestRecord(7_500);
  let storedInput: Record<string, unknown> | null = null;
  const context = executionContext({
    billing: {
      findInvoiceById: async () => invoice,
      createPaymentRequest: async (input: Record<string, unknown>) => {
        storedInput = input;
        return paymentRequest;
      }
    }
  });
  const handlers = createTreatmentBillingHandlerMap({ paymentProvider: availableProvider() });
  const response = await handlers.createInvoicePaymentRequest(
    operationRequest("createInvoicePaymentRequest", "accountant", {
      path: { invoiceId: INVOICE_ID },
      headers: idempotencyHeaders("payment-request-001"),
      body: { requestType: "invoice_qr", amountMinor: 7_500, metadata: {} }
    }),
    context
  );
  assert.equal(response.status, 201);
  assert.equal(storedInput?.amountMinor, 7_500);
  assert.equal(storedInput?.requestType, "dynamic_qr");
  assert.equal(storedInput?.providerReferenceId, "rzp_synthetic_request_001");

  const unavailableHandlers = createTreatmentBillingHandlerMap({
    paymentProvider: unavailableProvider()
  });
  await assert.rejects(
    unavailableHandlers.createInvoicePaymentRequest(
      operationRequest("createInvoicePaymentRequest", "accountant", {
        path: { invoiceId: INVOICE_ID },
        headers: idempotencyHeaders("payment-request-002"),
        body: { requestType: "payment_link", amountMinor: 1_000 }
      }),
      context
    ),
    (error) =>
      error instanceof ApiError && error.status === 503 && error.code === "DEPENDENCY_UNAVAILABLE"
  );
});

test("CP13 instruction output remains print/send-request evidence only", async () => {
  const evidence = evidenceRecorder();
  const context = executionContext(
    {
      clinicalCare: {
        createPatientInstruction: async () => patientInstruction()
      }
    },
    evidence
  );
  const handlers = createTreatmentBillingHandlerMap({ paymentProvider: availableProvider() });
  const response = await handlers.createPatientInstruction(
    operationRequest("createPatientInstruction", "assistant", {
      path: { patientId: PATIENT_ID },
      headers: idempotencyHeaders("instruction-request-001"),
      body: {
        channel: "whatsapp",
        templateId: "synthetic-post-op-v1",
        title: "Synthetic post-op instructions",
        body: "Synthetic instructions only."
      }
    }),
    context
  );
  assert.equal(response.status, 202);
  const instruction = (response.body as { instruction: PatientInstructionRecord }).instruction;
  assert.equal(instruction.status, "send_requested");
  assert.equal(instruction.providerConfirmationReceived, false);
  assert.equal(instruction.deliveredAt, null);
  assert.equal(instruction.readAt, null);
  assert.equal(evidence.outbox[0]?.eventType, "instruction.send_requested");
});

function executionContext(
  ports: {
    readonly dentalTreatment?: Record<string, unknown>;
    readonly billing?: Record<string, unknown>;
    readonly clinicalCare?: Record<string, unknown>;
  },
  evidence = evidenceRecorder()
): ClinicFeatureExecutionContext {
  return {
    repositories: {
      dentalTreatment: ports.dentalTreatment ?? {},
      billing: ports.billing ?? {},
      clinicalCare: ports.clinicalCare ?? {}
    },
    evidence,
    requestGuards: {},
    clock: { now: () => new Date(FIXED_NOW) }
  } as unknown as ClinicFeatureExecutionContext;
}

function evidenceRecorder() {
  const audit: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  return {
    audit,
    outbox,
    async appendAuditEvent(event: Record<string, unknown>) {
      audit.push(event);
    },
    async appendOutboxEvent(event: Record<string, unknown>) {
      outbox.push(event);
    }
  } as unknown as ClinicModuleTransactionContext["evidence"] & {
    audit: Array<Record<string, unknown>>;
    outbox: Array<Record<string, unknown>>;
  };
}

function operationRequest(
  operationId: TreatmentBillingClinicOperationId,
  role: ClinicRoleSlug,
  parsed: {
    readonly path?: Record<string, unknown>;
    readonly query?: Record<string, unknown>;
    readonly headers?: Record<string, unknown>;
    readonly body?: unknown;
  }
): ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId> {
  const clinic = {
    id: CLINIC_ID,
    tenantId: TENANT_ID,
    slug: "synthetic-clinic",
    displayName: "Synthetic Clinic",
    status: "active" as const,
    timezone: "Asia/Kolkata"
  };
  const access = buildAccessContext({
    principal: {
      subject: `synthetic-${role}`,
      issuer: "https://identity.synthetic.invalid/realms/clinicos",
      email: null,
      displayName: `Synthetic ${role}`,
      username: `synthetic-${role}`,
      keycloakRoles: [role]
    },
    tenant: {
      id: TENANT_ID,
      slug: "synthetic-tenant",
      legalName: "Synthetic Tenant",
      displayName: "Synthetic Tenant",
      status: "active"
    },
    user: {
      id: USER_ID,
      displayName: `Synthetic ${role}`,
      email: null,
      phone: null,
      status: "active"
    },
    memberships: [{ tenantId: TENANT_ID, userId: USER_ID, status: "active" }],
    clinicAssignments: [
      { tenantId: TENANT_ID, clinicId: CLINIC_ID, userId: USER_ID, status: "active" }
    ],
    roleAssignments: [{ tenantId: TENANT_ID, clinicId: CLINIC_ID, userId: USER_ID, roleSlug: role }]
  });
  return {
    operationId,
    access: { context: access, clinics: [clinic], clinicId: CLINIC_ID, clinic },
    parsed: {
      path: parsed.path ?? {},
      query: parsed.query ?? {},
      headers: parsed.headers ?? {},
      ...(parsed.body === undefined ? {} : { body: parsed.body })
    } as never,
    metadata: {
      requestId: `request-${operationId}`,
      receivedAt: new Date(FIXED_NOW),
      ipAddress: "127.0.0.1",
      userAgent: "cp13-treatment-billing-test"
    }
  };
}

function idempotencyHeaders(key: string) {
  return { "idempotency-key": key };
}

function permissionDenied(permission: string) {
  return (error: unknown) =>
    error instanceof ApiError &&
    error.status === 403 &&
    error.code === "PERMISSION_DENIED" &&
    error.details.required_permission === permission;
}

function treatmentPlan(status: "draft" | "accepted"): TreatmentPlanDetail {
  return {
    treatmentPlan: {
      id: PLAN_ID,
      tenantId: TENANT_ID,
      clinicId: CLINIC_ID,
      rowVersion: status === "accepted" ? 2 : 1,
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      title: "Synthetic restorative plan",
      status,
      currency: "INR",
      subtotalMinor: 10_000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 10_000,
      clinicalSummary: "Synthetic clinical summary",
      presentedAt: FIXED_NOW,
      acceptedAt: status === "accepted" ? FIXED_NOW : null,
      acceptedByUserId: status === "accepted" ? USER_ID : null,
      acceptedByName: status === "accepted" ? "Synthetic Patient" : null,
      acceptanceEvidence: status === "accepted" ? { source: "paper_card" } : {},
      createdByUserId: USER_ID,
      updatedByUserId: USER_ID,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW
    },
    phases: [
      {
        id: PHASE_ID,
        tenantId: TENANT_ID,
        clinicId: CLINIC_ID,
        treatmentPlanId: PLAN_ID,
        phaseIndex: 1,
        title: "Synthetic phase",
        description: null,
        estimatedStartAfterDays: null,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
        estimateItems: [
          {
            id: ITEM_ID,
            tenantId: TENANT_ID,
            clinicId: CLINIC_ID,
            treatmentPlanId: PLAN_ID,
            phaseId: PHASE_ID,
            pricebookProcedureId: PRICEBOOK_ID,
            dentalFindingId: null,
            toothNumber: "11",
            quantity: 1,
            unitPriceMinor: 10_000,
            discountMinor: 0,
            taxRateBasisPoints: 0,
            taxMinor: 0,
            totalMinor: 10_000,
            estimatedVisits: 1,
            priority: null,
            notes: null,
            status: status === "accepted" ? "accepted" : "planned",
            createdAt: FIXED_NOW,
            updatedAt: FIXED_NOW
          }
        ]
      }
    ]
  };
}

function performedProcedure(invoiceId: UUID | null): ProcedurePerformedRecord {
  return {
    id: PROCEDURE_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    patientId: PATIENT_ID,
    encounterId: ENCOUNTER_ID,
    treatmentPlanId: PLAN_ID,
    treatmentPlanEstimateItemId: ITEM_ID,
    pricebookProcedureId: PRICEBOOK_ID,
    dentalFindingId: null,
    invoiceId,
    toothNumber: "11",
    quantity: 1,
    unitPriceMinor: 10_000,
    discountMinor: 0,
    taxRateBasisPoints: 0,
    taxMinor: 0,
    totalMinor: 10_000,
    status: "completed",
    performedByUserId: USER_ID,
    performedAt: FIXED_NOW,
    notes: null,
    outcome: "Synthetic completed outcome",
    provenance: { source: "synthetic_clinician_entry" },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW
  };
}

function invoiceDetail(input: {
  readonly procedure?: ProcedurePerformedRecord;
  readonly paidMinor: number;
  readonly balanceMinor?: number;
  readonly payments?: PaymentTransactionRecord[];
}): InvoiceDetail {
  const procedure = input.procedure ?? performedProcedure(INVOICE_ID);
  return {
    invoice: {
      id: INVOICE_ID,
      tenantId: TENANT_ID,
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      invoiceNumber: "SYN-INV-001",
      status: "issued",
      paymentStatus: input.paidMinor > 0 ? "partially_paid" : "unpaid",
      currency: "INR",
      subtotalMinor: 10_000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 10_000,
      paidMinor: input.paidMinor,
      refundedMinor: 0,
      balanceMinor: input.balanceMinor ?? 10_000 - input.paidMinor,
      treatmentPlanId: PLAN_ID,
      issuedAt: FIXED_NOW,
      dueAt: null,
      createdByUserId: USER_ID,
      updatedByUserId: USER_ID,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW
    },
    items: [
      {
        id: "10000000-0000-4000-8000-000000007002" as UUID,
        tenantId: TENANT_ID,
        clinicId: CLINIC_ID,
        invoiceId: INVOICE_ID,
        patientId: PATIENT_ID,
        procedurePerformedId: procedure.id,
        treatmentPlanEstimateItemId: ITEM_ID,
        pricebookProcedureId: PRICEBOOK_ID,
        description: "Synthetic procedure",
        quantity: 1,
        unitPriceMinor: 10_000,
        discountMinor: 0,
        taxRateBasisPoints: 0,
        taxMinor: 0,
        totalMinor: 10_000,
        createdAt: FIXED_NOW
      }
    ],
    paymentRequests: [],
    payments: input.payments ?? [],
    receipts: []
  };
}

function manualPayment(input: {
  readonly amountMinor: number;
  readonly idempotencyKey: string;
}): PaymentTransactionRecord {
  return {
    id: PAYMENT_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    invoiceId: INVOICE_ID,
    patientId: PATIENT_ID,
    paymentRequestId: null,
    provider: "manual",
    providerPaymentId: null,
    providerOrderId: null,
    amountMinor: input.amountMinor,
    currency: "INR",
    method: "cash",
    status: "manually_recorded",
    verificationStatus: "not_required_manual",
    reconciliationStatus: "matched",
    idempotencyKey: input.idempotencyKey,
    receivedAt: FIXED_NOW,
    recordedByUserId: USER_ID,
    receiptId: null,
    metadata: { evidence: { registerLine: "synthetic-001" } },
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW
  };
}

function paymentRequestRecord(amountMinor: number): PaymentRequestRecord {
  return {
    id: PAYMENT_REQUEST_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    invoiceId: INVOICE_ID,
    patientId: PATIENT_ID,
    provider: "razorpay",
    requestType: "dynamic_qr",
    status: "provider_created",
    amountMinor,
    currency: "INR",
    providerReferenceId: "rzp_synthetic_request_001",
    providerUrl: null,
    providerQrPayload: "synthetic-qr-payload",
    expiresAt: null,
    metadata: {},
    createdByUserId: USER_ID,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW
  };
}

function patientInstruction(): PatientInstructionRecord {
  return {
    id: INSTRUCTION_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    patientId: PATIENT_ID,
    channel: "whatsapp",
    templateId: "synthetic-post-op-v1",
    title: "Synthetic post-op instructions",
    body: "Synthetic instructions only.",
    status: "send_requested",
    renderedAt: FIXED_NOW,
    printJobId: null,
    outboxEventId: "10000000-0000-4000-8000-000000009002" as UUID,
    providerConfirmationReceived: false,
    providerDeliveryConfirmedAt: null,
    deliveredAt: null,
    readAt: null,
    createdByUserId: USER_ID,
    createdAt: FIXED_NOW
  };
}

function availableProvider(): PaymentProvider {
  return {
    providerKey: "razorpay",
    capabilities: () => ["CREATE_PAYMENT_QR", "CREATE_PAYMENT_LINKS", "VERIFY_WEBHOOKS"],
    healthCheck: async () => ({
      providerKey: "razorpay",
      status: "available",
      checkedAt: FIXED_NOW,
      capabilities: ["CREATE_PAYMENT_QR", "CREATE_PAYMENT_LINKS", "VERIFY_WEBHOOKS"]
    }),
    createInvoiceQr: async (input) => ({
      providerKey: "razorpay",
      requestKind: "invoice_qr",
      providerRequestId: "rzp_synthetic_request_001",
      amountPaise: input.amountPaise,
      currency: input.currency,
      status: "created",
      qrString: "synthetic-qr-payload",
      metadata: {},
      providerHealth: {
        providerKey: "razorpay",
        status: "available",
        checkedAt: FIXED_NOW,
        capabilities: ["CREATE_PAYMENT_QR", "CREATE_PAYMENT_LINKS", "VERIFY_WEBHOOKS"]
      }
    }),
    createPaymentLink: async (input) => ({
      providerKey: "razorpay",
      requestKind: "payment_link",
      providerRequestId: "rzp_synthetic_request_001",
      amountPaise: input.amountPaise,
      currency: input.currency,
      status: "created",
      paymentUrl: "https://payments.synthetic.invalid/request/001",
      metadata: {},
      providerHealth: {
        providerKey: "razorpay",
        status: "available",
        checkedAt: FIXED_NOW,
        capabilities: ["CREATE_PAYMENT_QR", "CREATE_PAYMENT_LINKS", "VERIFY_WEBHOOKS"]
      }
    }),
    closeQr: async ({ providerRequestId }) => ({ providerRequestId, status: "closed" }),
    cancelPaymentLink: async ({ providerRequestId }) => ({
      providerRequestId,
      status: "cancelled"
    }),
    fetchPayment: async ({ providerPaymentId }) => ({
      providerKey: "razorpay",
      providerPaymentId,
      amountPaise: 1,
      currency: "INR",
      status: "captured",
      captured: true,
      metadata: {}
    }),
    verifyWebhook: async () => ({
      status: "verified",
      providerKey: "razorpay",
      message: "Synthetic verified event."
    }),
    parseWebhook: async () => {
      throw new Error("Webhook parsing is tested through the provider service.");
    }
  };
}

function unavailableProvider(): PaymentProvider {
  return {
    ...availableProvider(),
    capabilities: () => [],
    healthCheck: async () => ({
      providerKey: "razorpay",
      status: "not_configured",
      checkedAt: FIXED_NOW,
      capabilities: []
    })
  };
}
