import {
  ACTIVE_NATIVE_HTTP_OPERATIONS,
  type HttpOperationContract
} from "@clinic-os/api-contracts";
import {
  assertRouteSecurityCoverage,
  defineRouteSecurityPolicy,
  type RegisteredRoute,
  type RouteSecurityPolicy
} from "@clinic-os/security";

const OPERATION_PERMISSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  executeFinancialCommand: ["billing.write"], getFinancialAccount: ["billing.read"], getFinancialDay: ["billing.read", "analytics.read"],
  createAppointmentImport: ["migration.manage", "patient.read"],
  stageAppointmentObservations: ["migration.manage", "patient.read"],
  sealAppointmentImport: ["migration.manage", "patient.read"],
  listAppointmentImports: ["migration.manage", "patient.read"],
  getAppointmentImport: ["migration.manage", "patient.read"],
  reviewAppointmentObservation: ["migration.manage", "patient.read", "schedule.write"],
  listPatientEncounters: ["patient.read", "patient.phi.read", "clinical.note.read"],
  listEncounterPrescriptions: ["patient.read", "patient.phi.read", "prescription.write"],
  listPatientTreatmentPlans: ["patient.read", "patient.phi.read", "dental.chart.read"],
  listPatientInvoices: ["billing.read"],
  listUninvoicedPatientProcedures: ["billing.read"],
  listSopTemplates: ["sop.manage"],
  listSopSchedules: ["sop.manage"],
  listInventoryCheckRuns: ["inventory.manage"],
  previewPatientDuplicates: ["patient.read", "patient.write"],
  listClinicAccess: ["user.manage", "role.manage"],
  saveClinicAccess: ["user.manage", "role.manage"],
  listClinicSetup: ["clinic.manage"],
  saveClinicSetup: ["clinic.manage"],
  listPatientIntakeHistory: ["patient.read", "patient.phi.read", "clinical.note.read"],
  listLabReconciliations: ["lab.manage"],
  listPatientInstructions: ["patient.read", "patient_instruction.write"],
  searchBillingPatients: ["billing.read"],
  listClinicStaff: ["schedule.read"],
  getPatientDemographics: ["patient.read", "patient.write"],
  healthLive: [],
  healthReady: [],
  healthStartup: [],
  getCurrentIdentity: [],
  verifyMetaWhatsAppCallback: [],
  receiveMetaWhatsAppWebhook: [],
  receiveRazorpayPaymentWebhook: [],
  getFhirR4Capability: ["patient.read"],
  getAbdmCapability: ["patient.read"],
  exportFhirClinicalSummary: [
    "interoperability.fhir_r4.export",
    "patient.read",
    "patient.phi.read"
  ],
  importFhirClinicalSummary: [
    "interoperability.fhir_r4.import",
    "patient.read",
    "patient.phi.read"
  ],
  reviewFhirClinicalSummaryImport: [
    "interoperability.fhir_r4.reconcile",
    "patient.read",
    "patient.phi.read"
  ],
  listPatients: ["patient.read"],
  createPatient: ["patient.write"],
  getPatient: ["patient.read", "patient.phi.read"],
  updatePatient: ["patient.write"],
  listPatientDentalSnapshots: ["patient.read", "patient.phi.read", "dental.chart.read"],
  getPatientDentalSnapshot: ["patient.read", "patient.phi.read", "dental.chart.read"],
  preparePatientDocument: ["patient.document.read"],
  issuePatientDocument: ["patient.document.read"],
  getPatientDocument: ["patient.document.read"],
  listPatientSourceContexts: ["patient.read", "patient.phi.read", "clinical.note.read"],
  reviewPatientSourceContext: ["patient.read", "patient.phi.read", "clinical.note.read", "clinical.note.sign"],
  getPatientTimeline: ["patient.read", "patient.phi.read"],
  listLeads: ["message.read"],
  createLead: ["message.write"],
  matchLeadToPatient: ["patient.write", "message.write"],
  convertLeadToAppointment: ["patient.write", "schedule.write"],
  updateLeadStatus: ["message.write"],
  listAppointments: ["schedule.read"],
  createAppointment: ["schedule.write"],
  updateAppointment: ["schedule.write"],
  confirmAppointment: ["schedule.write"],
  checkInAppointment: ["queue.manage"],
  markAppointmentNoShow: ["schedule.write"],
  listAppointmentTypes: ["schedule.read"],
  listChairs: ["schedule.read"],
  listClinicDoctors: ["schedule.read"],
  listProviderSchedules: ["schedule.read"],
  listQueue: ["queue.manage"],
  updateQueueEntry: ["queue.manage"],
  getMorningDashboard: ["schedule.read"],
  listIntakeFormTemplates: ["patient.read"],
  createIntakeFormTemplate: ["clinic.manage"],
  submitPatientIntakeForm: ["intake.write"],
  getPatientPrepSummary: ["patient.read", "patient.phi.read", "clinical.note.read"],
  listPatientConsents: ["patient.read", "patient.phi.read"],
  createPatientConsent: ["intake.write"],
  revokePatientConsent: ["intake.write"],
  createEncounter: ["clinical.note.write"],
  getEncounter: ["clinical.note.read"],
  startEncounter: ["clinical.note.write"],
  closeEncounter: ["clinical.note.sign"],
  saveEncounterClinicalNoteDraft: ["clinical.note.write"],
  signEncounterClinicalNote: ["clinical.note.sign"],
  amendEncounterClinicalNote: ["clinical.note.sign"],
  createEncounterPrescription: ["prescription.write"],
  signPrescription: ["prescription.sign"],
  getPatientDentalChart: ["patient.read", "patient.phi.read", "dental.chart.read"],
  createPatientDentalFinding: ["patient.read", "patient.phi.read", "dental.chart.write"],
  createEncounterDentalFinding: ["patient.read", "patient.phi.read", "dental.chart.write"],
  updateDentalFinding: ["patient.read", "patient.phi.read", "dental.chart.write"],
  listDentalFindingHistory: ["patient.read", "patient.phi.read", "dental.chart.read"],
  createDentalChartSnapshot: ["patient.read", "patient.phi.read", "dental.chart.snapshot"],
  requestMediaUploadUrl: ["media.write"],
  receiveMediaUploadContent: ["media.write"],
  completeMediaUpload: ["media.write"],
  listPatientMediaAssets: ["patient.read", "patient.phi.read", "media.read"],
  getPatientMediaAsset: ["patient.read", "patient.phi.read", "media.read"],
  createSignedMediaAccess: ["patient.phi.read", "media.read"],
  listPricebookProcedures: ["billing.read"],
  createPatientTreatmentPlan: ["patient.read", "patient.phi.read", "dental.chart.write"],
  updateTreatmentPlan: ["patient.read", "patient.phi.read", "dental.chart.write"],
  acceptTreatmentPlan: ["patient.read", "patient.phi.read", "dental.chart.write"],
  createEncounterProcedurePerformed: ["patient.read", "patient.phi.read", "clinical.note.write"],
  createInvoice: ["billing.write"],
  getInvoice: ["billing.read"],
  createInvoiceReceipt: ["billing.write"],
  createPatientInstruction: ["patient.read", "patient_instruction.write"],
  createInvoicePaymentRequest: ["billing.write"],
  recordInvoiceManualPayment: ["billing.write"],
  getOwnerDashboard: ["analytics.read"],
  listTasks: ["task.manage"],
  createTask: ["task.manage"],
  updateTask: ["task.manage"],
  generateDueContinuityTasks: ["task.manage", "recall.manage"],
  createRecallRule: ["recall.manage"],
  listRecalls: ["recall.manage", "patient.read"],
  recordRecallAction: ["recall.manage"],
  createSopTemplate: ["sop.manage"],
  createSopSchedule: ["sop.manage"],
  listSopRuns: ["sop.manage"],
  generateDueSopRuns: ["sop.manage"],
  updateSopRun: ["sop.manage"],
  listLabVendors: ["lab.manage"],
  createLabVendor: ["lab.manage"],
  listLabCases: ["lab.manage"],
  createLabCase: ["patient.read", "patient.phi.read", "lab.manage"],
  updateLabCase: ["patient.read", "patient.phi.read", "lab.manage"],
  createLabReconciliation: ["lab.manage"],
  listInventoryCategories: ["inventory.manage"],
  createInventoryCategory: ["inventory.manage"],
  listInventoryItems: ["inventory.manage"],
  createInventoryItem: ["inventory.manage"],
  createStockLedgerEntry: ["inventory.manage"],
  listInventoryCheckTemplates: ["inventory.manage"],
  createInventoryCheckTemplate: ["inventory.manage"],
  createInventoryCheckRun: ["inventory.manage"],
  updateInventoryCheckRun: ["inventory.manage"],
  listInventoryExceptions: ["inventory.manage"],
  listIncidents: ["incident.manage"],
  createIncident: ["incident.manage"],
  listCorrectiveActions: ["corrective_action.manage"],
  createCorrectiveAction: ["corrective_action.manage"],
  updateCorrectiveAction: ["corrective_action.manage"],
  listProviderHealth: ["migration.manage"],
  listDeadLetterEvents: ["migration.manage"],
  replayDeadLetterEvent: ["migration.manage"],
  listMigrationBatches: ["migration.manage"],
  listImportRuns: ["migration.manage"],
  createPatientImportFile: ["migration.manage"],
  getPatientImportFile: ["migration.manage"],
  stagePatientImportChunk: ["migration.manage"],
  sealPatientImportFile: ["migration.manage"],
  createImportRun: ["migration.manage"],
  getImportRun: ["migration.manage"],
  createMigrationBatch: ["migration.manage"],
  getMigrationBatch: ["migration.manage"],
  listMigrationBatchRows: ["migration.manage"],
  resolveMigrationBatchRow: ["migration.manage"],
  commitMigrationBatch: ["migration.manage"],
  rollbackMigrationBatch: ["migration.manage"],
  listEncounterAiScribeSessions: ["ai.scribe.read", "patient.read", "patient.phi.read"],
  createAiScribeSession: ["ai.scribe.write", "patient.read", "patient.phi.read"],
  getAiScribeSession: ["ai.scribe.read", "patient.read", "patient.phi.read"],
  createAiScribeTranscriptSegment: ["ai.scribe.write", "patient.read", "patient.phi.read"],
  createAiScribeSourceAnchor: ["ai.scribe.write"],
  generateAiScribeDrafts: ["ai.scribe.write", "patient.read", "patient.phi.read"],
  recordAiScribeReviewDecision: ["ai.scribe.review", "patient.read", "patient.phi.read"],
  deleteAiScribeRetainedPayloads: ["ai.scribe.review"],
  listAuditEvents: ["audit.read"],
  reviewAuditEvent: ["audit.review"],
  listPatientRecordExports: ["patient.read", "patient.export"],
  createPatientRecordExport: ["patient.read", "patient.phi.read", "patient.export"],
  listDeletionRequests: ["retention.manage"],
  createDeletionRequest: ["privacy.request"],
  reviewDeletionRequest: ["retention.manage"],
  runRetentionJob: ["retention.manage"],
  listBreakGlassAccessRequests: ["break_glass.approve"],
  createBreakGlassAccessRequest: ["break_glass.request"],
  reviewBreakGlassAccessRequest: ["break_glass.approve"],
  getPilotReadiness: ["clinic.manage"]
});

