# Pilot Support And Admin Runbook

Date: 2026-07-07

Status: Draft CP10 support runbook

Scope: support and admin operations for a selected ClinicOS release-candidate
pilot

This runbook coordinates CP10 support response. It does not activate providers,
create cloud resources, authorize live ABDM exchange, or approve real PHI in
local/dev tooling.

## Support Roles

| Role                  | Owns                                                                    | Must not do                                                    |
| --------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| Pilot operator        | Clinic-side go/no-go, workflow scope, staff communication.              | Approve unsafe technical shortcuts or unscoped real-data use.  |
| Support lead          | Incident intake, triage, escalation, and support log.                   | Print secrets, expose PHI, or mutate data without evidence.    |
| Release lead          | Release status, rollback/degraded-mode decision, final report evidence. | Claim readiness before gates pass.                             |
| Data/privacy reviewer | PHI handling, exports, retention, deletion, break-glass evidence.       | Allow real data in fixtures/screenshots/logs without approval. |
| Provider owner        | Official provider activation and dashboard evidence.                    | Treat simulator/local contract success as live provider proof. |

## Incident Severity

| Severity | Examples                                                                                                             | Initial response target | Required action                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------: | ----------------------------------------------------------------------------------------- |
| P0       | PHI exposure, cross-tenant access, unsafe clinical/payment state, data loss, backup failure during real pilot.       |               Immediate | Stop affected workflow, preserve evidence, notify release lead and data/privacy reviewer. |
| P1       | Clinic-day workflow blocked, expected live provider unavailable, worker/API outage, payment reconciliation mismatch. |                  15 min | Switch to approved manual fallback, inspect health/dead letters, assign owner.            |
| P2       | Role-specific issue, degraded performance, confusing unavailable state, non-blocking E2E regression.                 |                 4 hours | Triage with layer order, record workaround only if safe and clinic-approved.              |
| P3       | Documentation/training gap, cosmetic issue, minor copy mismatch.                                                     |       Next review cycle | File follow-up; do not interrupt clinic operations.                                       |

## Intake Checklist

Collect safe evidence only:

- timestamp and environment;
- clinic/tenant scope, if safe to record;
- affected role and workflow;
- URL/path, request id, correlation id, or audit id if visible;
- screenshot with PHI redacted or synthetic-only data;
- exact error/unavailable text;
- whether a provider was expected live, simulator, unavailable/manual, or
  deferred;
- whether manual fallback was used;
- patient-impact note without patient-identifying details.

Do not collect or paste:

- provider tokens, API keys, webhook secrets, AWS credentials, database URLs, raw
  object keys, signed URLs, ABHA identifiers, or real patient identifiers;
- raw provider dashboard screenshots containing secrets;
- unapproved real PHI in issue trackers or Markdown docs.

## Layer-Order Triage

For missing, unavailable, or unlisted behavior, diagnose in this order:

1. Registration/discovery/install state: route registered, app surface present,
   provider configured, handler registered, environment parsed, feature included
   in pilot scope.
2. Official activation flow: signed webhook URL, dashboard callback status,
   account id, template approval, clinic-approved manual import/export path, or
   documented deferred state.
3. Permissions/runtime: role, tenant/clinic scope, auth session, worker health,
   provider outage, DNS/network, dead letters, database, or rate limits.

Do not spend time debugging runtime credentials for a provider that is
intentionally simulator, unconfigured, or outside pilot scope.

## Common Playbooks

### Provider Not Configured Or No Key

1. Check whether the provider is expected live in the go-live checklist.
2. Read provider-health evidence if available: `GET /v1/provider-health`.
3. If not expected live, leave the product in unavailable/manual mode and record
   the deferred state.
4. If expected live, confirm official activation and secret loading without
   printing values.
5. Use clinic-approved manual fallback for patient operations.

### Payment Reconciliation Mismatch

1. Treat as P0/P1 depending on patient impact.
2. Freeze automatic reconciliation for the affected payment path.
3. Preserve invoice id, payment request id, provider event id, audit id, and
   redacted operator notes.
4. Verify Razorpay or manual evidence from official source only.
5. Do not mark paid/provider-paid from UI acknowledgement alone.

### Dead-Letter Or Replay Request

1. Review tenant/clinic scope and idempotency key.
2. Preserve the dead-letter payload reference without exposing PHI/secrets.
3. Request replay only through the implemented admin workflow.
4. Treat replay as request evidence; wait for handler/provider confirmation
   before marking downstream workflow state complete.

### AI Scribe Or Clinical Draft Concern

1. Confirm consent state and role authorization.
2. Treat AI output as draft/review-only unless a later human sign-off workflow
   applies it.
3. If unsupported or unsafe content appears, stop clinical application and record
   the review decision.
4. Do not use live AI/STT providers unless activation, retention, and
   data-residency approvals are recorded.

### ABDM Or FHIR Question

1. Explain that CP9/CP10 evidence is projection/readiness only unless master
   records live ABDM activation.
2. Do not attempt live ABDM exchange without credentials, patient consent,
   facility/provider activation, and compliance sign-off.
3. For export questions, use approved patient export/privacy workflows and
   redacted evidence only.

### Backup, Restore, Or DR Concern

1. Follow `backup-restore-drill.md` for synthetic restore evidence.
2. Follow `disaster-recovery.md` for DR posture and failover principles.
3. Do not run destructive restore, Terraform apply, or live failover without
   human approval and an isolated target.

### User Cannot See A Workflow

1. Confirm the surface is in CP10 pilot scope and registered in navigation.
2. Confirm role and tenant permissions.
3. Confirm whether the feature is intentionally unavailable/deferred.
4. Only then inspect runtime errors or API failures.

## Degraded Mode

When a workflow is unsafe or unavailable:

- keep ClinicOS available for unaffected workflows only;
- use clinic-approved manual fallback for the affected workflow;
- record who approved the fallback and how it will be reconciled;
- preserve audit/outbox/dead-letter evidence before retries;
- do not bulk replay, backfill, or delete data during an active incident without
  release lead approval.

## Escalation Paths

| Escalate to            | When                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Release lead           | Any P0/P1, rollback decision, release gate failure, or unsafe product behavior.          |
| Data/privacy reviewer  | PHI exposure, export/deletion/retention/break-glass question, real-data approval.        |
| Provider owner         | Expected live provider degraded/unavailable, webhook activation, template/account issue. |
| Clinic owner           | Patient-impacting interruption, manual fallback approval, pilot scope change.            |
| Engineering lane owner | Reproducible product bug with route, test, or source evidence.                           |

## Support Log Template

| Field                   | Value            |
| ----------------------- | ---------------- |
| Incident id             | Pending          |
| Severity                | Pending          |
| Opened at               | Pending          |
| Environment             | Pending          |
| Clinic/tenant scope     | Pending/redacted |
| Workflow                | Pending          |
| Affected role           | Pending          |
| Evidence links          | Pending          |
| Provider expected live? | Pending          |
| Manual fallback used?   | Pending          |
| Owner                   | Pending          |
| Status                  | Pending          |
| Closeout notes          | Pending          |
