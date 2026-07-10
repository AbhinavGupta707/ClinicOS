import assert from "node:assert/strict";
import test from "node:test";
import { bundleWorkflowCode } from "@temporalio/worker";
import {
  CP13_ACTIVITY_RETRY_POLICY,
  CP13_DUE_GENERATION_CONTINUE_AS_NEW_BATCH_THRESHOLD,
  CP13_DUE_GENERATION_VERSION_MARKER,
  CP13_INSTRUCTION_SEND_VERSION_MARKER,
  CP13_MAX_DUE_GENERATION_BATCH_SIZE,
  CP13_PAYMENT_RECOVERY_VERSION_MARKER,
  type Cp13ClaimedPaymentIntent,
  type Cp13DueGenerationWorkflowInput,
  type Cp13PaymentIntentIdentity,
  type Cp13ProviderPaymentRequestRecoveryResult
} from "../cp13-contracts.js";
import {
  advanceCp13DueGeneration,
  claimedPaymentIntentIsAuthoritative,
  createCp13DueGenerationProgress,
  paymentRecoveryResultIsAuthoritative,
  planProviderPaymentResolution,
  toProviderPaymentRequestRecoveryRequest
} from "../cp13-workflow-state.js";
import {
  buildCp13DueGenerationWorkflowId,
  buildCp13PatientInstructionSendWorkflowId,
  buildCp13PaymentRequestRecoveryWorkflowId
} from "../cp13-workflow-ids.js";

const dueInput: Cp13DueGenerationWorkflowInput = {
  schemaVersion: "1.0",
  workflowVersion: 1,
  tenantId: "tenant-001",
  clinicId: "clinic-001",
  actorUserId: "user-001",
  eventId: "event-001",
  correlationId: "corr-001",
  idempotencyKey: "idem-001",
  requestedAt: "2026-07-10T08:00:00.000Z",
  generationKind: "continuity",
  asOf: "2026-07-10T08:00:00.000Z",
  batchSize: 25,
  cursor: "signed.opaque/cursor+value=="
};

test("CP13 workflow IDs are stable and scope every durable execution", () => {
  assert.equal(
    buildCp13DueGenerationWorkflowId(dueInput),
    "tenant/tenant-001/clinic/clinic-001/actor/user-001/clinic-day/continuity/2026-07-10T08:00:00.000Z"
  );
  assert.equal(
    buildCp13PatientInstructionSendWorkflowId({
      tenantId: "tenant-001",
      clinicId: "clinic-001",
      actorUserId: "user-001",
      patientId: "patient-001",
      instructionId: "instruction-001"
    }),
    "tenant/tenant-001/clinic/clinic-001/actor/user-001/patient/patient-001/instruction-send/instruction-001"
  );
  assert.equal(
    buildCp13PaymentRequestRecoveryWorkflowId({
      tenantId: "tenant-001",
      clinicId: "clinic-001",
      actorUserId: "user-001",
      durableIntentId: "intent-001"
    }),
    "tenant/tenant-001/clinic/clinic-001/actor/user-001/payment-request-recovery/intent-001"
  );
  assert.notEqual(
    buildCp13DueGenerationWorkflowId(dueInput),
    buildCp13DueGenerationWorkflowId({ ...dueInput, actorUserId: "user-002" })
  );
});

test("due generation passes an opaque cursor unchanged and records bounded progress", () => {
  const progress = createCp13DueGenerationProgress(dueInput);
  assert.equal(progress.cursor, dueInput.cursor);
  assert.equal(progress.actorUserId, dueInput.actorUserId);
  assert.equal(progress.eventId, dueInput.eventId);
  const next = advanceCp13DueGeneration(dueInput, progress, {
    processedCount: 3,
    createdCount: 2,
    skippedCount: 1,
    complete: false,
    nextCursor: "another.opaque/signed-value==",
    evidenceId: "due-evidence-001"
  });
  assert.equal(next.action, "continue");
  assert.equal(next.progress.cursor, "another.opaque/signed-value==");
  assert.equal(next.progress.processedCount, 3);
  assert.equal(next.progress.createdCount, 2);
  assert.equal(next.progress.skippedCount, 1);
});

test("due generation fails closed on an incomplete no-progress batch", () => {
  const progress = createCp13DueGenerationProgress(dueInput);
  const step = advanceCp13DueGeneration(dueInput, progress, {
    processedCount: 0,
    createdCount: 0,
    skippedCount: 0,
    complete: false,
    nextCursor: dueInput.cursor,
    evidenceId: "due-evidence-002"
  });
  assert.equal(step.action, "terminal");
  assert.equal(step.progress.status, "failed");
  assert.equal(step.progress.failureCode, "DUE_GENERATION_NO_PROGRESS");
});

test("due generation continues as new at the frozen history threshold", () => {
  const progress = {
    ...createCp13DueGenerationProgress(dueInput),
    processedCount: 19,
    createdCount: 10,
    skippedCount: 9,
    batchCount: CP13_DUE_GENERATION_CONTINUE_AS_NEW_BATCH_THRESHOLD - 1
  };
  const step = advanceCp13DueGeneration(dueInput, progress, {
    processedCount: 1,
    createdCount: 1,
    skippedCount: 0,
    complete: false,
    nextCursor: "opaque-continuation-cursor",
    evidenceId: "due-evidence-003"
  });
  assert.equal(step.action, "continue_as_new");
  if (step.action !== "continue_as_new") return;
  assert.equal(step.input.cursor, "opaque-continuation-cursor");
  assert.equal(step.input.continuation?.batchCount, 20);
  assert.equal(step.input.continuation?.continueAsNewCount, 1);
  assert.equal(step.input.continuation?.processedCount, 20);
  assert.equal(createCp13DueGenerationProgress(step.input).continueAsNewCount, 1);
});