const EXPENSIVE_OPERATION_IDS = new Set([
  "createPatientRecordExport",
  "generateAiScribeDrafts",
  "runRetentionJob",
  "commitMigrationBatch",
  "rollbackMigrationBatch",
  "generateDueContinuityTasks",
  "generateDueSopRuns"
]);

const OPERATION_REQUIRED_ROLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  saveClinicAccess: ["owner_admin"],
  reviewPatientSourceContext: ["doctor"],
  startEncounter: ["doctor"],
  createEncounterProcedurePerformed: ["doctor"],
  signEncounterClinicalNote: ["doctor"],
  amendEncounterClinicalNote: ["doctor"],
  closeEncounter: ["doctor"],
  signPrescription: ["doctor"]
});

export interface MatchedClinicOsRoute {
  operation: HttpOperationContract;
  policy: RouteSecurityPolicy;
  pathParameters: Readonly<Record<string, string>>;
}

interface CompiledRoute {
  operation: HttpOperationContract;
  policy: RouteSecurityPolicy;
  expression: RegExp;
  parameterNames: readonly string[];
}

export const CLINIC_OS_ROUTE_POLICIES: readonly RouteSecurityPolicy[] = Object.freeze(
  ACTIVE_NATIVE_HTTP_OPERATIONS.map(createPolicy)
);

