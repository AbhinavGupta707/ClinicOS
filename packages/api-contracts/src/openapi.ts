export interface Cp2OpenApiEndpointNote {
  method: "GET" | "POST" | "PATCH";
  path: string;
  operationId: string;
  requestExport: string;
  responseExport: string;
  emits: readonly string[];
  requiresIdempotencyKey: boolean;
  notes: string;
}

export const CP2_OPENAPI_ENDPOINT_NOTES: readonly Cp2OpenApiEndpointNote[] = [
  {
    method: "GET",
    path: "/v1/patients",
    operationId: "searchPatients",
    requestExport: "PatientSearchRequest",
    responseExport: "PatientSearchResponse",
    emits: [],
    requiresIdempotencyKey: false,
    notes: "Search is tenant/clinic scoped and requires query, phone, or source."
  },
  {
    method: "POST",
    path: "/v1/patients",
    operationId: "createPatient",
    requestExport: "PatientCreateRequest",
    responseExport: "PatientMutationResponse",
    emits: ["patient.created", "attribution.touch.created"],
    requiresIdempotencyKey: true,
    notes: "Patient create requires source/provenance and E.164 phone."
  },
  {
    method: "PATCH",
    path: "/v1/patients/{patientId}",
    operationId: "updatePatient",
    requestExport: "PatientUpdateRequest",
    responseExport: "PatientMutationResponse",
    emits: ["patient.updated"],
    requiresIdempotencyKey: true,
    notes: "Patient update requires a reason and at least one allowed patch field."
  },
  {
    method: "GET",
    path: "/v1/patients/{patientId}/timeline",
    operationId: "getPatientTimeline",
    requestExport: "PatientTimelineRequest",
    responseExport: "PatientTimelineResponse",
    emits: [],
    requiresIdempotencyKey: false,
    notes: "Timeline reads are patient-scoped PHI access and should be audited by API handlers."
  },
  {
    method: "POST",
    path: "/v1/leads",
    operationId: "createLead",
    requestExport: "LeadCreateRequest",
    responseExport: "LeadMutationResponse",
    emits: ["lead.created", "attribution.touch.created"],
    requiresIdempotencyKey: true,
    notes: "Lead create is source-attributed and stores only operational acquisition metadata."
  },
  {
    method: "GET",
    path: "/v1/leads",
    operationId: "listLeads",
    requestExport: "LeadListRequest",
    responseExport: "LeadListResponse",
    emits: [],
    requiresIdempotencyKey: false,
    notes: "Lead list supports source/status/date filtering for inbox views."
  },
  {
    method: "POST",
    path: "/v1/leads/{leadId}/match-patient",
    operationId: "matchLeadToPatient",
    requestExport: "LeadMatchPatientRequest",
    responseExport: "LeadMutationResponse",
    emits: ["lead.matched_to_patient"],
    requiresIdempotencyKey: true,
    notes: "Matching requires target patient, confidence, and rationale."
  },
  {
    method: "POST",
    path: "/v1/leads/{leadId}/convert-to-appointment",
    operationId: "convertLeadToAppointment",
    requestExport: "LeadConvertToAppointmentRequest",
    responseExport: "LeadMutationResponse",
    emits: ["lead.converted_to_appointment", "appointment.created"],
    requiresIdempotencyKey: true,
    notes: "Conversion carries the lead source into appointment attribution."
  },
  {
    method: "PATCH",
    path: "/v1/leads/{leadId}/status",
    operationId: "updateLeadStatus",
    requestExport: "LeadStatusUpdateRequest",
    responseExport: "LeadMutationResponse",
    emits: ["task.status_changed"],
    requiresIdempotencyKey: true,
    notes: "Status transitions are constrained by LEAD_STATUS_TRANSITIONS."
  },
  {
    method: "GET",
    path: "/v1/appointments",
    operationId: "listAppointments",
    requestExport: "AppointmentListRequest",
    responseExport: "AppointmentListResponse",
    emits: [],
    requiresIdempotencyKey: false,
    notes: "Appointment list requires a bounded filter such as date, provider, patient, or status."
  },
  {
    method: "POST",
    path: "/v1/appointments",
    operationId: "createAppointment",
    requestExport: "AppointmentCreateRequest",
    responseExport: "AppointmentMutationResponse",
    emits: ["appointment.created", "attribution.touch.created"],
    requiresIdempotencyKey: true,
    notes: "Conflict overrides require explicit conflictPolicy and overrideReason."
  },
  {
    method: "POST",
    path: "/v1/appointments/{appointmentId}/confirmation-request",
    operationId: "requestAppointmentConfirmation",
    requestExport: "AppointmentRequestConfirmationRequest",
    responseExport: "AppointmentMutationResponse",
    emits: ["appointment.confirmation_requested"],
    requiresIdempotencyKey: true,
    notes: "Creates the dashboard one-click confirmation draft/request."
  },
  {
    method: "POST",
    path: "/v1/appointments/{appointmentId}/confirm",
    operationId: "confirmAppointment",
    requestExport: "AppointmentConfirmRequest",
    responseExport: "AppointmentMutationResponse",
    emits: ["appointment.confirmed"],
    requiresIdempotencyKey: true,
    notes: "Manual and provider-backed confirmations share the same status contract."
  },
  {
    method: "POST",
    path: "/v1/appointments/{appointmentId}/check-in",
    operationId: "checkInAppointment",
    requestExport: "AppointmentCheckInRequest",
    responseExport: "AppointmentMutationResponse",
    emits: ["patient.checked_in", "queue.entry_created"],
    requiresIdempotencyKey: true,
    notes: "Check-in creates or links a queue entry and preserves new/returning visibility."
  },
  {
    method: "POST",
    path: "/v1/appointments/{appointmentId}/mark-no-show",
    operationId: "markAppointmentNoShow",
    requestExport: "AppointmentNoShowRequest",
    responseExport: "AppointmentMutationResponse",
    emits: ["appointment.no_show"],
    requiresIdempotencyKey: true,
    notes: "No-show is patient-scoped and audit-sensitive."
  },
  {
    method: "GET",
    path: "/v1/queue",
    operationId: "listQueue",
    requestExport: "QueueListRequest",
    responseExport: "QueueListResponse",
    emits: [],
    requiresIdempotencyKey: false,
    notes: "Queue list is scoped by clinic date and optional provider/status."
  },
  {
    method: "PATCH",
    path: "/v1/queue/{queueEntryId}",
    operationId: "updateQueueEntry",
    requestExport: "QueueUpdateRequest",
    responseExport: "QueueMutationResponse",
    emits: ["queue.entry_updated"],
    requiresIdempotencyKey: true,
    notes: "Queue update requires at least one queue field."
  },
  {
    method: "GET",
    path: "/v1/assistant/morning-dashboard",
    operationId: "getAssistantMorningDashboard",
    requestExport: "AssistantMorningDashboardRequest",
    responseExport: "AssistantMorningDashboardResponse",
    emits: [],
    requiresIdempotencyKey: false,
    notes: "Dashboard response is a read model over appointments, queue, leads, and task events."
  }
];

