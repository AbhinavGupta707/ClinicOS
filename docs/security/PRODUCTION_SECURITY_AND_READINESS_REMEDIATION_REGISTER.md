# ClinicOS Production Security and Readiness Remediation Register

**Audit date:** 2026-07-09
**Status:** Active canonical remediation register
**Release decision:** **NO-GO** for pilot, production PHI, or production provider traffic
**Scope:** Independent static, runtime, test, browser, configuration, infrastructure, and activation review of `main` after CP10

## 1. Executive Finding

ClinicOS has substantial domain modeling, fixture workflows, role-aware browser surfaces, API route foundations, and local provider contracts. It is not yet a deployable or operable production clinic system. CP10 demonstrated useful deterministic fixture behavior; it did not demonstrate a migrated durable database, deployable cloud resources, real dependency readiness, native device capture, live provider callbacks, production media storage, distributed observability, disaster recovery, or real-clinic acceptance.

The safe remediation strategy is not a rewrite and not a collection of symptom patches. It is a sequence of complete production foundations followed by durable workflow and boundary activation. Fixture behavior remains valuable test evidence but cannot be promoted into a readiness claim.

## 2. Rating and Closure Rules

| Rating | Meaning                                                                                                                                                           | Required response                                                                                |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P0     | Demonstrated active compromise, cross-tenant disclosure, unsafe clinical finalization, destructive corruption, or exposed production secret.                      | Stop affected environments immediately; incident response before normal work.                    |
| P1     | Production/pilot blocker with a credible path to PHI loss, tenant failure, clinical/financial error, inability to operate/recover, or materially false readiness. | Must close before pilot or explicitly remove the entire affected workflow from production scope. |
| P2     | Important security, reliability, maintainability, or evidence defect that increases operational risk.                                                             | Must close before production unless the owning capability is wholly absent and unreachable.      |
| P3     | Hygiene or efficiency defect with limited direct safety impact.                                                                                                   | Schedule and verify; cannot be used to conceal a failing higher gate.                            |

No P0 was demonstrated during this review because no production environment or real PHI was in scope. Absence of an observed P0 is not evidence that the system is secure.

A finding closes only when all of the following exist:

1. Production code or infrastructure implements the control; a plan, variable, interface, fixture, or unavailable shell is not implementation.
2. Automated tests cover success, failure, authorization, tenant isolation, idempotency/replay where applicable, and rollback or recovery.
3. The control is exercised at the evidence tier required by `docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md`.
4. Operational ownership, alerting, runbook, and residual risk are recorded.
5. The canonical register is updated with immutable evidence links, environment, timestamp, code revision, and approver.

## 3. Findings

### PRR-001 — Migrations are not applied to the local durable database (P1)

- **Evidence:** ten SQL migrations exist in `packages/db/migrations/`, but the root local lifecycle only starts containers (`package.json:24-27`) and the local runbook starts services without a migration step (`infra/runbooks/local-development.md:17-22`). The inspected local Postgres `public` schema contained zero tables.
- **Risk:** fixture-backed behavior can appear complete while the production repository cannot start or persist workflows. RLS, constraints, audit, and recovery are unproved.
- **Remediation:** CP11 must add a version-pinned, checksum-tracked migration runner; clean-database bootstrap; deployment one-shot migration task; advisory locking; least-privilege migration/runtime roles; seed separation; drift detection; and rollback/forward-fix policy. Use the existing canonical SQL rather than inventing a second schema source.
- **Closure evidence:** clean local E3 bootstrap, schema/RLS assertions, migration re-run idempotency, dirty/drift rejection, staging migration, and restore-to-new-database validation.

### PRR-002 — Repository test suite is clock-dependent and currently failing (P1)

- **Evidence:** lab slip assertion hardcodes `LAB-20260707` (`apps/api/test/cp6-lab-inventory-events.test.ts:70`); retention tests use a fixed 2026-07-08 `asOf` while creation uses the runtime clock (`apps/api/test/cp9-security-privacy.test.ts:145,158`); appointment/queue smoke uses historical clinic-day data. `npm run test` failed during the audit.
- **Risk:** a green historical checkpoint cannot be reproduced. Date-sensitive clinical, retention, and queue behavior may regress silently.
- **Remediation:** introduce an injected `Clock` contract at application boundaries; use fixed clocks in unit/integration tests; derive human-visible identifiers from the injected clinic-local date; test timezone/DST/midnight boundaries; prohibit implicit `new Date()` in domain/application logic through lint or review policy.
- **Closure evidence:** repeat the complete suite under at least two dates/timezones, with no source changes, plus focused rollover tests.

