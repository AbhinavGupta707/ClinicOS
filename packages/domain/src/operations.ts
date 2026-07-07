import type { DentalToothNumber } from "./dental.ts";
import type { UUID } from "./ids.ts";

export const LAB_VENDOR_STATUSES = ["active", "inactive"] as const;
export type LabVendorStatus = (typeof LAB_VENDOR_STATUSES)[number];

export const LAB_CASE_STATUSES = [
  "draft",
  "ready_for_pickup",
  "sent_to_lab",
  "received_by_lab",
  "due",
  "returned",
  "fitted",
  "completed",
  "cancelled",
  "rework_required"
] as const;
export type LabCaseStatus = (typeof LAB_CASE_STATUSES)[number];

export const LAB_RECONCILIATION_STATUSES = [
  "draft",
  "submitted",
  "matched",
  "variance_review",
  "approved",
  "cancelled"
] as const;
export type LabReconciliationStatus = (typeof LAB_RECONCILIATION_STATUSES)[number];

export const LAB_RECONCILIATION_ENTRY_STATUSES = [
  "matched",
  "amount_variance",
  "missing_invoice",
  "unbilled_case",
  "excluded"
] as const;
export type LabReconciliationEntryStatus =
  (typeof LAB_RECONCILIATION_ENTRY_STATUSES)[number];

export interface LabVendorRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  displayName: string;
  phone: string | null;
  email: string | null;
  address: Record<string, unknown>;
  taxRegistrationNumber: string | null;
  paymentTermsDays: number | null;
  status: LabVendorStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LabCaseItemRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  labCaseId: UUID;
  itemType: string;
  toothNumber: DentalToothNumber | null;
  material: string | null;
  shade: string | null;
  quantity: number;
  notes: string | null;
  createdAt: string;
}

export interface LabCaseRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  vendorId: UUID;
  patientId: UUID;
  encounterId: UUID | null;
  treatmentPlanId: UUID | null;
  treatmentPlanEstimateItemId: UUID | null;
  procedurePerformedId: UUID | null;
  title: string;
  status: LabCaseStatus;
  priority: "routine" | "urgent";
  dueAt: string;
  clinicalNotes: string | null;
  internalNotes: string | null;
  slipNumber: string;
  slipVersion: number;
  slipGeneratedAt: string;
  slipGeneratedByUserId: UUID;
  slipMetadata: Record<string, unknown>;
  expectedCostMinor: number | null;
  currency: "INR";
  sentAt: string | null;
  receivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdByUserId: UUID;
  updatedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export interface LabCaseStatusHistoryRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  labCaseId: UUID;
  patientId: UUID;
  fromStatus: LabCaseStatus | null;
  toStatus: LabCaseStatus;
  reason: string | null;
  evidence: Record<string, unknown>;
  changedByUserId: UUID;
  changedAt: string;
}

export interface LabCaseDetail {
  labCase: LabCaseRecord;
  vendor: LabVendorRecord;
  items: LabCaseItemRecord[];
  statusHistory: LabCaseStatusHistoryRecord[];
}

export interface LabReconciliationRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  vendorId: UUID;
  periodStart: string;
  periodEnd: string;
  status: LabReconciliationStatus;
  invoiceReference: string | null;
  invoiceAmountMinor: number | null;
  expectedAmountMinor: number;
  varianceAmountMinor: number;
  currency: "INR";
  evidence: Record<string, unknown>;
  createdByUserId: UUID;
  approvedByUserId: UUID | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LabReconciliationEntryRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  reconciliationId: UUID;
  labCaseId: UUID;
  patientId: UUID;
  status: LabReconciliationEntryStatus;
  expectedAmountMinor: number;
  invoiceAmountMinor: number | null;
  varianceAmountMinor: number;
  notes: string | null;
  createdAt: string;
}

export interface LabReconciliationDetail {
  reconciliation: LabReconciliationRecord;
  entries: LabReconciliationEntryRecord[];
}

export const INVENTORY_CATEGORY_KINDS = ["material", "instrument", "equipment"] as const;
export type InventoryCategoryKind = (typeof INVENTORY_CATEGORY_KINDS)[number];

export const INVENTORY_ITEM_STATUSES = ["active", "inactive", "retired"] as const;
export type InventoryItemStatus = (typeof INVENTORY_ITEM_STATUSES)[number];

export const STOCK_LEDGER_MOVEMENT_TYPES = [
  "opening_balance",
  "manual_adjustment",
  "consumption",
  "check_variance",
  "procurement_received",
  "write_off"
] as const;
export type StockLedgerMovementType = (typeof STOCK_LEDGER_MOVEMENT_TYPES)[number];

export const INVENTORY_CHECK_RUN_STATUSES = [
  "draft",
  "in_progress",
  "completed",
  "cancelled"
] as const;
export type InventoryCheckRunStatus = (typeof INVENTORY_CHECK_RUN_STATUSES)[number];

export const INVENTORY_EXCEPTION_TYPES = [
  "variance",
  "low_stock",
  "missing_item",
  "damaged",
  "expired"
] as const;
export type InventoryExceptionType = (typeof INVENTORY_EXCEPTION_TYPES)[number];

