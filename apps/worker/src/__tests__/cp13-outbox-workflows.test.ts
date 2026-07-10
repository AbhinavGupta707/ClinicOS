import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";
import type {
  ApprovalActivities,
  Cp13ActivityPorts,
  Cp13DueGenerationWorkflowInput,
  Cp13PaymentRequestRecoveryWorkflowInput
} from "@clinic-os/workflow";
import { createCp13WorkerComposition } from "../cp13/create-cp13-worker-composition.js";
import { classifyOutboxFailure } from "../outbox/errors.js";
import { OutboxHandlerRegistry } from "../outbox/handler-registry.js";
import {
  CP13_CONTINUITY_DUE_GENERATION_REQUESTED_EVENT,
  CP13_SOP_DUE_GENERATION_REQUESTED_EVENT,
  Cp13ContinuityDueGenerationRequestedHandler,
  Cp13SopDueGenerationRequestedHandler
} from "../outbox/handlers/cp13-due-generation-requested.js";
import {
  CP13_PATIENT_INSTRUCTION_SEND_REQUESTED_EVENT,
  Cp13PatientInstructionSendRequestedHandler
} from "../outbox/handlers/cp13-patient-instruction-send-requested.js";
import {
  CP13_PAYMENT_REQUEST_RECOVERY_REQUESTED_EVENT,
  Cp13PaymentRequestRecoveryRequestedHandler
} from "../outbox/handlers/cp13-payment-request-recovery-requested.js";
import type {
  OutboxAttemptRecord,
  OutboxEventHandler,
  OutboxEventRecord,
  OutboxHandlerContext
} from "../outbox/types.js";

test("CP13 due-generation handlers propagate the frozen opaque cursor and stable workflow ID", async () => {
  const temporal = new RecordingTemporalClient();
  const event = dueEvent("continuity");
  const handler = new Cp13ContinuityDueGenerationRequestedHandler({
    temporalClient: temporal.asClient()
  });

  await handler.handle(event, contextFor(event));

  assert.equal(temporal.calls.length, 1);
  const options = temporal.calls[0]?.options;
  assert.equal(
    options?.workflowId,
    "tenant/tenant-001/clinic/clinic-001/actor/user-001/clinic-day/continuity/2026-07-10T08:00:00.000Z"
  );
  assert.equal(options?.workflowIdReusePolicy, "REJECT_DUPLICATE");
  const input = options?.args?.[0] as Cp13DueGenerationWorkflowInput;
  assert.equal(input.cursor, "signed.opaque/cursor==");
  assert.equal(input.batchSize, 25);
  assert.equal(input.asOf, "2026-07-10T08:00:00.000Z");
  assert.equal(input.actorUserId, "user-001");
  assert.equal(input.eventId, event.eventId);
  assert.equal(input.requestedAt, event.occurredAt);
});

test("WorkflowExecutionAlreadyStarted is an idempotent replay for every CP13 starter", async () => {
  const temporal = new RecordingTemporalClient("already_started");
  const cases: readonly [OutboxEventHandler, OutboxEventRecord][] = [
    [
      new Cp13ContinuityDueGenerationRequestedHandler({ temporalClient: temporal.asClient() }),
      dueEvent("continuity")
    ],
    [
      new Cp13SopDueGenerationRequestedHandler({ temporalClient: temporal.asClient() }),
      dueEvent("sop")
    ],
    [
      new Cp13PatientInstructionSendRequestedHandler({ temporalClient: temporal.asClient() }),
      instructionEvent()
    ],
    [
      new Cp13PaymentRequestRecoveryRequestedHandler({ temporalClient: temporal.asClient() }),
      paymentRecoveryEvent()
    ]
  ];

  for (const [handler, event] of cases) {
    await handler.handle(event, contextFor(event));
  }
  assert.equal(temporal.calls.length, 4);
});

test("unexpected Temporal start failures remain transient for outbox crash/retry", async () => {
  const temporal = new RecordingTemporalClient("transient_failure");
  const event = dueEvent("continuity");
  const handler = new Cp13ContinuityDueGenerationRequestedHandler({
    temporalClient: temporal.asClient()
  });
  await assert.rejects(
    () => handler.handle(event, contextFor(event)),
    (error: unknown) => {
      const failure = classifyOutboxFailure(error);
      return failure.retryable && failure.code === "UNEXPECTED_ERROR";
    }
  );
});

