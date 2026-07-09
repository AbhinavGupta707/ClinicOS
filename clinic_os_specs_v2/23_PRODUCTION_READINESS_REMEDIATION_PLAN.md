# 23 — Production Readiness Remediation Plan

**Date:** 2026-07-09
**Status:** Canonical post-CP10 implementation plan
**Execution model:** One persistent master Codex session, sequential checkpoints, no worktree orchestration by default
**Release posture:** Local/synthetic development only; production and pilot are **NO-GO** until the applicable gates pass

## 1. Purpose

This plan converts the independent post-CP10 audit into an executable path from a fixture-capable codebase to a production-grade clinic operating system. It supplements plans 17–20 and takes precedence wherever an earlier checkpoint report or release document implies that deterministic fixture evidence is sufficient for pilot readiness.

The detailed finding source is `../docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md`. The proof rules are in `../docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md`. Security architecture is in `24_PRODUCTION_SECURITY_THREAT_MODEL_AND_CONTROLS.md`.

## 2. Decisions

### 2.1 Preserve the modular-monolith target; do not rewrite blindly

The desired system remains a modular monolith with explicit domain boundaries, a durable outbox, Temporal workflows, typed provider adapters, and generated contracts. The present native Node router and very large application/repository files are migrated incrementally behind parity tests. Existing durable domain behavior is preserved unless the canonical spec explicitly changes it.

### 2.2 Existing SQL is the schema source of truth

The ten numbered SQL migrations remain canonical. CP11 introduces a mature checksum-tracked runner, not a custom migration framework and not a second ORM-owned schema. The default decision is a version-pinned Flyway container/CLI wrapped by repository commands because the existing source is raw PostgreSQL SQL. A short ADR may select an equivalent tool only if it demonstrates checksums, locking, CI/deploy integration, and PostgreSQL support without duplicating schema truth.

### 2.3 Fixture, durable-local, staging, and production claims are different

Fixtures remain test doubles. They may prove deterministic UI and contract behavior but never durable readiness, live provider readiness, or go-live. Product surfaces must identify unavailable/unconfigured capabilities honestly. Release documents must name the evidence tier.

### 2.4 Security and clinical safety are checkpoint-wide requirements

Security is not a final hardening phase. Every checkpoint owns authorization, tenant isolation, runtime validation, audit, idempotency, secrets, logging/redaction, failure behavior, tests, documentation, and rollback for its scope. AI drafts only; a human signs clinical outputs.

### 2.5 One master session executes sequentially

The default implementation path uses the current master session for architecture, code, tests, browser/device checks, integration, and documentation. Each checkpoint is still an independently reviewable increment with a clean scope and completion gate. Do not begin a later checkpoint to hide a failing earlier one. Worktrees or parallel agents require a later explicit user decision and a genuinely independent ownership boundary.

## 3. Target Production Architecture

```text
Web (Next.js BFF/session)             Mobile (Expo, PKCE, secure storage)
             |                                      |
             +------------- TLS/WAF/ALB -------------+
                                    |
                       NestJS modular-monolith API
              authn -> tenant/authz -> validation -> domain
                                    |
          +-------------------------+--------------------------+
          |                         |                          |
 PostgreSQL/RLS + outbox       Temporal + workers       Provider adapters
 audit/clinical/billing        durable workflows        signed webhooks
          |                         |                  Meta/Razorpay/etc.
          +--------------- private AWS network ----------------+
                                    |
                     S3/KMS quarantine + signed access
                                    |
          OpenTelemetry -> logs/metrics/traces/alerts/SLOs
                                    |
         backup/PITR/cross-region restore + immutable audit export
```

### 3.1 Identity and sessions

- Self-hosted Keycloak in India-region infrastructure, highly available and backed up.
- Authorization Code + PKCE for browser and mobile.
- Browser uses an application BFF/session with `HttpOnly`, `Secure`, appropriately scoped `SameSite` cookies; cookie-authenticated mutations require CSRF and origin checks.
- Mobile tokens and key material live only in OS secure storage. No auth tokens or PHI in Web Storage.
- API validates issuer, audience, signature, expiry, authorized party, tenant membership, clinic scope, role and capability on every request.
- Privileged roles require MFA; revocation, offboarding, key rotation and break-glass are tested and audited.

