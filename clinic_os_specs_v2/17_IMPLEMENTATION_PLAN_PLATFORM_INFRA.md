# 17 - Implementation Plan: Platform and Infrastructure

**Date:** 2026-07-06  
**Status:** Execution plan  
**Primary owner:** Platform/backend/infrastructure agent  
**Companion docs:** `02_SYSTEM_ARCHITECTURE.md`, `03_DOMAIN_MODEL_AND_FHIR_MAPPING.md`, `06_SECURITY_PRIVACY_COMPLIANCE_INDIA.md`, `09_API_CONTRACTS_AND_EVENTS.md`, `14_STACK_AND_VENDOR_DECISIONS.md`

## 1. Mission

Build the production foundation that lets ClinicOS safely run a multi-tenant, PHI-sensitive dental clinic operating system in India.

This plan does not build every product workflow. It builds the substrate that makes every workflow production-grade:

- Monorepo and app boundaries.
- Auth and tenant identity.
- Product authorization.
- Database schema and migrations.
- Row-level tenant isolation where feasible.
- API conventions and OpenAPI.
- Temporal durable workflow runtime.
- Outbox/event processing.
- Audit logs.
- Integration credential storage.
- Object storage and signed URLs.
- Observability, CI/CD, backups, and operational runbooks.

## 2. Required Reading

Before implementation, read:

1. `../AGENTS.md`
2. `16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md`
3. `20_ORCHESTRATION_CHECKPOINT_PLAN.md`
4. `02_SYSTEM_ARCHITECTURE.md`
5. `03_DOMAIN_MODEL_AND_FHIR_MAPPING.md`
6. `06_SECURITY_PRIVACY_COMPLIANCE_INDIA.md`
7. `09_API_CONTRACTS_AND_EVENTS.md`
8. `14_STACK_AND_VENDOR_DECISIONS.md`

## 3. Non-Negotiable Platform Rules

- No tenant-owned data table without tenant isolation strategy.
- No PHI access without authorization and audit classification.
- No provider webhook trusted before signature/provider-state verification.
- No side effect without idempotency and provenance.
- No durable business process implemented as a fire-and-forget queue job.
- No product code that depends on a fake provider.
- No raw PHI in logs, traces, analytics, or error messages.
- No direct object storage paths exposed to clients.
- No manual infrastructure changes outside Terraform once environments exist.

## 4. Target Repository Shape

Create the monorepo with explicit app and package boundaries:

```text
clinic-os/
  apps/
    web/                      # Next.js web app for clinic users
    api/                      # NestJS REST API
    worker/                   # outbox, integration, workflow workers
    mobile/                   # Expo/React Native capture app
  packages/
    config/                   # shared env parsing and constants
    db/                       # schema, migrations, seeds
    domain/                   # domain types, invariants, policy helpers
    auth/                     # session/JWT parsing, permission helpers
    api-contracts/            # OpenAPI types, shared API schemas
    integrations/             # provider interfaces and contract fixtures
    workflow/                 # Temporal clients/workflows/activities
    security/                 # audit, encryption, redaction helpers
    observability/            # logging, tracing, metrics setup
    fhir/                     # FHIR projection helpers
    ui/                       # shared UI primitives if needed
  infra/
    terraform/
    docker/
    runbooks/
  docs/
    decisions/
    operations/
```

If the implementation starts from an existing framework scaffold, preserve this boundary concept even if directory names differ.

## 5. Stack Defaults

Use these unless implementation evidence forces a change:

| Layer | Choice |
|---|---|
| Runtime | Node.js LTS for web/api/workers. |
| Language | TypeScript. |
| Package manager | pnpm or npm workspaces; choose one and document it. |
| Web | Next.js + React. |
| API | NestJS REST API with OpenAPI generation. |
| Worker | Node.js worker app using Temporal client/workers and outbox processors. |
| Mobile | Expo/React Native app in `apps/mobile`. |
| Database | PostgreSQL. |
| ORM/query | Prisma or Drizzle; allow raw SQL for RLS, reporting, locks, search. |
| Workflow | Temporal. |
| Short jobs/cache | Redis; BullMQ only for short, non-durable jobs. |
| Auth | Self-hosted Keycloak, OIDC/OAuth2. |
| Object storage | S3 in AWS India region. |
| Infrastructure | Terraform + AWS India, ECS/Fargate first. |
| Observability | OpenTelemetry, structured logs, metrics, Sentry-style error reporting. |

## 6. Environment Strategy

Create five environment profiles:

| Environment | Purpose | Data |
|---|---|---|
| `local` | Developer workflow | Synthetic data only. |
| `dev` | Shared development | Synthetic data only. |
| `staging` | Production-like provider sandbox | Synthetic or approved test data only. |
| `pilot-prod` | First clinic production | Real clinic data, tightly monitored. |
| `prod` | General production | Real clinic data. |

