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
