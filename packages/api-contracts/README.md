# API Contracts Package

OpenAPI schemas, shared validation contracts, and generated client/server types.

## Checkpoint 2 contracts

This package owns the shared lead, patient, appointment, queue, dashboard, and CP2 event contracts for the lead-to-appointment workflow. It exports TypeScript request/response types plus runtime parsers that reject unknown fields and enforce tenant/clinic context, actor context, idempotency keys on mutations, and source/provenance attribution.

Primary exports for backend and frontend lanes:

- Patient: `PatientSearchRequest`, `PatientCreateRequest`, `PatientUpdateRequest`, `PatientTimelineRequest`, `parsePatientCreateRequest`.
- Lead: `LeadCreateRequest`, `LeadListRequest`, `LeadMatchPatientRequest`, `LeadConvertToAppointmentRequest`, `LeadStatusUpdateRequest`, `LEAD_STATUS_TRANSITIONS`.
- Appointment: `AppointmentListRequest`, `AppointmentCreateRequest`, `AppointmentRequestConfirmationRequest`, `AppointmentConfirmRequest`, `AppointmentCheckInRequest`, `AppointmentNoShowRequest`, `APPOINTMENT_STATUS_TRANSITIONS`.
- Queue/dashboard: `QueueListRequest`, `QueueUpdateRequest`, `AssistantMorningDashboardRequest`, `AssistantMorningDashboardResponse`.
- Events/OpenAPI notes: `CP2_EVENT_TYPES`, `createCp2EventEnvelope`, `parseCp2EventEnvelope`, `CP2_OPENAPI_ENDPOINT_NOTES`.

The OpenAPI note artifact is intentionally code-owned in `src/openapi.ts` until a generated OpenAPI pipeline exists. Backend handlers should map these operation ids to route registration; frontend consumers should import response types rather than maintaining local mirrors.
