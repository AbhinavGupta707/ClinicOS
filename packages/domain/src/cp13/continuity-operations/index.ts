import type {
  CorrectiveActionRecord,
  InventoryExceptionRecord,
  OwnerDashboardDataSource,
  RecallActionType,
  RecallStatus,
  UUID
} from "../../index.ts";

export const OWNER_ANALYTICS_MAX_RANGE_DAYS = 93;
export const OWNER_ANALYTICS_STALE_AFTER_SECONDS = 300;

export const CONTINUITY_OPERATIONS_EVENT_TYPES = Object.freeze([
  "task.created",
  "task.status_changed",
  "task.completed",
  "task.due",
  "recall.rule_created",
  "recall.due",
  "recall.sent",
  "recall.action_recorded",
  "recall.completed",
  "sop_template.created",
  "sop_schedule.created",
  "sop_run.created",
  "sop_run.updated",
  "sop_run.completed",
  "lab_vendor.created",
  "lab_slip.generated",
  "lab_case.created",
  "lab_case.sent",
  "lab_case.received",
  "lab_case.returned",
  "lab_case.completed",
  "lab_case.cancelled",
  "lab_case.status_changed",
  "lab_reconciliation.created",
  "inventory_category.created",
  "inventory_item.created",
  "inventory_stock.adjusted",
  "inventory_check.created",
  "inventory_check.completed",
  "inventory.low_stock_detected",
  "inventory.procurement_suggested",
  "incident.created",
  "corrective_action.created",
  "corrective_action.status_changed",
  "corrective_action.completed"
] as const);

export type ContinuityOperationsEventType = (typeof CONTINUITY_OPERATIONS_EVENT_TYPES)[number];

export interface OwnerAnalyticsFreshness {
  readonly status: "fresh" | "stale" | "unavailable";
  readonly generatedAt: string;
  readonly ageSeconds: number;
  readonly staleAfterSeconds: number;
  readonly projectionMode: "transactional_request_time";
  readonly rebuild: {
    readonly supported: false;
    readonly reason: "request_time_projection_has_no_materialized_state";
  };
  readonly unavailableSources: readonly string[];
}

const TERMINAL_RECALL_STATUSES = new Set<RecallStatus>(["completed", "cancelled", "skipped"]);

const RECALL_ACTION_STATUS: Readonly<Record<RecallActionType, RecallStatus>> = {
  manual_contact_requested: "contact_requested",
  manual_contacted: "contacted",
  appointment_booked: "booked",
  completed: "completed",
  skipped: "skipped",
  cancelled: "cancelled"
};

const CORRECTIVE_ACTION_TRANSITIONS: Readonly<
  Record<CorrectiveActionRecord["status"], readonly CorrectiveActionRecord["status"][]>
