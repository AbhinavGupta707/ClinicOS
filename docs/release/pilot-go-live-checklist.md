# ClinicOS Pilot-Production Go-Live Checklist

**Date:** 2026-07-09
**Status:** Active hard-gate checklist
**Current decision:** **NO-GO**
**Decision owners:** Clinic owner, ClinicOS engineering release lead, security/privacy lead, clinical safety lead and operations/support lead

This checklist supersedes the 2026-07-07 CP10 draft. Synthetic dry-runs and fixture browser evidence cannot satisfy production hard gates. Every in-scope gate must pass for the exact revision and environment. If an optional workflow cannot pass, remove it completely from production registration/routes/navigation/configuration and preserve a safe complete manual workflow; do not waive the gate.

## 1. Entry Criteria

Do not schedule go-live until:

- CP11-CP16 are complete for the selected pilot scope;
- the remediation register has no open in-scope P0/P1 and no boundary-bypassing P2;
- the exact pilot-prod artifact/config is frozen and traceable;
- E5 synthetic pilot-prod rehearsal is complete;
- external provider, clinic and data authorities required for the selected scope are available;
- an independent penetration test is complete and release-blocking findings are closed.

## 2. Technical Hard Gates

| Gate                      | Go condition                                                                                                                                        | No-go trigger                                                                                             | Required tier/evidence  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------- |
| Revision and supply chain | Reviewed revision; lockfile; scans; SBOM; signed/provenanced artifact built once and promoted through environments.                                 | Unreviewed/rebuilt artifact, critical/high unaccepted finding, expired exception, unsigned image.         | E5 CI/artifact record.  |
| Repository gates          | Check, real TypeScript typecheck, lint, full tests, build, secret/SCA/SAST/IaC/container/license gates pass with zero unexplained skips.            | Any failing/skipped required gate or syntax-only TypeScript check.                                        | E1 plus exact revision. |
| Database and migrations   | Clean migration history/checksums, least-privilege roles, RLS inventory, staging/pilot-prod migration rehearsal and forward-fix/rollback plan.      | Drift, failed/dirty history, runtime schema privilege, untested data transform or missing backup.         | E4/E5.                  |
| Tenant/role safety        | Every tenant-owned operation and table has API authorization and RLS negative evidence; role matrix, MFA, revocation and break-glass pass.          | Cross-tenant access/existence leak, stale privilege, missing privileged audit.                            | E4/E5.                  |
| Durable clinic day        | Selected lead-to-continuity workflows pass through real repositories, outbox/Temporal, generated clients and UI without fixture fallback.           | Fixture/simulator data used as source of truth, stale route, unreconciled state or fake completion.       | E4/E5.                  |
| API/web boundary          | Runtime schemas, idempotency/concurrency, bounded requests, rate limits, strict CORS/origin/CSRF, CSP/security headers and PHI cache controls pass. | Bypass, mass assignment, wildcard credentialed CORS, missing deployed policy or unbounded expensive path. | E4/E5.                  |
| Cloud/IAM/network         | Terraform-applied inventory matches plan; private data paths, KMS/Secrets, least IAM/network, WAF/TLS/DNS, CI OIDC and drift protection pass.       | Public DB/storage, manual untracked resource, broad production identity, missing encryption or drift.     | E5.                     |
| Media                     | Private S3/KMS upload, validation, quarantine/scan, signed access, audit, lifecycle/deletion and tenant denial pass.                                | Local simulator, public/raw object access, unscanned media or leaked key/path.                            | E4/E5.                  |
| Telemetry and alerts      | PHI-safe correlated logs/metrics/traces, SLO dashboards, security/provider/queue/DB/backup alerts and real paging route pass.                       | Console-only telemetry, alert not delivered, PHI/secret leakage or no owner/runbook.                      | E5 alert injection.     |
| Backup and recovery       | Automated backup/PITR/cross-region copy is healthy; timed restore and failover/failback meet approved RPO/RTO and application reconciliation.       | Synthetic dry-run only, failed backup, untested restore, unmet RPO/RTO or destructive ambiguity.          | E5 live drill.          |
| Load and resilience       | Critical journeys meet latency/availability targets under approved peak/headroom; dependency faults, backpressure and recovery pass.                | Queue runaway, noisy-tenant failure, data loss/duplication or unsafe degraded state.                      | E4/E5.                  |
| Vulnerability/security    | Independent penetration test and authenticated security checks complete; blocking findings closed; residual risk signed.                            | Open P0/P1 or high boundary risk; no independent test.                                                    | E5 report.              |