### 3.2 Data and tenancy

- PostgreSQL is authoritative for transactional clinic state.
- Every tenant-owned row carries the required tenant/clinic key. RLS uses a transaction-scoped request context and a restricted runtime role.
- Application authorization and RLS are both required; neither substitutes for the other.
- Domain write, audit event, and outbox event commit atomically where the workflow requires them.
- Migration and runtime DB roles are separate. Production runtime cannot alter schema or audit history.
- Reporting/read models have explicit freshness, rebuild and reconciliation rules.

### 3.3 APIs and contracts

- NestJS controllers are thin; application services own use cases; repositories own persistence; provider adapters own external semantics.
- Request, path, query, and response shapes have runtime schemas. Unknown writable fields are rejected.
- OpenAPI is generated from runtime truth; checked-in clients are regenerated and diff-checked in CI.
- Stable error taxonomy, pagination ceilings, idempotency keys, optimistic concurrency where needed, request IDs, and no-store PHI responses are uniform.

### 3.4 Workflows and events

- PostgreSQL outbox is atomically written with domain state.
- Relay and consumers are idempotent, leased, observable, and replayable with authorization.
- Temporal owns long-running/retrying clinic workflows; Redis/BullMQ is restricted to short, non-authoritative jobs if used.
- Workflow/activity code is versioned and replay-tested. Poison work goes to an observable dead-letter/reconciliation path.

### 3.5 Media and mobile

- Media bytes use private S3 with KMS, tenant-scoped keys, validation, malware quarantine, short-lived signed access and audit.
- Mobile capture is native, permission-aware, consent-aware, encrypted offline, retryable, and safely purged.
- No raw bucket, object key, local path, PHI filename, or provider token crosses a client/log boundary.

### 3.6 External providers

- Only official APIs, partner integrations, signed callbacks, authorized exports/imports, or explicit clinic-approved manual workflows.
- Activation state is explicit: absent → registered → configured → sandbox verified → production verified, with degraded/disabled states.
- Webhooks verify signatures against raw bounded bodies before parsing, deduplicate event IDs, handle out-of-order delivery, persist evidence, retry safely and reconcile with provider truth.

### 3.7 Cloud, telemetry, and recovery

- Separate AWS accounts or strong equivalent isolation for non-production and production; Mumbai primary and Hyderabad recovery posture as approved.
- Private subnets for data/compute, least-privilege security groups and IAM, KMS/Secrets Manager, WAF, TLS/DNS, image registry/scanning, remote Terraform state and CI OIDC.
- OpenTelemetry propagation across HTTP, database, outbox, workers and providers. Diagnostic telemetry is PHI-redacted; clinical/audit records remain separate.
- Encrypted backups, PITR, cross-region copy, tested restore/failover, signed RPO/RTO evidence, and immutable audit export.

## 4. Sequential Checkpoints

### CP11 — Verification Integrity and Durable Data Foundation

**Goal:** make every subsequent claim reproducible against a clean, migrated, durable local stack.

**Owns:** PRR-001, 002, 003, 010, 011, 025, 027 foundations, 029.

**Deliverables:**

- injected clock and time-zone boundary tests;
- all repository gates reproducibly green;
- real TypeScript checks for every production workspace;
- version-pinned migration runner, clean bootstrap, migration/runtime roles and drift checks;
- deterministic synthetic seed separated from migrations;
- Postgres/RLS/transaction/audit/outbox integration tests;
- live smoke using runtime-discovered identifiers;
- readiness probes for required local dependencies;
- clean-clone gate and product-only formatting scope;
- corrected evidence and release truth.

**Exit:** all CP11 checks pass twice from a clean database and after restart; the full CP2–CP10 API contract chain that remains canonical runs against Postgres with zero silent fixture fallback.

### CP12 — Modular API and Generated Contract Foundation

**Goal:** make public boundaries reviewable, validated and drift-resistant without a big-bang rewrite.

**Owns:** PRR-012, 017, 028, 030 contract foundations.

**Deliverables:**

- NestJS bootstrap and module dependency rules;
- incremental route migration, starting identity/health and highest-risk mutation/webhook paths;
- centralized authn/tenant/authz/validation/error/idempotency/request-context middleware;
- runtime DTO/schema validation and generated OpenAPI/client pipeline;
- route parity, invalid-input, authorization, tenant and performance tests;
- deprecation/removal plan for the native router once parity is complete.

