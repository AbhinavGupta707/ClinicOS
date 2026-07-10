const MEBIBYTE = 1024 * 1024;

const COMMON_GAPS = Object.freeze([
  "no_registered_security_policy",
  "unvalidated_client_request_id",
  "no_application_rate_budget",
  "no_runtime_response_schema",
  "error_message_and_details_not_centrally_redacted"
]);

function operation(method, pathTemplate, handler, permissions, queryFields = []) {
  const hasJsonBody = ["PATCH", "POST"].includes(method);
  const isRawMedia = method === "PUT" && pathTemplate.endsWith("/content");
  return Object.freeze({
    method,
    pathTemplate,
    handler,
    routeClass: "authenticated_clinic_operation",
    currentControls: Object.freeze({
      readinessAdmission: true,
      authentication: "verified_keycloak_or_local_only_fixture",
      tenantAuthority: "verified_identity_repository",
      clinicAuthority: "client_selector_checked_against_verified_clinics",
      authorization:
        permissions.length > 0 ? "handler_permission_assertions" : "indirect_helper_assertions",
      permissions: Object.freeze([...permissions]),
      queryFields: Object.freeze([...queryFields]),
      requestBody: isRawMedia ? "raw_bytes" : hasJsonBody ? "handwritten_json_parser" : "none",
      bodyBudgetBytes: isRawMedia ? 100 * MEBIBYTE : hasJsonBody ? MEBIBYTE : null,
      bodyOversizeStatus: isRawMedia || hasJsonBody ? 400 : null,
      unknownFieldsRejected: false,
      queryBudget: "absent",
      paginationBudget: queryFields.includes("limit") ? "handler_specific_only" : "absent",
      rateBudget: "absent",
      requestIdPolicy: "unvalidated_header_or_uuid",
      errorPolicy: "legacy_unredacted_message_and_details"
    }),
    compliantWithCp12Pipeline: false,
    gaps: Object.freeze([
      ...COMMON_GAPS,
      "no_global_query_cardinality_or_byte_budget",
      ...(hasJsonBody
        ? ["unknown_body_fields_ignored", "no_global_string_array_or_object_complexity_budget"]
        : []),
      ...(isRawMedia || hasJsonBody ? ["oversize_body_returns_400_not_413"] : [])
    ])
  });
}