## 3. Provider and Boundary Gates

Complete only the rows enabled for the pilot.

| Capability    | Go condition                                                                                                                                                                   | No-go trigger                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Meta WhatsApp | Official app/account approved; HTTPS callback registered; challenge/signature, template, consent/opt-out, send/status, retry/replay/reconciliation pass.                       | Credential-only/simulator evidence, unsigned route, missing opt-out or invented delivery/read state. |
| Razorpay      | Official account/mode; HTTPS callback registered; raw signature, invoice/amount match, duplicates/order/retry/refund/dispute reconciliation pass.                              | Static/manual payment marked provider-paid, missing URL/signature/reconciliation.                    |
| Telephony     | Official account/API/callback, event validation, missed-call matching/ambiguity and reconciliation pass.                                                                       | Scraping, invented callback or silent patient mislink.                                               |
| Native mobile | Signed internal iOS/Android builds; camera/audio permissions, consent, encrypted offline queue, revoke/purge, poor network and physical-device matrix pass.                    | Web-only smoke, memory cache, plaintext PHI/token or untested devices.                               |
| AI/STT        | Approved vendor/region/terms/no-training-retention posture; consent, data minimization, eval thresholds, human review, provenance, kill switch and cost/failure controls pass. | Unapproved PHI path, no evals, autonomous clinical finalization or missing consent.                  |
| FHIR/ABDM     | Selected scope has official validator/sandbox, identity/consent/provenance/retry/reconciliation and compliance approval.                                                       | Fixture projection represented as live exchange or incomplete national-profile claim.                |

Disabled capabilities must be unreachable and honestly unavailable. Manual fallbacks cannot fabricate provider-confirmed state.

## 4. Clinic, Privacy and Clinical Safety Gates

| Gate                         | Required evidence                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal/data roles             | Executed clinic agreement/DPA; controller/processor and subprocessor responsibilities; approved privacy notices and contact/escalation.                    |
| Data inventory and lifecycle | Purpose, classification, access, retention, deletion/legal hold, export and backup exception matrix approved.                                              |
| Clinic configuration         | Facility, timezone/hours, roles, appointment types, pricebook/taxes, templates, consent versions, payment/provider modes and fallback procedures signed.   |
| Migration                    | Authorized source/export; dry run; patient matching/ambiguity queue; reconciliation totals; sampled clinical review; rollback and source-of-truth cutover. |
| Clinical safety              | Named clinical safety lead; signed workflow/hazard review; record sign/amend, prescription, wrong-patient, consent and AI boundaries exercised.            |
| Staff access                 | Named roster, least roles, MFA for privileged users, training completion, test login, offboarding and break-glass procedure.                               |
| Support/downtime             | On-call rota, severity matrix, contact channel, manual clinic continuity pack, data backfill/reconciliation and stop authority exercised.                  |
| Patient communication        | Approved templates, consent/opt-out, identity-safe content, response/escalation and outage behavior reviewed.                                              |
| Real data authorization      | Exact environment, data categories, users, date/window and permitted workflows approved before any PHI enters.                                             |

## 5. T-14 to T-7 Days

- Freeze intended pilot scope and explicitly list disabled workflows.
- Complete clinic configuration and migration rehearsal with synthetic or approved de-identified data.
- Complete E4 provider/device tests and remediate security/load defects.
- Run restore/failover and alert delivery; confirm results remain fresh for launch.
- Train role groups on the exact release and manual downtime workflow.
- Confirm provider dashboard registrations, callback domains/certificates and rotation owners without recording secrets in docs.
- Review remediation register and reject any documentation-only closure.

## 6. T-6 to T-2 Days