**Exit:** all active public routes are either migrated or have a time-bounded, tested adapter; generated contracts match runtime; no production endpoint bypasses the security pipeline.

### CP13 — Durable Clinic-Day Vertical Slices

**Goal:** prove the actual source-of-truth clinic workflows across database, API, worker and UI.

**Owns:** PRR-014 and the complete durable product path; closes remaining PRR-027 behavior.

**Vertical slices:**

1. lead/source → patient match/create → appointment → queue;
2. intake/consent → encounter → note/prescription sign/amend;
3. dental chart/media metadata → treatment plan/estimate;
4. invoice → payment state/reconciliation foundation → instructions;
5. tasks/recalls → lab/inventory/events/SOP → owner analytics;
6. privacy/audit/export/break-glass operations selected for the first clinic.

Each slice includes Postgres persistence, RLS, audit/outbox, worker recovery, generated client, role UI, unavailable/error states, browser mobile-width smoke and restart/retry reconciliation. A read model is implemented canonically or its entire consumer workflow stays unavailable.

**Exit:** role-based E3/E4 clinic-day tests use runtime IDs and durable state; no fixture is required for a claimed product workflow; data and event reconciliation is zero-drift.

### CP14 — Deployable Cloud, Security Operations, Media, Observability and Recovery

**Goal:** create and operate a production-equivalent environment rather than a posture-only profile.

**Owns:** PRR-006, 007, 009, 013, 015, 016 infrastructure, 017 edge, 018, 019, 020, 024.

**Deliverables:**

- deployable Terraform modules, environment/account separation, CI OIDC and immutable build artifacts;
- private RDS/Postgres, Redis if required, Temporal deployment/managed decision, ECS/Fargate, ALB/WAF, S3/KMS, Secrets Manager, DNS/TLS;
- Keycloak HA/backup/realm promotion and production session controls;
- production media pipeline and quarantine;
- OpenTelemetry backend, dashboards, SLOs, paging and synthetic monitoring;
- CSP/browser headers, CORS/origin/CSRF and cache policy;
- dependency/SAST/IaC/container/SBOM/signing gates;
- backup/PITR/cross-region restore and failover drills;
- audit immutability, lifecycle/key operations, capacity and incident exercises.

**Exit:** E4 staging and E5 pilot-prod exist, match Terraform, survive dependency fault and restore exercises, and meet approved security/SLO gates. No real PHI yet.

### CP15 — Official Messaging, Payments and Telephony

**Goal:** activate only complete official provider workflows.

**Owns:** PRR-008 and 026 for Meta, Razorpay and selected telephony provider.

**Deliverables:**

- public callback routes and provider-side registration;
- Meta verification, signed inbound messages, template send, status transitions, consent/opt-out and reconciliation;
- Razorpay payment link/QR as scoped, signed callbacks, amount/invoice matching, duplicate/out-of-order/refund/dispute reconciliation;
- official missed-call/call-event path with patient matching and manual ambiguity queue;
- provider health, rate/cost limits, DLQ/replay, outage states and support runbooks;
- Google/Practo remains official API/export/manual-only; no scraping.

**Exit:** E4 official sandbox evidence covers success and adversarial/retry cases; production activation is disabled until provider approval and go-live authorization.

### CP16 — Native Mobile, AI/Scribe and Interoperability

**Goal:** complete selected boundary capabilities without exposing partial clinical behavior.

**Owns:** PRR-004, 005, 021, 022, 023.

**Deliverables:**

- physical-device camera/audio, encrypted offline queue, SecureStore sessions, safe deletion and internal distribution;
- approved AI/STT data path, consent, gateway, evals, human review, provenance, kill switch and cost controls—or the whole capability remains disabled;
- selected FHIR export/exchange route with validator and reconciliation;
- ABDM only through official sandbox/production activation with consent and approval; otherwise unavailable;
- privacy manifests, device support, crash telemetry, signed release/rollback.

**Exit:** E4 device/provider/validator evidence and clinical safety sign-off for each enabled capability. Partial boundaries do not ship.

### CP17 — Pilot-Production Validation and Controlled Clinic Launch

**Goal:** demonstrate production operation with approved people, process and data before clinical reliance expands.

