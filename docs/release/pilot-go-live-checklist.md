# Pilot Go-Live Checklist

Date: 2026-07-07

Status: Draft checklist for master and pilot operator completion

Decision owner: pilot clinic owner plus ClinicOS release lead

This checklist is the release-candidate gate for a selected pilot clinic. A
pilot may only proceed when every hard gate is either passed with evidence or
explicitly removed from the pilot scope as a deferred whole workflow.

## Hard Go/No-Go Gates

| Gate                       | Go condition                                                                                                                                                     | No-go trigger                                                                                                        | Evidence location                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Repository checks          | `git diff --check`, `npm run check`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and `npm run security:secrets` pass after CP10 merge. | Any failing gate without an accepted non-product blocker.                                                            | `docs/orchestration/CHECKPOINT_10_FINAL_REPORT.md`        |
| Full clinic-day regression | Lead through owner dashboard passes with synthetic/simulator data and canonical route families.                                                                  | Regression skips an implemented workflow, uses stale routes, or treats fixture-only behavior as live.                | `docs/qa/checkpoint-10-evidence-matrix.md`                |
| Role and tenant safety     | Owner, doctor, assistant, receptionist, accountant, auditor/support, and platform/admin boundaries pass.                                                         | Unauthorized role can read/write PHI or cross-tenant records, or a required role cannot complete its owned workflow. | CP10 QA evidence                                          |
| Browser/mobile safety      | Desktop and 390px mobile smoke show reachable controls, no horizontal overflow, and honest loading/error/unavailable states.                                     | Primary controls unreachable, horizontal overflow, fake completion copy, or unsafe PHI exposure.                     | CP10 browser screenshots/spec output                      |
| Provider posture           | Every provider is either activated with official evidence, intentionally simulator/local, unavailable, or manual.                                                | UI or docs claim live delivery/payment/ABDM/cloud readiness without evidence.                                        | Provider-health evidence and risk register                |
| Backup/restore             | Synthetic restore dry-run evidence is current; live restore remains deferred unless separately approved.                                                         | Missing restore evidence or unresolved backup failure.                                                               | `infra/runbooks/backup-restore-drill.md` and final report |
| Migration/data             | Any CP10 migration dry-run or data import review passes, with no silent overwrite of verified records.                                                           | Migration changes lack rollback/evidence or overwrite source-attributed records.                                     | CP10 QA evidence                                          |
| Training                   | Role training checklist is completed by the pilot clinic team using synthetic/demo data first.                                                                   | Staff cannot complete their day-one tasks without unsafe workarounds.                                                | `docs/training/pilot-training-flow.md`                    |
| Support readiness          | Pilot support owner, escalation path, outage posture, and manual fallback are assigned.                                                                          | No named support owner or no incident channel for the pilot window.                                                  | `infra/runbooks/pilot-support-admin.md`                   |
| Real data authorization    | Real clinic data import/use is explicitly approved and scoped, or pilot stays synthetic/manual.                                                                  | Real PHI appears in fixtures, screenshots, logs, or local docs without authorization.                                | Pilot operator sign-off                                   |

## Timeline Checklist

### T-14 To T-7 Days

- Confirm pilot clinic scope, chairs/operators, working hours, appointment types,
  and launch window.
- Confirm whether the pilot uses synthetic-only data, approved real exports, or
  a clinic-approved manual backfill workflow.
- Collect clinic-approved pricebook, prescription templates, post-op
  instructions, recall templates, lab card examples, inventory list, consent
  language, and current payment/WhatsApp posture.
- Confirm provider mode for each integration: simulator, unavailable/manual,
  sandbox, or live. Do not configure dashboards until signed HTTPS callback
  routes exist.
- Assign release lead, support lead, data/privacy reviewer, and clinic owner
  approver.

### T-6 To T-2 Days

