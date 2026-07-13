import type { DentalToothNumber } from "./dental.ts";
import type { UUID } from "./ids.ts";

export const CP10_PILOT_READINESS_STATUSES = [
  "ready",
  "unavailable",
  "deferred",
  "blocked"
] as const;
export type Cp10PilotReadinessStatus = (typeof CP10_PILOT_READINESS_STATUSES)[number];

export const CP10_PILOT_READINESS_CATEGORIES = [
  "clinic_setup",
  "workflow",
  "provider",
  "data_migration",
  "operations",
  "security_compliance",
  "training"
] as const;
export type Cp10PilotReadinessCategory =
  (typeof CP10_PILOT_READINESS_CATEGORIES)[number];

export interface Cp10PilotReadinessItem {
  id: string;
  category: Cp10PilotReadinessCategory;
  label: string;
  status: Cp10PilotReadinessStatus;
  evidence: string;
  activationPath: string[];
  routeContracts: string[];
  externalBlocker: boolean;
}

export interface Cp10PilotReadinessSummary {
  ready: number;
  unavailable: number;
  deferred: number;
  blocked: number;
  total: number;
}

export interface Cp10PilotReadinessInput {
  generatedAt?: string;
  environment: string;
  productionLike: boolean;
  tenantId?: UUID | string | undefined;
  clinicId?: UUID | string | undefined;
  clinicName: string;
  syntheticDataOnly: boolean;
  pilotInputs: {
    patientExportPath?: string | undefined;
    appointmentExportPath?: string | undefined;
    pricebookPath?: string | undefined;
    templatesDir?: string | undefined;
    xraySampleDir?: string | undefined;
  };
  providers: {
    whatsapp: {
      provider: string;
      credentialsPresent: boolean;
      signedWebhookConfigured: boolean;
    };
    payment: {
      provider: string;
      credentialsPresent: boolean;
      signedWebhookConfigured: boolean;
    };
    telephony: {
      provider: string;
      credentialsPresent: boolean;
      signedWebhookConfigured: boolean;
    };
    ai: {
      llmProvider: string;
      llmCredentialsPresent: boolean;
      transcriptionProvider: string;
      transcriptionCredentialsPresent: boolean;
      dataResidencyApproved: boolean;
    };
  };
  operations: {
    cloud: {
      primaryRegion: string;
      drRegion: string;
      accountConfigured: boolean;
      terraformBackendConfigured: boolean;
      kmsConfigured: boolean;
      applyVerified: boolean;
    };
    alerting: {
      provider: string;
      destinationConfigured: boolean;
    };
    backupRestore: {
      drillMode: string;
      dryRunEvidence: boolean;
      liveRestoreVerified: boolean;
    };
    githubPushVerified: boolean;
    physicalDeviceVerified: boolean;
    abdmSandboxVerified: boolean;
  };
}

export interface Cp10PilotReadinessPlan {
  schemaVersion: "cp10.pilot_readiness.v1";
  generatedAt: string;
  environment: string;
  tenantId?: string | undefined;
  clinicId?: string | undefined;
  clinicName: string;
  localConfigurationStatus: Cp10PilotReadinessStatus;
  pilotGoLiveStatus: Cp10PilotReadinessStatus;
  summary: Cp10PilotReadinessSummary;
  items: Cp10PilotReadinessItem[];
  liveVerificationGaps: Cp10PilotReadinessItem[];
  safety: {
    syntheticOnly: boolean;
    noRealPhi: boolean;
    noLiveProviderActivation: boolean;
    noSecretValues: boolean;
  };
}

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
  rowVersion: number;
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
  rowVersion: number;
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
  rowVersion: number;
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

const CP10_PROVIDER_ROUTE_CONTRACTS = {
  whatsapp: ["POST /v1/webhooks/whatsapp/{accountId}", "GET /v1/provider-health"],
  payment: [
    "POST /v1/provider-callbacks/razorpay/{registrationKey}",
    "GET /v1/provider-health"
  ],
  telephony: ["Provider-signed telephony callback route", "GET /v1/provider-health"],
  ai: [
    "POST /v1/encounters/{encounterId}/ai-scribe/sessions",
    "POST /v1/ai-scribe/sessions/{sessionId}/review-decisions"
  ],
  migration: [
    "POST /v1/migration-batches",
    "GET /v1/migration-batches/{migrationBatchId}",
    "POST /v1/migration-batches/{migrationBatchId}/rows/{rowId}/resolve"
  ]
} as const;