> = {
  open: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export function assertOwnerAnalyticsRange(from: string, to: string): void {
  const fromMs = parseInstant(from, "from");
  const toMs = parseInstant(to, "to");
  if (fromMs > toMs) throw new Error("Owner analytics range starts after it ends.");
  if (toMs - fromMs > OWNER_ANALYTICS_MAX_RANGE_DAYS * 86_400_000) {
    throw new Error(`Owner analytics range cannot exceed ${OWNER_ANALYTICS_MAX_RANGE_DAYS} days.`);
  }
}

export function assertRecallAction(input: {
  currentStatus: RecallStatus;
  actionType: RecallActionType;
  evidence: Readonly<Record<string, unknown>>;
  appointmentId?: UUID | null;
}): RecallStatus {
  if (TERMINAL_RECALL_STATUSES.has(input.currentStatus)) {
    throw new Error(`Recall in ${input.currentStatus} state cannot accept another action.`);
  }
  assertNonEmptyEvidence(input.evidence, "Recall action");
  if (input.actionType === "appointment_booked" && !input.appointmentId) {
    throw new Error("Booked recall actions require an appointment reference.");
  }
  return RECALL_ACTION_STATUS[input.actionType];
}

export function assertCorrectiveActionTransition(input: {
  current: Pick<CorrectiveActionRecord, "status">;
  nextStatus: CorrectiveActionRecord["status"];
  completionEvidence?: Readonly<Record<string, unknown>>;
  verificationEvidence?: Readonly<Record<string, unknown>>;
}): void {
  if (
    input.current.status !== input.nextStatus &&
    !CORRECTIVE_ACTION_TRANSITIONS[input.current.status].includes(input.nextStatus)
  ) {
    throw new Error(
      `Corrective action cannot transition from ${input.current.status} to ${input.nextStatus}.`
    );
  }
  if (input.nextStatus === "completed") {
    assertNonEmptyEvidence(input.completionEvidence, "Corrective action completion");
    assertNonEmptyEvidence(input.verificationEvidence, "Corrective action verification");
  }
}

export function assertNonEmptyEvidence(
  evidence: Readonly<Record<string, unknown>> | null | undefined,
  subject: string
): void {
  if (!evidence || Object.keys(evidence).length === 0) {
    throw new Error(`${subject} requires attributable evidence.`);
  }
}

export function assertNoProviderOrProcurementCompletionClaim(
  evidence: Readonly<Record<string, unknown>>
): void {
  const forbidden = [
    "providerCompleted",
    "providerDelivered",
    "purchaseExecuted",
    "procurementCompleted",
    "vendorPaid"
  ];
  for (const key of forbidden) {
    if (evidence[key] === true) {
      throw new Error(`${key} cannot be asserted by a manual continuity operation.`);
    }
  }
}

export function inventoryExceptionAnalyticsSource(exception: InventoryExceptionRecord): {
  id: UUID;
  itemKey: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "procurement_requested" | "resolved";
  detectedAt: string;
  resolvedAt: string | null;
  procurementTaskId: UUID | null;
} {
  const suggestion = exception.procurementSuggestion;
  const detectedAt =
    exception.checkRunLine?.countedAt ?? suggestion?.createdAt ?? exception.item.updatedAt;
  const status =
    suggestion?.status === "converted_to_task"
      ? "procurement_requested"
      : suggestion?.status === "dismissed"
        ? "resolved"
        : "open";
  const severity =
    exception.exceptionType === "damaged" || exception.exceptionType === "expired"
      ? "critical"
      : exception.exceptionType === "missing_item" || exception.exceptionType === "low_stock"
        ? "high"
        : "medium";
  return {
    id: exception.checkRunLine?.id ?? suggestion?.id ?? exception.item.id,
    itemKey: exception.item.sku,
    severity,
    status,
    detectedAt,
    resolvedAt: status === "resolved" ? (suggestion?.updatedAt ?? exception.item.updatedAt) : null,
    procurementTaskId: suggestion?.taskId ?? null
  };
}

export function ownerAnalyticsFreshness(input: {
  generatedAt: string;
  observedAt: Date;
  dataSources: readonly OwnerDashboardDataSource[];
}): OwnerAnalyticsFreshness {
  const generatedAtMs = parseInstant(input.generatedAt, "generatedAt");
  const ageSeconds = Math.max(0, Math.floor((input.observedAt.getTime() - generatedAtMs) / 1_000));
  const unavailableSources = input.dataSources
    .filter((source) => source.status === "schema_dependency" || source.status === "local_fixture")
    .map((source) => source.key)
    .sort();
  const status =
    unavailableSources.length > 0
      ? "unavailable"
      : ageSeconds > OWNER_ANALYTICS_STALE_AFTER_SECONDS
        ? "stale"
        : "fresh";
  return {
    status,
    generatedAt: input.generatedAt,
    ageSeconds,
    staleAfterSeconds: OWNER_ANALYTICS_STALE_AFTER_SECONDS,
    projectionMode: "transactional_request_time",
    rebuild: {
      supported: false,
      reason: "request_time_projection_has_no_materialized_state"
    },
    unavailableSources
  };
}

function parseInstant(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${field} must be a valid ISO-8601 instant.`);
  return parsed;
}
