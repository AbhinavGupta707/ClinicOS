import assert from "node:assert/strict";
import test from "node:test";
import { buildCp5SmokePlan } from "../../scripts/cp5-contract-smoke.mjs";
import {
  loadCp5Scenario,
  summarizeCp5Scenario,
  validateCp5Scenario
} from "../../scripts/validate-cp5-fixtures.mjs";

test("CP5 synthetic scenario is deterministic and local-test only", async () => {
  const scenario = await loadCp5Scenario();

  assert.equal(validateCp5Scenario(scenario), true);
  assert.deepEqual(summarizeCp5Scenario(scenario), {
    tenants: 2,
    clinics: 2,
    actors: 7,
    patients: 1,
    encounters: 1,
    pricebookProcedures: 2,
    treatmentPlans: 1,
    treatmentPlanItems: 2,
    proceduresPerformed: 1,
    invoices: 1,
    paymentRequests: 1,
    paymentWebhookEvents: 3,
    paymentTransactions: 2,
    receipts: 1,
    prescriptions: 1,
    instructionRequests: 2,
    flowSteps: 17,
    roleTenantExpectations: 12
  });
});

test("CP5 scenario covers treatment plan to invoice to receipt and clinical outputs", async () => {
  const scenario = await loadCp5Scenario();
  const steps = new Set(scenario.flow.steps.map((step) => step.key));

  for (const stepKey of [
    "read-pricebook-procedures",
    "create-treatment-plan-as-doctor",
    "update-treatment-plan-estimate",
    "accept-treatment-plan",
    "record-completed-procedure",
    "create-invoice-from-procedure",
    "read-invoice-before-payment",
    "create-payment-request",
    "reject-bad-signature-webhook",
    "apply-partial-provider-webhook",
    "replay-partial-provider-webhook",
    "record-manual-balance-payment",
    "generate-receipt",
    "create-prescription-draft",
    "sign-prescription-as-doctor",
    "request-instruction-print",
    "request-instruction-send"
  ]) {
    assert.ok(steps.has(stepKey), `${stepKey} missing from CP5 flow`);
  }

  assert.equal(
    scenario.flow.name,
    "treatment plan -> invoice -> payment request -> verified/manual payment -> receipt -> prescription and instructions"
  );

  const invoice = scenario.invoices.find((candidate) => candidate.key === "rctInvoice");
  assert.equal(invoice.totalAmountPaise, 1200000);
  assert.equal(invoice.state, "paid");
  assert.deepEqual(
    invoice.stateHistory.map((history) => history.state),
    ["draft", "payment_requested", "partially_paid", "paid"]
  );
});

test("CP5 scenario rejects fake payment success, preserves partial state, and deduplicates replay", async () => {
  const scenario = await loadCp5Scenario();
  const badWebhook = scenario.paymentWebhookEvents.find(
    (candidate) => candidate.key === "badSignatureWebhook"
  );
  const partialWebhook = scenario.paymentWebhookEvents.find(
    (candidate) => candidate.key === "partialPaymentWebhook"
  );
  const replayWebhook = scenario.paymentWebhookEvents.find(
    (candidate) => candidate.key === "partialPaymentReplayWebhook"
  );
  const providerTransaction = scenario.paymentTransactions.find(
    (candidate) => candidate.key === "razorpayPartialPayment"
  );

  assert.equal(badWebhook.signatureVerified, false);
  assert.equal(badWebhook.accepted, false);
  assert.equal(badWebhook.createdTransactionId, null);
  assert.equal(badWebhook.invoiceStateAfterEvent, "payment_requested");
  assert.equal(badWebhook.invoicePaidAmountPaiseAfterEvent, 0);

  assert.equal(partialWebhook.signatureVerified, true);
  assert.equal(partialWebhook.createdTransactionId, providerTransaction.id);
  assert.equal(partialWebhook.invoiceStateAfterEvent, "partially_paid");
  assert.equal(partialWebhook.invoicePaidAmountPaiseAfterEvent, 350000);
  assert.equal(partialWebhook.invoiceOutstandingAmountPaiseAfterEvent, 850000);

  assert.equal(replayWebhook.providerEventId, partialWebhook.providerEventId);
  assert.equal(replayWebhook.duplicateIgnored, true);
  assert.equal(replayWebhook.createdTransactionId, null);
  assert.equal(replayWebhook.invoicePaidAmountPaiseAfterEvent, 350000);
  assert.equal(
    scenario.responseAssertions.paymentIntegrity.webhookReplayDoesNotDuplicatePayment
      .transactionCountAfterReplay,
    1
  );
});

test("CP5 manual payment and receipt require auditable balance settlement", async () => {
  const scenario = await loadCp5Scenario();
  const manualPayment = scenario.paymentTransactions.find(
    (candidate) => candidate.key === "manualBalancePayment"
  );
  const receipt = scenario.receipts.find((candidate) => candidate.key === "rctReceipt");

  assert.equal(manualPayment.source, "manual");
  assert.equal(manualPayment.amountPaise, 850000);
  assert.equal(manualPayment.method, "upi_manual");
  assert.ok(manualPayment.reference);
  assert.ok(manualPayment.reason);
  assert.equal(manualPayment.capturedByActorKey, "receptionist");

  assert.deepEqual(receipt.paymentTransactionIds, [
    "50000000-0000-4000-8000-000000011001",
    "50000000-0000-4000-8000-000000011002"
  ]);
  assert.equal(receipt.totalPaidPaise, 1200000);

  const manualStep = scenario.flow.steps.find(
    (candidate) => candidate.key === "record-manual-balance-payment"
  );
  assert.ok(
    manualStep.expectedAudit.some((event) => event.action === "payment.manual_recorded")
  );
});