export function buildCp10PilotReadinessPlan(
  input: Cp10PilotReadinessInput
): Cp10PilotReadinessPlan {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const items: Cp10PilotReadinessItem[] = [
    ...buildCp10OnboardingItems(input),
    ...buildCp10WorkflowItems(),
    ...buildCp10ProviderItems(input),
    ...buildCp10OperationsItems(input)
  ];
  const summary = summarizeCp10PilotReadiness(items);
  const onboardingItems = items.filter((item) =>
    ["clinic_setup", "data_migration", "training"].includes(item.category)
  );
  const localConfigurationStatus = highestCp10Status(onboardingItems);
  const goLiveItems = items.filter(
    (item) => item.category === "provider" || item.category === "operations"
  );
  const pilotGoLiveStatus = highestCp10Status(goLiveItems);

  return {
    schemaVersion: "cp10.pilot_readiness.v1",
    generatedAt,
    environment: input.environment,
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    clinicName: input.clinicName,
    localConfigurationStatus,
    pilotGoLiveStatus,
    summary,
    items,
    liveVerificationGaps: items.filter(
      (item) => item.externalBlocker || item.status === "blocked" || item.status === "deferred"
    ),
    safety: {
      syntheticOnly: input.syntheticDataOnly,
      noRealPhi: input.syntheticDataOnly,
      noLiveProviderActivation: true,
      noSecretValues: true
    }
  };
}

export function summarizeCp10PilotReadiness(
  items: readonly Cp10PilotReadinessItem[]
): Cp10PilotReadinessSummary {
  const summary: Cp10PilotReadinessSummary = {
    blocked: 0,
    deferred: 0,
    ready: 0,
    total: items.length,
    unavailable: 0
  };

  for (const item of items) {
    summary[item.status] += 1;
  }

  return summary;
}

export function isCp10PilotReadinessStatus(
  value: string
): value is Cp10PilotReadinessStatus {
  return (CP10_PILOT_READINESS_STATUSES as readonly string[]).includes(value);
}

