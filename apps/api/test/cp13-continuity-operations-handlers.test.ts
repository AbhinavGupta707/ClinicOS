import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeOperationRequest } from "@clinic-os/api-contracts";
import { authorize, buildAccessContext } from "@clinic-os/auth";
import type {
  ClinicModuleTransactionContext,
  ClinicRepositoryModules,
  TransactionEvidencePort
} from "@clinic-os/db";
import { FixedClock, type TaskRecord, type UUID } from "@clinic-os/domain";
import type { VerifiedClinicRequestContext } from "../src/framework/contracts.ts";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureOperationRequest
} from "../src/features/contracts.ts";
import { CP13_CONTINUITY_OPERATIONS_OPERATION_IDS } from "../src/features/cp13-operation-ownership.ts";
import {
  createContinuityOperationsHandlerMap,
  type ContinuityOperationsOperationId
} from "../src/features/continuity-operations/index.ts";

const now = "2026-07-10T12:00:00.000Z";
const tenantId = id("0001");
const clinicId = id("0002");
const userId = id("0003");

test("CP13 continuity handler factory covers all 34 frozen operation IDs exactly", () => {
  const handlers = createContinuityOperationsHandlerMap();
  assert.deepEqual(
    Object.keys(handlers).sort(),
    [...CP13_CONTINUITY_OPERATIONS_OPERATION_IDS].sort()
  );
  assert.equal(Object.isFrozen(handlers), true);
  assert.equal(
    Object.values(handlers).every((handler) => typeof handler === "function"),
    true
  );
});

test("CP13 create task uses parsed input, bound port, injected clock, audit and outbox", async () => {
  const evidence = evidenceRecorder();
  const task = taskRecord();
  let receivedInput: Record<string, unknown> | null = null;
  const context = executionContext(
    {
      continuity: {
        createTask: async (input: Record<string, unknown>) => {
          receivedInput = input;
          return task;
        }
      }
    },
    evidence.port
  );
  const response = await createContinuityOperationsHandlerMap().createTask(
    request("createTask", {
      headers: { "idempotency-key": "cp13-task-create-0001" },
      body: {
        title: "Review post-op follow-up",
        patientId: id("0100"),
        taskType: "post_op_follow_up",
        sourceWorkflow: "post_op_follow_up",
        dueAt: "2026-07-10T14:00:00.000Z"
      }
    }),
    context
  );

  assert.equal(response.status, 201);
  assert.equal(receivedInput?.idempotencyKey, "cp13-task-create-0001");
  assert.equal(evidence.audits.length, 1);
  assert.equal(evidence.audits[0]?.action, "task.created");
  assert.equal(evidence.audits[0]?.occurredAt, now);
  assert.equal(evidence.outbox.length, 1);
  assert.equal(evidence.outbox[0]?.eventType, "task.created");
  assert.equal(evidence.outbox[0]?.idempotencyKey, "cp13-task-create-0001");
  assert.doesNotMatch(JSON.stringify(response.body), /tenantId|clinicId/);
});

test("CP13 task transition rejects reopening a completed durable task before writing", async () => {
  let writes = 0;
  const completed = { ...taskRecord(), status: "done" as const };
  const context = executionContext({
    continuity: {
      findTaskById: async () => completed,
      updateTask: async () => {
        writes += 1;
        return completed;
      }
    }
  });
  await assert.rejects(
    createContinuityOperationsHandlerMap().updateTask(
      request("updateTask", {
        path: { taskId: completed.id },
        headers: {
          "idempotency-key": "cp13-task-update-0001",
          "if-match": '"rv-2"'
        },
        body: { status: "open" }
      }),
      context
    ),
    /cannot transition/
  );
  assert.equal(writes, 0);
});

