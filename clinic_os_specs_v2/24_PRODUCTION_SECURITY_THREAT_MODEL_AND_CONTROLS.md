# 24 — Production Security Threat Model and Controls

**Date:** 2026-07-09
**Status:** Canonical production security baseline
**Applies to:** Web, API, worker, mobile, data, cloud, providers, AI, interoperability, operations and delivery pipeline

## 1. Security Objective

ClinicOS must preserve patient safety, confidentiality, integrity, availability, tenant isolation, consent, clinical authorship, financial correctness and durable provenance through normal use, dependency failure, operator error and hostile activity. Compliance documentation cannot substitute for working technical controls and verified operations.

This document is a threat-informed engineering baseline, not a legal opinion. India privacy/health obligations, provider contracts and clinic policy require qualified legal and clinical review before production.

## 2. Protected Assets

| Asset | Primary harms if compromised |
|---|---|
| Patient identity, contact, demographics and source attribution | Privacy harm, fraud, stalking, cross-clinic disclosure. |
| Appointments, queue, consent and encounter context | Care disruption, wrong-patient action, invalid consent. |
| Signed notes, prescriptions, dental findings, plans and instructions | Direct clinical harm, attribution fraud, medico-legal loss. |
| Photos, X-rays, audio, transcripts and AI artifacts | Highly sensitive PHI disclosure, biometric/voice exposure, unsafe inference. |
| Estimates, invoices, payments and reconciliation | Financial loss, duplicate/incorrect payment state, fraud. |
| Credentials, sessions, signing keys, KMS keys and provider secrets | System-wide impersonation or decryption. |
| Audit, provenance, outbox and workflow histories | Loss of accountability, concealed tampering, irrecoverable divergence. |
| Availability, backups and recovery controls | Clinic downtime, permanent record loss, unsafe manual fallback. |
| Tenant configuration, roles and policy | Systematic cross-tenant or over-privileged access. |
| Build artifacts, source, dependencies and infrastructure state | Supply-chain compromise and persistent control-plane access. |

## 3. Trust Boundaries

1. Public internet to WAF/load balancer.
2. Browser/mobile device to application session/API.
3. Application to Keycloak and identity administration.
4. API/worker to PostgreSQL, Redis, Temporal and S3.
5. Tenant/clinic boundary inside shared services and tables.
6. API/worker to Meta, Razorpay, telephony, AI/STT and ABDM/FHIR peers.
7. Provider webhook sender to public callback endpoint.
8. Staff user to privileged/break-glass and export capabilities.
9. Developer/CI to source, artifacts, Terraform and production control plane.
10. Primary region to backup/DR region and immutable evidence store.
11. Mobile app sandbox to camera, microphone, filesystem, clipboard, notifications and OS backup.
12. Diagnostic telemetry to monitoring and support personnel.

No boundary is trusted solely because it is inside a VPC, uses a clinic identifier supplied by the client, or carries a previously authenticated event.

## 4. Threat Actors and Failure Sources

- unauthenticated internet attacker or bot;
- compromised patient-facing link/session;
- malicious or compromised staff account;
- over-privileged clinic owner, platform operator or developer;
- user from a different tenant manipulating identifiers;
- stolen, rooted/jailbroken or shared clinic device;
- spoofed/replayed/out-of-order provider webhook;
- compromised provider, dependency, container, build runner or package;
- prompt injection or malicious content entering AI workflows;
- operator/configuration/migration error;
- database, region, network or provider outage;
- ransomware, destructive insider or leaked backup;
- concurrency, retry, time-zone or clock failure causing silent business corruption.

## 5. Security Invariants

The following must always hold:

1. A request may access only a tenant/clinic for which the verified identity has active membership and the required capability.
2. A client-supplied tenant/clinic/user/price/payment/clinical-signature field never establishes authority.
3. Patient matching ambiguity creates a review queue; it never silently merges records.
4. Clinical drafts and AI outputs cannot become signed clinical truth without an authorized human signing action.
5. Signed records are amended through additive provenance, not destructive overwrite.
6. Consent is purpose-specific, versioned, attributable and checked at action time; revocation blocks future use.
7. Domain state, required audit and required outbox evidence commit atomically.
8. Duplicate/retried requests and callbacks cannot create duplicate clinical, financial or messaging effects.
9. PHI and secrets never appear in URLs, logs, traces, analytics, crash reports, filenames or client-accessible storage paths.
10. Production media is private, encrypted, validated, quarantined until safe and accessed only through short-lived mediated authorization.
11. Production dependencies failing causes bounded degradation or removal from readiness, not false success.
12. Backups are encrypted, access-controlled and restorable; deletion/legal hold behavior is explicit.
13. Fixtures, simulator headers and local credentials cannot activate in staging/pilot-prod/prod.
14. Every privileged, export, break-glass, reconciliation, replay and configuration action is attributable and reviewable.
15. External capability registration and official activation precede permissions/runtime diagnosis and exposure.