**Owns:** PRR-030 and final closure confirmation for all in-scope P1/P2 release gates.

**Deliverables:**

- clinic contract, privacy/controller-processor roles, configured policy/roles/consents and migration plan;
- synthetic E5 rehearsal, then explicitly approved limited real-data E6 validation;
- staff training, downtime/manual fallback, support/on-call, incident and rollback drills;
- end-to-end observed clinic day on web and physical devices;
- provider production verification, backup/restore freshness, load/security/pentest closure;
- signed engineering, security/privacy, clinical safety, operations and clinic go-live decision;
- stop conditions, limited cohort, monitoring room and rollback authority.

**Exit:** all hard gates pass. A hard gate is never waived as an “accepted gap”; remove the entire optional workflow or delay launch.

### CP18 — Multi-Clinic General Production Readiness

**Goal:** convert the controlled first-clinic deployment into a repeatable, supportable production service.

**Deliverables:**

- observed pilot outcomes and defect closure;
- tenant onboarding/offboarding automation and configuration validation;
- multi-clinic capacity/noisy-neighbor evidence and billing/support model;
- vulnerability, access, backup/restore, incident, release and disaster-review operating cadence;
- customer-facing status/support/privacy/security material;
- availability and recovery service objectives, error-budget policy and release controls;
- multi-clinic migration tooling with reconciliation and rollback;
- final production threat-model review and independent penetration test.

**Exit:** repeatable onboarding and operation meet E7 evidence; no first-clinic manual exception is silently generalized.

## 5. Cross-Cutting Definition of Done

Every checkpoint must include, for its scope:

- canonical requirements and an ADR for any material architecture divergence;
- production implementation with no mock/stub/placeholder path enabled outside local/test;
- server-side authorization, tenant isolation and RLS where applicable;
- runtime input/output validation and stable error semantics;
- audit, provenance, idempotency/concurrency, observability and redaction;
- success, failure, negative-role, cross-tenant, retry/replay and recovery tests;
- web/mobile reachability and no horizontal overflow for implemented UI;
- threat-model/control update and security regression;
- deployment/config migration, rollback/forward-fix and runbook;
- evidence record containing revision, environment, command/test, timestamp and result;
- updated register, changelog, memory, checkpoint log and release truth.

## 6. Single-Session Execution Protocol

For each checkpoint, the master session follows this loop:

1. Re-read this plan, the remediation register, threat model, evidence standard and the checkpoint packet.
2. Confirm the current clean base, preserve user-owned/untracked work and record pre-existing failures.
3. Create one checkpoint branch only if the user asks; otherwise work on the current authorized branch without destructive commands.
4. Implement the smallest complete dependency-ordered slice. Shared manifests/lockfile are reconciled once per checkpoint.
5. Run narrow tests immediately after each material change.
6. Run database/API/worker/browser/device/provider evidence at the required tier.
7. Run full repository/security/build gates.
8. Inspect the diff, generated files, schema and release claims; record residual risks.
9. Commit only when explicitly authorized or when the active execution request includes commits.
10. Do not start the next checkpoint while the current exit gate is failing.

Context compaction does not change the execution model: the docs and checkpoint record are durable state. The session resumes from the last verified checkpoint rather than restarting or batching unreviewed changes.

## 7. Inputs and External Authorities

Some checkpoints require user/clinic/provider authority that code cannot create:

- AWS account, domains, DNS, budget, production apply and recovery windows;
- Keycloak and CI identity ownership;
- Meta/Razorpay/telephony registrations and public callback URLs;
- approved AI/STT vendor, legal terms, region, no-training/retention posture;
- ABDM credentials/approval if the workflow is selected;
- Apple/Google signing/distribution accounts and physical devices;
- clinic contract, staff roster, privacy/consent text, migration exports and go-live approvers;
- authorization to submit dependency inventory to an audit service or an approved offline alternative.

Missing authority blocks activation, not foundational implementation. The affected workflow must remain disabled and honestly unavailable.

## 8. Start Here

Execution begins with `../docs/implementation/CHECKPOINT_11_VERIFICATION_AND_DURABLE_DATA_FOUNDATION.md`. CP11 is intentionally narrow: until the database and test evidence are trustworthy, work on later cloud/provider/mobile features would multiply uncertainty.