Environment requirements:

- Separate databases and object buckets per environment.
- Separate provider credentials per environment.
- Separate Keycloak realms or clearly separated clients.
- No production PHI copied into dev/staging.
- Config loaded through typed env schema.
- Secrets stored in a secrets manager for non-local environments.

## 7. Infrastructure Implementation

### 7.1 Local Development

Provide a local environment that starts:

- PostgreSQL.
- Redis.
- Temporal server.
- Keycloak.
- API.
- Worker.
- Web app.
- Mobile app dev instructions.

Deliverables:

- `docker-compose.yml` or equivalent local dev stack.
- Seed script for one tenant, one clinic, owner, doctor, assistant, receptionist.
- Test provider simulators for local and automated tests only.
- Local webhook replay utility for integration tests.

Acceptance:

- A new developer can start the stack from documented commands.
- Seed users can log in.
- API can connect to DB, Redis, Temporal, and Keycloak.
- Web can call API using authenticated session.
- Worker can process a test outbox event and a test Temporal workflow.

### 7.2 AWS Baseline

Build Terraform modules for:

- VPC with public/private subnets.
- ECS/Fargate or equivalent managed containers.
- RDS/Aurora PostgreSQL Multi-AZ.
- ElastiCache Redis.
- S3 buckets with KMS.
- Keycloak service and backing database/schema.
- Temporal service deployment or managed Temporal Cloud only if region/legal posture is approved.
- Load balancer and WAF.
- Secrets Manager.
- CloudWatch/log routing.
- Backups and lifecycle policies.

Region default:

- Primary: `ap-south-1` Asia Pacific Mumbai.
- DR/warm standby: `ap-south-2` Asia Pacific Hyderabad.

Acceptance:

- Terraform plan is reproducible.
- No database is public.
- Services that do not need public ingress are private.
- KMS encryption is enabled for data stores.
- Backups are configured.
- Logs are centralized.
- Provider credentials are stored as secrets.

## 8. Authentication and Authorization

### 8.1 Identity

Use Keycloak for:

- Authentication.
- MFA.
- OIDC/OAuth2 tokens.
- Session management.
- Identity brokering later.
- Enterprise SSO later.

Application stores:

- Tenant membership.
- Clinic membership.
- Role assignment.
- Permission policies.
- Clinical sign-off rights.
- Export rights.
- Break-glass access records.

### 8.2 Core Auth Tables

Implement at minimum:

- `tenants`
- `clinics`
- `users`
- `user_identities`
- `memberships`
- `roles`
- `permissions`
- `role_permissions`
- `user_role_assignments`
- `clinic_user_assignments`
- `break_glass_accesses`
- `audit_events`

### 8.3 Authorization Model

Use layered checks:

1. Authenticated principal from Keycloak token.
2. Tenant membership.
3. Clinic membership where relevant.
4. Role permission.
5. Attribute-based rule where needed, such as doctor sign-off, export permission, or own assigned task.
6. RLS enforcement for tenant-owned PHI tables where feasible.

Acceptance:

- Owner, doctor, assistant, receptionist, accountant, and platform admin roles are represented.
- Accountant cannot view clinical notes/media by default.
- Assistant can manage schedule, tasks, messages, intake, and operational workflows.
- Doctor can sign clinical records and prescriptions.
- Privileged actions are audited.
- Permission tests cover allowed and denied paths.

## 9. Database and Tenancy

### 9.1 Schema Principles

- Every tenant-owned table has `tenant_id`.
- Clinic-scoped records also have `clinic_id`.
- Every mutable table has `created_at`, `updated_at`, and actor/provenance where relevant.
- Clinical and financial records use immutable state transitions where appropriate.
- Signed clinical records are append/amend, not destructive overwrite.
- Provider payloads are retained in raw event tables with access controls.

### 9.2 RLS Strategy

Apply PostgreSQL Row Level Security to PHI and tenant-owned operational tables where feasible:

- Patients.
- Appointments.
- Encounters.
- Clinical notes.
- Dental chart/findings.
- Media metadata.
- Invoices/payments.
- Conversations/messages.
- Tasks/recalls/lab/inventory/incidents.

Implementation pattern:

- Set request-local tenant/clinic context inside transaction.
- Define RLS policies using tenant context.
- Keep service/admin bypass tightly controlled and audited.
- Test cross-tenant access failures.

Acceptance:

- Automated tests prove tenant A cannot read/write tenant B records through API or direct repository layer.
- RLS policies are documented and migration-reviewed.
- Background workers set tenant context before tenant-owned queries.

## 10. API Foundation

### 10.1 API Style

Use REST + OpenAPI.

All mutating endpoints:

- Validate request body with shared schema.
- Enforce authorization.
- Use idempotency keys where external side effects or retries exist.
- Return structured errors.
- Emit audit/domain events where appropriate.