## 6. Threat and Control Matrix

| ID | Threat | Preventive controls | Detective/recovery controls | Required evidence |
|---|---|---|---|---|
| T01 | Cross-tenant object access/IDOR | Verified membership/capability, clinic context derived server-side, RLS, opaque IDs, scoped repositories. | Denied-access audit, anomaly alert, tenant test corpus. | Cross-tenant negative tests on every tenant-owned operation at E3/E4. |
| T02 | Role escalation or stale privilege | Keycloak groups/roles mapped to narrow capabilities, MFA, short sessions, revocation, JML process. | Role-change/session audit and access reviews. | Revocation, offboarding and role mutation tests. |
| T03 | Session/token theft | PKCE, secure HttpOnly web cookies, SecureStore mobile tokens, short TTL, rotation, TLS, no Web Storage. | Reuse/anomalous-login telemetry, remote revoke. | Cookie/token inspection and lost-device exercise. |
| T04 | CSRF, CORS or origin confusion | SameSite cookies, anti-CSRF token, strict origin/host checks, exact CORS allowlist, no wildcard credentials. | Rejected-origin audit/metrics. | Cross-site mutation and preflight negative tests. |
| T05 | XSS/clickjacking/content injection | React escaping, no unsafe HTML, CSP nonce/hash, Trusted Types evaluation, output encoding, frame-ancestors none. | CSP reports, dependency/SAST/DAST. | Deployed headers and browser injection tests. |
| T06 | Request injection/mass assignment/DoS | Runtime schemas, reject unknown fields, parameterized SQL, size/pagination/time limits, no shell interpolation. | Validation/error metrics and abuse alerts. | Negative corpus/fuzz tests for all public operations. |
| T07 | Webhook spoof/replay/reordering | Raw bounded body signature verification, timestamp/replay window, event-ID uniqueness, state machine, allowlisted provider config. | Invalid-signature/replay metrics, reconciliation jobs. | Official sandbox adversarial callback suite. |
| T08 | Duplicate clinical/financial effects | Idempotency keys, unique constraints, optimistic concurrency, transactional outbox, idempotent consumers. | Reconciliation and duplicate anomaly alerts. | Concurrent/retry/crash tests. |
| T09 | Wrong-patient association | Search normalization, confidence/ambiguity thresholds, human merge/link review, immutable merge provenance. | Duplicate/merge review reports. | Collision, typo and ambiguous-match tests. |
| T10 | Clinical record tampering | Narrow sign/amend permissions, immutable signed versions, strong attribution, server timestamps, append-only audit. | Tamper-evident export and periodic review. | Denied overwrite and provenance-chain verification. |
| T11 | AI unsafe action or data leak | Approved gateway/provider, minimum necessary PHI, consent, structured output, tool/action allowlists, human sign, no training/retention contract. | Evals, drift/safety monitoring, kill switch, complete provenance. | Red-team/eval thresholds and human-factors sign-off. |
| T12 | Media malware/exfiltration | Private S3/KMS, signed short TTL, magic-byte/type/size validation, quarantine scanner, tenant-scoped authorization. | Scan alerts, access logs, lifecycle reconciliation. | Cross-tenant, malicious file, expired URL and quarantine tests. |
| T13 | Mobile PHI leakage | Encrypted app-private files, secure keys/tokens, backup exclusion, TTL/purge, no screenshots/clipboard where policy requires, remote revoke. | Crash/redaction and device compliance telemetry. | Storage inspection, reboot/revoke/logout/lost-device tests. |
| T14 | Secret/key compromise | Secrets Manager, KMS least privilege, no committed/client secrets, rotation, CI OIDC, environment separation. | Secret scanning, key-use alerts, access reviews. | Rotation/revocation drills and policy tests. |
| T15 | Audit destruction or evasion | Append-only DB role, correction events, immutable signed/WORM export, synchronized clocks. | Integrity verification and privileged-query monitoring. | Tamper attempt and export verification. |
| T16 | Data over-retention or incomplete deletion | Data inventory, purpose/retention matrix, legal hold, cascade workflow, provider/backup exception policy. | Scheduled lifecycle reconciliation. | End-to-end retention/deletion/export test. |
| T17 | Backup loss/ransomware/region outage | PITR, isolated/cross-region immutable copies, separate credentials, deletion protection, tested runbooks. | Backup failure alerts and periodic restore/failover. | Timed RPO/RTO drill. |
| T18 | Dependency/service outage | Timeouts, retries with jitter, circuit breakers, backpressure, readiness, graceful unavailable/manual states. | SLOs, synthetic checks, queue/provider health. | Fault-injection and recovery tests. |
| T19 | Supply-chain/CI compromise | Pin/lock dependencies/actions/images, SCA/SAST/IaC/image scan, SBOM, provenance/signing, protected deploy approvals. | Artifact verification and audit logs. | Signed artifact promotion and compromised-build exercise. |
| T20 | Infrastructure misconfiguration | Terraform-only change, policy checks, private defaults, least IAM/network, drift detection, separate accounts. | Config/security monitoring and inventory. | Applied E4/E5 policy scan and drift test. |
| T21 | Denial of service/cost exhaustion | WAF/app/tenant rate limits, payload/query budgets, queue concurrency, AI/provider cost ceilings. | Rate/cost/backlog alerts. | Load/abuse/noisy-neighbor tests. |
| T22 | Unsafe privileged support/break-glass | Time-bound approval, reason/ticket, MFA, scope minimization, visible banner, full audit, post-review. | Immediate alert and mandatory review. | Approved and denied break-glass exercises. |
| T23 | Export/interoperability misdelivery | Explicit purpose/recipient, re-auth, encryption, expiry, consent, profile validation and provenance. | Download/access audit and reconciliation. | Wrong-recipient/expired/consent-negative tests. |
| T24 | False readiness or fixture leakage | Environment denylist, startup assertions, dependency probes, evidence tiers, immutable release decision. | Synthetic prod-header/capability alarms. | Production config rejects fixtures/simulators and failed dependencies. |

