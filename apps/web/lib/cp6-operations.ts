import type { ClinicRole } from "./roles";

export type Cp6OperationsSource = "api" | "cp6_fixture";

export type RecallStatus = "action_completed" | "booked" | "deferred" | "due";
export type RecallActionKind = "manual_call_completed" | "whatsapp_request_unavailable";

export type TaskKind =
  | "corrective_action"
  | "lab_follow_up"
  | "payment_follow_up"
  | "post_op_follow_up"
  | "procurement"
  | "recall"
  | "sop";
export type TaskStatus = "assigned" | "blocked" | "completed" | "in_progress" | "open";

export type SopRunStatus = "completed" | "due" | "in_progress";
export type LabCaseStatus =
  | "cancelled"
  | "completed"
  | "draft"
  | "due"
  | "fitted"
  | "ready_for_pickup"
  | "received_by_lab"
  | "returned"
  | "rework_required"
  | "sent_to_lab";
export type InventoryCheckRunStatus = "completed" | "in_progress" | "scheduled" | "variance_review";
export type InventoryExceptionStatus =
  | "low_stock"
  | "procurement_requested"
  | "resolved"
  | "variance";
export type IncidentStatus = "capa_assigned" | "closed" | "open";
export type CorrectiveActionStatus = "assigned" | "completed" | "in_progress";

export interface Cp6PatientRef {
  accountLabel: string;
  displayName: string;
  id: string;
}

export interface RecallAction {
  actorName: string;
  at: string;
  detail: string;
  id: string;
  kind: RecallActionKind;
}

export interface RecallDue {
  actionHistory: RecallAction[];
  dueDate: string;
  id: string;
  patientId: string;
  ruleLabel: string;
  status: RecallStatus;
  suggestedChannel: "manual_call" | "whatsapp";
}

export interface Cp6Task {
  assignedToName?: string;
  assignedToRole: ClinicRole;
  completedAt?: string;
  detail: string;
  dueAt: string;
  id: string;
  kind: TaskKind;
  patientId?: string;
  status: TaskStatus;
  title: string;
}

export interface SopChecklistItem {
  completedAt?: string;
  id: string;
  label: string;
  required: boolean;
  status: "completed" | "open";
}

export interface SopRun {
  checklist: SopChecklistItem[];
  dueAt: string;
  id: string;
  ownerRole: ClinicRole;
  status: SopRunStatus;
  templateTitle: string;
}

export interface LabVendor {
  id: string;
  name: string;
}

export interface LabCase {
  amountCents: number;
  dueDate: string;
  id: string;
  material: string;
  notes: string;
  patientId: string;
  procedure: string;
  reconciliationId?: string;
  shade: string;
  status: LabCaseStatus;
  toothNumber: string;
  vendorId: string;
}

export interface LabReconciliation {
  caseIds: string[];
  createdAt: string;
  createdBy: string;
  expectedAmountCents: number;
  id: string;
  month: string;
  state: "created";
}

export interface InventoryItem {
  category: "equipment" | "instrument" | "material";
  currentOnHand: number;
  expectedOnHand: number;
  id: string;
  location: string;
  name: string;
  reorderPoint: number;
  unit: string;
}

export interface InventoryCountLine {
  countedOnHand?: number;
  expectedOnHand: number;
  itemId: string;
  variance?: number;
}

export interface InventoryCheckRun {
  checkedBy?: string;
  completedAt?: string;
  id: string;
  lines: InventoryCountLine[];
  location: string;
  status: InventoryCheckRunStatus;
  templateTitle: string;
}

export interface InventoryException {
  createdAt: string;
  detail: string;
  id: string;
  itemId: string;
  procurementTaskId?: string;
  status: InventoryExceptionStatus;
}

export interface Incident {
  category: "lab_delay" | "missed_appointment" | "missing_instrument" | "payment_not_collected" | "stockout";
  correctiveActionId?: string;
  createdAt: string;
  description: string;
  id: string;
  impact: string;
  learning: string;
  reportedBy: string;
  status: IncidentStatus;
}

export interface CorrectiveAction {
  assignedToName: string;
  assignedToRole: ClinicRole;
  completedAt?: string;
  completionNote?: string;
  dueDate: string;
  id: string;
  incidentId: string;
  status: CorrectiveActionStatus;
  title: string;
}

export interface Cp6TimelineItem {
  at: string;
  detail: string;
  id: string;
  kind:
    | "corrective_action.completed"
    | "corrective_action.created"
    | "incident.created"
    | "inventory.low_stock_detected"
    | "inventory_check.completed"
    | "inventory_check.updated"
    | "lab_case.completed"
    | "lab_case.returned"
    | "lab_case.sent"
    | "lab_reconciliation.created"
    | "recall.action_completed"
    | "sop_run.completed"
    | "sop_run.updated"
    | "task.assigned"
    | "task.completed"
    | "task.created";
  title: string;
}

export interface Cp6Readiness {
  inventoryProcurement: "manual_task_only" | "provider_unavailable";
  messagingProvider: "provider_unavailable" | "simulator";
  ownerAnalytics: "available" | "source_revenue_deferred";
  workflowTimers: "deterministic_fixture" | "live";
}