test("CP13 due generation preserves repository retry truth and emits no duplicate event for skips", async () => {
  const evidence = evidenceRecorder();
  let attempt = 0;
  const context = executionContext(
    {
      continuity: {
        generateDueContinuityTasks: async () => {
          attempt += 1;
          return attempt === 1
            ? {
                recallTasksCreated: [taskRecord()],
                followUpTasksCreated: [],
                recallsCreated: [],
                skippedExistingKeys: []
              }
            : {
                recallTasksCreated: [],
                followUpTasksCreated: [],
                recallsCreated: [],
                skippedExistingKeys: ["post-op-follow-up:source-1"]
              };
        }
      }
    },
    evidence.port
  );
  const parsed = request("generateDueContinuityTasks", {
    headers: { "idempotency-key": "cp13-due-generation-0001" },
    body: { asOf: now }
  });
  const first = await createContinuityOperationsHandlerMap().generateDueContinuityTasks(
    parsed,
    context
  );
  const second = await createContinuityOperationsHandlerMap().generateDueContinuityTasks(
    parsed,
    context
  );
  assert.equal(first.status, 202);
  assert.deepEqual((second.body as { skippedExistingKeys: string[] }).skippedExistingKeys, [
    "post-op-follow-up:source-1"
  ]);
  assert.equal(evidence.outbox.length, 1);
});

test("CP13 lab reconciliation emits variance evidence without inventing payment", async () => {
  const evidence = evidenceRecorder();
  const reconciliationId = id("6001");
  const vendorId = id("6002");
  const labCaseId = id("6003");
  const context = executionContext(
    {
      clinicOperations: {
        createLabReconciliation: async () => ({
          reconciliation: {
            id: reconciliationId,
            tenantId,
            clinicId,
            vendorId,
            periodStart: "2026-07-01",
            periodEnd: "2026-07-31",
            status: "variance_review",
            invoiceReference: "INV-REDACTED",
            invoiceAmountMinor: 11_000,
            expectedAmountMinor: 10_000,
            varianceAmountMinor: 1_000,
            currency: "INR",
            evidence: { method: "manual_invoice_review" },
            createdByUserId: userId,
            approvedByUserId: null,
            approvedAt: null,
            createdAt: now,
            updatedAt: now
          },
          entries: [
            {
              id: id("6004"),
              tenantId,
              clinicId,
              reconciliationId,
              labCaseId,
              patientId: id("0100"),
              status: "amount_variance",
              expectedAmountMinor: 10_000,
              invoiceAmountMinor: 11_000,
              varianceAmountMinor: 1_000,
              notes: null,
              createdAt: now
            }
          ]
        })
      }
    },
    evidence.port
  );
  const response = await createContinuityOperationsHandlerMap().createLabReconciliation(
    request("createLabReconciliation", {
      headers: { "idempotency-key": "cp13-lab-recon-0001" },
      body: {
        vendorId,
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        status: "variance_review",
        invoiceReference: "INV-REDACTED",
        invoiceAmountMinor: 11_000,
        evidence: { method: "manual_invoice_review" },
        entries: [{ labCaseId, status: "amount_variance", invoiceAmountMinor: 11_000 }]
      }
    }),
    context
  );
  assert.equal(response.status, 201);
  assert.equal(evidence.outbox[0]?.eventType, "lab_reconciliation.created");
  assert.equal((evidence.outbox[0]?.payload as Record<string, unknown>).paymentExecuted, false);
  assert.doesNotMatch(JSON.stringify(response.body), /\bpaid\b/i);
});