function buildCp10OnboardingItems(
  input: Cp10PilotReadinessInput
): Cp10PilotReadinessItem[] {
  const patientAndAppointmentExportsConfigured = Boolean(
    input.pilotInputs.patientExportPath && input.pilotInputs.appointmentExportPath
  );

  return [
    cp10Item({
      activationPath: [
        "Confirm the pilot clinic name, timezone, working hours, appointment types, chairs, and staff roster.",
        "Load only synthetic or explicitly clinic-approved onboarding data."
      ],
      category: "clinic_setup",
      evidence: `${input.clinicName} is the active clinic context for this readiness contract.`,
      id: "clinic-profile",
      label: "Pilot clinic profile",
      routeContracts: ["GET /v1/me"],
      status: input.clinicName.trim().length > 0 ? "ready" : "blocked"
    }),
    cp10Item({
      activationPath: [
        "Keep PILOT_SYNTHETIC_DATA_ONLY=true for local release-candidate evidence.",
        "Do not load real patient exports until the clinic has approved a governed import run."
      ],
      category: "clinic_setup",
      evidence: input.syntheticDataOnly
        ? "Pilot evidence is synthetic-only and safe for local QA, screenshots, and training."
        : "Synthetic-only mode is off; CP10 cannot treat local fixtures as no-real-PHI evidence.",
      externalBlocker: !input.syntheticDataOnly,
      id: "synthetic-data-posture",
      label: "No-real-PHI pilot data posture",
      routeContracts: [],
      status: input.syntheticDataOnly ? "ready" : "blocked"
    }),
    cp10Item({
      activationPath: [
        "Provide clinic-approved patient and appointment exports through official export/import paths.",
        "Review rows through migration duplicate/conflict routes before any commit."
      ],
      category: "data_migration",
      evidence: patientAndAppointmentExportsConfigured
        ? "Patient and appointment export paths are configured as input locations."
        : "Patient and appointment export paths are missing from pilot input configuration.",
      externalBlocker: !patientAndAppointmentExportsConfigured,
      id: "patient-appointment-import-inputs",
      label: "Patient and appointment import inputs",
      routeContracts: [...CP10_PROVIDER_ROUTE_CONTRACTS.migration],
      status: patientAndAppointmentExportsConfigured ? "ready" : "blocked"
    }),
    cp10Item({
      activationPath: [
        "Provide the pilot clinic pricebook/procedure list.",
        "Review mapped procedure names, taxes, and prices before staff training."
      ],
      category: "clinic_setup",
      evidence: input.pilotInputs.pricebookPath
        ? "Pricebook input path is configured."
        : "Pricebook input path is missing from pilot configuration.",
      externalBlocker: !input.pilotInputs.pricebookPath,
      id: "pricebook-configuration",
      label: "Pricebook configuration",
      routeContracts: ["GET /v1/pricebook/procedures"],
      status: input.pilotInputs.pricebookPath ? "ready" : "blocked"
    }),
    cp10Item({
      activationPath: [
        "Load consent, prescription, payment, post-op, and recall templates from clinic-approved files.",
        "Have owner/doctor approve final patient-facing wording before live use."
      ],
      category: "training",
      evidence: input.pilotInputs.templatesDir
        ? "Template directory is configured for CP10 pilot onboarding."
        : "Template directory is missing from pilot configuration.",
      externalBlocker: !input.pilotInputs.templatesDir,
      id: "template-configuration",
      label: "Template configuration",
      routeContracts: ["GET /v1/form-templates", "POST /v1/patients/{patientId}/instructions"],
      status: input.pilotInputs.templatesDir ? "ready" : "blocked"
    }),
    cp10Item({
      activationPath: [
        "Keep sample imaging metadata synthetic unless the clinic approves explicit export samples.",
        "Use the CP4 mediated media route family for upload/list/signed access testing."
      ],
      category: "clinic_setup",
      evidence: input.pilotInputs.xraySampleDir
        ? "Synthetic X-ray/photo sample directory is configured."
        : "Synthetic media sample directory is not configured; media pilot training remains deferred.",
      externalBlocker: !input.pilotInputs.xraySampleDir,
      id: "media-sample-inputs",
      label: "Media sample inputs",
      routeContracts: [
        "POST /v1/media/upload-urls",
        "POST /v1/media/uploads/{uploadId}/complete",
        "POST /v1/media/assets/{mediaAssetId}/signed-url"
      ],
      status: input.pilotInputs.xraySampleDir ? "ready" : "deferred"
    })
  ];
}

function buildCp10WorkflowItems(): Cp10PilotReadinessItem[] {
  return [
    workflowItem(
      "lead-appointment-day-start",
      "Lead to appointment and day-start",
      "CP2 verified lead capture, patient match/create, appointments, confirmations, check-in, queue, timeline, role denial, and tenant isolation.",
      [
        "GET /v1/leads",
        "POST /v1/leads/{id}/convert-to-appointment",
        "GET /v1/appointments",
        "GET /v1/queue"
      ]
    ),
    workflowItem(
      "intake-consent-encounter",
      "Intake, consent, encounter, notes, and prescriptions",
      "CP3 verified patient-scoped forms, consent create/revoke, encounter start, note draft/sign/amend, prescription sign, and consent enforcement state.",
      [
        "POST /v1/patients/{patientId}/form-responses",
        "POST /v1/patients/{patientId}/consents",
        "POST /v1/encounters/{encounterId}/sign-note"
      ]
    ),
    workflowItem(
      "dental-chart-media",
      "Dental charting, media, and imaging coexistence",
      "CP4 verified dental findings, history, snapshots, private media upload, mediated signed access, role denial, and tenant denial.",
      [
        "POST /v1/patients/{patientId}/dental-findings",
        "PATCH /v1/dental-findings/{findingId}",
        "POST /v1/media/upload-urls"
      ]
    ),
    workflowItem(
      "checkout-payments-instructions",
      "Treatment checkout, payment request, and instructions",
      "CP5 verified treatment estimates, accepted plans, procedure performance, invoices, payment requests, manual payment evidence, receipts, and instruction requests.",
      [
        "POST /v1/patients/{patientId}/treatment-plans",
        "POST /v1/invoices",
        "POST /v1/invoices/{invoiceId}/payment-requests"
      ]
    ),
    workflowItem(
      "continuity-operations-owner",
      "Continuity, lab, inventory, events, and owner dashboard",
      "CP6 verified recall/task/SOP workflows, lab case/reconciliation, inventory checks, incidents/CAPA, and owner dashboard source attribution.",
      [
        "GET /v1/tasks",
        "GET /v1/lab-cases",
        "GET /v1/inventory/exceptions",
        "GET /v1/owner-dashboard"
      ]
    ),
    workflowItem(
      "integration-ops-migration",
      "Integration operations and safe migration review",
      "CP7 verified provider health, dead-letter replay request evidence, and row-centered migration review without fake provider completion.",
      [
        "GET /v1/provider-health",
        "GET /v1/dead-letter-events",
        "GET /v1/migration-batches"
      ]
    ),
    workflowItem(
      "ai-mobile-review",
      "Mobile capture and AI review boundaries",
      "CP8 verified consent-gated capture contracts, AI scribe sessions, source anchors, draft outputs, and review-only decisions.",
      [
        "POST /v1/encounters/{encounterId}/ai-scribe/sessions",
        "POST /v1/ai-scribe/sessions/{sessionId}/review-decisions"
      ]
    ),
    workflowItem(
      "security-privacy-ops",
      "Security, privacy, FHIR projection, and restore evidence",
      "CP9 verified record exports, deletion requests, retention dry runs, audit review, break-glass review, FHIR projection package, and restore dry-run evidence.",
      [
        "POST /v1/patients/{patientId}/record-exports",
        "POST /v1/privacy/retention-runs",
        "GET /v1/break-glass/access-requests"
      ]
    )
  ];
}

