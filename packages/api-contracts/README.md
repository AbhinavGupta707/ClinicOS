# API Contracts Package

Runtime HTTP schemas, active native-route inventory, deterministic OpenAPI, and the source for the
checked-in generated client.

## CP12 runtime contract registry

`src/native-http-contracts.ts` is the contract authority for all 130 currently registered native
HTTP operations from identity/health through CP2–CP10. The registry defines strict path, query,
header, body, response, error, body-budget, pagination, idempotency, optimistic-concurrency, PHI,
and cache metadata. It rejects unknown writable fields and recursively rejects tenant/actor,
signature, price-authority, private-storage, raw-provider-payload, and provider-secret fields in
unstructured writable maps.

Generated artifacts:

- `generated/native-openapi.json` — OpenAPI 3.1 generated from runtime schema data.
- `generated/native-route-inventory.json` — active/deferred route and integration metadata.
- `../api-client-generated/src/index.ts` — standalone typed client generated from the same source.

Offline checks:

```sh
npm --workspace @clinic-os/api-contracts run generate
npm --workspace @clinic-os/api-contracts run check:generated
npm --workspace @clinic-os/api-contracts run check:inventory
npm --workspace @clinic-os/api-contracts run typecheck
npm --workspace @clinic-os/api-contracts test
npm --workspace @clinic-os/api-contracts run build
npm --workspace @clinic-os/api-client-generated run typecheck
npm --workspace @clinic-os/api-client-generated test
npm --workspace @clinic-os/api-client-generated run build
```

The native router is read-only input to this lane. Until the CP12 API integration consumes the
registry, generated metadata honestly records `body-parser-only`, `partial`, or `route-parity`
native enforcement and the exact master wiring obligations. Generated contracts do not claim
NestJS migration, official provider registration, or runtime idempotency/ETag persistence is
already complete.

The registry also owns twelve canonical row-versioned resource mappings and response-header truth.
Versioned public records require `id` plus positive safe `rowVersion`; strong ETags use quoted
`"rv-<rowVersion>"`. OpenAPI declares request correlation, replay truth, singleton ETags and retry
delay headers, while list items carry versions without a collection ETag. Razorpay retains raw
signature bytes under its real `application/json` provider media type.

## Checkpoint 2 contracts

This package owns the shared lead, patient, appointment, queue, dashboard, and CP2 event contracts for the lead-to-appointment workflow. It exports TypeScript request/response types plus runtime parsers that reject unknown fields and enforce tenant/clinic context, actor context, idempotency keys on mutations, and source/provenance attribution.

Primary exports for backend and frontend lanes:

- Patient: `PatientSearchRequest`, `PatientCreateRequest`, `PatientUpdateRequest`, `PatientTimelineRequest`, `parsePatientCreateRequest`.
- Lead: `LeadCreateRequest`, `LeadListRequest`, `LeadMatchPatientRequest`, `LeadConvertToAppointmentRequest`, `LeadStatusUpdateRequest`, `LEAD_STATUS_TRANSITIONS`.
- Appointment: `AppointmentListRequest`, `AppointmentCreateRequest`, `AppointmentRequestConfirmationRequest`, `AppointmentConfirmRequest`, `AppointmentCheckInRequest`, `AppointmentNoShowRequest`, `APPOINTMENT_STATUS_TRANSITIONS`.
- Queue/dashboard: `QueueListRequest`, `QueueUpdateRequest`, `AssistantMorningDashboardRequest`, `AssistantMorningDashboardResponse`.
- Events/OpenAPI notes: `CP2_EVENT_TYPES`, `createCp2EventEnvelope`, `parseCp2EventEnvelope`, `CP2_OPENAPI_ENDPOINT_NOTES`.

`CP2_OPENAPI_ENDPOINT_NOTES` and `CP3_OPENAPI_ENDPOINT_NOTES` remain historical compatibility
exports for existing consumers. They are not the active route inventory and must not be used to
generate clients. The CP12 registry explicitly classifies their stale or unregistered route notes.