export const PROCUREMENT_SUGGESTION_STATUSES = [
  "suggested",
  "converted_to_task",
  "dismissed"
] as const;
export type ProcurementSuggestionStatus = (typeof PROCUREMENT_SUGGESTION_STATUSES)[number];

export interface InventoryCategoryRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  code: string;
  displayName: string;
  kind: InventoryCategoryKind;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItemRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  categoryId: UUID;
  sku: string;
  displayName: string;
  unitOfMeasure: string;
  storageLocation: string;
  trackQuantity: boolean;
  minimumQuantity: number;
  reorderQuantity: number;
  currentQuantity: number;
  status: InventoryItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StockLedgerEntryRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  itemId: UUID;
  movementType: StockLedgerMovementType;
  quantityDelta: number;
  quantityAfter: number;
  unitCostMinor: number | null;
  currency: "INR" | null;
  sourceTable: string | null;
  sourceId: UUID | null;
  reason: string;
  evidence: Record<string, unknown>;
  recordedByUserId: UUID;
  recordedAt: string;
}

export interface InventoryCheckTemplateRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  code: string;
  displayName: string;
  cadence: "daily" | "weekly" | "monthly" | "ad_hoc";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryCheckTemplateLineRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  templateId: UUID;
  itemId: UUID;
  sequence: number;
  drawerLocation: string;
  expectedQuantity: number | null;
  required: boolean;
  instructions: string | null;
}

export interface InventoryCheckRunRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  templateId: UUID;
  status: InventoryCheckRunStatus;
  startedByUserId: UUID;
  completedByUserId: UUID | null;
  startedAt: string;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryCheckRunLineRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  checkRunId: UUID;
  templateLineId: UUID;
  itemId: UUID;
  sequence: number;
  drawerLocation: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  varianceQuantity: number | null;
  exceptionType: InventoryExceptionType | null;
  exceptionNotes: string | null;
  countedByUserId: UUID | null;
  countedAt: string | null;
}

export interface ProcurementSuggestionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  itemId: UUID;
  sourceCheckRunId: UUID | null;
  sourceCheckRunLineId: UUID | null;
  status: ProcurementSuggestionStatus;
  suggestedQuantity: number;
  reason: string;
  taskId: UUID | null;
  evidence: Record<string, unknown>;
  createdByUserId: UUID;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryCheckRunDetail {
  run: InventoryCheckRunRecord;
  template: InventoryCheckTemplateRecord;
  lines: InventoryCheckRunLineRecord[];
  procurementSuggestions: ProcurementSuggestionRecord[];
}

export interface InventoryExceptionRecord {
  item: InventoryItemRecord;
  checkRunLine: InventoryCheckRunLineRecord | null;
  procurementSuggestion: ProcurementSuggestionRecord | null;
  exceptionType: InventoryExceptionType;
  quantityAvailable: number;
  thresholdQuantity: number;
  suggestedTask: {
    taskType: "procurement";
    title: string;
    status: "suggested_not_created";
  };
}

export const INCIDENT_CATEGORIES = [
  "clinical",
  "operational",
  "lab",
  "inventory",
  "billing",
  "safety",
  "patient_experience",
  "security_privacy",
  "other"
] as const;
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const INCIDENT_STATUSES = [
  "open",
  "under_review",
  "capa_assigned",
  "resolved",
  "closed",
  "cancelled"
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const CORRECTIVE_ACTION_TYPES = ["corrective", "preventive"] as const;
export type CorrectiveActionType = (typeof CORRECTIVE_ACTION_TYPES)[number];

export const CORRECTIVE_ACTION_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "cancelled"
] as const;
export type CorrectiveActionStatus = (typeof CORRECTIVE_ACTION_STATUSES)[number];
export type CorrectiveActionEffectiveStatus = CorrectiveActionStatus | "overdue";

export interface IncidentRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID | null;
  appointmentId: UUID | null;
  labCaseId: UUID | null;
  inventoryItemId: UUID | null;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  occurredAt: string;
  location: string | null;
  summary: string;
  description: string;
  impact: string | null;
  learning: string | null;
  immediateAction: string | null;
  evidence: Record<string, unknown>;
  reportedByUserId: UUID;
  ownerUserId: UUID | null;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CorrectiveActionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  incidentId: UUID | null;
  actionType: CorrectiveActionType;
  title: string;
  description: string;
  status: CorrectiveActionStatus;
  ownerUserId: UUID;
  dueAt: string;
  completedAt: string | null;
  completedByUserId: UUID | null;
  completionEvidence: Record<string, unknown>;
  verificationEvidence: Record<string, unknown>;
  createdByUserId: UUID;
  updatedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export interface CorrectiveActionView extends CorrectiveActionRecord {
  effectiveStatus: CorrectiveActionEffectiveStatus;
  overdue: boolean;
}