export interface Cp6OperationsData {
  api?: {
    environment?: string;
    requestIds: string[];
  };
  correctiveActions: CorrectiveAction[];
  incidents: Incident[];
  inventoryCheckRuns: InventoryCheckRun[];
  inventoryExceptions: InventoryException[];
  inventoryItems: InventoryItem[];
  labCases: LabCase[];
  labReconciliations: LabReconciliation[];
  labVendors: LabVendor[];
  patients: Cp6PatientRef[];
  readiness: Cp6Readiness;
  recalls: RecallDue[];
  sopRuns: SopRun[];
  source: Cp6OperationsSource;
  tasks: Cp6Task[];
  timeline: Cp6TimelineItem[];
  today: string;
}

export type Cp6ProblemCode =
  | "AUTH_REQUIRED"
  | "CONTRACT_MISMATCH"
  | "CP6_ENDPOINT_NOT_REGISTERED"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface Cp6EndpointIssue {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export interface Cp6OperationsProblem {
  code: Cp6ProblemCode;
  detail?: string;
  endpoints: Cp6EndpointIssue[];
  message: string;
}

export type Cp6OperationsLoadState =
  | { data: Cp6OperationsData; status: "ready" }
  | { problem: Cp6OperationsProblem; status: "unauthenticated" | "unavailable" };

export interface RecallActionInput {
  actorName: string;
  detail: string;
  recallId: string;
}

export interface TaskAssignmentInput {
  assignedToName: string;
  assignedToRole: ClinicRole;
  taskId: string;
}

export interface TaskCompletionInput {
  actorName: string;
  completionNote: string;
  taskId: string;
}

export interface SopItemInput {
  actorName: string;
  itemId: string;
  sopRunId: string;
}

export interface SopRunCompletionInput {
  actorName: string;
  sopRunId: string;
}

export interface LabCasePatchInput {
  actorName: string;
  labCaseId: string;
  status: LabCaseStatus;
}

export interface LabReconciliationInput {
  caseIds: string[];
  createdBy: string;
  month: string;
}

export interface InventoryCountInput {
  actorName: string;
  checkRunId: string;
  counts: Record<string, number>;
}

export interface ProcurementRequestInput {
  actorName: string;
  exceptionId: string;
}

export interface IncidentCreateInput {
  category: Incident["category"];
  description: string;
  impact: string;
  learning: string;
  reportedBy: string;
}

export interface CorrectiveActionCreateInput {
  assignedToName: string;
  assignedToRole: ClinicRole;
  dueDate: string;
  incidentId: string;
  title: string;
}

export interface CorrectiveActionCompletionInput {
  actorName: string;
  completionNote: string;
  correctiveActionId: string;
}

interface EndpointResponse {
  payload: unknown;
  requestId?: string;
  status: number;
}

interface EndpointFailure {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export const CP6_READ_ENDPOINTS = [
  "GET /v1/tasks?status=&dueDate=",
  "GET /v1/recalls?status=&dueBefore=",
  "GET /v1/sop-runs?date=",
  "GET /v1/lab-cases?status=&dueBefore=",
  "GET /v1/inventory/exceptions",
  "GET /v1/owner-dashboard?from=&to="
] as const;

export const CP6_WRITE_ENDPOINTS = [
  "POST /v1/tasks",
  "PATCH /v1/tasks/{taskId}",
  "POST /v1/recalls/{recallId}/actions",
  "PATCH /v1/sop-runs/{sopRunId}",
  "PATCH /v1/lab-cases/{labCaseId}",
  "POST /v1/lab-reconciliations",
  "POST /v1/inventory/check-runs",
  "PATCH /v1/inventory/check-runs/{checkRunId}",
  "POST /v1/incidents",
  "POST /v1/corrective-actions",
  "PATCH /v1/corrective-actions/{correctiveActionId}"
] as const;

export const CP6_REQUIRED_ENDPOINTS = [...CP6_READ_ENDPOINTS, ...CP6_WRITE_ENDPOINTS] as const;

const FIXTURE_ENVIRONMENTS = new Set(["development", "dev", "local", "test"]);
let fixtureIdCounter = 0;

export function getTodayInputValue(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isCp6FixtureAllowed() {
  const fixtureRequested =
    process.env.NEXT_PUBLIC_CLINIC_OS_USE_CP6_OPERATIONS_FIXTURE === "true";
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;

  return fixtureRequested && FIXTURE_ENVIRONMENTS.has(environment);
}

export function canManageContinuityTasks(roles: ClinicRole[]) {
  return roles.some((role) => ["assistant", "owner", "receptionist"].includes(role));
}

export function canManageLabCases(roles: ClinicRole[]) {
  return roles.some((role) => ["assistant", "doctor", "owner"].includes(role));
}

export function canManageOperations(roles: ClinicRole[]) {
  return roles.some((role) => ["assistant", "owner"].includes(role));
}

export function canViewOwnerControl(roles: ClinicRole[]) {
  return roles.includes("owner");
}

export function createFixtureCp6OperationsData(today = getTodayInputValue()): Cp6OperationsData {
  const patientId = "cp6SyntheticPatient";
  const recallId = "cp6RecallSixMonth";
  const labCaseId = "cp6LabCaseCrown36";
  const inventoryItemId = "cp6CompositeItem";
  const sopRunId = "cp6SopRunSwitches";
  const checkRunId = "cp6InventoryRunDrawerA";
  const incidentId = "cp6IncidentLabDelay";

  return {
    api: {
      environment: "local synthetic CP6 fixture",
      requestIds: ["fixture-cp6-operations"]
    },
    correctiveActions: [],
    incidents: [
      {
        category: "lab_delay",
        createdAt: `${today}T05:45:00.000Z`,
        description: "Synthetic lab return was delayed during continuity workflow verification.",
        id: incidentId,
        impact: "Assistant had to call before seating the patient.",
        learning: "Confirm lab case due dates during evening close.",
        reportedBy: "assistant fixture user",
        status: "open"
      }
    ],
    inventoryCheckRuns: [
      {
        id: checkRunId,
        lines: [
          {
            expectedOnHand: 6,
            itemId: inventoryItemId
          },
          {
            expectedOnHand: 12,
            itemId: "cp6MirrorItem"
          }
        ],
        location: "Drawer A",
        status: "scheduled",
        templateTitle: "Monthly restorative drawer count"
      }
    ],
    inventoryExceptions: [],
    inventoryItems: [
      {
        category: "material",
        currentOnHand: 6,
        expectedOnHand: 6,
        id: inventoryItemId,
        location: "Drawer A",
        name: "Synthetic composite capsules A2",
        reorderPoint: 4,
        unit: "capsules"
      },
      {
        category: "instrument",
        currentOnHand: 12,
        expectedOnHand: 12,
        id: "cp6MirrorItem",
        location: "Drawer A",
        name: "Synthetic mouth mirrors",
        reorderPoint: 8,
        unit: "pieces"
      }
    ],
    labCases: [
      {
        amountCents: 180000,
        dueDate: today,
        id: labCaseId,
        material: "Zirconia crown",
        notes: "Synthetic CP6 lab case for status and reconciliation verification.",
        patientId,
        procedure: "Crown fabrication",
        shade: "A2",
        status: "draft",
        toothNumber: "36",
        vendorId: "cp6LabVendor"
      }
    ],
    labReconciliations: [],
    labVendors: [
      {
        id: "cp6LabVendor",
        name: "Synthetic Dental Lab"
      }
    ],
    patients: [
      {
        accountLabel: "CP6 account SYN-010",
        displayName: "Synthetic continuity patient",
        id: patientId
      }
    ],
    readiness: {
      inventoryProcurement: "manual_task_only",
      messagingProvider: "provider_unavailable",
      ownerAnalytics: "source_revenue_deferred",
      workflowTimers: "deterministic_fixture"
    },
    recalls: [
      {
        actionHistory: [],
        dueDate: today,
        id: recallId,
        patientId,
        ruleLabel: "Six-month restoration recall",
        status: "due",
        suggestedChannel: "manual_call"
      }
    ],
    sopRuns: [
      {
        checklist: [
          {
            id: "cp6SopSwitches",
            label: "Check chair, compressor, and wall switches",
            required: true,
            status: "open"
          },
          {
            id: "cp6SopCuringLight",
            label: "Place curing light on charger",
            required: true,
            status: "open"
          }
        ],
        dueAt: `${today}T13:30:00.000Z`,
        id: sopRunId,
        ownerRole: "assistant",
        status: "due",
        templateTitle: "Evening close SOP"
      }
    ],
    source: "cp6_fixture",
    tasks: [
      {
        assignedToRole: "assistant",
        detail: "Call after procedure and record whether pain/swelling follow-up is resolved.",
        dueAt: `${today}T10:30:00.000Z`,
        id: "cp6TaskPostOp",
        kind: "post_op_follow_up",
        patientId,
        status: "open",
        title: "Post-op follow-up"
      },
      {
        assignedToRole: "receptionist",
        detail: "Review unpaid synthetic invoice and record manual follow-up outcome.",
        dueAt: `${today}T11:00:00.000Z`,
        id: "cp6TaskPaymentFollowUp",
        kind: "payment_follow_up",
        patientId,
        status: "open",
        title: "Payment follow-up"
      }
    ],
    timeline: [
      timelineItem(
        "task.created",
        "Continuity tasks generated",
        "Synthetic post-op and payment follow-up tasks are due for staff action.",
        `${today}T05:30:00.000Z`
      )
    ],
    today
  };
}

export async function loadCp6Operations(
  signal?: AbortSignal,
  today = getTodayInputValue()
): Promise<Cp6OperationsLoadState> {
  if (isCp6FixtureAllowed()) {
    return {
      data: createFixtureCp6OperationsData(today),
      status: "ready"
    };
  }

  try {
    const monthStart = `${today.slice(0, 8)}01`;
    const [tasks, recalls, sopRuns, labCases, inventoryExceptions, ownerDashboard] =
      await Promise.all([
        fetchEndpoint("/v1/tasks", { dueDate: today, status: "open" }, signal),
        fetchEndpoint("/v1/recalls", { dueBefore: today, status: "due" }, signal),
        fetchEndpoint("/v1/sop-runs", { date: today }, signal),
        fetchEndpoint("/v1/lab-cases", { dueBefore: today, status: "open" }, signal),
        fetchEndpoint("/v1/inventory/exceptions", {}, signal),
        fetchEndpoint("/v1/owner-dashboard", { from: monthStart, to: today }, signal)
      ]);
    const normalized = normalizeCp6OperationsPayload(
      {
        inventoryExceptions: inventoryExceptions.payload,
        labCases: labCases.payload,
        ownerDashboard: ownerDashboard.payload,
        recalls: recalls.payload,
        sopRuns: sopRuns.payload,
        tasks: tasks.payload
      },
      today,
      [tasks, recalls, sopRuns, labCases, inventoryExceptions, ownerDashboard]
        .map((response) => response.requestId)
        .filter((requestId): requestId is string => Boolean(requestId))
    );

    if ("code" in normalized) {
      return {
        problem: normalized,
        status: normalized.code === "AUTH_REQUIRED" ? "unauthenticated" : "unavailable"
      };
    }

    return {
      data: normalized,
      status: "ready"
    };
  } catch (error) {
    const failure = normalizeEndpointFailure(error);
    const problem = classifyCp6EndpointFailures([failure]);

    return {
      problem,
      status: problem.code === "AUTH_REQUIRED" ? "unauthenticated" : "unavailable"
    };
  }
}

export async function createLiveTask(
  input: Omit<Cp6Task, "completedAt" | "id" | "status"> & { source: string },
  signal?: AbortSignal
) {
  return postEndpoint(
    "/v1/tasks",
    {
      assignedToRole: input.assignedToRole,
      detail: input.detail,
      dueAt: input.dueAt,
      kind: input.kind,
      patientId: input.patientId ?? null,
      source: input.source,
      title: input.title
    },
    signal
  );
}

export async function patchLiveTask(
  taskId: string,
  input: Partial<Pick<Cp6Task, "assignedToName" | "assignedToRole" | "status">> & {
    completionEvidence?: {
      actorName: string;
      note: string;
    };
  },
  signal?: AbortSignal
) {
  return patchEndpoint(`/v1/tasks/${encodeURIComponent(taskId)}`, input, signal);
}

export async function completeLiveRecallAction(input: RecallActionInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/recalls/${encodeURIComponent(input.recallId)}/actions`,
    {
      actionType: "manual_call_completed",
      actorName: input.actorName,
      detail: input.detail,
      providerDeliveryConfirmedAt: null
    },
    signal
  );
}

export async function patchLiveSopRun(
  sopRunId: string,
  input: {
    actorName: string;
    checklist?: Array<{ id: string; status: SopChecklistItem["status"] }>;
    status?: SopRunStatus;
  },
  signal?: AbortSignal
) {
  return patchEndpoint(`/v1/sop-runs/${encodeURIComponent(sopRunId)}`, input, signal);
}

export async function patchLiveLabCase(input: LabCasePatchInput, signal?: AbortSignal) {
  return patchEndpoint(
    `/v1/lab-cases/${encodeURIComponent(input.labCaseId)}`,
    {
      status: input.status,
      statusEvidence: {
        actorName: input.actorName,
        source: "operations_surface"
      }
    },
    signal
  );
}

export async function createLiveLabReconciliation(
  input: LabReconciliationInput,
  signal?: AbortSignal
) {
  return postEndpoint(
    "/v1/lab-reconciliations",
    {
      caseIds: input.caseIds,
      createdBy: input.createdBy,
      month: input.month
    },
    signal
  );
}

export async function createLiveInventoryCheckRun(
  input: { startedBy: string; templateId: string },
  signal?: AbortSignal
) {
  return postEndpoint(
    "/v1/inventory/check-runs",
    {
      startedBy: input.startedBy,
      templateId: input.templateId
    },
    signal
  );
}

export async function patchLiveInventoryCheckRun(
  input: InventoryCountInput,
  signal?: AbortSignal
) {
  return patchEndpoint(
    `/v1/inventory/check-runs/${encodeURIComponent(input.checkRunId)}`,
    {
      checkedBy: input.actorName,
      counts: Object.entries(input.counts).map(([itemId, countedOnHand]) => ({
        countedOnHand,
        itemId
      })),
      status: "variance_review"
    },
    signal
  );
}

export async function createLiveIncident(input: IncidentCreateInput, signal?: AbortSignal) {
  return postEndpoint(
    "/v1/incidents",
    {
      category: input.category,
      description: input.description,
      impact: input.impact,
      learning: input.learning,
      reportedBy: input.reportedBy
    },
    signal
  );
}

export async function createLiveCorrectiveAction(
  input: CorrectiveActionCreateInput,
  signal?: AbortSignal
) {
  return postEndpoint(
    "/v1/corrective-actions",
    {
      assignedToName: input.assignedToName,
      assignedToRole: input.assignedToRole,
      dueDate: input.dueDate,
      incidentId: input.incidentId,
      title: input.title
    },
    signal
  );
}

export async function patchLiveCorrectiveAction(
  input: CorrectiveActionCompletionInput,
  signal?: AbortSignal
) {
  return patchEndpoint(
    `/v1/corrective-actions/${encodeURIComponent(input.correctiveActionId)}`,
    {
      completionEvidence: {
        actorName: input.actorName,
        note: input.completionNote
      },
      status: "completed"
    },
    signal
  );
}

export function applyFixtureCompleteRecallAction(
  data: Cp6OperationsData,
  input: RecallActionInput
) {
  const completedAt = new Date().toISOString();

  return {
    ...data,
    recalls: data.recalls.map((recall) =>
      recall.id === input.recallId
        ? {
            ...recall,
            actionHistory: [
              {
                actorName: input.actorName,
                at: completedAt,
                detail: input.detail,
                id: nextFixtureId("cp6-recall-action"),
                kind: "manual_call_completed" as const
              },
              ...recall.actionHistory
            ],
            status: "action_completed" as const
          }
        : recall
    ),
    timeline: prependTimeline(
      data.timeline,
      "recall.action_completed",
      "Recall action completed",
      "Manual recall action completed without fake WhatsApp sent or delivered state.",
      completedAt
    )
  };
}

export function applyFixtureAssignTask(data: Cp6OperationsData, input: TaskAssignmentInput) {
  const assignedAt = new Date().toISOString();

  return {
    ...data,
    tasks: data.tasks.map((task) =>
      task.id === input.taskId
        ? {
            ...task,
            assignedToName: input.assignedToName,
            assignedToRole: input.assignedToRole,
            status: "assigned" as const
          }
        : task
    ),
    timeline: prependTimeline(
      data.timeline,
      "task.assigned",
      "Task assigned",
      `Task assigned to ${input.assignedToName}.`,
      assignedAt
    )
  };
}

export function applyFixtureCompleteTask(data: Cp6OperationsData, input: TaskCompletionInput) {
  const completedAt = new Date().toISOString();

  return {
    ...data,
    tasks: data.tasks.map((task) =>
      task.id === input.taskId
        ? {
            ...task,
            completedAt,
            status: "completed" as const
          }
        : task
    ),
    timeline: prependTimeline(
      data.timeline,
      "task.completed",
      "Task completed",
      input.completionNote,
      completedAt
    )
  };
}

export function applyFixtureCompleteSopItem(data: Cp6OperationsData, input: SopItemInput) {
  const completedAt = new Date().toISOString();

  return {
    ...data,
    sopRuns: data.sopRuns.map((run) => {
      if (run.id !== input.sopRunId) {
        return run;
      }

      return {
        ...run,
        checklist: run.checklist.map((item) =>
          item.id === input.itemId
            ? {
                ...item,
                completedAt,
                status: "completed" as const
              }
            : item
        ),
        status: "in_progress" as const
      };
    }),
    timeline: prependTimeline(
      data.timeline,
      "sop_run.updated",
      "SOP checklist item completed",
      "Required SOP checklist evidence was recorded.",
      completedAt
    )
  };
}

export function applyFixtureCompleteSopRun(data: Cp6OperationsData, input: SopRunCompletionInput) {
  const run = data.sopRuns.find((item) => item.id === input.sopRunId);

  if (!run) {
    throw new Error("Select an SOP run before completion.");
  }

  if (run.checklist.some((item) => item.required && item.status !== "completed")) {
    throw new Error("Complete all required SOP checklist items before closing the run.");
  }

  const completedAt = new Date().toISOString();

  return {
    ...data,
    sopRuns: data.sopRuns.map((item) =>
      item.id === input.sopRunId
        ? {
            ...item,
            status: "completed" as const
          }
        : item
    ),
    timeline: prependTimeline(
      data.timeline,
      "sop_run.completed",
      "SOP run completed",
      `${run.templateTitle} completed by ${input.actorName}.`,
      completedAt
    )
  };
}

export function applyFixtureAdvanceLabCase(data: Cp6OperationsData, input: LabCasePatchInput) {
  const changedAt = new Date().toISOString();
  const eventKind =
    input.status === "completed"
      ? "lab_case.completed"
      : input.status === "returned"
        ? "lab_case.returned"
        : "lab_case.sent";

  return {
    ...data,
    labCases: data.labCases.map((labCase) =>
      labCase.id === input.labCaseId
        ? {
            ...labCase,
            status: input.status
          }
        : labCase
    ),
    timeline: prependTimeline(
      data.timeline,
      eventKind,
      "Lab case status updated",
      `Lab case marked ${input.status.replace(/_/g, " ")} by ${input.actorName}.`,
      changedAt
    )
  };
}

export function applyFixtureCreateLabReconciliation(
  data: Cp6OperationsData,
  input: LabReconciliationInput
) {
  const eligibleCases = data.labCases.filter(
    (labCase) =>
      input.caseIds.includes(labCase.id) &&
      ["completed", "fitted", "returned"].includes(labCase.status)
  );

  if (eligibleCases.length === 0) {
    throw new Error("Reconciliation needs at least one returned or completed lab case.");
  }

  const createdAt = new Date().toISOString();
  const reconciliation: LabReconciliation = {
    caseIds: eligibleCases.map((labCase) => labCase.id),
    createdAt,
    createdBy: input.createdBy,
    expectedAmountCents: eligibleCases.reduce((sum, labCase) => sum + labCase.amountCents, 0),
    id: nextFixtureId("cp6-lab-reconciliation"),
    month: input.month,
    state: "created"
  };

  return {
    ...data,
    labCases: data.labCases.map((labCase) =>
      reconciliation.caseIds.includes(labCase.id)
        ? {
            ...labCase,
            reconciliationId: reconciliation.id
          }
        : labCase
    ),
    labReconciliations: [reconciliation, ...data.labReconciliations],
    timeline: prependTimeline(
      data.timeline,
      "lab_reconciliation.created",
      "Lab reconciliation created",
      "Month-end reconciliation lists expected lab payable amounts without marking invoices paid.",
      createdAt
    )
  };
}

export function applyFixtureRecordInventoryCount(
  data: Cp6OperationsData,
  input: InventoryCountInput
) {
  const countedAt = new Date().toISOString();
  const checkRun = data.inventoryCheckRuns.find((run) => run.id === input.checkRunId);

  if (!checkRun) {
    throw new Error("Select an inventory check run before recording counts.");
  }

  const nextLines = checkRun.lines.map((line) => {
    const countedOnHand = input.counts[line.itemId] ?? line.expectedOnHand;

    return {
      ...line,
      countedOnHand,
      variance: countedOnHand - line.expectedOnHand
    };
  });
  const lowStockExceptions = nextLines.flatMap((line) => {
    const item = data.inventoryItems.find((candidate) => candidate.id === line.itemId);

    if (!item || line.countedOnHand === undefined || line.countedOnHand >= item.reorderPoint) {
      return [];
    }

    return [
      {
        createdAt: countedAt,
        detail: `${item.name} counted ${line.countedOnHand} ${item.unit}; reorder point is ${item.reorderPoint}.`,
        id: nextFixtureId("cp6-inventory-exception"),
        itemId: item.id,
        status: "low_stock" as const
      }
    ];
  });
  const nextStatus: InventoryCheckRunStatus =
    lowStockExceptions.length > 0 ? "variance_review" : "completed";

  return {
    ...data,
    inventoryCheckRuns: data.inventoryCheckRuns.map((run) =>
      run.id === input.checkRunId
        ? {
            ...run,
            checkedBy: input.actorName,
            lines: nextLines,
            status: nextStatus
          }
        : run
    ),
    inventoryExceptions: [...lowStockExceptions, ...data.inventoryExceptions],
    inventoryItems: data.inventoryItems.map((item) => {
      const counted = input.counts[item.id];

      return counted === undefined
        ? item
        : {
            ...item,
            currentOnHand: counted
          };
    }),
    timeline: prependTimeline(
      data.timeline,
      lowStockExceptions.length > 0
        ? "inventory.low_stock_detected"
        : "inventory_check.completed",
      lowStockExceptions.length > 0 ? "Low stock detected" : "Inventory check completed",
      "Drawer count recorded from the CP6 inventory runner.",
      countedAt
    )
  };
}

export function applyFixtureRequestProcurement(
  data: Cp6OperationsData,
  input: ProcurementRequestInput
) {
  const exception = data.inventoryExceptions.find((item) => item.id === input.exceptionId);

  if (!exception) {
    throw new Error("Select an inventory exception before requesting procurement.");
  }

  const item = data.inventoryItems.find((candidate) => candidate.id === exception.itemId);
  const createdAt = new Date().toISOString();
  const taskId = nextFixtureId("cp6-procurement-task");
  const task: Cp6Task = {
    assignedToName: input.actorName,
    assignedToRole: "assistant",
    detail: item
      ? `Create clinic-approved procurement request for ${item.name}.`
      : "Create clinic-approved procurement request.",
    dueAt: createdAt,
    id: taskId,
    kind: "procurement",
    status: "assigned",
    title: "Procurement request"
  };

  return {
    ...data,
    inventoryExceptions: data.inventoryExceptions.map((current) =>
      current.id === input.exceptionId
        ? {
            ...current,
            procurementTaskId: taskId,
            status: "procurement_requested" as const
          }
        : current
    ),
    tasks: [task, ...data.tasks],
    timeline: prependTimeline(
      data.timeline,
      "task.created",
      "Procurement task created",
      "Manual procurement task created; no vendor purchase was executed.",
      createdAt
    )
  };
}

export function applyFixtureCreateIncident(data: Cp6OperationsData, input: IncidentCreateInput) {
  const createdAt = new Date().toISOString();
  const incident: Incident = {
    category: input.category,
    createdAt,
    description: input.description.trim(),
    id: nextFixtureId("cp6-incident"),
    impact: input.impact.trim(),
    learning: input.learning.trim(),
    reportedBy: input.reportedBy,
    status: "open"
  };

  return {
    ...data,
    incidents: [incident, ...data.incidents],
    timeline: prependTimeline(
      data.timeline,
      "incident.created",
      "Incident recorded",
      "Operational event diary entry created with impact and learning.",
      createdAt
    )
  };
}

export function applyFixtureCreateCorrectiveAction(
  data: Cp6OperationsData,
  input: CorrectiveActionCreateInput
) {
  const createdAt = new Date().toISOString();
  const correctiveAction: CorrectiveAction = {
    assignedToName: input.assignedToName,
    assignedToRole: input.assignedToRole,
    dueDate: input.dueDate,
    id: nextFixtureId("cp6-corrective-action"),
    incidentId: input.incidentId,
    status: "assigned",
    title: input.title
  };

  return {
    ...data,
    correctiveActions: [correctiveAction, ...data.correctiveActions],
    incidents: data.incidents.map((incident) =>
      incident.id === input.incidentId
        ? {
            ...incident,
            correctiveActionId: correctiveAction.id,
            status: "capa_assigned" as const
          }
        : incident
    ),
    timeline: prependTimeline(
      data.timeline,
      "corrective_action.created",
      "Corrective action assigned",
      `${correctiveAction.title} assigned to ${input.assignedToName}.`,
      createdAt
    )
  };
}

export function applyFixtureCompleteCorrectiveAction(
  data: Cp6OperationsData,
  input: CorrectiveActionCompletionInput
) {
  const completedAt = new Date().toISOString();

  return {
    ...data,
    correctiveActions: data.correctiveActions.map((action) =>
      action.id === input.correctiveActionId
        ? {
            ...action,
            completedAt,
            completionNote: input.completionNote,
            status: "completed" as const
          }
        : action
    ),
    incidents: data.incidents.map((incident) => {
      const action = data.correctiveActions.find(
        (candidate) => candidate.id === input.correctiveActionId
      );

      return action?.incidentId === incident.id
        ? {
            ...incident,
            status: "closed" as const
          }
        : incident;
    }),
    timeline: prependTimeline(
      data.timeline,
      "corrective_action.completed",
      "Corrective action completed",
      input.completionNote,
      completedAt
    )
  };
}

export function deriveCp6OwnerMetrics(data: Cp6OperationsData) {
  return {
    completedTasks: data.tasks.filter((task) => task.status === "completed").length,
    inventoryExceptions: data.inventoryExceptions.filter(
      (exception) => exception.status !== "resolved"
    ).length,
    labExceptions: data.labCases.filter((labCase) =>
      ["due", "rework_required"].includes(labCase.status)
    ).length,
    openCapa: data.correctiveActions.filter((action) => action.status !== "completed").length,
    openIncidents: data.incidents.filter((incident) => incident.status !== "closed").length,
    openTasks: data.tasks.filter((task) => task.status !== "completed").length,
    recallActionsCompleted: data.recalls.filter((recall) => recall.status === "action_completed")
      .length,
    recallsDue: data.recalls.filter((recall) => recall.status === "due").length
  };
}

export function classifyCp6EndpointFailures(failures: Cp6EndpointIssue[]): Cp6OperationsProblem {
  const hasAuthFailure = failures.some(
    (failure) => failure.status === 401 || failure.status === 403
  );
  const hasMissingEndpoint = failures.some((failure) => failure.status === 404);
  const hasServerFailure = failures.some((failure) => failure.status && failure.status >= 500);
  const hasNetworkFailure = failures.some((failure) => failure.endpoint.startsWith("FETCH"));

  if (hasAuthFailure) {
    return {
      code: "AUTH_REQUIRED",
      endpoints: failures,
      message: "Sign in through the configured identity provider before opening CP6 operations."
    };
  }

  if (hasMissingEndpoint) {
    return {
      code: "CP6_ENDPOINT_NOT_REGISTERED",
      endpoints: failures,
      message:
        "One or more CP6 continuity endpoints are not registered in this environment. Check route registration and activation before debugging permissions or runtime state."
    };
  }

  if (hasServerFailure) {
    return {
      code: "SERVER_ERROR",
      endpoints: failures,
      message: "The ClinicOS API is reachable but could not load the CP6 operations workflow."
    };
  }

  if (hasNetworkFailure) {
    return {
      code: "NETWORK_UNAVAILABLE",
      endpoints: failures,
      message: "The CP6 operations API could not be reached from the web app."
    };
  }

  return {
    code: "UNKNOWN",
    endpoints: failures,
    message: "The CP6 operations API returned an unexpected response."
  };
}

export function formatMoney(amountCents: number) {
  return new Intl.NumberFormat("en-IN", {
    currency: "INR",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(amountCents / 100);
}

export function normalizeCp6OperationsPayload(
  payload: unknown,
  today: string,
  requestIds: string[] = []
): Cp6OperationsData | Cp6OperationsProblem {
  if (!isRecord(payload)) {
    return contractMismatch("Expected CP6 operation read payloads to be JSON objects.");
  }

  const tasks = readArrayFromPayload(payload.tasks, ["tasks", "items", "data"], isCp6Task);
  const recalls = readArrayFromPayload(payload.recalls, ["recalls", "items", "data"], isRecallDue);
  const sopRuns = readArrayFromPayload(payload.sopRuns, ["sopRuns", "runs", "items", "data"], isSopRun);
  const labCases = readArrayFromPayload(payload.labCases, ["labCases", "cases", "items", "data"], isLabCase);
  const inventoryExceptions = readArrayFromPayload(
    payload.inventoryExceptions,
    ["inventoryExceptions", "exceptions", "items", "data"],
    isInventoryException
  );

  if (!tasks || !recalls || !sopRuns || !labCases || !inventoryExceptions) {
    return contractMismatch(
      "Expected tasks, recalls, SOP runs, lab cases, and inventory exceptions from CP6 read routes."
    );
  }

  return {
    api: {
      environment: "api",
      requestIds
    },
    correctiveActions: [],
    incidents: [],
    inventoryCheckRuns: [],
    inventoryExceptions,
    inventoryItems: [],
    labCases,
    labReconciliations: [],
    labVendors: [],
    patients: [],
    readiness: {
      inventoryProcurement: "provider_unavailable",
      messagingProvider: "provider_unavailable",
      ownerAnalytics: isRecord(payload.ownerDashboard) ? "available" : "source_revenue_deferred",
      workflowTimers: "live"
    },
    recalls,
    sopRuns,
    source: "api",
    tasks,
    timeline: [],
    today
  };
}

function contractMismatch(detail: string): Cp6OperationsProblem {
  return {
    code: "CONTRACT_MISMATCH",
    detail,
    endpoints: CP6_READ_ENDPOINTS.map((endpoint) => ({
      endpoint,
      message: "Contract mismatch"
    })),
    message: "The CP6 operations read routes are reachable but do not match the web contract."
  };
}

function getWorkflowApiBaseUrl() {
  return process.env.NEXT_PUBLIC_CLINIC_OS_API_BASE_URL ?? "";
}

function buildWorkflowUrl(path: string, params?: Record<string, string>) {
  const baseUrl = getWorkflowApiBaseUrl().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`, getBrowserOrigin());

  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function getBrowserOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost";
}

async function fetchEndpoint(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<EndpointResponse> {
  const response = await fetch(buildWorkflowUrl(path, params), {
    credentials: "include",
    headers: {
      Accept: "application/json"
    },
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse(path, response, payload);
  }

  return {
    payload,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

async function postEndpoint(path: string, body: unknown, signal?: AbortSignal) {
  return writeEndpoint("POST", path, body, signal);
}

async function patchEndpoint(path: string, body: unknown, signal?: AbortSignal) {
  return writeEndpoint("PATCH", path, body, signal);
}

async function writeEndpoint(
  method: "PATCH" | "POST",
  path: string,
  body: unknown,
  signal?: AbortSignal
) {
  const response = await fetch(buildWorkflowUrl(path), {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": `web-cp6-${crypto.randomUUID()}`
    },
    method,
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse(path, response, payload);
  }

  return payload;
}

async function parseJsonSafely(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json() as Promise<unknown>;
}

function endpointFailureFromResponse(
  path: string,
  response: Response,
  payload: unknown
): EndpointFailure {
  return {
    endpoint: `${response.status === 0 ? "FETCH" : "HTTP"} ${path}`,
    message: readErrorMessage(payload) ?? `HTTP ${response.status}`,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

function normalizeEndpointFailure(error: unknown): EndpointFailure {
  if (isEndpointFailure(error)) {
    return error;
  }

  return {
    endpoint: "FETCH /v1/cp6-continuity",
    message: error instanceof Error ? error.message : "Network request failed"
  };
}

function isEndpointFailure(value: unknown): value is EndpointFailure {
  return isRecord(value) && typeof value.endpoint === "string" && typeof value.message === "string";
}

function getRequestId(response: Response, payload: unknown) {
  if (isRecord(payload)) {
    const topLevel = readString(payload, [
      "request_id",
      "requestId",
      "correlation_id",
      "correlationId"
    ]);
    const error = isRecord(payload.error) ? payload.error : null;
    const nested = error
      ? readString(error, ["request_id", "requestId", "correlation_id", "correlationId"])
      : null;

    return topLevel ?? nested ?? response.headers.get("x-request-id") ?? undefined;
  }

  return response.headers.get("x-request-id") ?? undefined;
}

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const error = isRecord(payload.error) ? payload.error : null;

  return (
    readString(payload, ["message", "detail", "error_description"]) ??
    (error ? readString(error, ["message", "detail", "error_description"]) : null)
  );
}

function timelineItem(
  kind: Cp6TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
): Cp6TimelineItem {
  return {
    at,
    detail,
    id: `${kind}-${at}`,
    kind,
    title
  };
}

function prependTimeline(
  items: Cp6TimelineItem[],
  kind: Cp6TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
) {
  return [timelineItem(kind, title, detail, at), ...items].sort(
    (first, second) => Date.parse(second.at) - Date.parse(first.at)
  );
}

function nextFixtureId(prefix: string) {
  fixtureIdCounter += 1;

  return `${prefix}-${fixtureIdCounter}`;
}

function readArrayFromPayload<T>(
  payload: unknown,
  keys: string[],
  guard: (value: unknown) => value is T
) {
  const value = unwrapPayloadArray(payload, keys);

  return value ? value.filter(guard) : null;
}

function unwrapPayloadArray(payload: unknown, keys: string[]) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return null;
  }

  for (const key of keys) {
    const value = payload[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function isClinicRole(value: unknown): value is ClinicRole {
  return (
    value === "accountant" ||
    value === "assistant" ||
    value === "doctor" ||
    value === "owner" ||
    value === "platform_admin" ||
    value === "receptionist"
  );
}

function isCp6Task(value: unknown): value is Cp6Task {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.detail === "string" &&
    typeof value.dueAt === "string" &&
    isClinicRole(value.assignedToRole) &&
    typeof value.kind === "string" &&
    typeof value.status === "string"
  );
}

function isRecallDue(value: unknown): value is RecallDue {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.ruleLabel === "string" &&
    typeof value.dueDate === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.actionHistory)
  );
}

function isSopRun(value: unknown): value is SopRun {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.templateTitle === "string" &&
    typeof value.dueAt === "string" &&
    typeof value.status === "string" &&
    Array.isArray(value.checklist)
  );
}

function isLabCase(value: unknown): value is LabCase {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.procedure === "string" &&
    typeof value.vendorId === "string" &&
    typeof value.status === "string" &&
    typeof value.dueDate === "string"
  );
}

function isInventoryException(value: unknown): value is InventoryException {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.itemId === "string" &&
    typeof value.detail === "string" &&
    typeof value.status === "string"
  );
}