- Deploy the signed release candidate to pilot-prod using the production pipeline.
- Run E5 full synthetic clinic day for all in-scope roles and physical devices.
- Run tenant-negative, auth revocation, provider adversarial/retry, load/fault and privacy/security tests.
- Reconcile database, audit, outbox, Temporal, read models, provider state and dashboard totals.
- Review backup, alert, SLO, cost/capacity and support dashboards.
- Complete independent security, privacy and clinical safety review.
- Prepare rollback artifact/config and verify authority to invoke it.

## 7. T-1 Day Change Freeze

- Record git revision, artifact digest, Terraform state/plan, migration versions, config version and provider modes.
- Allow only reviewed release-blocking fixes followed by full invalidated evidence reruns.
- Confirm named on-call staff, clinic contacts, escalation bridge, decision log and stop conditions.
- Verify no real PHI in repository, fixtures, local volumes, CI output, screenshots or unrestricted telemetry.
- Confirm backups healthy and last restore/failover evidence within approved freshness.
- Obtain conditional technical signatures; clinic/real-data authorization remains required at go-live.

## 8. Go-Live Day

1. Hold clinic safety huddle: scope, disabled capabilities, manual fallback, stop authority and support channel.
2. Verify exact artifact/config/migrations and dependency readiness.
3. Run synthetic canary identity → appointment → encounter → billing/continuity plus provider/device checks.
4. Verify telemetry, alert route, backup status and audit/outbox/queue health.
5. Record all required signatures for the exact revision/environment.
6. Enable only the approved limited cohort/workflows.
7. Observe the first real workflow end to end with clinic staff and support present.
8. Reconcile clinical, financial, provider and audit state before expanding.
9. Stop/rollback on any no-go condition; do not debug through unsafe live use.

## 9. Immediate Stop/Rollback Conditions

- wrong patient, tenant disclosure or authorization bypass;
- lost, duplicated or silently altered signed clinical/financial state;
- unverified provider action represented as confirmed;
- consent failure or AI bypass of required review;
- database/audit/outbox divergence that cannot be reconciled promptly;
- backup/readiness/telemetry unavailable beyond the approved window;
- material PHI/secret exposure;
- severe latency/outage with unsafe manual fallback;
- staff cannot safely complete the selected workflow;
- security/privacy/clinical/clinic approver withdraws authorization.

Preserve evidence, disable affected capability/traffic, invoke clinic downtime, notify the incident owner, roll back application before attempting data changes, and use restore only through the approved destructive-action procedure.

## 10. Manual Fallback and Reconciliation

| Workflow                  | Safe fallback                             | Reconciliation requirement                                                                |
| ------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| Lead/appointment/queue    | Approved paper/phone/source log.          | Named staff backfill with source, original time and duplicate review.                     |
| Intake/consent            | Approved paper form.                      | Verify identity/consent version; scan/transcribe through audited workflow.                |
| Encounter/clinical record | Clinic downtime clinical record.          | Authorized clinician reconciles/signs additive record; never silently backdate/overwrite. |
| Dental/media              | Approved paper/existing imaging software. | Import only through validated private media/chart path with provenance.                   |
| Payment                   | Existing clinic payment process.          | Record manual evidence; provider-paid only from provider/reconciled proof.                |
| Messaging/recall          | Approved manual communication.            | Record request/action evidence; do not invent sent/delivered/read.                        |
| Lab/inventory/tasks       | Existing register/checklist.              | Backfill with source/operator/time and reconcile totals/status.                           |

## 11. Sign-Off

| Role                               | Name    | Decision | UTC/date | Revision/environment | Notes     |
| ---------------------------------- | ------- | -------- | -------- | -------------------- | --------- |
| Clinic owner                       | Pending | NO-GO    | Pending  | Pending              | Required. |
| Clinic doctor/clinical safety lead | Pending | NO-GO    | Pending  | Pending              | Required. |
| Clinic operations lead             | Pending | NO-GO    | Pending  | Pending              | Required. |
| ClinicOS engineering release lead  | Pending | NO-GO    | Pending  | Pending              | Required. |
| Security/privacy lead              | Pending | NO-GO    | Pending  | Pending              | Required. |
| Support/operations lead            | Pending | NO-GO    | Pending  | Pending              | Required. |

Final **GO** exists only when all rows are completed for the same revision/environment and every hard gate above passes. Until then, the authoritative decision remains **NO-GO**.