const LAB_CASE_STATUS_SET = new Set<string>(LAB_CASE_STATUSES);
const LAB_RECONCILIATION_STATUS_SET = new Set<string>(LAB_RECONCILIATION_STATUSES);
const LAB_RECONCILIATION_ENTRY_STATUS_SET = new Set<string>(LAB_RECONCILIATION_ENTRY_STATUSES);
const INVENTORY_CATEGORY_KIND_SET = new Set<string>(INVENTORY_CATEGORY_KINDS);
const INVENTORY_CHECK_RUN_STATUS_SET = new Set<string>(INVENTORY_CHECK_RUN_STATUSES);
const INVENTORY_EXCEPTION_TYPE_SET = new Set<string>(INVENTORY_EXCEPTION_TYPES);
const INCIDENT_CATEGORY_SET = new Set<string>(INCIDENT_CATEGORIES);
const INCIDENT_SEVERITY_SET = new Set<string>(INCIDENT_SEVERITIES);
const INCIDENT_STATUS_SET = new Set<string>(INCIDENT_STATUSES);
const CORRECTIVE_ACTION_TYPE_SET = new Set<string>(CORRECTIVE_ACTION_TYPES);
const CORRECTIVE_ACTION_STATUS_SET = new Set<string>(CORRECTIVE_ACTION_STATUSES);

const LAB_CASE_TRANSITIONS: Record<LabCaseStatus, readonly LabCaseStatus[]> = {
  draft: ["ready_for_pickup", "sent_to_lab", "cancelled"],
  ready_for_pickup: ["sent_to_lab", "cancelled"],
  sent_to_lab: ["received_by_lab", "due", "returned", "rework_required", "cancelled"],
  received_by_lab: ["due", "returned", "rework_required", "cancelled"],
  due: ["returned", "rework_required", "cancelled"],
  returned: ["fitted", "completed", "rework_required"],
  fitted: ["completed", "rework_required"],
  completed: [],
  cancelled: [],
  rework_required: ["sent_to_lab", "cancelled"]
};

export function isLabCaseStatus(value: string): value is LabCaseStatus {
  return LAB_CASE_STATUS_SET.has(value);
}

export function isLabReconciliationStatus(value: string): value is LabReconciliationStatus {
  return LAB_RECONCILIATION_STATUS_SET.has(value);
}

export function isLabReconciliationEntryStatus(
  value: string
): value is LabReconciliationEntryStatus {
  return LAB_RECONCILIATION_ENTRY_STATUS_SET.has(value);
}

export function assertLabCaseTransition(fromStatus: LabCaseStatus, toStatus: LabCaseStatus): void {
  if (fromStatus === toStatus) return;

  if (!LAB_CASE_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new Error(`Lab case cannot transition from ${fromStatus} to ${toStatus}.`);
  }
}

export function isInventoryCategoryKind(value: string): value is InventoryCategoryKind {
  return INVENTORY_CATEGORY_KIND_SET.has(value);
}

export function isInventoryCheckRunStatus(value: string): value is InventoryCheckRunStatus {
  return INVENTORY_CHECK_RUN_STATUS_SET.has(value);
}

export function isInventoryExceptionType(value: string): value is InventoryExceptionType {
  return INVENTORY_EXCEPTION_TYPE_SET.has(value);
}

export function calculateInventoryVariance(input: {
  expectedQuantity: number;
  countedQuantity: number;
}): number {
  assertFiniteQuantity(input.expectedQuantity, "expectedQuantity");
  assertFiniteQuantity(input.countedQuantity, "countedQuantity");
  return input.countedQuantity - input.expectedQuantity;
}

export function classifyInventoryException(input: {
  expectedQuantity: number;
  countedQuantity: number;
  minimumQuantity: number;
}): InventoryExceptionType | null {
  const variance = calculateInventoryVariance(input);
  if (input.countedQuantity <= 0 && input.expectedQuantity > 0) return "missing_item";
  if (input.countedQuantity < input.minimumQuantity) return "low_stock";
  if (variance !== 0) return "variance";
  return null;
}

export function assertFiniteQuantity(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite non-negative quantity.`);
  }
}

export function isIncidentCategory(value: string): value is IncidentCategory {
  return INCIDENT_CATEGORY_SET.has(value);
}

export function isIncidentSeverity(value: string): value is IncidentSeverity {
  return INCIDENT_SEVERITY_SET.has(value);
}

export function isIncidentStatus(value: string): value is IncidentStatus {
  return INCIDENT_STATUS_SET.has(value);
}

export function isCorrectiveActionType(value: string): value is CorrectiveActionType {
  return CORRECTIVE_ACTION_TYPE_SET.has(value);
}

export function isCorrectiveActionStatus(value: string): value is CorrectiveActionStatus {
  return CORRECTIVE_ACTION_STATUS_SET.has(value);
}

export function correctiveActionEffectiveStatus(
  action: Pick<CorrectiveActionRecord, "status" | "dueAt">,
  nowIso = new Date().toISOString()
): CorrectiveActionEffectiveStatus {
  if (action.status === "open" || action.status === "in_progress") {
    return action.dueAt < nowIso ? "overdue" : action.status;
  }
  return action.status;
}