### PRR-003 — CP10 live smoke uses fixture clinic identifiers and fails authorization (P1)

- **Evidence:** `scripts/cp10-contract-smoke.mjs` mixes deterministic fixture identifiers with runtime `/v1/me` identity. The live fixture-header run reached health and then failed `403 clinic_mismatch`; canonical reads using the runtime clinic identifier succeeded.
- **Risk:** the advertised live contract gate does not prove the deployed route family and can misdiagnose tenant enforcement as product failure.
- **Remediation:** split deterministic fixture validation from live runtime smoke; discover and carry runtime tenant/clinic/patient identifiers; create per-run unique data; clean up or retain evidence safely; fail on skipped scenarios; record identity and environment without PHI.
- **Closure evidence:** zero-skip CP10/CP11 live smoke against E3 and E4, including negative cross-tenant assertions.

### PRR-004 — Native photo and audio capture are intentionally unavailable (P1)

- **Evidence:** the default photo provider throws an unavailable error (`apps/mobile/src/features/capture/adapters/photoCaptureProvider.ts:42-45`); audio is hardcoded unavailable (`apps/mobile/src/features/shell/MobileShellScreen.tsx:26-30`); required native packages are absent (`apps/mobile/package.json:15-28`).
- **Risk:** chairside media and consented recording workflows cannot operate on supported devices.
- **Remediation:** CP16 must implement approved Expo camera/audio providers, runtime permission flows, consent enforcement, capture cancellation/retry, foreground/background behavior, metadata minimization, and device capability diagnostics. Audio stays disabled unless active consent and policy allow it.
- **Closure evidence:** physical iOS and Android device tests, denied/revoked permission tests, consent transition tests, upload/retry/offline tests, and distribution build evidence.

### PRR-005 — Mobile “secure” capture cache is memory-only (P1)

- **Evidence:** `InMemorySecureCaptureCache` stores bytes and queue state in process memory (`apps/mobile/src/features/capture/secureCache.ts:7-29`) and is used by the shell (`MobileShellScreen.tsx:37-40`).
- **Risk:** captures disappear on process death; offline retry is not durable; an eventual naïve persistence implementation could leak PHI.
- **Remediation:** encrypted application-private file storage for media, SecureStore/Keychain/Keystore for key material and tokens, authenticated metadata encryption, TTL and post-upload secure deletion, device backup exclusion, logout/revocation purge, low-storage handling, and remote-session invalidation.
- **Closure evidence:** process-kill/reboot/offline recovery, logout purge, storage inspection, tamper/corruption tests, and lost/stolen device threat tests.

### PRR-006 — Pilot-prod Terraform declares no providers or resources (P1)

- **Evidence:** the profile explicitly states it is validation-only and declares no live resources (`infra/terraform/pilot-prod/README.md:1-3`); `main.tf` contains posture locals rather than resources (`infra/terraform/pilot-prod/main.tf:1-36`).
- **Risk:** ClinicOS cannot be deployed, isolated, monitored, backed up, or recovered in the target AWS environment.
- **Remediation:** CP14 must implement version-pinned modules and remote state for network, private data stores, compute, load balancing, WAF, DNS/TLS, KMS, Secrets Manager, object storage, logging, alerts, CI/OIDC, backup vaults, and DR foundations. Separate accounts/environments and deny public database/storage paths.
- **Closure evidence:** reviewed plans, policy/security scans, applied staging and pilot-prod resources, network reachability tests, inventory export, cost estimate, drift checks, teardown protection, and architecture diagram matching reality.

### PRR-007 — Observability has no production telemetry backend (P1)

- **Evidence:** default metrics and logs write JSON to the console (`packages/observability/src/metrics.ts:23`, `packages/observability/src/logger.ts:40-44`). Alert definitions exist but no collector, exporter, dashboard, paging route, or retention backend is connected.
- **Risk:** clinical, tenant, provider, queue, security, and recovery failures can remain invisible; incident reconstruction is unreliable.
- **Remediation:** OpenTelemetry traces/metrics/log correlation; PHI-safe structured logging; CloudWatch or approved backend exporters; SLO dashboards; provider, queue, DB, auth, backup, security, and synthetic alerts; paging/escalation tests; immutable audit remains separate from diagnostic logs.
- **Closure evidence:** deployed telemetry, trace correlation through API/outbox/worker/provider, alert injection to a real escalation target, redaction tests, dashboards, and retention/access review.