export interface Cp3OpenApiEndpointNote {
  method: "GET" | "POST" | "PATCH";
  path: string;
  operationId: string;
  requestExport: string;
  responseExport: string;
  emits: readonly string[];
  requiresIdempotencyKey: boolean;
  doctorOnly?: boolean;
  notes: string;
}

export const CP3_OPENAPI_ENDPOINT_NOTES: readonly Cp3OpenApiEndpointNote[] = [
  {
    method: "GET",
    path: "/v1/form-templates",
    operationId: "listIntakeFormTemplates",
    requestExport: "RequestContext",
    responseExport: "IntakeFormTemplateRecord[]",
    emits: [],
    requiresIdempotencyKey: false,
    notes: "Lists active tenant/clinic-scoped intake templates."
  },
  {
    method: "POST",
    path: "/v1/form-templates",
    operationId: "createIntakeFormTemplate",
    requestExport: "IntakeFormTemplateCreateRequest",
    responseExport: "IntakeFormTemplateRecord",
    emits: [],
    requiresIdempotencyKey: true,
    notes: "Creates a versioned form template; normal clinic use should keep templates versioned."
  },
  {
    method: "POST",
    path: "/v1/patients/{patientId}/form-responses",
    operationId: "submitPatientIntakeForm",
    requestExport: "IntakeFormSubmissionRequest",
    responseExport: "IntakeFormSubmissionRecord",
    emits: ["form_response.submitted"],
    requiresIdempotencyKey: true,
    notes: "Supports digital intake and assistant-entered paper-card intake."
  },
  {
    method: "GET",
    path: "/v1/patients/{patientId}/consents",
    operationId: "listPatientConsents",
    requestExport: "RequestContext",
    responseExport: "ConsentRecord[] + ConsentEnforcementState",
    emits: [],
    requiresIdempotencyKey: false,
    notes: "Returns consent ledger plus enforcement state for future AI/audio gating."
  },
  {
    method: "POST",
    path: "/v1/patients/{patientId}/consents",
    operationId: "createPatientConsent",
    requestExport: "ConsentCreateRequest",
    responseExport: "ConsentRecord + ConsentEnforcementState",
    emits: ["consent.created"],
    requiresIdempotencyKey: true,
    notes: "Records one active consent per patient/purpose."
  },
  {
    method: "POST",
    path: "/v1/patients/{patientId}/consents/{consentId}/revoke",
    operationId: "revokePatientConsent",
    requestExport: "ConsentRevokeRequest",
    responseExport: "ConsentRecord + ConsentEnforcementState",
    emits: ["consent.revoked"],
    requiresIdempotencyKey: true,
    notes: "Revocation updates enforcement state immediately."
  },
  {
    method: "POST",
    path: "/v1/encounters",
    operationId: "createEncounter",
    requestExport: "EncounterCreateRequest",
    responseExport: "EncounterRecord",
    emits: ["encounter.created"],
    requiresIdempotencyKey: true,
    notes: "Creates an encounter linked to a patient and optional appointment."
  },
  {
    method: "POST",
    path: "/v1/encounters/{encounterId}/start",
    operationId: "startEncounter",
    requestExport: "MutationRequestContext",
    responseExport: "EncounterRecord",
    emits: ["encounter.started"],
    requiresIdempotencyKey: true,
    notes: "Transitions scheduled encounters into drafting."
  },
  {
    method: "PATCH",
    path: "/v1/encounters/{encounterId}",
    operationId: "saveEncounterClinicalNoteDraft",
    requestExport: "ClinicalNoteDraftSaveRequest",
    responseExport: "ClinicalNoteVersionRecord",
    emits: ["clinical_note.draft_created"],
    requiresIdempotencyKey: true,
    notes: "Saves or updates the current draft; signed encounters must use amendments."
  },
  {
    method: "POST",
    path: "/v1/encounters/{encounterId}/sign-note",
    operationId: "signEncounterClinicalNote",
    requestExport: "MutationRequestContext",
    responseExport: "SignClinicalNoteResult",
    emits: ["clinical_note.signed"],
    requiresIdempotencyKey: true,
    doctorOnly: true,
    notes: "Doctor role is required; signed note versions are immutable."
  },
  {
    method: "POST",
    path: "/v1/encounters/{encounterId}/amend-note",
    operationId: "amendEncounterClinicalNote",
    requestExport: "ClinicalNoteAmendRequest",
    responseExport: "AmendClinicalNoteResult",
    emits: ["clinical_note.amended"],
    requiresIdempotencyKey: true,
    doctorOnly: true,
    notes: "Creates a linked signed amendment version without editing the prior version."
  },
  {
    method: "POST",
    path: "/v1/encounters/{encounterId}/prescriptions",
    operationId: "createEncounterPrescription",
    requestExport: "PrescriptionCreateRequest",
    responseExport: "PrescriptionRecord",
    emits: ["prescription.draft_created"],
    requiresIdempotencyKey: true,
    notes: "Creates a prescription draft; assistants may draft but cannot sign."
  },
  {
    method: "POST",
    path: "/v1/prescriptions/{prescriptionId}/sign",
    operationId: "signPrescription",
    requestExport: "PrescriptionSignRequest",
    responseExport: "PrescriptionRecord",
    emits: ["prescription.signed"],
    requiresIdempotencyKey: true,
    doctorOnly: true,
    notes: "Doctor role is required and signed prescription records are immutable."
  }
];