test("CP13 completed inventory checks emit exception and suggestion events without purchase execution", async () => {
  const evidence = evidenceRecorder();
  const checkRunId = id("7001");
  const itemId = id("7002");
  const suggestionId = id("7003");
  const context = executionContext(
    {
      clinicOperations: {
        updateInventoryCheckRun: async () => ({
          run: {
            id: checkRunId,
            tenantId,
            clinicId,
            rowVersion: 3,
            templateId: id("7004"),
            status: "completed",
            startedByUserId: userId,
            completedByUserId: userId,
            startedAt: now,
            completedAt: now,
            notes: null,
            createdAt: now,
            updatedAt: now
          },
          template: {
            id: id("7004"),
            tenantId,
            clinicId,
            code: "DRAWER-A",
            displayName: "Drawer A",
            cadence: "daily",
            active: true,
            createdAt: now,
            updatedAt: now
          },
          lines: [
            {
              id: id("7005"),
              tenantId,
              clinicId,
              checkRunId,
              templateLineId: id("7006"),
              itemId,
              sequence: 1,
              drawerLocation: "Drawer A",
              expectedQuantity: 8,
              countedQuantity: 0,
              varianceQuantity: -8,
              exceptionType: "missing_item",
              exceptionNotes: "Count verified twice",
              countedByUserId: userId,
              countedAt: now
            }
          ],
          procurementSuggestions: [
            {
              id: suggestionId,
              tenantId,
              clinicId,
              itemId,
              sourceCheckRunId: checkRunId,
              sourceCheckRunLineId: id("7005"),
              status: "suggested",
              suggestedQuantity: 8,
              reason: "Missing item",
              taskId: null,
              evidence: { source: "inventory_check" },
              createdByUserId: userId,
              createdAt: now,
              updatedAt: now
            }
          ]
        })
      }
    },
    evidence.port
  );
  const response = await createContinuityOperationsHandlerMap().updateInventoryCheckRun(
    request("updateInventoryCheckRun", {
      path: { checkRunId },
      headers: {
        "idempotency-key": "cp13-inventory-run-0001",
        "if-match": '"rv-2"'
      },
      body: {
        status: "completed",
        lines: [{ lineId: id("7005"), countedQuantity: 0, exceptionNotes: "Count verified twice" }]
      }
    }),
    context
  );
  assert.equal(response.status, 200);
  assert.deepEqual(
    evidence.outbox.map((event) => event.eventType),
    ["inventory_check.completed", "inventory.low_stock_detected", "inventory.procurement_suggested"]
  );
  assert.equal((evidence.outbox[2]?.payload as Record<string, unknown>).purchaseExecuted, false);
});

test("CP13 owner analytics remains aggregate-only and exposes request-time freshness", async () => {
  const evidence = evidenceRecorder();
  const patientId = id("8001");
  const context = executionContext(
    {
      clinicOperations: {
        loadOwnerDashboardProjectionData: async () => ({
          patients: [{ id: patientId, source: "manual", createdAt: now }],
          leads: [],
          appointments: [],
          encounters: [],
          attributionTouches: [],
          treatmentPlans: [],
          procedures: [],
          invoices: [],
          payments: [],
          recalls: [],
          tasks: [],
          sopRuns: [],
          labCases: [],
          inventoryExceptions: [],
          incidents: [],
          correctiveActions: [],
          dataSources: [
            {
              key: "continuity-operations",
              label: "Continuity operations",
              status: "ready",
              recordCount: 1,
              provenance: ["tasks", "recalls", "sop_runs"]
            }
          ]
        })
      }
    },
    evidence.port
  );
  const response = await createContinuityOperationsHandlerMap().getOwnerDashboard(
    request("getOwnerDashboard", { query: { from: "2026-07-10", to: "2026-07-10" } }),
    context
  );
  assert.equal(response.status, 200);
  assert.doesNotMatch(JSON.stringify(response.body), new RegExp(patientId));
  assert.match(JSON.stringify(response.body), /"status":"fresh"/);
  assert.equal(evidence.audits[0]?.action, "owner_dashboard.viewed");
  assert.equal(evidence.outbox.length, 0);
});