const COMPILED_ROUTES: readonly CompiledRoute[] = Object.freeze(
  ACTIVE_NATIVE_HTTP_OPERATIONS.map((operation, index) => {
    const parameterNames: string[] = [];
    const expression = new RegExp(
      `^${operation.path
        .split("/")
        .map((segment) => {
          const match = /^\{([^}]+)\}$/.exec(segment);
          if (!match) return escapeRegularExpression(segment);
          parameterNames.push(match[1]);
          return "([^/]+)";
        })
        .join("/")}$`
    );
    return {
      operation,
      policy: CLINIC_OS_ROUTE_POLICIES[index],
      expression,
      parameterNames
    };
  })
);

const REGISTERED_ROUTES: readonly RegisteredRoute[] = ACTIVE_NATIVE_HTTP_OPERATIONS.map(
  (operation) => ({ method: operation.method, pathTemplate: operation.path })
);

assertRouteSecurityCoverage(REGISTERED_ROUTES, CLINIC_OS_ROUTE_POLICIES);
assertApplicationRouteRegistry();

export function matchClinicOsRoute(method: string, pathname: string): MatchedClinicOsRoute | null {
  for (const candidate of COMPILED_ROUTES) {
    if (candidate.operation.method !== method) continue;
    const match = candidate.expression.exec(pathname);
    if (!match) continue;
    const pathParameters = Object.fromEntries(
      candidate.parameterNames.map((name, index) => [name, decodePathSegment(match[index + 1])])
    );
    return { operation: candidate.operation, policy: candidate.policy, pathParameters };
  }
  return null;
}