test("CP5 keeps prescription doctor-only and instructions as print/send request evidence", async () => {
  const scenario = await loadCp5Scenario();
  const prescription = scenario.prescriptions.find(
    (candidate) => candidate.key === "postRctPrescription"
  );
  const sendRequest = scenario.instructionRequests.find(
    (candidate) => candidate.key === "postRctWhatsAppInstructionRequest"
  );
  const printRequest = scenario.instructionRequests.find(
    (candidate) => candidate.key === "postRctPrintInstruction"
  );

  assert.equal(prescription.status, "signed");
  assert.equal(prescription.createdByActorKey, "assistant");
  assert.equal(prescription.signedByActorKey, "doctor");
  assert.match(prescription.signedHash, /^sha256:/);

  for (const expectation of [
    ["assistant-cannot-sign-prescription", "missing_permission"],
    ["receptionist-cannot-sign-prescription", "missing_permission"],
    ["doctor-can-sign-prescription", "allow"]
  ]) {
    const [key, expected] = expectation;
    const roleExpectation = scenario.roleTenantExpectations.find(
      (candidate) => candidate.key === key
    );
    assert.ok(roleExpectation, `${key} missing`);
    if (expected === "allow") {
      assert.equal(roleExpectation.expected, "allow");
    } else {
      assert.equal(roleExpectation.expectedReason, expected);
    }
  }

  assert.equal(printRequest.channel, "print");
  assert.equal(printRequest.status, "ready_for_print");
  assert.ok(printRequest.printJobId);
  assert.ok(printRequest.renderedAt);

  assert.equal(sendRequest.channel, "whatsapp");
  assert.equal(sendRequest.status, "requested");
  assert.equal(sendRequest.providerConfirmationReceived, false);
  assert.equal(sendRequest.deliveryClaimed, false);
  assert.equal(sendRequest.outboxEventType, "instruction.send_requested");

  const serializedInstructions = JSON.stringify(scenario.instructionRequests);
  for (const forbiddenStatus of ["delivered", "read"]) {
    assert.equal(serializedInstructions.includes(`"${forbiddenStatus}"`), false);
  }
});

test("CP5 scenario includes accountant and wrong-tenant billing/clinical-output denials", async () => {
  const scenario = await loadCp5Scenario();

  for (const expectation of [
    ["accountant-can-read-invoice-summary", "allow"],
    ["accountant-cannot-read-treatment-plan-clinical-detail", "missing_permission"],
    ["accountant-cannot-request-instructions", "missing_permission"],
    ["wrong-tenant-assistant-cannot-read-treatment-plan", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-read-invoice", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-create-payment-request", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-create-receipt", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-request-instruction", "tenant_mismatch"]
  ]) {
    const [key, expected] = expectation;
    const roleExpectation = scenario.roleTenantExpectations.find(
      (candidate) => candidate.key === key
    );
    assert.ok(roleExpectation, `${key} missing`);
    if (expected === "allow") {
      assert.equal(roleExpectation.expected, "allow");
    } else {
      assert.equal(roleExpectation.expected, "deny");
      assert.equal(roleExpectation.expectedReason, expected);
    }
  }
});

test("CP5 smoke plan can be built from documented contracts", async () => {
  const scenario = await loadCp5Scenario();
  const plan = buildCp5SmokePlan(scenario);

  assert.equal(plan.flowRequests.length, 17);
  assert.equal(plan.negativeRequests.length, 9);
  assert.equal(plan.postFlowVerification.length, 4);
  assert.deepEqual(
    plan.flowRequests.map((request) => `${request.method} ${request.path}`),
    [
      "GET /v1/pricebook/procedures",
      "POST /v1/patients/50000000-0000-4000-8000-000000002001/treatment-plans",
      "PATCH /v1/treatment-plans/50000000-0000-4000-8000-000000006001",
      "POST /v1/treatment-plans/50000000-0000-4000-8000-000000006001/accept",
      "POST /v1/encounters/50000000-0000-4000-8000-000000004001/procedures",
      "POST /v1/invoices",
      "GET /v1/invoices/50000000-0000-4000-8000-000000008001",
      "POST /v1/invoices/50000000-0000-4000-8000-000000008001/payment-requests",
      "POST /v1/payment-webhooks/razorpay",
      "POST /v1/payment-webhooks/razorpay",
      "POST /v1/payment-webhooks/razorpay",
      "POST /v1/invoices/50000000-0000-4000-8000-000000008001/manual-payments",
      "POST /v1/invoices/50000000-0000-4000-8000-000000008001/receipts",
      "POST /v1/encounters/50000000-0000-4000-8000-000000004001/prescriptions",
      "POST /v1/prescriptions/50000000-0000-4000-8000-000000013001/sign",
      "POST /v1/patients/50000000-0000-4000-8000-000000002001/instructions",
      "POST /v1/patients/50000000-0000-4000-8000-000000002001/instructions"
    ]
  );

  assert.ok(plan.flowRequests.some((request) => request.key === "reject-bad-signature-webhook"));
  assert.ok(plan.flowRequests.some((request) => request.key === "replay-partial-provider-webhook"));
  assert.ok(
    plan.postFlowVerification.some(
      (request) => request.key === "verify-instruction-send-request-evidence"
    )
  );
});
