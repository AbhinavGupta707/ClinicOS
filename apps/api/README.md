# API App

Owner: platform/backend workstream.

Checkpoint 1 exposes a bootable Node HTTP API surface for production session context and health checks. Later checkpoints can replace the transport with NestJS/OpenAPI without changing the typed `/v1/me` contract.

Runtime commands:

```sh
npm run dev --workspace @clinic-os/api
npm run typecheck --workspace @clinic-os/api
npm run test --workspace @clinic-os/api
npm run build --workspace @clinic-os/api
```

## Checkpoint 1 Data/Auth Contract

This lane adds a framework-neutral `/v1/me` handler in `src/me.ts` so the later NestJS route can be a thin adapter:

1. OIDC middleware verifies the Keycloak access token signature.
2. The route passes verified claims to `getMe`.
3. `getMe` validates issuer/audience/expiry, resolves ClinicOS identity and role assignments, records an `auth.session.resolved` audit event, and returns user/tenant/clinic/permission context.

The identity repository is an interface from `@clinic-os/db`; production code must back it with PostgreSQL and the Checkpoint 1 RLS context. Tests use an in-memory repository double only inside `test/`.

## HTTP Runtime

- `GET /health/live` proves the API process is serving.
- `GET /health/ready` proves the identity repository and auth mode are configured.
- `GET /v1/me` resolves authenticated tenant, clinic, role, permission, and audit context.

By default `/v1/me` verifies Keycloak RS256 bearer tokens against the realm JWKS endpoint. For local synthetic boot checks only, set `CLINIC_OS_API_USE_DEV_AUTH_FIXTURE=true`; this accepts `x-clinic-os-dev-subject` values such as `seed-assistant` and is blocked for production-like environments.

## Checkpoint 2 Operations Contract

CP2 adds tenant/clinic-scoped handlers for:

- `GET/POST /v1/patients`, `GET/PATCH /v1/patients/{patientId}`, and `GET /v1/patients/{patientId}/timeline`
- `GET/POST /v1/leads`, `POST /v1/leads/{leadId}/match-patient`, `POST /v1/leads/{leadId}/convert-to-appointment`, and `PATCH /v1/leads/{leadId}/status`
- `GET/POST /v1/appointments`, `PATCH /v1/appointments/{appointmentId}`, `POST /v1/appointments/{appointmentId}/confirm`, `POST /v1/appointments/{appointmentId}/check-in`, and `POST /v1/appointments/{appointmentId}/mark-no-show`
- `GET /v1/appointment-types`, `GET /v1/chairs`, `GET /v1/provider-schedules`, `GET/PATCH /v1/queue`, and `GET /v1/dashboard/morning`

Production-like runtime uses PostgreSQL-backed repositories. The in-memory local operations repository is only wired when `CLINIC_OS_API_USE_DEV_AUTH_FIXTURE=true`; it exists for deterministic local/test flows and must not be used as production data.

## Checkpoint 4 Media Contract

CP4 adds backend-mediated media access for patient, encounter, tooth, and dental finding context:

- `POST /v1/media/upload-urls` reserves a private object key and returns an opaque mediated upload URL.
- `PUT /v1/media/uploads/{uploadId}/content` accepts local/test mediated upload bytes through the storage provider contract.
- `POST /v1/media/uploads/{uploadId}/complete` validates patient/encounter context and stored object metadata before creating media metadata.
- `GET /v1/patients/{patientId}/media` lists public media metadata without object keys.
- `POST /v1/media/assets/{mediaAssetId}/signed-url` returns short-lived opaque signed access after authorization and audit.

Raw object keys and bucket paths are internal repository/storage fields only. Local/dev uses `LocalMediaStorageSimulator`; production-like runtimes must register an official storage provider and cannot silently fall back to the simulator.

## Checkpoint 6 Owner Dashboard Contract

CP6 adds an aggregate owner analytics read model:

- `GET /v1/owner-dashboard?from=&to=` returns source-backed revenue, recall, task, SOP, lab, inventory, treatment/payment leakage, no-show, incident, and CAPA metrics.
- The route requires `analytics.read`; owner/admin and accountant-style analytics roles are allowed, assistant roles are denied.
- The response is aggregate-only and must not include patient names, phone numbers, clinical notes, or medical-history payloads.
- Production runtime reads existing durable CP2-CP5 tables now and marks CP6 lab/inventory/event tables as schema dependencies until those migrations land. Local/dev fixture mode adds explicit synthetic CP6 continuity rows through the repository contract only.

## Checkpoint 9 Security And Privacy Contract

CP9 adds clinic-scoped security/privacy operations:

- `GET /v1/audit-events` lists reviewable audit events with PHI-redacted metadata; filters include `patientId`, `action`, `category`, `riskLevel`, and `limit`.
- `POST /v1/audit-events/{auditEventId}/reviews` appends audit review evidence. It does not mutate the original audit event.
- `POST /v1/patients/{patientId}/record-exports` creates a JSON patient record export with configured sections, a safety manifest, digest, and redacted privacy audit trail.
- `GET /v1/patients/{patientId}/record-exports` lists export records without returning the payload by default.
- `POST/GET /v1/privacy/deletion-requests` creates and lists privacy/deletion requests. Request scope explicitly marks clinical and audit records as `not_deleted`.
- `POST /v1/privacy/deletion-requests/{requestId}/review` records owner/admin review decisions.
- `POST /v1/privacy/retention-runs` runs conservative dry-run or execute retention jobs. CP9 only deletes eligible transient AI transcript payloads and records protected clinical/audit skips.
- `POST/GET /v1/break-glass/access-requests` creates and lists reasoned, scoped, time-bound break-glass requests.
- `POST /v1/break-glass/access-requests/{requestId}/review` approves, denies, or revokes break-glass access. Approval is time-bounded and never grants permanent access.

Patient record exports must not expose storage object keys, bucket paths, raw provider payloads, or unrelated tenant data. Break-glass requests require a specific reason, at least one access category, and an expiry no more than eight hours out. Retention jobs are auditable and conservative by design.