### PRR-008 — Official provider activation is incomplete (P1)

- **Evidence:** Razorpay has a raw-body route (`apps/api/src/server.ts:261-289`) but no registered public webhook URL; Meta signature/provider adapters exist without a registered inbound WhatsApp route; no telephony callback route was found. Credential presence is partial and does not prove provider registration, approval, or traffic.
- **Risk:** messages, delivery states, missed calls, and payments cannot reliably enter the source of truth; spoofing and lost callbacks are possible if activation is improvised.
- **Remediation:** CP15 implements official HTTPS callback routes, provider dashboard registration, challenge/verification flows, signed raw-body verification before parsing, replay windows, event deduplication, state machines, retries/DLQ/replay, IP/rate controls where officially supported, and provider health.
- **Closure evidence:** official sandbox events for success, invalid signature, duplicate, out-of-order, retry, outage, and replay; provider dashboard screenshots/exports with secrets redacted.

### PRR-009 — No production media storage provider exists (P1)

- **Evidence:** runtime media storage supports only `local_simulator`; other providers fail and the simulator is forbidden in production-like environments (`apps/api/src/server.ts:1428-1455`).
- **Risk:** clinical photos and attachments cannot be stored in production; unsafe direct object exposure may emerge under delivery pressure.
- **Remediation:** private S3/KMS provider with tenant-scoped object keys, content-length/type validation, magic-byte inspection, malware quarantine/scanning, signed upload/download with short TTL, completion verification, immutable provenance, lifecycle/retention/deletion, audit, and no bucket/key disclosure to clients.
- **Closure evidence:** E4 upload/download/quarantine/access-denial tests, cross-tenant negative tests, expired URL tests, object lifecycle and restore tests.

### PRR-010 — Readiness endpoint reports success without probing dependencies (P1)

- **Evidence:** `/health/ready` always returns 200 and describes configuration, not connectivity (`apps/api/src/server.ts:217-223`).
- **Risk:** load balancers can send PHI traffic to instances without DB/auth/workflow/storage connectivity and dashboards can show a false green state.
- **Remediation:** separate liveness, startup, and readiness. Readiness must use bounded probes for required synchronous dependencies; optional provider degradation belongs in detailed authenticated health, not a false global success. Use timeouts, caching, circuit breakers, and no secret/PHI leakage.
- **Closure evidence:** dependency fault-injection tests proving readiness removal/recovery and orchestration/load-balancer behavior.

### PRR-011 — Several package “typechecks” only perform syntax checks (P2, release blocker)

- **Evidence:** the database package uses `node --check` on TypeScript files (`packages/db/package.json:11`) while the root command trusts workspace scripts (`package.json:16`). Similar scripts must be audited across packages.
- **Risk:** interface/schema drift and unsafe refactors can pass CI.
- **Remediation:** real `tsc --noEmit` project references for every TypeScript workspace, strict options, generated contract compilation, no emit-on-error, and a gate that rejects syntax-only TypeScript checks.
- **Closure evidence:** injected cross-package type failure makes CI fail; all production TypeScript is included and generated output excluded appropriately.

### PRR-012 — API routing and operations are highly concentrated and contracts are handwritten (P2)

- **Evidence:** the CP12 integration candidate now places all 128 active operations behind one NestJS contract/security pipeline, generates deterministic OpenAPI and a typed client from runtime truth, and exposes transaction-leased namespaced repository seams. The large operation dispatcher remains only as a time-bounded domain strangler after the uniform boundary. Deterministic, durable-local, restart and browser evidence passes; the externally authorized dependency audit and promotion remain pending (`docs/qa/checkpoint-12-evidence.md`).
- **Risk:** authorization, validation, transaction, idempotency, and route changes are difficult to review; documentation and clients can drift.
- **Remediation:** CP12 performs an incremental modular-monolith strangler into NestJS domain modules, typed controllers/services/repositories, runtime request/response schemas, generated OpenAPI and clients, central exception/security middleware, and architecture dependency tests. No big-bang rewrite.
- **Closure evidence:** route parity suite, generated-spec diff gate, runtime invalid-input tests, dependency-boundary tests, and performance comparison.