- Run master integration checks and record evidence in the final report.
- Run CP10 clinic-day regression and role matrix after all lane commits merge.
- Run browser/user smoke for desktop and 390px mobile.
- Run backup/restore dry-run evidence and review DR gaps.
- Train owner, doctor, assistant, receptionist, and accountant roles on synthetic
  data.
- Review known risks and remove from pilot scope any workflow without acceptable
  evidence.

### T-1 Day

- Freeze non-critical changes to the pilot release candidate.
- Confirm support rota, contact channel, incident severity definitions, and
  manual fallback supplies.
- Confirm provider dashboards remain disconnected unless official signed
  webhook evidence exists.
- Confirm clinic staff know which workflows are live in ClinicOS, which are
  manual, and which are not part of the pilot.
- Confirm no real PHI is in screenshots, fixture files, local logs, or docs.

### Go-Live Day

- Start with a clinic huddle: pilot scope, no-go conditions, manual fallback,
  support channel, and escalation owner.
- Run a short health check: web/API/worker readiness, provider-health read,
  support contact test, and manual fallback availability.
- Allow ClinicOS use only for the approved pilot workflows.
- Record every incident, manual fallback, provider outage, and data correction in
  the support log.
- Do not enable live providers, ABDM, cloud mutations, or physical-device
  distribution during the pilot window unless separately approved and recorded.

### T+1 To T+7 Days

- Review support tickets, dead letters, audit/security events, and manual
  fallback records daily.
- Reconcile manual actions back into ClinicOS only through approved workflows
  with source attribution and audit evidence.
- Compare owner dashboard metrics with clinic expectations and source records.
- Decide whether to expand, hold, or roll back the pilot scope.

## Rollback And Degraded Mode

Use this posture when a release issue blocks safe operation:

1. Stop expanding use of the affected ClinicOS workflow.
2. Preserve audit logs, outbox/dead-letter evidence, screenshots, and operator
   notes before retrying or reverting anything.
3. Switch to the clinic-approved manual workflow for the affected area.
4. Keep provider actions unavailable/manual unless official evidence confirms
   successful provider processing.
5. If code rollback is needed, roll back the application release before touching
   data.
6. If data restore is needed, follow `infra/runbooks/backup-restore-drill.md`
   and `infra/runbooks/disaster-recovery.md`; do not run destructive restore
   steps without human approval.

## Manual Fallbacks

Manual fallback is acceptable only when clinic-approved and later reconciled
with audit/source evidence.

| Workflow               | Safe fallback                                        | Reconciliation rule                                                                    |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Lead or missed call    | Manual phone/WhatsApp log outside ClinicOS.          | Backfill as manual source-attributed lead/patient/appointment when the system is safe. |
| Intake and consent     | Clinic paper form or assistant-entered history card. | Attach or transcribe only with patient consent and audit trail.                        |
| Dental chart and media | Doctor paper note or existing imaging software.      | Backfill findings/media only through CP4 durable media/chart routes.                   |
| Payment                | Existing clinic UPI/payment process.                 | Record manual payment evidence; never mark provider-paid without provider proof.       |
| Instructions/recalls   | Printed instructions or approved manual message.     | Record request/evidence; do not invent delivered/read provider state.                  |
| Lab/inventory/SOP      | Existing register or checklist.                      | Backfill tasks/events with source attribution.                                         |

## Sign-Off

| Role                   | Name    | Decision | Date    | Notes                                     |
| ---------------------- | ------- | -------- | ------- | ----------------------------------------- |
| Clinic owner           | Pending | Pending  | Pending | Required before pilot go-live.            |
| Clinic doctor lead     | Pending | Pending  | Pending | Required for clinical workflow scope.     |
| Clinic operations lead | Pending | Pending  | Pending | Required for assistant/reception flow.    |
| ClinicOS release lead  | Pending | Pending  | Pending | Required after evidence review.           |
| Data/privacy reviewer  | Pending | Pending  | Pending | Required before real PHI or real exports. |