function buildCp10ProviderItems(input: Cp10PilotReadinessInput): Cp10PilotReadinessItem[] {
  const whatsappLiveReady =
    input.providers.whatsapp.provider === "meta_cloud" &&
    input.providers.whatsapp.credentialsPresent &&
    input.providers.whatsapp.signedWebhookConfigured;
  const whatsappKnownButBlocked =
    input.providers.whatsapp.provider === "meta_cloud" &&
    input.providers.whatsapp.credentialsPresent &&
    !input.providers.whatsapp.signedWebhookConfigured;
  const razorpayLiveReady =
    input.providers.payment.provider === "razorpay" &&
    input.providers.payment.credentialsPresent &&
    input.providers.payment.signedWebhookConfigured;
  const razorpayKnownButBlocked =
    input.providers.payment.provider === "razorpay" &&
    input.providers.payment.credentialsPresent &&
    !input.providers.payment.signedWebhookConfigured;
  const telephonyLiveReady =
    input.providers.telephony.provider === "exotel" &&
    input.providers.telephony.credentialsPresent &&
    input.providers.telephony.signedWebhookConfigured;
  const liveAiReady =
    input.providers.ai.llmProvider !== "simulator" &&
    input.providers.ai.llmProvider !== "unconfigured" &&
    input.providers.ai.llmCredentialsPresent &&
    input.providers.ai.transcriptionProvider !== "simulator" &&
    input.providers.ai.transcriptionProvider !== "unconfigured" &&
    input.providers.ai.transcriptionCredentialsPresent &&
    input.providers.ai.dataResidencyApproved;

  return [
    cp10Item({
      activationPath: [
        "Use Meta Cloud API or an approved BSP.",
        "Register a public HTTPS webhook callback only after signed verification is active.",
        "Run live outbound/inbound smoke under explicit live-provider approval."
      ],
      category: "provider",
      evidence: whatsappLiveReady
        ? "WhatsApp credentials and signed webhook callback configuration are present."
        : whatsappKnownButBlocked
          ? "WhatsApp credentials are present, but signed hosted webhook registration is not configured."
          : `WhatsApp provider is ${input.providers.whatsapp.provider}; production messaging is unavailable.`,
      externalBlocker: !whatsappLiveReady,
      id: "provider-whatsapp",
      label: "WhatsApp messaging activation",
      routeContracts: [...CP10_PROVIDER_ROUTE_CONTRACTS.whatsapp],
      status: whatsappLiveReady ? "ready" : whatsappKnownButBlocked ? "blocked" : "unavailable"
    }),
    cp10Item({
      activationPath: [
        "Use Razorpay sandbox/live API keys through the official dashboard.",
        "Register HTTPS callback with raw-body signature verification before provider-paid state is enabled.",
        "Reconcile payment events through CP5 signed webhook routes."
      ],
      category: "provider",
      evidence: razorpayLiveReady
        ? "Razorpay credentials and signed webhook URL are configured."
        : razorpayKnownButBlocked
          ? "Razorpay credentials are present, but RAZORPAY_WEBHOOK_URL is missing."
          : `Payment provider is ${input.providers.payment.provider}; live Razorpay reconciliation is unavailable.`,
      externalBlocker: !razorpayLiveReady,
      id: "provider-razorpay",
      label: "Razorpay payment activation",
      routeContracts: [...CP10_PROVIDER_ROUTE_CONTRACTS.payment],
      status: razorpayLiveReady ? "ready" : razorpayKnownButBlocked ? "blocked" : "unavailable"
    }),
    cp10Item({
      activationPath: [
        "Use Exotel or another clinic-approved telephony provider through official APIs.",
        "Register signed callbacks before showing live missed-call capture.",
        "Keep manual missed-call entry as the clinic-approved fallback until activation."
      ],
      category: "provider",
      evidence: telephonyLiveReady
        ? "Telephony credentials and signed callback configuration are present."
        : `Telephony provider is ${input.providers.telephony.provider}; live missed-call capture is not configured.`,
      externalBlocker: !telephonyLiveReady,
      id: "provider-telephony",
      label: "Telephony/missed-call activation",
      routeContracts: [...CP10_PROVIDER_ROUTE_CONTRACTS.telephony],
      status: telephonyLiveReady ? "ready" : "deferred"
    }),
    cp10Item({
      activationPath: [
        "Select approved LLM and transcription providers.",
        "Record no-training/no-retention and data-residency posture before live patient audio.",
        "Keep CP8 review-only AI outputs until doctor approval workflows are active."
      ],
      category: "provider",
      evidence: liveAiReady
        ? "Live LLM and transcription providers are configured with data-residency approval."
        : `AI uses LLM=${input.providers.ai.llmProvider} and transcription=${input.providers.ai.transcriptionProvider}; live scribe remains deferred.`,
      externalBlocker: !liveAiReady,
      id: "provider-ai-scribe",
      label: "Live AI/transcription activation",
      routeContracts: [...CP10_PROVIDER_ROUTE_CONTRACTS.ai],
      status: liveAiReady ? "ready" : "deferred"
    }),
    cp10Item({
      activationPath: [
        "Use internal FHIR R4 projections for local export evidence.",
        "Enable ABDM only after sandbox credentials, HFR/HPR/facility details, and compliance approval exist.",
        "Do not call ABDM live endpoints from CP10 readiness."
      ],
      category: "provider",
      evidence: input.operations.abdmSandboxVerified
        ? "ABDM sandbox verification is recorded, but production exchange still requires compliance activation."
        : "ABDM live/sandbox exchange is not verified in this CP10 lane.",
      externalBlocker: true,
      id: "provider-abdm",
      label: "ABDM activation",
      routeContracts: ["FHIR projection package evidence only; no live ABDM API route is claimed"],
      status: input.operations.abdmSandboxVerified ? "deferred" : "deferred"
    })
  ];
}