### PRR-013 — Web response security policy is absent from application configuration (P2, release blocker)

- **Evidence:** Next configuration only enables strict mode and package transpilation (`apps/web/next.config.mjs:1-5`). No deployed edge exists that supplies an equivalent policy.
- **Risk:** clickjacking, content injection impact, referrer leakage, MIME confusion, and unsafe browser capability exposure are insufficiently constrained.
- **Remediation:** nonce/hash-based CSP compatible with Next, HSTS at TLS edge, `frame-ancestors 'none'`, `X-Content-Type-Options`, strict referrer and permissions policies, secure cookies, no-store/private caching for PHI, trusted-host/origin enforcement, CSRF protection for cookie-authenticated mutations, and documented CORS allowlists.
- **Closure evidence:** deployed-header tests, CSP violation monitoring, browser regression, CSRF/origin negative tests, and cache inspection.

### PRR-014 — Durable end-to-end clinic-day behavior is not demonstrated (P1)

- **Evidence:** CP10 browser workflows passed in fixture mode while the inspected durable database was empty and the live smoke failed. Some aggregate read models remain intentionally unavailable outside fixtures.
- **Risk:** the UI can present a coherent synthetic day while production writes, reads, workflow transitions, audit, outbox, and recovery disagree.
- **Remediation:** CP13 runs the canonical lead-to-recall and payment/operations flows against Postgres, Keycloak, Temporal/outbox, and production-equivalent API clients. Implement canonical read models or defer their entire UI workflow; do not add compatibility stubs.
- **Closure evidence:** E3/E4 role-based browser and API tests with runtime IDs, restart/retry recovery, audit/outbox reconciliation, and tenant-negative evidence.

### PRR-015 — Backup, point-in-time recovery, restore, and failover are not live-tested (P1)

- **Evidence:** CP9/CP10 accepted synthetic restore dry-runs and explicitly deferred live apply/restore. No production data store exists to restore.
- **Risk:** RPO/RTO and record recoverability are assumptions.
- **Remediation:** automated encrypted backups, PITR, cross-region copy, retention/legal-hold policy, quarterly restore to isolated environment, integrity/application smoke, documented failover/failback, DNS/secret rotation, and break-glass authorization.
- **Closure evidence:** timed restore and failover drills from real environment backups meeting approved RPO/RTO, with data reconciliation and signed review.

### PRR-016 — Production authentication/session lifecycle is not evidenced (P1)

- **Evidence:** local fixture headers and local Keycloak foundations exist, but no deployed Keycloak HA, realm promotion, MFA policy, session revocation, key rotation, web BFF/session, or mobile PKCE/SecureStore evidence was demonstrated.
- **Risk:** account takeover, stale authorization, leaked refresh tokens, or unreviewed admin access.
- **Remediation:** Keycloak production topology and backups; Authorization Code + PKCE; short-lived access tokens; rotation/revocation; MFA for privileged roles; HttpOnly Secure SameSite web sessions via BFF where cookies are used; mobile tokens only in OS secure storage; SCIM/manual joiner-mover-leaver workflow; admin/break-glass audit.
- **Closure evidence:** E4 login/logout/revocation/role-change/MFA/key-rotation tests and lost-device/offboarding exercises.

### PRR-017 — Rate limits, resource limits, and abuse controls are incomplete (P2, release blocker)

- **Evidence:** the CP12 candidate implements pre-auth IP budgets, authenticated tenant/actor rate and expensive-operation budgets, strict body/query/pagination limits, Redis Lua atomic consumption, `429`/`Retry-After`, 80 durable idempotency scopes and 12 conditional resource-version updates. Repeated local Redis/socket denial and recovery evidence passes; CP14 deployed WAF, noisy-neighbor load and alert validation remain open (`docs/qa/checkpoint-12-evidence.md`).
- **Risk:** denial of service, runaway provider cost, brute force, oversized payloads, and noisy-neighbor failure.
- **Remediation:** WAF and application rate limits by route/identity/tenant/IP as appropriate; body/file limits; pagination ceilings; query timeouts; worker concurrency and provider budgets; AI token/duration limits; `429`/`Retry-After`; abuse telemetry without PHI.
- **Closure evidence:** load/abuse tests at edge and application layers, isolation under noisy-tenant conditions, and alert validation.