test("wrong envelope scope and payload authority are permanent", async () => {
  const temporal = new RecordingTemporalClient();
  const event = dueEvent("continuity");
  const mismatched = {
    ...event,
    aggregateId: "clinic-other"
  };
  const handler = new Cp13ContinuityDueGenerationRequestedHandler({
    temporalClient: temporal.asClient()
  });
  await assert.rejects(
    () => handler.handle(mismatched, contextFor(mismatched)),
    (error: unknown) => {
      const failure = classifyOutboxFailure(error);
      return !failure.retryable && failure.code === "CP13_DUE_GENERATION_ENVELOPE_INVALID";
    }
  );
  const workflow = event.payload.workflow as Record<string, unknown>;
  const payloadAuthority = {
    ...event,
    payload: { workflow: { ...workflow, actorUserId: "user-other" } }
  };
  await assert.rejects(
    () => handler.handle(payloadAuthority, contextFor(payloadAuthority)),
    (error: unknown) => {
      const failure = classifyOutboxFailure(error);
      return !failure.retryable && failure.code === "CP13_DUE_GENERATION_PAYLOAD_INVALID";
    }
  );
  const untrustedActor = {
    ...event,
    actor: { type: "system" as const, id: "scheduler" }
  };
  await assert.rejects(
    () => handler.handle(untrustedActor, contextFor(untrustedActor)),
    (error: unknown) => {
      const failure = classifyOutboxFailure(error);
      return !failure.retryable && failure.code === "CP13_WORKFLOW_ENVELOPE_INVALID";
    }
  );
  assert.equal(temporal.calls.length, 0);
});

test("instruction starter accepts request evidence but rejects delivery or read authority", async () => {
  const temporal = new RecordingTemporalClient();
  const valid = instructionEvent();
  const handler = new Cp13PatientInstructionSendRequestedHandler({
    temporalClient: temporal.asClient()
  });
  await handler.handle(valid, contextFor(valid));
  const input = temporal.calls[0]?.options.args?.[0] as Record<string, unknown>;
  assert.deepEqual(
    {
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      patientId: input.patientId,
      instructionId: input.instructionId
    },
    {
      tenantId: "tenant-001",
      clinicId: "clinic-001",
      actorUserId: "user-001",
      patientId: "patient-001",
      instructionId: "instruction-001"
    }
  );
  assert.equal("deliveredAt" in input, false);
  assert.equal("readAt" in input, false);

  const delivered = {
    ...valid,
    payload: { ...valid.payload, deliveredAt: "2026-07-10T08:01:00.000Z" }
  };
  await assert.rejects(
    () => handler.handle(delivered, contextFor(delivered)),
    (error: unknown) => classifyOutboxFailure(error).retryable === false
  );
  assert.equal(temporal.calls.length, 1);
});

test("payment recovery starter accepts only a pre-existing pending intent identity and digest", async () => {
  const temporal = new RecordingTemporalClient();
  const valid = paymentRecoveryEvent();
  const handler = new Cp13PaymentRequestRecoveryRequestedHandler({
    temporalClient: temporal.asClient()
  });
  await handler.handle(valid, contextFor(valid));
  const input = temporal.calls[0]?.options.args?.[0] as Cp13PaymentRequestRecoveryWorkflowInput;
  assert.equal(input.durableIntentId, "intent-001");
  assert.equal(input.intentDigest, "a".repeat(64));
  assert.equal(input.intentStatus, "pending_provider_request");
  assert.equal(input.actorUserId, "user-001");
  assert.equal(input.eventId, valid.eventId);

  const workflow = valid.payload.workflow as Record<string, unknown>;
  const falselyPaid = {
    ...valid,
    payload: { workflow: { ...workflow, paymentStatus: "paid" } }
  };
  await assert.rejects(
    () => handler.handle(falselyPaid, contextFor(falselyPaid)),
    (error: unknown) => {
      const failure = classifyOutboxFailure(error);
      return !failure.retryable && failure.code === "CP13_PAYMENT_RECOVERY_PAYLOAD_INVALID";
    }
  );
  const providerFieldsInOutbox = {
    ...valid,
    payload: { workflow: { ...workflow, amountMinor: 12_500, currency: "INR" } }
  };
  await assert.rejects(
    () => handler.handle(providerFieldsInOutbox, contextFor(providerFieldsInOutbox)),
    (error: unknown) => classifyOutboxFailure(error).retryable === false
  );
  assert.equal(temporal.calls.length, 1);
});