### 10.2 Error Shape

Use the error format from `09_API_CONTRACTS_AND_EVENTS.md`:

```json
{
  "error": {
    "code": "permission_denied",
    "message": "You do not have access to this record.",
    "details": {},
    "correlation_id": "trace_id"
  }
}
```

### 10.3 Shared Concerns

Implement:

- Request correlation IDs.
- Tenant resolver.
- Clinic resolver.
- Auth guard.
- Permission guard.
- Idempotency middleware.
- Rate limiting for public/webhook endpoints.
- Audit helper.
- OpenAPI generation.
- API client generation for web/mobile if practical.

Acceptance:

- Endpoint tests cover validation, auth, tenant isolation, permission failure, success, and audit emission.
- OpenAPI spec is generated in CI.
- API error shape is consistent.

## 11. Events, Outbox, and Temporal

### 11.1 Outbox Pattern

Implement:

- `outbox_events`
- `outbox_attempts`
- `dead_letter_events`

Required fields:

- `event_id`
- `event_type`
- `schema_version`
- `tenant_id`
- `clinic_id`
- `aggregate_type`
- `aggregate_id`
- `actor_type`
- `actor_id`
- `correlation_id`
- `idempotency_key`
- `payload`
- `occurred_at`
- `status`
- `attempt_count`
- `next_attempt_at`

Rules:

- Write domain data and outbox event in the same transaction.
- Process events idempotently.
- Persist attempts.
- Dead-letter permanent or exhausted failures.
- Provide admin review tooling later.

### 11.2 Temporal Runtime

Use Temporal for:

- Appointment confirmation loops.
- Recall workflows.
- Post-op instruction workflows.
- Payment reminders and reconciliation checks.
- Lab case lifecycle.
- Inventory/SOP recurring tasks.
- Migration review and commit workflows.
- AI review/sign-off workflows.
- ABDM consent/data exchange.

Do not use Temporal for:

- Simple synchronous CRUD.
- Thumbnail creation unless part of a larger durable workflow.
- Cache invalidation.

### 11.3 Workflow Coding Rules

- Workflow code must be deterministic.
- Side effects happen in activities.
- Activities are idempotent.
- Workflow IDs should include tenant/clinic/domain identifiers.
- Version workflows before incompatible changes.
- Store domain references, not PHI-heavy payloads, in workflow state where possible.
- Emit audit/domain events at important state transitions.

Acceptance:

- One sample production-style workflow exists before product workflows proliferate.
- Workflow tests cover retry, timer, cancellation, and human approval.
- Workers expose health and metrics.

## 12. Object Storage and Media Security

Implement object storage abstractions for:

- Intraoral photos.
- X-rays.
- PDFs.
- Audio chunks.
- Generated documents.

Rules:

- Objects are private.
- Object keys include environment/tenant/clinic but are never exposed directly.
- Signed URLs are short-lived and generated after authorization.
- Upload completion creates metadata row.
- Downloads/views are audited for sensitive media.
- Malware scanning or quarantine path is designed from first production release.
- Audio retention policies are enforceable.

Acceptance:

- Upload URL flow works.
- Complete-upload validates expected object metadata.
- Signed URL checks role/tenant/clinic access.
- Media access creates audit event.

## 13. Audit, Logging, and PHI Redaction

### 13.1 Audit Events

Audit at minimum:

- Login/logout and failed auth events.
- Patient record view/export.
- Clinical note create/sign/amend.
- Prescription sign.
- Media view/download.
- Consent create/revoke.
- Invoice/payment state changes.
- Integration credential changes.
- Provider webhook trust failures.
- Break-glass access.
- Role/permission changes.
- AI session start/output/review.

### 13.2 Logging

Use structured logs:

- `timestamp`
- `level`
- `service`
- `environment`
- `tenant_id` where safe
- `clinic_id` where safe
- `correlation_id`
- `event`
- `message`

Never log:

- Full patient names with clinical details.
- Phone numbers unless masked.
- ABHA IDs unless masked.
- Clinical notes.
- Transcripts.
- Payment identifiers beyond masked/provider IDs.
- Provider secrets.

Acceptance:

- PHI redaction helper exists.
- Tests prove common sensitive fields are redacted.
- Audit log viewer can be added without schema redesign.

## 14. Observability

Implement:

- OpenTelemetry tracing across web/API/worker/integration calls.
- Metrics for API latency, error rate, DB latency, Temporal workflow state, outbox lag, webhook failures, payment reconciliation mismatches, AI job latency/cost, and provider health.
- Error reporting with PHI scrubbing.
- Health endpoints for API and workers.
- Readiness/liveness probes.

Initial alerts:

- API error spike.
- Worker down.
- Outbox lag over threshold.
- Webhook failure spike.
- Payment reconciliation mismatch.
- Database connection saturation.
- Backup failure.
- Provider outage.

Acceptance:

- Traces include correlation IDs.
- Logs, metrics, and errors can be joined by correlation ID.
- Synthetic health check can exercise login/API/worker basics in staging.

## 15. CI/CD and Quality Gates

CI must run:

- Typecheck.
- Lint.
- Unit tests.
- Integration tests.
- Migration validation.
- OpenAPI generation check.
- Security/dependency scan.
- Secret scan.
- Formatting check.

Deployment gates:

- Staging deploy before pilot-prod.
- Database migrations reviewed.
- Rollback plan for risky migrations.
- Smoke tests after deploy.
- Manual approval for production until release process is mature.

Acceptance:

- A failed test blocks merge/deploy.
- Migrations can be applied from CI/CD safely.
- Seed data is deterministic.

## 16. Backup, Retention, and DR

Implement from first production clinic:

- Automated database backups.
- Point-in-time recovery.
- Object storage lifecycle policies.
- Backup restore drills.
- Encrypted backup storage.
- Retention policies for logs, audit, media, and audio.
- DR runbook for Mumbai primary and Hyderabad standby.

Acceptance:

- Restore drill is documented and tested before real pilot data.
- RPO/RTO targets are stated for pilot-prod.
- Deletion/retention jobs are auditable.

## 17. Platform Milestones

### P0.1 Monorepo and Local Stack

Deliver:

- Monorepo with web/api/worker/mobile skeletons.
- Local Postgres, Redis, Temporal, Keycloak.
- Shared config package.
- Seed clinic/users.
- CI typecheck/lint/test.

Done when:

- All apps boot locally.
- Seed users authenticate.
- API returns authenticated `/me`.

### P0.2 Core Tenancy and Auth

Deliver:

- Tenant/clinic/user/membership/role/permission schema.
- Auth guard.
- Tenant/clinic resolver.
- Permission guard.
- RLS proof of concept.
- Audit helper.

Done when:

- Cross-tenant access tests fail correctly.
- Owner/doctor/assistant permissions behave correctly.

### P0.3 API/Event Foundation

Deliver:

- OpenAPI setup.
- Shared validation schemas.
- Error format.
- Idempotency middleware.
- Outbox tables and worker.
- Dead-letter model.
- Sample domain event.

Done when:

- A sample transaction writes data and outbox event atomically.
- Worker processes and retries idempotently.

### P0.4 Temporal Foundation

Deliver:

- Temporal client/worker.
- Workflow package.
- Sample approval/timer workflow.
- Workflow test harness.

Done when:

- A sample workflow survives worker restart and completes after simulated approval.

### P0.5 Object Storage and Audit Foundation

Deliver:

- S3 adapter.
- Upload URL and complete-upload primitives.
- Signed URL authorization.
- Media metadata base table.
- Audit event recording.

Done when:

- Media upload/download path is private, signed, permissioned, and audited.

### P0.6 Staging/Pilot Infrastructure

Deliver:

- Terraform baseline.
- Dev/staging/pilot-prod profiles.
- Secrets manager.
- Logs/metrics/traces.
- Backup and restore runbook.

Done when:

- Staging deploy succeeds through CI/CD.
- Restore drill completes with synthetic data.

## 18. Platform Risks and Mitigations

| Risk | Mitigation |
|---|---|
| RLS complexity slows development | Start with PHI/high-risk tables and repository tests; expand deliberately. |
| Temporal adds operational overhead | Use it early for a small workflow, document patterns, and avoid using it for simple jobs. |
| Keycloak setup delays product work | Containerize local/dev setup and keep app authorization separate from identity. |
| Provider simulators leak into product | Enforce provider interface and environment gating; fail production startup if simulator provider is selected. |
| PHI appears in logs | Central redaction helper, tests, code review checklist, error-reporting scrubber. |
| Infrastructure overbuild | Use ECS/Fargate and managed services first, but keep Terraform, backups, security, and observability production-grade. |

## 19. Platform Acceptance Checklist

Before Workstreams B and C depend on platform as production-ready:

- [ ] Local stack starts cleanly.
- [ ] CI gates are active.
- [ ] Seed tenant/clinic/users work.
- [ ] Keycloak login works.
- [ ] Tenant/clinic authorization is enforced.
- [ ] RLS exists for first PHI tables or is explicitly scheduled with tests.
- [ ] Audit helper is available.
- [ ] OpenAPI generation works.
- [ ] Outbox worker works.
- [ ] Temporal worker works.
- [ ] Object upload/signed URL flow works.
- [ ] Logs/traces/metrics exist.
- [ ] Backup/restore runbook exists.
- [ ] Production startup blocks simulator providers.
- [ ] Security and PHI redaction tests exist.