### PRR-018 — Security validation and vulnerability management are not release-operational (P1)

- **Evidence:** secret scanning passed historically; dependency audit was not completed in checkpoint evidence and a later install reported moderate advisories. No SAST, IaC/container scanning, SBOM/signing, DAST, penetration test, or remediation SLA evidence exists.
- **Risk:** known vulnerable dependencies or deployment defects can ship without ownership.
- **Remediation:** lockfile-controlled dependency governance; approved registry audit/SCA; SAST; secret scan; IaC, image, license, and SBOM scans; provenance/signing; patch SLAs; exception expiry; pre-pilot independent penetration test; recurring authenticated DAST in staging.
- **Closure evidence:** CI results, zero unexpired critical/high findings unless formally risk-accepted by named authority, penetration-test closure, and signed artifact verification.

### PRR-019 — Audit immutability and privileged access need production enforcement (P1)

- **Evidence:** audit models/sinks exist, but no deployed append-only database role policy, tamper-evident export, privileged query monitoring, immutable retention store, or periodic audit review evidence was demonstrated.
- **Risk:** malicious or accidental alteration can erase clinical, privacy, billing, or break-glass provenance.
- **Remediation:** append-only runtime permissions; correction-by-superseding-event; restricted auditor access; hash-chain or signed batch export to immutable/WORM storage; clock synchronization; privileged-query audit; retention/legal-hold; scheduled review and anomaly alerts.
- **Closure evidence:** tamper attempts denied/detected, export verification, access review, and sampled end-to-end event reconciliation.

### PRR-020 — Data lifecycle and cryptographic key operations are not deployed (P1)

- **Evidence:** privacy/retention route foundations and posture variables exist, but no production KMS alias/resource, key policy, rotation, encrypted backup, deletion execution, legal hold, or data inventory evidence exists.
- **Risk:** PHI may be retained, deleted, restored, or decrypted inconsistently.
- **Remediation:** authoritative data inventory/classification; purpose and retention matrix; KMS hierarchy and separation of duties; rotation/revocation; encrypted database/storage/backups; deletion propagation; legal hold; export; media/AI/provider lifecycle; cryptographic erasure where applicable.
- **Closure evidence:** lifecycle tests across primary, replicas, backups, caches, search, object storage, provider records, and audit exceptions.

### PRR-021 — AI/STT is simulator-only and has no approved production data path (P1 if enabled)

- **Evidence:** live AI/STT keys, endpoints/model approvals, residency, no-training/no-retention contract evidence, and live evaluation were absent. CP8 correctly kept clinical application deferred.
- **Risk:** PHI disclosure, hallucinated clinical content, unreviewed record mutation, uncontrolled cost, and irreproducible output.
- **Remediation:** keep feature unreachable until CP16 approves provider/legal/data path; gateway with allowlisted models/regions, data minimization, consent, retention controls, prompt/version provenance, structured schemas, safety/effectiveness evals, monitoring, kill switch, cost limits, and mandatory clinician review/signature. AI never signs or autonomously prescribes/bills/messages.
- **Closure evidence:** approved DPIA/vendor terms, E4 red-team/eval thresholds, human factors test, consent/revocation, failure/fallback, and audit provenance.

### PRR-022 — FHIR/ABDM interoperability is a projection foundation, not a live workflow (P1 if enabled)

- **Evidence:** FHIR package/fixtures exist; no live FHIR API route is claimed and ABDM credentials/approvals are absent.
- **Risk:** overstating interoperability can create clinical/legal expectations; partial exports can be incomplete or misidentified.
- **Remediation:** implement and validate only a selected complete export/exchange scope; terminology/profile validation; patient matching; consent; provenance; idempotency; retry/reconciliation; authorized official ABDM sandbox/production path. Otherwise keep the workflow wholly unavailable.
- **Closure evidence:** official validator and sandbox results, round-trip reconciliation, negative consent/identity tests, and signed clinical review.

### PRR-023 — No physical-device distribution or mobile release controls exist (P1)