test("CP13 composition preserves approval and registers only exact action events", () => {
  const temporal = new RecordingTemporalClient();
  const composition = createCp13WorkerComposition({
    temporalClient: temporal.asClient(),
    approvalActivities: approvalActivities(),
    cp13ActivityPorts: cp13ActivityPorts()
  });
  const registry = new OutboxHandlerRegistry(composition.handlers);
  assert.deepEqual(registry.eventTypes(), [
    "instruction.send_requested",
    "workflow.approval.requested",
    "workflow.cp13.continuity_due_generation.requested",
    "workflow.cp13.payment_request_recovery.requested",
    "workflow.cp13.sop_due_generation.requested"
  ]);
  assert.equal(registry.get("task.due"), undefined);
  assert.equal(registry.get("sop_run.created"), undefined);
  assert.equal(registry.get("payment.requested"), undefined);
  assert.deepEqual(Object.keys(composition.activities).sort(), [
    "claimPaymentRequestIntent",
    "createApprovalTask",
    "createOrRecoverProviderPaymentRequest",
    "executeApprovedAction",
    "finalizeOrReconcilePaymentRequestIntent",
    "generateContinuityDueBatch",
    "generateSopDueBatch",
    "recordCp13DueGenerationTerminal",
    "recordPatientInstructionSendTerminal",
    "recordWorkflowStarted",
    "recordWorkflowTerminal",
    "recordWorkflowWaiting",
    "requestPatientInstructionSend"
  ]);
});

interface StartOptionsProjection {
  readonly workflowId: string;
  readonly workflowIdReusePolicy?: string;
  readonly args?: readonly unknown[];
}

class RecordingTemporalClient {
  readonly calls: { readonly workflow: unknown; readonly options: StartOptionsProjection }[] = [];
  readonly #mode: "success" | "already_started" | "transient_failure";

  constructor(mode: "success" | "already_started" | "transient_failure" = "success") {
    this.#mode = mode;
  }