test("CP13 central role and tenant policies deny unsupported clinic access", () => {
  const receptionist = accessContext("receptionist");
  assert.deepEqual(
    authorize(receptionist, {
      tenantId,
      clinicId,
      permission: "lab.manage"
    }),
    {
      allowed: false,
      reason: "missing_permission",
      requiredPermission: "lab.manage"
    }
  );
  assert.deepEqual(
    authorize(accessContext("owner_admin"), {
      tenantId: id("9999"),
      clinicId,
      permission: "analytics.read"
    }),
    {
      allowed: false,
      reason: "tenant_mismatch",
      requiredPermission: "analytics.read"
    }
  );
});

function request(
  operationId: ContinuityOperationsOperationId,
  input: { path?: unknown; query?: unknown; headers?: unknown; body?: unknown }
): ClinicFeatureOperationRequest<ContinuityOperationsOperationId> {
  const parsed = parseNativeOperationRequest(operationId, {
    ...input,
    headers: {
      authorization: "Bearer cp13-test-token",
      ...(input.body === undefined ? {} : { "content-type": "application/json" }),
      ...(input.headers as Record<string, unknown> | undefined)
    }
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed));
  if (!parsed.success) throw new Error("Request fixture did not satisfy the frozen contract.");
  return {
    operationId,
    parsed: parsed.data,
    access: { clinicId } as VerifiedClinicRequestContext,
    metadata: {
      requestId: `request-${operationId}`,
      receivedAt: new Date(now),
      ipAddress: "127.0.0.1",
      userAgent: "cp13-test"
    }
  };
}

function executionContext(
  modules: Record<string, Record<string, unknown>>,
  evidence: TransactionEvidencePort = evidenceRecorder().port
): ClinicFeatureExecutionContext {
  return {
    repositories: modules as unknown as ClinicRepositoryModules,
    evidence,
    requestGuards: {} as ClinicModuleTransactionContext["requestGuards"],
    clock: new FixedClock(now)
  };
}

function evidenceRecorder() {
  const audits: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  return {
    audits,
    outbox,
    port: {
      appendAuditEvent: async (event) => {
        audits.push(event);
      },
      appendOutboxEvent: async (event) => {
        outbox.push(event);
      }
    } satisfies TransactionEvidencePort
  };
}

function taskRecord(): TaskRecord {
  return {
    id: id("1001"),
    tenantId,
    clinicId,
    rowVersion: 2,
    patientId: id("0100"),
    leadId: null,
    appointmentId: null,
    invoiceId: null,
    encounterId: null,
    treatmentPlanId: null,
    procedurePerformedId: null,
    taskType: "post_op_follow_up",
    sourceWorkflow: "post_op_follow_up",
    sourceRecordType: "procedure_performed",
    sourceRecordId: id("0200"),
    title: "Review post-op follow-up",
    description: null,
    priority: "normal",
    status: "open",
    dueAt: "2026-07-10T14:00:00.000Z",
    assignedToUserId: null,
    assignedByUserId: null,
    completedByUserId: null,
    completedAt: null,
    completionEvidence: {},
    cancelledReason: null,
    idempotencyKey: "cp13-task-create-0001",
    createdByUserId: userId,
    updatedByUserId: userId,
    statusChangedAt: now,
    createdAt: now,
    updatedAt: now
  };
}

function accessContext(roleSlug: "owner_admin" | "receptionist") {
  return buildAccessContext({
    principal: {
      subject: "cp13-user",
      issuer: "https://issuer.test",
      email: null,
      displayName: "CP13 User",
      username: "cp13-user",
      keycloakRoles: []
    },
    tenant: {
      id: tenantId,
      slug: "cp13-tenant",
      legalName: "CP13 Test Tenant",
      displayName: "CP13 Test Tenant",
      status: "active"
    },
    user: {
      id: userId,
      displayName: "CP13 User",
      email: null,
      phone: null,
      status: "active"
    },
    memberships: [{ tenantId, userId, status: "active" }],
    clinicAssignments: [{ tenantId, clinicId, userId, status: "active" }],
    roleAssignments: [{ tenantId, clinicId, userId, roleSlug }]
  });
}

function id(suffix: string): UUID {
  return `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}