- **Evidence:** web export/shell tests exist, but no signed TestFlight/internal Android build, device matrix, crash reporting, OTA policy, certificate/key custody, or store privacy declaration evidence was found.
- **Risk:** a browser representation can hide native permission, storage, background, networking, and update failures.
- **Remediation:** EAS/release pipeline with environment separation, signing-key custody, internal distribution, minimum OS/device matrix, crash/ANR monitoring, safe update/rollback policy, jailbreak/root posture decision, privacy manifests, and support diagnostics.
- **Closure evidence:** signed builds installed and exercised on representative physical devices under degraded network and permission states.

### PRR-024 — SLOs, capacity, resilience, and incident operations are not validated (P1)

- **Evidence:** target posture and load scripts exist, but no deployed baselines, error budgets, realistic capacity model, chaos/fault tests, on-call schedule, or incident exercise evidence exists.
- **Risk:** the first clinic may discover unacceptable latency, queue backlog, provider saturation, or recovery behavior during care.
- **Remediation:** define critical user journeys and SLIs; availability/latency/freshness/durability SLOs; capacity and cost model; realistic load data; dependency fault/latency tests; autoscaling; queue backpressure; graceful degradation; incident severity/comms; game days.
- **Closure evidence:** E4/E5 load and fault reports, alert-to-runbook exercise, capacity headroom, and approved error budgets.

### PRR-025 — CP10 documentation overstates readiness when read without its caveats (P1 governance)

- **Evidence:** historical reports say repository gates passed and classify multiple production controls as accepted external gaps, while current audit reproduced failing tests, zero database tables, and a failing live smoke. The old go-live checklist allowed synthetic restore dry-run evidence.
- **Risk:** a future operator may authorize PHI or provider traffic based on obsolete fixture evidence.
- **Remediation:** preserve CP10 as historical evidence, add superseded notices, establish this register and the evidence standard as current truth, and make go-live require live environment evidence. No external hard gate may be waived by relabeling it an “accepted gap.”
- **Closure evidence:** documentation consistency scan and release decision signed against the current revision.

### PRR-026 — Dependency/runtime activation state is not consistently represented (P2)

- **Evidence:** simulator, unconfigured, registered-unavailable, and live states appear across providers and UI but are not governed by one deploy-time capability registry with authoritative health and activation evidence.
- **Risk:** configured credentials may be mistaken for a usable integration; missing registration may be debugged as permissions/runtime.
- **Remediation:** provider/capability registry with states `absent`, `registered`, `configured`, `sandbox_verified`, `production_verified`, `degraded`, `disabled`; activation prerequisites; last verified time; owner; health; UI/API exposure rules. Diagnose registration/discovery first, then permissions/runtime.
- **Closure evidence:** automated state-transition tests and operations surface matching provider-side truth.

### PRR-027 — Outbox and Temporal durability are not proven against real persistence (P1)

- **Evidence:** workflow/outbox models and local services exist, but fixture repositories bypass durable persistence and no full transaction-to-worker recovery evidence was demonstrated on the empty local database.
- **Risk:** lost/duplicated messages, stuck clinic workflows, or state divergence after crashes.
- **Remediation:** atomic domain-write/outbox transaction; relay ownership/lease; idempotent consumers; Temporal workflow/activity retry policies; poison handling; replay authorization; versioning; queue age SLO; restart and failover recovery.
- **Closure evidence:** kill-after-commit, duplicate delivery, worker restart, Temporal replay/version, dead-letter and reconciliation tests at E3/E4.

### PRR-028 — Runtime validation and mass-assignment defenses are inconsistent (P2)

- **Evidence:** the CP12 candidate has authoritative strict path/query/header/body and response schemas for all 128 operations, generated contract coverage, unknown/prototype-key rejection, bounded request complexity and a stable central error taxonomy. Deterministic, socket and browser evidence passes; the externally authorized dependency audit and promotion remain pending (`docs/qa/checkpoint-12-evidence.md`).
- **Risk:** invalid or attacker-controlled fields can cross authorization/domain boundaries or cause denial of service.
- **Remediation:** deny-by-default runtime schemas generated into OpenAPI; strip/reject unknown keys; explicit command DTOs; stable error taxonomy; pagination/query budgets; validation before domain use; output schemas/redaction.
- **Closure evidence:** generated negative corpus/fuzz tests for every public operation and contract coverage gate.

### PRR-029 — Build/check scope is polluted by optional untracked research files (P3)