export function permissionsForOperation(operationId: string): readonly string[] {
  const permissions = OPERATION_PERMISSIONS[operationId];
  if (!permissions) throw new Error(`Missing application permission policy: ${operationId}`);
  return permissions;
}

export function requiredRolesForOperation(operationId: string): readonly string[] {
  return OPERATION_REQUIRED_ROLES[operationId] ?? [];
}

function createPolicy(operation: HttpOperationContract): RouteSecurityPolicy {
  const permissions = permissionsForOperation(operation.operationId);
  const bodyMaximumBytes = operation.request.body?.maximumBytes ?? null;
  const queryPropertyCount = Object.keys(operation.request.query.properties ?? {}).length;
  const authenticated = operation.auth === "bearer";
  const isMutation = operation.idempotency.mode === "header";
  const access =
    operation.operationId === "healthLive"
      ? ({ mode: "public_health", healthKind: "liveness" } as const)
      : operation.operationId === "healthReady"
        ? ({ mode: "public_health", healthKind: "readiness" } as const)
        : operation.operationId === "healthStartup"
          ? ({ mode: "public_health", healthKind: "startup" } as const)
          : operation.auth === "meta_challenge"
            ? ({
                mode: "provider_challenge",
                provider: "meta_whatsapp_cloud",
                verification: "constant_time_registered_token"
              } as const)
            : operation.auth === "meta_signature" || operation.auth === "razorpay_signature"
              ? ({
                  mode: "verified_webhook",
                  provider:
                    operation.auth === "meta_signature" ? "meta_whatsapp_cloud" : "razorpay",
                  signatureVerification: "raw_body_before_parse",
                  replayProtection: "required"
                } as const)
              : operation.operationId === "getCurrentIdentity"
                ? ({
                    mode: "authenticated",
                    tenant: "verified_active_membership",
                    clinic: "not_applicable",
                    authorization: { mode: "active_identity" }
                  } as const)
                : ({
                    mode: "authenticated",
                    tenant: "verified_active_membership",
                    clinic: "verified_active_membership",
                    authorization: {
                      mode: "all_permissions",
                      permissions: permissions as readonly [string, ...string[]]
                    }
                  } as const);

  return defineRouteSecurityPolicy({
    routeId: toRouteId(operation.operationId),
    method: operation.method,
    pathTemplate: operation.path,
    access,
    abuse: {
      body: operation.method === "GET" ? null : { maxBytes: bodyMaximumBytes ?? 0 },
      query: {
        maxParameters: queryPropertyCount,
        maxTotalBytes: queryPropertyCount === 0 ? 0 : 4096,
        maxKeyBytes: 128,
        maxValueBytes: 2048,
        maxValuesPerKey: 1
      },
      pagination:
        operation.pagination.mode === "bounded"
          ? {
              defaultLimit: operation.pagination.defaultLimit ?? 50,
              maxLimit: operation.pagination.maximumLimit ?? 100,
              maxCursorBytes: 1
            }
          : null,
      rate: {
        limit: operation.auth === "none" ? 120 : isMutation ? 120 : 300,
        windowSeconds: 60,
        scope: authenticated ? "tenant_actor" : "ip"
      },
      expensiveOperation: EXPENSIVE_OPERATION_IDS.has(operation.operationId)
        ? {
            maxUnitsPerRequest: 1,
            maxUnitsPerWindow: 20,
            windowSeconds: 60,
            scope: "tenant_actor"
          }
        : null
    },
    runtimeValidation: {
      path: Object.keys(operation.request.path.properties ?? {}).length > 0 ? "strict" : "none",
      query: queryPropertyCount > 0 ? "strict" : "none",
      body:
        operation.auth === "meta_signature" || operation.auth === "razorpay_signature"
          ? "verified_raw_body"
          : operation.request.body
            ? "strict"
            : "none",
      response: "strict",
      rejectUnknownFields: true
    },
    cachePolicy: "no-store"
  });
}

function assertApplicationRouteRegistry(): void {
  const operationIds = new Set(ACTIVE_NATIVE_HTTP_OPERATIONS.map(({ operationId }) => operationId));
  const permissionIds = new Set(Object.keys(OPERATION_PERMISSIONS));
  const missing = [...operationIds].filter((operationId) => !permissionIds.has(operationId));
  const stale = [...permissionIds].filter((operationId) => !operationIds.has(operationId));
  if (missing.length > 0 || stale.length > 0) {
    throw new Error(
      `Application permission registry drift; missing=[${missing.sort().join(",")}], stale=[${stale.sort().join(",")}].`
    );
  }
  for (const operation of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    if (
      operation.auth === "bearer" &&
      operation.operationId !== "getCurrentIdentity" &&
      permissionsForOperation(operation.operationId).length === 0
    ) {
      throw new Error(
        `Authenticated clinic operation has no central permission: ${operation.operationId}`
      );
    }
  }
}

function decodePathSegment(value: string | undefined): string {
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    return value ?? "";
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toRouteId(operationId: string): string {
  return operationId.replace(/[A-Z]/g, (character) => `.${character.toLowerCase()}`);
}