## 7. Required Control Baselines

### 7.1 Authentication and authorization

- Deny by default; controller UI visibility is never the security boundary.
- Central authorization policy maps identity, active membership, clinic, role/capability, resource relationship, purpose and workflow state.
- Privileged/platform access uses separate accounts, MFA and audited just-in-time elevation where feasible.
- Service identities are workload-specific and cannot impersonate humans silently.
- Support tooling redacts PHI by default and uses explicit audited access for patient-level detail.

### 7.2 Tenant isolation and database

- Tenant/clinic context is set transaction-locally after authorization; pooled connections are reset safely.
- RLS applies to every tenant-owned table and fails closed if context is missing.
- Foreign keys/unique constraints include tenant scope where cross-tenant collision is possible.
- Migration owner bypass is not used by application runtime.
- Tests enumerate every table and fail if a tenant-owned table lacks the required RLS/policy posture.

### 7.3 Web and API boundary

- TLS only; HSTS after domain readiness; secure canonical hosts.
- CSP, frame denial, MIME/referrer/permissions policy and PHI cache controls are tested at the deployed edge.
- Browser mutations use CSRF/origin protection if authenticated by cookies.
- API has schema validation, bounded bodies, pagination, query timeouts, consistent errors and request IDs.
- Sensitive error detail stays server-side, redacted; client responses do not reveal stack, SQL, bucket/key, token or provider secret.

### 7.4 Provider and webhook boundary

- Registration URL, verification/challenge, provider account, approved app/template/product state and credential rotation owner are inventory fields.
- Raw body is read once within a route-specific limit and verified before JSON parsing/business effects.
- Unique provider event ID and normalized business idempotency keys are persisted.
- Out-of-order statuses follow explicit monotonic/state-transition rules; reconciliation polls official APIs when supported.
- Replay requires narrow authorization, reason, rate limit, dry-run/preview where possible and full audit.

### 7.5 Files and media