- **Evidence:** the root Prettier glob includes `scripts/**/*.{js,mjs}` (`package.json:20-21`); optional user-owned `scripts/research/` files caused `npm run check` failure during the audit.
- **Risk:** release gates become non-reproducible and developers may delete unrelated research to get green.
- **Remediation:** define tracked product formatting scope or explicit ignore policy; keep research artifacts outside release gates unless promoted intentionally; CI starts from a clean checkout.
- **Closure evidence:** clean-clone and dirty-worktree checks behave predictably without touching user-owned files.

### PRR-030 — Real-clinic governance and human acceptance are absent (P1 external gate)

- **Evidence:** no approved real-clinic data use, data processing agreement, configured clinic policy set, staff training completion, clinical safety sign-off, support rota, or pilot authorization was demonstrated.
- **Risk:** technically functioning software can still be illegal, unsafe, or unusable in the real workflow.
- **Remediation:** named controller/processor roles; contracts and privacy notices; clinic configuration and data migration sign-off; role roster; consent wording; downtime/manual fallback; training; support/escalation; clinical and privacy approval; limited rollout and stop criteria.
- **Closure evidence:** signed go-live record with clinic, security/privacy, clinical safety, operations, and engineering approvers plus E6 observed workflow evidence.

## 4. Finding-to-Checkpoint Traceability

| Finding                                      | Priority | Default owner | Current status                                                            | Production gate            |
| -------------------------------------------- | -------- | ------------- | ------------------------------------------------------------------------- | -------------------------- |
| PRR-001 migrations/database                  | P1       | CP11          | Partial: E3 local closed; E4/E5 open                                      | Hard                       |
| PRR-002 deterministic time/tests             | P1       | CP11          | Closed at E3                                                              | Hard                       |
| PRR-003 live smoke runtime IDs               | P1       | CP11          | Partial: E3 closed; E4 open                                               | Hard                       |
| PRR-004 native capture                       | P1       | CP16          | Open                                                                      | Hard if mobile enabled     |
| PRR-005 encrypted durable mobile cache       | P1       | CP16          | Open                                                                      | Hard if mobile enabled     |
| PRR-006 deployable cloud                     | P1       | CP14          | Open                                                                      | Hard                       |
| PRR-007 telemetry/alerts                     | P1       | CP14          | Open                                                                      | Hard                       |
| PRR-008 official provider activation         | P1       | CP15          | Open                                                                      | Hard for enabled provider  |
| PRR-009 production media                     | P1       | CP14          | Open                                                                      | Hard for media workflow    |
| PRR-010 truthful readiness                   | P1       | CP11          | Partial: local dependencies closed; deployed admission open               | Hard                       |
| PRR-011 real TypeScript checking             | P2       | CP11          | Closed at E3                                                              | Hard                       |
| PRR-012 modular API/generated contracts      | P2       | CP12          | Candidate implemented; external audit and promotion pending               | Hard                       |
| PRR-013 web/edge security policy             | P2       | CP14          | Open                                                                      | Hard                       |
| PRR-014 durable clinic day                   | P1       | CP13          | Open                                                                      | Hard                       |
| PRR-015 live backup/restore/failover         | P1       | CP14          | Open                                                                      | Hard                       |
| PRR-016 production identity/session          | P1       | CP14          | Open                                                                      | Hard                       |
| PRR-017 rate/resource/abuse control          | P2       | CP12/CP14     | Partial: CP12 local evidence passes; CP14 edge/load evidence remains open | Hard                       |
| PRR-018 vulnerability management             | P1       | CP14/CP17     | Open                                                                      | Hard                       |
| PRR-019 immutable audit/privileged access    | P1       | CP14          | Open                                                                      | Hard                       |
| PRR-020 lifecycle/cryptographic operations   | P1       | CP14          | Open                                                                      | Hard                       |
| PRR-021 approved AI/STT path                 | P1       | CP16          | Open                                                                      | Hard if AI enabled         |
| PRR-022 live FHIR/ABDM scope                 | P1       | CP16          | Open                                                                      | Hard if enabled            |
| PRR-023 mobile release/device controls       | P1       | CP16          | Open                                                                      | Hard if mobile enabled     |
| PRR-024 SLO/capacity/resilience/incident ops | P1       | CP14/CP17     | Open                                                                      | Hard                       |
| PRR-025 accurate readiness governance        | P1       | Docs/CP11     | Partial: CP10 corrected; production approvals open                        | Hard                       |
| PRR-026 capability activation registry       | P2       | CP11/CP15     | Partial: repository/auth modes truthful; provider registry open           | Hard for enabled providers |
| PRR-027 outbox/Temporal durability           | P1       | CP11/CP13     | Partial: Postgres outbox/worker closed; Temporal reconciliation open      | Hard                       |
| PRR-028 runtime validation/mass assignment   | P2       | CP12          | Candidate implemented; external audit and promotion pending               | Hard                       |
| PRR-029 release-check scope hygiene          | P3       | CP11          | Closed at E3                                                              | Check reproducibility      |
| PRR-030 real-clinic governance               | P1       | CP17          | Open                                                                      | Hard                       |