const operationRoutes = [
  ["GET", "/v1/form-templates", "listIntakeFormTemplates", ["patient.read"]],
  ["POST", "/v1/form-templates", "createIntakeFormTemplate", ["clinic.manage"]],
  ["GET", "/v1/patients", "listPatients", ["patient.read"], ["query", "phone", "source"]],
  ["POST", "/v1/patients", "createPatient", ["patient.write"]],
  ["GET", "/v1/provider-health", "listProviderHealth", ["migration.manage"]],
  ["GET", "/v1/pilot-readiness", "getPilotReadiness", ["clinic.manage"]],
  [
    "GET",
    "/v1/dead-letter-events",
    "listDeadLetterEvents",
    ["migration.manage"],
    ["limit", "status"]
  ],
  [
    "GET",
    "/v1/audit-events",
    "listAuditReviewEvents",
    ["audit.read"],
    ["patientId", "action", "category", "riskLevel", "limit"]
  ],
  ["POST", "/v1/audit-events/{auditEventId}/reviews", "reviewAuditEvent", ["audit.review"]],
  [
    "GET",
    "/v1/privacy/deletion-requests",
    "listDeletionRequests",
    ["retention.manage"],
    ["patientId", "status", "limit"]
  ],
  ["POST", "/v1/privacy/deletion-requests", "createDeletionRequest", ["privacy.request"]],
  [
    "POST",
    "/v1/privacy/deletion-requests/{deletionRequestId}/review",
    "reviewDeletionRequest",
    ["retention.manage"]
  ],
  ["POST", "/v1/privacy/retention-runs", "runRetentionJob", ["retention.manage"]],
  [
    "GET",
    "/v1/break-glass/access-requests",
    "listBreakGlassAccessRequests",
    ["break_glass.approve"],
    ["patientId", "status", "requestedByUserId", "limit"]
  ],
  [
    "POST",
    "/v1/break-glass/access-requests",
    "createBreakGlassAccessRequest",
    ["break_glass.request"]
  ],
  [
    "POST",
    "/v1/break-glass/access-requests/{breakGlassAccessId}/review",
    "reviewBreakGlassAccessRequest",
    ["break_glass.approve"]
  ],
  [
    "POST",
    "/v1/dead-letter-events/{deadLetterEventId}/replay",
    "replayDeadLetterEvent",
    ["migration.manage"]
  ],
  [
    "GET",
    "/v1/migration-batches",
    "listMigrationBatches",
    ["migration.manage"],
    ["limit", "status"]
  ],
  ["POST", "/v1/migration-batches", "createMigrationBatch", ["migration.manage"]],
  [
    "GET",
    "/v1/migration-batches/{batchId}/rows",
    "listMigrationBatchRows",
    ["migration.manage"],
    ["matchStatus", "status"]
  ],
  [
    "POST",
    "/v1/migration-batches/{batchId}/rows/{rowId}/resolve",
    "resolveMigrationBatchRow",
    ["migration.manage"]
  ],
  ["POST", "/v1/migration-batches/{batchId}/commit", "commitMigrationBatch", ["migration.manage"]],
  [
    "POST",
    "/v1/migration-batches/{batchId}/rollback",
    "rollbackMigrationBatch",
    ["migration.manage"]
  ],
  ["GET", "/v1/migration-batches/{batchId}", "getMigrationBatch", ["migration.manage"]],
  ["GET", "/v1/patients/{patientId}", "getPatient", ["patient.read", "patient.phi.read"]],
  ["PATCH", "/v1/patients/{patientId}", "updatePatient", ["patient.write"]],
  [
    "GET",
    "/v1/patients/{patientId}/timeline",
    "getPatientTimeline",
    ["patient.read", "patient.phi.read"]
  ],
  [
    "GET",
    "/v1/patients/{patientId}/record-exports",
    "listPatientRecordExports",
    ["patient.read", "patient.export"],
    ["status", "limit"]
  ],
  [
    "POST",
    "/v1/patients/{patientId}/record-exports",
    "createPatientRecordExport",
    ["patient.read", "patient.phi.read", "patient.export"]
  ],
  [
    "GET",
    "/v1/patients/{patientId}/prep-summary",
    "getPatientPrepSummary",
    ["patient.read", "patient.phi.read", "clinical.note.read"],
    ["appointmentId"]
  ],
  [
    "GET",
    "/v1/patients/{patientId}/media",
    "listPatientMediaAssets",
    ["patient.read", "patient.phi.read", "media.read"]
  ],
  [
    "GET",
    "/v1/patients/{patientId}/dental-chart",
    "getPatientDentalChart",
    ["patient.read", "patient.phi.read", "dental.chart.read"]
  ],
  [
    "POST",
    "/v1/patients/{patientId}/dental-findings",
    "createPatientDentalFinding",
    ["patient.read", "patient.phi.read", "dental.chart.write"]
  ],
  [
    "POST",
    "/v1/patients/{patientId}/dental-chart/snapshots",
    "createDentalChartSnapshot",
    ["patient.read", "patient.phi.read", "dental.chart.snapshot"]
  ],
  ["POST", "/v1/patients/{patientId}/form-responses", "submitPatientIntakeForm", ["intake.write"]],
  [
    "GET",
    "/v1/patients/{patientId}/consents",
    "listPatientConsents",
    ["patient.read", "patient.phi.read"]
  ],
  ["POST", "/v1/patients/{patientId}/consents", "createPatientConsent", ["intake.write"]],
  [
    "POST",
    "/v1/patients/{patientId}/consents/{consentId}/revoke",
    "revokePatientConsent",
    ["intake.write"]
  ],
  ["GET", "/v1/leads", "listLeads", ["message.read"], ["source", "status"]],
  ["POST", "/v1/leads", "createLead", ["message.write"]],
  [
    "POST",
    "/v1/leads/{leadId}/match-patient",
    "matchLeadToPatient",
    ["patient.write", "message.write"]
  ],
  [
    "POST",
    "/v1/leads/{leadId}/convert-to-appointment",
    "convertLeadToAppointment",
    ["patient.write", "schedule.write"]
  ],
  ["PATCH", "/v1/leads/{leadId}/status", "updateLeadStatus", ["message.write"]],
  [
    "GET",
    "/v1/appointments",
    "listAppointments",
    ["schedule.read"],
    ["date", "providerId", "status"]
  ],
  ["POST", "/v1/appointments", "createAppointment", ["schedule.write"]],
  ["GET", "/v1/appointment-types", "listAppointmentTypes", ["schedule.read"]],
  ["GET", "/v1/chairs", "listChairs", ["schedule.read"]],
  ["GET", "/v1/provider-schedules", "listProviderSchedules", ["schedule.read"], ["providerId"]],
  ["GET", "/v1/pricebook/procedures", "listPricebookProcedures", ["billing.read"]],
  [
    "POST",
    "/v1/patients/{patientId}/treatment-plans",
    "createPatientTreatmentPlan",
    ["patient.read", "patient.phi.read", "dental.chart.write"]
  ],
  [
    "PATCH",
    "/v1/treatment-plans/{treatmentPlanId}",
    "updateTreatmentPlan",
    ["patient.read", "patient.phi.read", "dental.chart.write"]
  ],
  [
    "POST",
    "/v1/treatment-plans/{treatmentPlanId}/accept",
    "acceptTreatmentPlan",
    ["patient.read", "patient.phi.read", "dental.chart.write"]
  ],
  ["POST", "/v1/invoices", "createInvoice", ["billing.write"]],
  ["GET", "/v1/invoices/{invoiceId}", "getInvoice", ["billing.read"]],
  ["POST", "/v1/invoices/{invoiceId}/receipts", "createInvoiceReceipt", ["billing.write"]],
  ["POST", "/v1/media/upload-urls", "requestMediaUploadUrl", ["media.write"]],
  ["PUT", "/v1/media/uploads/{uploadId}/content", "receiveMediaUploadContent", ["media.write"]],
  ["POST", "/v1/media/uploads/{uploadId}/complete", "completeMediaUpload", ["media.write"]],
  [
    "POST",
    "/v1/media/assets/{mediaAssetId}/signed-url",
    "createSignedMediaAccess",
    ["patient.phi.read", "media.read"]
  ],
  ["PATCH", "/v1/appointments/{appointmentId}", "updateAppointment", ["schedule.write"]],
  ["POST", "/v1/appointments/{appointmentId}/confirm", "confirmAppointment", ["schedule.write"]],
  ["POST", "/v1/appointments/{appointmentId}/check-in", "checkInAppointment", ["queue.manage"]],
  [
    "POST",
    "/v1/appointments/{appointmentId}/mark-no-show",
    "markAppointmentNoShow",
    ["schedule.write"]
  ],
  ["GET", "/v1/queue", "listQueue", ["queue.manage"], ["date"]],
  ["PATCH", "/v1/queue/{queueEntryId}", "updateQueueEntry", ["queue.manage"]],
  ["GET", "/v1/dashboard/morning", "getMorningDashboard", ["schedule.read"], ["date"]],
  ["GET", "/v1/owner-dashboard", "getOwnerDashboard", ["analytics.read"], ["from", "to"]],
  [
    "GET",
    "/v1/tasks",
    "listTasks",
    ["task.manage"],
    [
      "status",
      "taskType",
      "priority",
      "assigneeUserId",
      "patientId",
      "appointmentId",
      "dueBefore",
      "dueAfter"
    ]
  ],
  ["POST", "/v1/tasks", "createTask", ["task.manage"]],
  [
    "POST",
    "/v1/tasks/generate-due",
    "generateDueContinuityTasks",
    ["task.manage", "recall.manage"]
  ],
  ["PATCH", "/v1/tasks/{taskId}", "updateTask", ["task.manage"]],
  ["POST", "/v1/recall-rules", "createRecallRule", ["recall.manage"]],
  [
    "GET",
    "/v1/recalls",
    "listRecalls",
    ["recall.manage"],
    ["status", "patientId", "dueBefore", "dueAfter"]
  ],
  ["POST", "/v1/recalls/{recallId}/actions", "recordRecallAction", ["recall.manage"]],
  ["POST", "/v1/sop-templates", "createSopTemplate", ["sop.manage"]],
  ["POST", "/v1/sop-schedules", "createSopSchedule", ["sop.manage"]],
  [
    "GET",
    "/v1/sop-runs",
    "listSopRuns",
    ["sop.manage"],
    ["status", "scheduledFrom", "scheduledTo", "templateId"]
  ],
  ["POST", "/v1/sop-runs/generate-due", "generateDueSopRuns", ["sop.manage"]],
  ["PATCH", "/v1/sop-runs/{sopRunId}", "updateSopRun", ["sop.manage"]],
  ["GET", "/v1/lab-vendors", "listLabVendors", ["lab.manage"]],
  ["POST", "/v1/lab-vendors", "createLabVendor", ["lab.manage"]],
  ["GET", "/v1/lab-cases", "listLabCases", ["lab.manage"], ["status", "dueBefore", "vendorId"]],
  ["POST", "/v1/lab-cases", "createLabCase", ["patient.read", "patient.phi.read", "lab.manage"]],
  [
    "PATCH",
    "/v1/lab-cases/{labCaseId}",
    "updateLabCase",
    ["patient.read", "patient.phi.read", "lab.manage"]
  ],
  ["POST", "/v1/lab-reconciliations", "createLabReconciliation", ["lab.manage"]],
  ["GET", "/v1/inventory/categories", "listInventoryCategories", ["inventory.manage"]],
  ["POST", "/v1/inventory/categories", "createInventoryCategory", ["inventory.manage"]],
  ["GET", "/v1/inventory/items", "listInventoryItems", ["inventory.manage"]],
  ["POST", "/v1/inventory/items", "createInventoryItem", ["inventory.manage"]],
  ["POST", "/v1/inventory/stock-ledger", "createStockLedgerEntry", ["inventory.manage"]],
  ["GET", "/v1/inventory/check-templates", "listInventoryCheckTemplates", ["inventory.manage"]],
  ["POST", "/v1/inventory/check-templates", "createInventoryCheckTemplate", ["inventory.manage"]],
  ["POST", "/v1/inventory/check-runs", "createInventoryCheckRun", ["inventory.manage"]],
  [
    "PATCH",
    "/v1/inventory/check-runs/{checkRunId}",
    "updateInventoryCheckRun",
    ["inventory.manage"]
  ],
  [
    "GET",
    "/v1/inventory/exceptions",
    "listInventoryExceptions",
    ["inventory.manage"],
    ["itemId", "checkRunId"]
  ],
  [
    "GET",
    "/v1/incidents",
    "listIncidents",
    ["incident.manage"],
    ["status", "severity", "category"]
  ],
  ["POST", "/v1/incidents", "createIncident", ["incident.manage"]],
  ["GET", "/v1/corrective-actions", "listCorrectiveActions", ["corrective_action.manage"]],
  ["POST", "/v1/corrective-actions", "createCorrectiveAction", ["corrective_action.manage"]],
  [
    "PATCH",
    "/v1/corrective-actions/{correctiveActionId}",
    "updateCorrectiveAction",
    ["corrective_action.manage"]
  ],
  ["POST", "/v1/encounters", "createEncounter", ["clinical.note.write"]],
  ["GET", "/v1/encounters/{encounterId}", "getEncounter", ["clinical.note.read"]],
  [
    "PATCH",
    "/v1/encounters/{encounterId}",
    "saveEncounterClinicalNoteDraft",
    ["clinical.note.write"]
  ],
  [
    "GET",
    "/v1/encounters/{encounterId}/ai-scribe/sessions",
    "listEncounterAiScribeSessions",
    ["ai.scribe.read", "patient.read", "patient.phi.read"]
  ],
  [
    "POST",
    "/v1/encounters/{encounterId}/ai-scribe/sessions",
    "createAiScribeSession",
    ["ai.scribe.write", "patient.read", "patient.phi.read"]
  ],
  [
    "GET",
    "/v1/ai-scribe/sessions/{sessionId}",
    "getAiScribeSession",
    ["ai.scribe.read", "patient.read", "patient.phi.read"]
  ],
  [
    "POST",
    "/v1/ai-scribe/sessions/{sessionId}/transcript-segments",
    "createAiScribeTranscriptSegment",
    ["ai.scribe.write", "patient.read", "patient.phi.read"]
  ],
  [
    "POST",
    "/v1/ai-scribe/sessions/{sessionId}/source-anchors",
    "createAiScribeSourceAnchor",
    ["ai.scribe.write"]
  ],
  [
    "POST",
    "/v1/ai-scribe/sessions/{sessionId}/generate-drafts",
    "generateAiScribeDrafts",
    ["ai.scribe.write", "patient.read", "patient.phi.read"]
  ],
  [
    "POST",
    "/v1/ai-scribe/sessions/{sessionId}/review-decisions",
    "recordAiScribeReviewDecision",
    ["ai.scribe.review", "patient.read", "patient.phi.read"]
  ],
  [
    "POST",
    "/v1/ai-scribe/sessions/{sessionId}/retention-delete",
    "deleteAiScribeRetainedPayloads",
    ["ai.scribe.review"]
  ],
  ["POST", "/v1/encounters/{encounterId}/start", "startEncounter", ["clinical.note.write"]],
  [
    "POST",
    "/v1/encounters/{encounterId}/sign-note",
    "signEncounterClinicalNote",
    ["clinical.note.sign", "role:doctor"]
  ],
  [
    "POST",
    "/v1/encounters/{encounterId}/amend-note",
    "amendEncounterClinicalNote",
    ["clinical.note.sign", "role:doctor"]
  ],
  [
    "POST",
    "/v1/encounters/{encounterId}/prescriptions",
    "createEncounterPrescription",
    ["prescription.write"]
  ],
  [
    "POST",
    "/v1/encounters/{encounterId}/dental-findings",
    "createEncounterDentalFinding",
    ["patient.read", "patient.phi.read", "dental.chart.write"]
  ],
  [
    "POST",
    "/v1/encounters/{encounterId}/procedures",
    "createEncounterProcedurePerformed",
    ["patient.read", "patient.phi.read", "clinical.note.write"]
  ],
  [
    "GET",
    "/v1/dental-findings/{findingId}/history",
    "listDentalFindingHistory",
    ["patient.read", "patient.phi.read", "dental.chart.read"]
  ],
  [
    "PATCH",
    "/v1/dental-findings/{findingId}",
    "updateDentalFinding",
    ["patient.read", "patient.phi.read", "dental.chart.write"]
  ],
  [
    "POST",
    "/v1/prescriptions/{prescriptionId}/sign",
    "signPrescription",
    ["prescription.sign", "role:doctor"]
  ],
  [
    "POST",
    "/v1/patients/{patientId}/instructions",
    "createPatientInstruction",
    ["patient.read", "patient_instruction.write"]
  ],
  [
    "POST",
    "/v1/invoices/{invoiceId}/payment-requests",
    "createInvoicePaymentRequest",
    ["billing.write"]
  ],
  [
    "POST",
    "/v1/invoices/{invoiceId}/manual-payments",
    "recordInvoiceManualPayment",
    ["billing.write"]
  ]
].map(([method, pathTemplate, handler, permissions, queryFields]) =>
  operation(method, pathTemplate, handler, permissions, queryFields)
);