  asClient(): Client {
    return {
      workflow: {
        start: async (workflow: unknown, options: StartOptionsProjection) => {
          this.calls.push({ workflow, options });
          if (this.#mode === "already_started") {
            throw new WorkflowExecutionAlreadyStartedError(
              "already started",
              options.workflowId,
              "cp13-test-workflow"
            );
          }
          if (this.#mode === "transient_failure") throw new Error("Temporal unavailable");
          return {};
        }
      }
    } as unknown as Client;
  }
}

function dueEvent(kind: "continuity" | "sop"): OutboxEventRecord {
  const eventType =
    kind === "continuity"
      ? CP13_CONTINUITY_DUE_GENERATION_REQUESTED_EVENT
      : CP13_SOP_DUE_GENERATION_REQUESTED_EVENT;
  return event({
    eventType,
    aggregateType: "clinic",
    aggregateId: "clinic-001",
    payload: {
      workflow: {
        generationKind: kind,
        asOf: "2026-07-10T08:00:00.000Z",
        batchSize: 25,
        cursor: "signed.opaque/cursor=="
      }
    }
  });
}

function instructionEvent(): OutboxEventRecord {
  return event({
    eventType: CP13_PATIENT_INSTRUCTION_SEND_REQUESTED_EVENT,
    aggregateType: "patient_instruction",
    aggregateId: "instruction-001",
    payload: {
      instructionId: "instruction-001",
      patientId: "patient-001",
      templateId: "post-op-v1",
      channel: "whatsapp",
      status: "send_requested",
      printJobId: null,
      outboxEventId: null,
      providerConfirmationReceived: false,
      providerDeliveryConfirmedAt: null,
      deliveredAt: null,
      readAt: null
    }
  });
}

function paymentRecoveryEvent(): OutboxEventRecord {
  return event({
    eventType: CP13_PAYMENT_REQUEST_RECOVERY_REQUESTED_EVENT,
    aggregateType: "payment_request_intent",
    aggregateId: "intent-001",
    payload: {
      workflow: {
        patientId: "patient-001",
        invoiceId: "invoice-001",
        durableIntentId: "intent-001",
        intentDigest: "a".repeat(64),
        intentStatus: "pending_provider_request",
        requestType: "payment_link"
      }
    }
  });
}

function event(overrides: Partial<OutboxEventRecord>): OutboxEventRecord {
  return {
    eventId: "event-001",
    eventType: "test.event",
    schemaVersion: "1.0",
    tenantId: "tenant-001",
    clinicId: "clinic-001",
    aggregateType: "test",
    aggregateId: "aggregate-001",
    actor: { type: "user", id: "user-001" },
    correlationId: "corr-001",
    idempotencyKey: "idem-001",
    payload: {},
    occurredAt: "2026-07-10T08:00:00.000Z",
    status: "pending",
    attemptCount: 0,
    createdAt: "2026-07-10T08:00:00.000Z",
    updatedAt: "2026-07-10T08:00:00.000Z",
    ...overrides
  };
}

function contextFor(value: OutboxEventRecord): OutboxHandlerContext {
  const attempt: OutboxAttemptRecord = {
    attemptId: "attempt-001",
    eventId: value.eventId,
    attemptNumber: 1,
    workerId: "worker-001",
    status: "started",
    startedAt: value.occurredAt
  };
  return {
    workerId: "worker-001",
    attempt,
    correlationId: value.correlationId,
    tenantId: value.tenantId,
    clinicId: value.clinicId,
    idempotencyKey: value.idempotencyKey
  };
}

function approvalActivities(): ApprovalActivities {
  return {
    recordWorkflowStarted: async () => undefined,
    createApprovalTask: async () => ({
      approvalTaskId: "approval-task-001",
      createdAt: "2026-07-10T08:00:00.000Z"
    }),
    recordWorkflowWaiting: async () => undefined,
    executeApprovedAction: async () => ({ actionExecutionId: "execution-001" }),
    recordWorkflowTerminal: async () => undefined
  };
}

function cp13ActivityPorts(): Cp13ActivityPorts {
  return {
    dueGeneration: {
      generateContinuityDueBatch: async () => ({
        processedCount: 0,
        createdCount: 0,
        skippedCount: 0,
        complete: true,
        nextCursor: null,
        evidenceId: "due-evidence-001"
      }),
      generateSopDueBatch: async () => ({
        processedCount: 0,
        createdCount: 0,
        skippedCount: 0,
        complete: true,
        nextCursor: null,
        evidenceId: "sop-evidence-001"
      }),
      recordCp13DueGenerationTerminal: async () => undefined
    },
    patientInstruction: {
      requestPatientInstructionSend: async () => ({
        outcome: "requested",
        providerSubmissionId: "provider-submission-001",
        requestEvidenceId: "instruction-evidence-001"
      }),
      recordPatientInstructionSendTerminal: async () => undefined
    },
    paymentRequestRecovery: {
      claimPaymentRequestIntent: async () => ({
        outcome: "reconciliation_required",
        reasonCode: "TEST_ONLY",
        evidenceId: "payment-claim-evidence-001"
      }),
      createOrRecoverProviderPaymentRequest: async () => ({
        outcome: "ambiguous",
        reasonCode: "TEST_ONLY",
        providerEvidenceId: "provider-evidence-001"
      }),
      finalizeOrReconcilePaymentRequestIntent: async (request) => ({
        tenantId: request.tenantId,
        clinicId: request.clinicId,
        actorUserId: request.actorUserId,
        patientId: request.patientId,
        invoiceId: request.invoiceId,
        durableIntentId: request.durableIntentId,
        intentDigest: request.intentDigest,
        requestType: request.requestType,
        status: "reconciliation_required",
        evidenceId: "payment-final-evidence-001",
        reconciliationReasonCode: "TEST_ONLY"
      })
    }
  };
}
