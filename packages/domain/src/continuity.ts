import type { UUID } from "./ids.ts";

export const TASK_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TYPES = [
  "confirmation",
  "missed_call",
  "whatsapp_request",
  "follow_up",
  "post_op_follow_up",
  "recall",
  "payment_due",
  "payment_follow_up",
  "lab_case",
  "sop",
  "inventory_check",
  "procurement",
  "incident",
  "corrective_action",
  "manual"
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_SOURCE_WORKFLOWS = [
  "manual",
  "appointment_confirmation",
  "recall_generation",
  "post_op_follow_up",
  "payment_follow_up",
  "sop_run",
  "lab_case",
  "inventory_check",
  "incident_capa",
  "system"
] as const;
export type TaskSourceWorkflow = (typeof TASK_SOURCE_WORKFLOWS)[number];

export const TASK_DUE_STATES = [
  "unscheduled",
  "not_due",
  "due",
  "overdue",
  "completed",
  "cancelled"
] as const;
export type TaskDueState = (typeof TASK_DUE_STATES)[number];

export interface TaskCompletionEvidence {
  method: "phone" | "whatsapp" | "sms" | "email" | "in_person" | "print" | "system" | "other";
  summary: string;
  recordedAt?: string;
  reference?: string | null;
  providerConfirmationReceived?: false;
  metadata?: Record<string, unknown>;
}

export interface TaskRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  rowVersion: number;
  patientId: UUID | null;
  leadId: UUID | null;
  appointmentId: UUID | null;
  invoiceId: UUID | null;
  encounterId: UUID | null;
  treatmentPlanId: UUID | null;
  procedurePerformedId: UUID | null;
  taskType: TaskType;
  sourceWorkflow: TaskSourceWorkflow;
  sourceRecordType: string | null;
  sourceRecordId: UUID | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt: string | null;
  assignedToUserId: UUID | null;
  assignedByUserId: UUID | null;
  completedByUserId: UUID | null;
  completedAt: string | null;
  completionEvidence: Record<string, unknown>;
  cancelledReason: string | null;
  idempotencyKey: string | null;
  createdByUserId: UUID | null;
  updatedByUserId: UUID | null;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export const RECALL_RULE_STATUSES = ["active", "paused", "retired"] as const;
export type RecallRuleStatus = (typeof RECALL_RULE_STATUSES)[number];

export const RECALL_RULE_ANCHORS = ["procedure_completed", "checkout_completed"] as const;
export type RecallRuleAnchor = (typeof RECALL_RULE_ANCHORS)[number];

export interface RecallRuleRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  code: string;
  title: string;
  status: RecallRuleStatus;
  anchor: RecallRuleAnchor;
  offsetDays: number;
  procedureCategory: string | null;
  pricebookProcedureId: UUID | null;
  defaultTaskTitle: string;
  defaultTaskPriority: TaskPriority;
  createdByUserId: UUID;
  updatedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export const RECALL_STATUSES = [
  "due",
  "contact_requested",
  "contacted",
  "booked",
  "completed",
  "cancelled",
  "skipped"
] as const;
export type RecallStatus = (typeof RECALL_STATUSES)[number];

export const RECALL_ACTION_TYPES = [
  "manual_contact_requested",
  "manual_contacted",
  "appointment_booked",
  "completed",
  "skipped",
  "cancelled"
] as const;
export type RecallActionType = (typeof RECALL_ACTION_TYPES)[number];

export interface RecallRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  recallRuleId: UUID;
  patientId: UUID;
  sourceProcedurePerformedId: UUID | null;
  sourceInvoiceId: UUID | null;
  taskId: UUID | null;
  appointmentId: UUID | null;
  status: RecallStatus;
  dueAt: string;
  lastActionAt: string | null;
  actionEvidence: Record<string, unknown>;
  createdByUserId: UUID | null;
  updatedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export const SOP_TEMPLATE_STATUSES = ["active", "retired"] as const;
export type SopTemplateStatus = (typeof SOP_TEMPLATE_STATUSES)[number];

export interface SopTemplateRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  code: string;
  title: string;
  description: string | null;
  status: SopTemplateStatus;
  createdByUserId: UUID;
  updatedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export interface SopTemplateItemRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  templateId: UUID;
  itemIndex: number;
  title: string;
  instructions: string | null;
  evidenceRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SopTemplateDetail {
  template: SopTemplateRecord;
  items: SopTemplateItemRecord[];
}

export const SOP_SCHEDULE_STATUSES = ["active", "paused", "retired"] as const;
export type SopScheduleStatus = (typeof SOP_SCHEDULE_STATUSES)[number];

export const SOP_RECURRENCE_TYPES = ["daily", "weekly", "monthly", "interval_days"] as const;
export type SopRecurrenceType = (typeof SOP_RECURRENCE_TYPES)[number];

export interface SopScheduleRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  templateId: UUID;
  title: string;
  status: SopScheduleStatus;
  recurrenceType: SopRecurrenceType;
  intervalDays: number | null;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  dueTime: string;
  timezone: string;
  startsOn: string;
  endsOn: string | null;
  assignedToUserId: UUID | null;
  defaultTaskPriority: TaskPriority;
  createdByUserId: UUID;
  updatedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export const SOP_RUN_STATUSES = ["due", "in_progress", "completed", "cancelled", "overdue"] as const;
export type SopRunStatus = (typeof SOP_RUN_STATUSES)[number];

export const SOP_RUN_ITEM_STATUSES = ["pending", "done", "skipped"] as const;
export type SopRunItemStatus = (typeof SOP_RUN_ITEM_STATUSES)[number];

export interface SopRunRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  rowVersion: number;
  templateId: UUID;
  scheduleId: UUID;
  taskId: UUID | null;
  dueAt: string;
  status: SopRunStatus;
  assignedToUserId: UUID | null;
  startedByUserId: UUID | null;
  startedAt: string | null;
  completedByUserId: UUID | null;
  completedAt: string | null;
  completionEvidence: Record<string, unknown>;
  generatedFromKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface SopRunItemRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  sopRunId: UUID;
  templateItemId: UUID | null;
  itemIndex: number;
  title: string;
  instructions: string | null;
  evidenceRequired: boolean;
  status: SopRunItemStatus;
  evidence: Record<string, unknown>;
  completedByUserId: UUID | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SopRunDetail {
  run: SopRunRecord;
  items: SopRunItemRecord[];
}

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskType(value: string): value is TaskType {
  return (TASK_TYPES as readonly string[]).includes(value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isTaskSourceWorkflow(value: string): value is TaskSourceWorkflow {
  return (TASK_SOURCE_WORKFLOWS as readonly string[]).includes(value);
}

export function isRecallRuleStatus(value: string): value is RecallRuleStatus {
  return (RECALL_RULE_STATUSES as readonly string[]).includes(value);
}

export function isRecallRuleAnchor(value: string): value is RecallRuleAnchor {
  return (RECALL_RULE_ANCHORS as readonly string[]).includes(value);
}

export function isRecallStatus(value: string): value is RecallStatus {
  return (RECALL_STATUSES as readonly string[]).includes(value);
}

export function isRecallActionType(value: string): value is RecallActionType {
  return (RECALL_ACTION_TYPES as readonly string[]).includes(value);
}

export function isSopRecurrenceType(value: string): value is SopRecurrenceType {
  return (SOP_RECURRENCE_TYPES as readonly string[]).includes(value);
}

export function isSopRunStatus(value: string): value is SopRunStatus {
  return (SOP_RUN_STATUSES as readonly string[]).includes(value);
}

export function isSopRunItemStatus(value: string): value is SopRunItemStatus {
  return (SOP_RUN_ITEM_STATUSES as readonly string[]).includes(value);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  const allowed: Record<TaskStatus, readonly TaskStatus[]> = {
    open: ["in_progress", "done", "cancelled"],
    in_progress: ["open", "done", "cancelled"],
    done: [],
    cancelled: []
  };

  if (!allowed[from].includes(to)) {
    throw new Error(`Task status cannot transition from ${from} to ${to}.`);
  }
}

export function assertTaskCompletionEvidence(input: {
  status: TaskStatus;
  evidence?: Record<string, unknown> | null;
  completedAt?: string | null;
  completedByUserId?: UUID | null;
}): void {
  if (input.status !== "done") return;
  if (!input.completedAt || !input.completedByUserId) {
    throw new Error("Completed tasks require completedAt and completedByUserId.");
  }
  if (!input.evidence || Object.keys(input.evidence).length === 0) {
    throw new Error("Completed tasks require completion evidence.");
  }
}

export function taskDueState(
  task: Pick<TaskRecord, "status" | "dueAt">,
  asOf: string | Date = new Date()
): TaskDueState {
  if (task.status === "done") return "completed";
  if (task.status === "cancelled") return "cancelled";
  if (!task.dueAt) return "unscheduled";

  const dueMs = new Date(task.dueAt).getTime();
  const asOfMs = asOf instanceof Date ? asOf.getTime() : new Date(asOf).getTime();
  if (dueMs < asOfMs) return "overdue";
  if (dueMs === asOfMs || new Date(task.dueAt).toISOString().slice(0, 10) === new Date(asOfMs).toISOString().slice(0, 10)) {
    return "due";
  }
  return "not_due";
}

export function buildRecallGenerationKey(input: {
  recallRuleId: UUID;
  sourceProcedurePerformedId?: UUID | null;
  patientId: UUID;
  dueAt: string;
}): string {
  return [
    "recall",
    input.recallRuleId,
    input.sourceProcedurePerformedId ?? input.patientId,
    input.dueAt.slice(0, 10)
  ].join(":");
}

export function buildPostOpFollowUpKey(procedurePerformedId: UUID): string {
  return `post-op-follow-up:${procedurePerformedId}`;
}

export function buildPaymentFollowUpKey(invoiceId: UUID): string {
  return `payment-follow-up:${invoiceId}`;
}

export function buildSopRunGenerationKey(scheduleId: UUID, dueAt: string): string {
  return `sop-run:${scheduleId}:${dueAt.slice(0, 10)}`;
}

export function addDaysIso(anchor: string, days: number): string {
  const date = new Date(anchor);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function assertSopRunCompletion(input: SopRunDetail): void {
  if (input.run.status !== "completed") return;
  const incompleteRequiredItem = input.items.find(
    (item) => item.evidenceRequired && item.status !== "done"
  );
  if (incompleteRequiredItem) {
    throw new Error(`SOP run cannot complete until required item ${incompleteRequiredItem.itemIndex} is done.`);
  }
}