const publicHealthRoutes = ["live", "ready", "startup"].map((kind) =>
  Object.freeze({
    method: "GET",
    pathTemplate: `/health/${kind}`,
    handler: `inlineHealth:${kind}`,
    routeClass: "public_health",
    currentControls: Object.freeze({
      readinessAdmission: false,
      authentication: "intentionally_public",
      tenantAuthority: "not_applicable",
      clinicAuthority: "not_applicable",
      authorization: "public_health_exception",
      permissions: Object.freeze([]),
      queryFields: Object.freeze([]),
      requestBody: "none",
      bodyBudgetBytes: null,
      bodyOversizeStatus: null,
      unknownFieldsRejected: false,
      queryBudget: "absent",
      paginationBudget: "absent",
      rateBudget: "absent",
      requestIdPolicy: "unvalidated_header_or_uuid",
      errorPolicy: "legacy_unredacted_message_and_details"
    }),
    compliantWithCp12Pipeline: false,
    gaps: COMMON_GAPS
  })
);

const identityRoute = Object.freeze({
  method: "GET",
  pathTemplate: "/v1/me",
  handler: "getMe",
  routeClass: "authenticated_identity",
  currentControls: Object.freeze({
    readinessAdmission: true,
    authentication: "verified_keycloak_or_local_only_fixture",
    tenantAuthority: "verified_identity_repository",
    clinicAuthority: "not_required",
    authorization: "registered_identity_only",
    permissions: Object.freeze([]),
    queryFields: Object.freeze([]),
    requestBody: "none",
    bodyBudgetBytes: null,
    bodyOversizeStatus: null,
    unknownFieldsRejected: false,
    queryBudget: "absent",
    paginationBudget: "absent",
    rateBudget: "absent",
    requestIdPolicy: "unvalidated_header_or_uuid",
    errorPolicy: "legacy_unredacted_message_and_details"
  }),
  compliantWithCp12Pipeline: false,
  gaps: COMMON_GAPS
});