- Direct-to-storage upload requires server reservation and scoped signed URL; completion verifies object metadata and ownership.
- Content type is not trusted from filename/header alone.
- Objects remain quarantined until scan success; scan failure never becomes accessible.
- Derived images/thumbnails inherit tenant, consent, retention and audit policy.
- Deletion handles active objects, versions/replicas, caches and backup policy without corrupting clinical/audit obligations.

### 7.6 AI/STT

- Provider contract and configuration explicitly address region, training, retention, subcontractors and incident notification.
- Prompts and model IDs are versioned; inputs/outputs/tool calls carry traceable provenance without leaking PHI to logs.
- Data is minimized/pseudonymized where possible. Audio consent is checked before capture and before processing.
- Structured schema validation and clinical safety rules precede human review.
- AI cannot directly sign notes, prescribe, bill, merge patients, release exports or send patient communications.
- Offline/unavailable/manual workflow is complete and safe.

### 7.7 Telemetry, audit and incident response

- Logs/traces/metrics use an explicit allowed-field schema and redaction tests.
- Audit records are a separate authoritative product record, not console logs.
- Alerts include tenant-safe context, severity, owner, runbook and escalation; they do not include PHI.
- Security events cover invalid auth/signatures, tenant denial anomalies, privileged actions, secret/key use, WAF abuse, export, replay, backup and audit-integrity failure.
- Incident runbooks define containment, evidence preservation, clinical downtime, notification decision, recovery, reconciliation and post-incident review.

### 7.8 Secure delivery

- Protected main/release controls; reviewed Terraform and migrations; CI uses OIDC and least privilege.
- Dependency lockfile, pinned actions/images, SCA, secret, SAST, IaC, container, license and SBOM scans.
- Artifacts are built once, signed/provenanced and promoted; deployment never rebuilds unreviewed source.
- Database migrations are forward compatible with rolling deployment or the release uses a controlled maintenance window and rollback/forward-fix plan.
- Security exceptions have owner, justification, compensating control and expiry; P1 release gates cannot be accepted by engineering alone.

## 8. Privacy and Clinical Safety Controls

- Record data purpose, lawful/contractual basis, notice/consent version and retention policy by category.
- Minimum necessary access and export; purpose-limited break-glass.
- Patient request workflows authenticate the requester and avoid deleting records subject to clinical/legal retention without governed disposition.
- Clinical record authorship, signing, amendment, co-sign and delegation are explicit.
- Medication/allergy/diagnosis validation assists but does not falsely claim medical-device-level decision support unless separately governed.
- Downtime procedures prevent silent backfill/merge; recovered paper/manual actions are reconciled with named staff and timestamps.
- Migration never overwrites ambiguous patient/clinical truth; exceptions enter a human resolution queue.

## 9. Verification Cadence

| Cadence | Required activity |
|---|---|
| Every change | Type/lint/unit/contract/security-negative tests; secret scan; generated contract and migration checks. |
| Every checkpoint | Threat/control delta, tenant suite, dependency scan, browser/device evidence for changed paths, operational/rollback review. |
| Every deployment | Signed artifact/config/Terraform diff, smoke, readiness, migration, synthetic journey and rollback readiness. |
| Monthly | Access and vulnerability review, restore/backup evidence review, provider/queue/SLO/cost review. |
| Quarterly | Restore/failover exercise, incident/game day, privileged access recertification, threat-model review. |
| Before pilot/major release | Independent penetration test, clinical/privacy/security review, load/fault test, real-device/provider validation and signed go-live. |
| After material incident/provider/model change | Targeted threat model, control/eval regression and approval before reactivation. |

## 10. Security Release Gate

Production is blocked when any of the following is true:

- an in-scope P0/P1 is open;
- a P2 allows boundary bypass, tenant uncertainty or unbounded PHI processing;
- required evidence is fixture-only;
- real dependency readiness, backup restore or alert delivery has not been tested;
- provider registration/signature/reconciliation is incomplete;
- native capture is enabled without encrypted durable storage and consent;
- AI is enabled without approved data path, evals and human sign-off;
- security scan or penetration findings exceed the approved threshold;
- clinic/privacy/clinical/operations approvers have not signed the exact revision and environment.

Wholly removing an optional capability from registration, routes, navigation and production configuration can remove its activation gate. Hiding a control while leaving an accessible route does not.