test("due generation rejects batches outside the production bound", () => {
  assert.equal(CP13_MAX_DUE_GENERATION_BATCH_SIZE, 25);
  assert.throws(
    () => createCp13DueGenerationProgress({ ...dueInput, batchSize: 26 }),
    /batchSize must be an integer from 1 through 25/u
  );
  assert.throws(
    () => createCp13DueGenerationProgress({ ...dueInput, cursor: "x".repeat(2_049) }),
    /cursor must be null or a non-empty opaque string/u
  );
});

test("payment recovery preserves link versus QR truth and reconciles mismatches", () => {
  const identity: Cp13PaymentIntentIdentity = {
    tenantId: "tenant-001",
    clinicId: "clinic-001",
    actorUserId: "user-001",
    patientId: "patient-001",
    invoiceId: "invoice-001",
    durableIntentId: "intent-001",
    intentDigest: "a".repeat(64),
    requestType: "payment_link"
  };
  const intent: Cp13ClaimedPaymentIntent = {
    ...identity,
    claimToken: "claim-001",
    providerKey: "razorpay",
    amountMinor: 12500,
    currency: "INR",
    description: "Invoice invoice-001 collection",
    expiresAt: "2026-07-11T08:00:00.000Z",
    customer: {
      name: "Synthetic Patient",
      email: "synthetic@example.invalid",
      contact: "+910000000000"
    },
    metadata: { checkoutSurface: "clinic_day" }
  };
  assert.equal(claimedPaymentIntentIsAuthoritative(identity, intent), true);
  const providerRequest = toProviderPaymentRequestRecoveryRequest(intent, {
    eventId: "event-001",
    correlationId: "corr-001",
    idempotencyKey: "idem-001"
  });
  assert.deepEqual(
    {
      requestType: providerRequest.requestType,
      amountMinor: providerRequest.amountMinor,
      currency: providerRequest.currency,
      description: providerRequest.description,
      expiresAt: providerRequest.expiresAt,
      customer: providerRequest.customer,
      metadata: providerRequest.metadata
    },
    {
      requestType: "payment_link",
      amountMinor: 12500,
      currency: "INR",
      description: "Invoice invoice-001 collection",
      expiresAt: "2026-07-11T08:00:00.000Z",
      customer: {
        name: "Synthetic Patient",
        email: "synthetic@example.invalid",
        contact: "+910000000000"
      },
      metadata: { checkoutSurface: "clinic_day" }
    }
  );
  assert.equal(
    claimedPaymentIntentIsAuthoritative(identity, {
      ...intent,
      metadata: { providerSecret: "must-not-enter-workflow" }
    }),
    false
  );
  const provider: Cp13ProviderPaymentRequestRecoveryResult = {
    outcome: "created_or_recovered",
    providerKey: "razorpay",
    providerRequestId: "provider-request-001",
    artifact: { kind: "invoice_qr", qrString: "qr-value", qrImageUrl: null },
    providerEvidenceId: "provider-evidence-001"
  };
  const resolution = planProviderPaymentResolution(identity, intent, provider, {
    eventId: "event-001",
    correlationId: "corr-001",
    idempotencyKey: "idem-001"
  });
  assert.equal(resolution.resolution.status, "reconciliation_required");
  if (resolution.resolution.status === "reconciliation_required") {
    assert.equal(resolution.resolution.reasonCode, "PAYMENT_PROVIDER_RECOVERY_MISMATCH");
  }

  assert.equal(
    paymentRecoveryResultIsAuthoritative(identity, {
      ...identity,
      status: "requested",
      providerKey: "razorpay",
      providerRequestId: "provider-request-001",
      artifact: { kind: "payment_link", paymentUrl: "https://payments.example/request/001" },
      evidenceId: "final-evidence-001"
    }),
    true
  );
  assert.equal(
    paymentRecoveryResultIsAuthoritative(identity, {
      ...identity,
      status: "requested",
      providerKey: "razorpay",
      providerRequestId: "provider-request-001",
      artifact: { kind: "payment_link", paymentUrl: "http://unsafe.example/request/001" },
      evidenceId: "final-evidence-001"
    }),
    false
  );
});

test("Temporal workflow bundle includes CP13 versioned deterministic workflow exports", async () => {
  const bundle = await bundleWorkflowCode({
    workflowsPath: new URL("../workflows/index.js", import.meta.url).pathname
  });
  assert.ok(bundle.code.length > 0);
  assert.equal(CP13_DUE_GENERATION_VERSION_MARKER, "cp13-due-generation-v1");
  assert.equal(CP13_INSTRUCTION_SEND_VERSION_MARKER, "cp13-instruction-send-v1");
  assert.equal(CP13_PAYMENT_RECOVERY_VERSION_MARKER, "cp13-payment-recovery-v1");
  assert.deepEqual(CP13_ACTIVITY_RETRY_POLICY, {
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "5 minutes",
    maximumAttempts: 6
  });
});