“Hard if enabled” means the workflow may be removed whole from the selected release. It does not permit an accessible partial route, hidden control, simulator, or manual state masquerading as provider-confirmed behavior.

### CP11 E3 status delta — 2026-07-09

Result commit: `a6109bb`. Evidence: `docs/qa/checkpoint-11-evidence.md`. Threat delta:
`docs/security/checkpoint-11-threat-model-delta.md`.

- PRR-002, PRR-011 and PRR-029 are closed for their CP11 E3 scope: deterministic critical-path
  time, real compiler coverage, and research-safe release checks pass.
- PRR-001 is not production-closed by a local migration runner. Clean local bootstrap, checksums,
  locking, failure rollback, 96 forced-RLS tenant tables, and migrator/runtime/worker separation pass;
  staging migration and restore-to-new-database remain required.
- PRR-003 passes twice against local durable PostgreSQL with runtime-discovered IDs and fixture
  repository fallback detection. E4 staging identity and data evidence remains open.
- PRR-010 passes bounded Postgres and Keycloak loss/recovery locally. Deployed load-balancer and
  production dependency evidence remains open.
- PRR-025 now keeps CP10 historical and the release NO-GO. Named human approval remains absent.
- PRR-026 truthfully distinguishes local auth/repository modes, but official provider capability
  registration remains CP15.
- PRR-027 now has atomic domain/audit/outbox commits plus a least-privilege durable worker with
  persisted attempt/retry/dead-letter evidence and healthy process restart. Temporal workflow
  crash/replay/reconciliation remains CP13.

Tooling gates not converted to accepted gaps: Terraform is not installed; Docker Scout is installed
but not authenticated; container/IaC scan evidence therefore remains open. CycloneDX npm SBOM,
high-severity npm audit and tracked-file secret scan pass. No physical-device, provider sandbox,
cloud apply, live restore, alert-delivery or real-clinic evidence exists.

## 5. Remediation Dependency Order

```text
PRR-002/003/011/025/029 evidence integrity
  -> PRR-001/010/016/017/027/028 durable platform truth
  -> PRR-012/014 canonical durable clinic workflows
  -> PRR-006/007/009/013/015/018/019/020/024 cloud and security operations
  -> PRR-008/021/022/026 provider and interoperability activation
  -> PRR-004/005/023 native mobile
  -> PRR-030 controlled clinic validation and production decision
```

Security work is not postponed until the cloud checkpoint. Every checkpoint must satisfy its applicable controls, threat cases, tenant-negative tests, audit, observability, and rollback requirements.

## 6. Scope Discipline

The following are valid outcomes for an optional workflow:

- implement it completely and meet its evidence tier; or
- keep it unregistered/unreachable in production, show an honest unavailable state where necessary, and record the future activation gate.

The following are not valid outcomes:

- using a fixture as production data;
- accepting a simulator as live-provider evidence;
- creating a weak compatibility route to satisfy an old test;
- marking a failed hard gate as an accepted gap;
- shipping a provider credential without registration and callback verification;
- enabling AI, media, mobile, FHIR, ABDM, payment, or messaging paths partially.

## 7. Current Release Decision

ClinicOS may continue local development with synthetic data. It must not accept real PHI, real payments, live patient messages/calls, or production clinical reliance until the relevant P1 findings are closed and the production go-live checklist is signed. The first executable unit is CP11 in `docs/implementation/CHECKPOINT_11_VERIFICATION_AND_DURABLE_DATA_FOUNDATION.md`.