function buildCp10OperationsItems(input: Cp10PilotReadinessInput): Cp10PilotReadinessItem[] {
  const cloudReady =
    input.operations.cloud.accountConfigured &&
    input.operations.cloud.terraformBackendConfigured &&
    input.operations.cloud.kmsConfigured &&
    input.operations.cloud.applyVerified;
  const alertingReady =
    input.operations.alerting.provider !== "unconfigured" &&
    input.operations.alerting.destinationConfigured;
  const dryRunReady = input.operations.backupRestore.dryRunEvidence;

  return [
    cp10Item({
      activationPath: [
        "Use AWS India ap-south-1 primary and ap-south-2 DR regions.",
        "Run Terraform apply only in an approved deployment window.",
        "Record successful cloud apply evidence before pilot-prod go-live."
      ],
      category: "operations",
      evidence: cloudReady
        ? "Pilot-prod cloud account, backend, KMS, and apply evidence are configured."
        : `Cloud posture is not live-applied in ${input.environment}; primary=${input.operations.cloud.primaryRegion}, dr=${input.operations.cloud.drRegion}.`,
      externalBlocker: !cloudReady,
      id: "ops-cloud-pilot-prod",
      label: "AWS pilot-prod deployment",
      routeContracts: ["Terraform validation profile", "Restore dry-run evidence"],
      status: cloudReady ? "ready" : "blocked"
    }),
    cp10Item({
      activationPath: [
        "Configure alert routing before live clinic operations.",
        "Verify owner/support escalation path with synthetic incidents."
      ],
      category: "operations",
      evidence: alertingReady
        ? "Alerting provider and destination are configured."
        : `Alerting provider is ${input.operations.alerting.provider}; destination is not pilot-ready.`,
      externalBlocker: !alertingReady,
      id: "ops-alerting",
      label: "Alerting and escalation",
      routeContracts: ["Provider-health alert catalog", "Incident/CAPA routes"],
      status: alertingReady ? "ready" : "blocked"
    }),
    cp10Item({
      activationPath: [
        "Keep restore checks non-mutating by default.",
        "Run live restore/failover only with explicit approval and isolated target resources."
      ],
      category: "operations",
      evidence: input.operations.backupRestore.liveRestoreVerified
        ? "Live restore evidence is recorded."
        : dryRunReady
          ? "Synthetic restore dry-run evidence exists; live restore remains external."
          : "Restore dry-run evidence is missing.",
      externalBlocker: !input.operations.backupRestore.liveRestoreVerified,
      id: "ops-backup-restore",
      label: "Backup and restore readiness",
      routeContracts: ["scripts/cp9-restore-drill.mjs --dry-run"],
      status: input.operations.backupRestore.liveRestoreVerified
        ? "ready"
        : dryRunReady
          ? "deferred"
          : "blocked"
    }),
    cp10Item({
      activationPath: [
        "Authenticate GitHub CLI or CI token.",
        "Push release-candidate branch and verify remote checks before promotion."
      ],
      category: "operations",
      evidence: input.operations.githubPushVerified
        ? "GitHub push/check verification is recorded."
        : "GitHub push and remote CI verification are not part of this lane.",
      externalBlocker: !input.operations.githubPushVerified,
      id: "ops-github-push",
      label: "GitHub push and remote CI",
      routeContracts: ["GitHub Actions checks"],
      status: input.operations.githubPushVerified ? "ready" : "blocked"
    }),
    cp10Item({
      activationPath: [
        "Run Expo/TestFlight/internal app checks on approved clinic devices.",
        "Do not treat Expo web or simulator evidence as physical-device pilot readiness."
      ],
      category: "operations",
      evidence: input.operations.physicalDeviceVerified
        ? "Physical-device smoke verification is recorded."
        : "Physical-device smoke is an external verification gap.",
      externalBlocker: !input.operations.physicalDeviceVerified,
      id: "ops-physical-device",
      label: "Physical-device mobile verification",
      routeContracts: ["Expo/mobile capture app checks"],
      status: input.operations.physicalDeviceVerified ? "ready" : "deferred"
    })
  ];
}

function workflowItem(
  id: string,
  label: string,
  evidence: string,
  routeContracts: string[]
): Cp10PilotReadinessItem {
  return cp10Item({
    activationPath: [
      "Keep route family canonical with its checkpoint tests.",
      "Run CP10 full-clinic-day regression before release-candidate closeout."
    ],
    category: "workflow",
    evidence,
    id: `workflow-${id}`,
    label,
    routeContracts,
    status: "ready"
  });
}

function cp10Item(
  item: Omit<Cp10PilotReadinessItem, "externalBlocker"> & { externalBlocker?: boolean }
): Cp10PilotReadinessItem {
  const inferredExternalBlocker =
    item.status === "blocked" || item.status === "deferred" || item.status === "unavailable";

  return {
    ...item,
    externalBlocker: item.externalBlocker ?? inferredExternalBlocker
  };
}

function highestCp10Status(
  items: readonly Pick<Cp10PilotReadinessItem, "status">[]
): Cp10PilotReadinessStatus {
  if (items.some((item) => item.status === "blocked")) return "blocked";
  if (items.some((item) => item.status === "deferred")) return "deferred";
  if (items.some((item) => item.status === "unavailable")) return "unavailable";
  return "ready";
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