const paymentWebhookRoute = Object.freeze({
  method: "POST",
  pathTemplate: "/v1/payment-webhooks/razorpay",
  handler: "processPaymentWebhook",
  routeClass: "verified_provider_webhook",
  currentControls: Object.freeze({
    readinessAdmission: true,
    authentication: "provider_signature_verified_in_handler",
    tenantAuthority: "verified_provider_event_after_signature",
    clinicAuthority: "verified_provider_event_after_signature",
    authorization: "provider_signature_and_event_scope",
    permissions: Object.freeze([]),
    queryFields: Object.freeze([]),
    requestBody: "raw_bytes_before_parse",
    bodyBudgetBytes: MEBIBYTE,
    bodyOversizeStatus: 400,
    unknownFieldsRejected: false,
    queryBudget: "absent",
    paginationBudget: "absent",
    rateBudget: "absent",
    requestIdPolicy: "unvalidated_header_or_uuid",
    errorPolicy: "provider_message_and_legacy_details"
  }),
  compliantWithCp12Pipeline: false,
  gaps: Object.freeze([
    ...COMMON_GAPS,
    "oversize_body_returns_400_not_413",
    "no_preverification_ip_or_provider_rate_budget",
    "full_request_header_record_forwarded_to_provider_contract"
  ])
});

export const CURRENT_ROUTE_CONTROL_INVENTORY = Object.freeze([
  ...publicHealthRoutes,
  identityRoute,
  paymentWebhookRoute,
  ...operationRoutes
]);

export const CURRENT_ROUTE_COUNT = 128;
export const CURRENT_OPERATION_ROUTE_COUNT = 123;
