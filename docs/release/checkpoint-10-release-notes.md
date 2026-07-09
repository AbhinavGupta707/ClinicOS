# Checkpoint 10 Release Notes

> **Historical release-candidate notes (superseded 2026-07-09):** CP10 remains local/fixture regression context only. It is not a current pilot or production package. The current decision is **NO-GO** and the active release gate is `docs/release/pilot-go-live-checklist.md`, backed by the production readiness remediation register.

Date: 2026-07-07

Status: Historical CP10 draft; superseded for readiness claims

Release scope: release-candidate operations package for a selected pilot clinic

These notes are for operators, clinic leaders, and support staff preparing a
ClinicOS release-candidate pilot. They are not a production go-live claim until
the master integration pass fills the final evidence slots in
`docs/orchestration/CHECKPOINT_10_FINAL_REPORT.md`.

## Release Candidate Scope

Checkpoint 10 organizes the implemented dental-first clinic-day loop from prior
checkpoints into a release-candidate package for pilot evaluation:

- lead capture, patient match/create, appointment booking, queue, and day-start
  visibility;
- intake, consent, encounter start, clinical notes, prescriptions, and timeline
  evidence;
- dental finding charting, media upload lifecycle, chart snapshots, and mediated
  media access;
- treatment planning, invoice/payment request, manual payment evidence, receipt
  request, and patient instruction request;
- recalls, post-op and SOP tasks, lab case tracking, inventory events, incident
  diary, and owner dashboard foundations;
- provider-health, dead-letter replay request evidence, migration review,
  privacy/export/break-glass/retention foundations, FHIR projection helpers, and
  ABDM readiness status models;
- Expo mobile capture shell and AI scribe/review foundations with consent and
  human-review boundaries.

## Release Status

| Area                       | CP10 status                                                    | Required before pilot go-live                                                               |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Local/synthetic regression | Pending master evidence                                        | Full CP10 clinic-day regression and role matrix must pass.                                  |
| Browser/user smoke         | Pending master evidence                                        | Desktop and 390px mobile smoke for implemented CP10 surfaces must pass.                     |
| Production build           | Pending master evidence                                        | `npm run build` and release artifact review must pass after all lanes merge.                |
| Provider readiness         | Simulator/local only unless master records activation evidence | Keep provider actions unavailable/manual until signed webhook and provider evidence exists. |
| ABDM                       | Readiness-only                                                 | No live exchange until credentials, approvals, and compliance activation exist.             |
| AWS pilot-prod             | Validation-only unless explicitly approved                     | No Terraform apply or cloud mutation is claimed by this lane.                               |
| Mobile physical device     | Not claimed                                                    | Expo/local evidence is not physical-device distribution evidence.                           |
| GitHub/CI push             | Not claimed by this lane                                       | GitHub push and Actions checks must be recorded separately if used.                         |

## Operator-Visible Changes

- The release package now has an explicit pilot go-live checklist in
  `docs/release/pilot-go-live-checklist.md`.
- Role-based training tasks for owner, doctor, assistant, receptionist, and
  accountant are defined in `docs/training/pilot-training-flow.md`.
- Support and admin triage now has a pilot runbook in
  `infra/runbooks/pilot-support-admin.md`.
- Known risks and deferred whole workflows are tracked in
  `docs/release/known-risks-deferred-work.md`.
- Master closeout evidence belongs in
  `docs/orchestration/CHECKPOINT_10_FINAL_REPORT.md` and the QA evidence matrix
  in `docs/qa/checkpoint-10-evidence-matrix.md`.

## Safety Boundaries

- Do not enter real PHI into local/dev or training environments unless the
  clinic has explicitly approved a controlled pilot data flow and the environment
  has passed the go-live gates.
- Do not treat simulator provider success as live WhatsApp, Razorpay,
  telephony, AI/STT, Google, ABDM, or AWS readiness.
- Do not mark provider delivery, payment capture, AI output application, data
  export, or dead-letter replay as complete without durable provider or
  authorized human evidence.
- Use official APIs, signed webhooks, authorized exports/imports, or
  clinic-approved manual workflows. Do not depend on scraping or browser
  automation for clinic operations.

## Upgrade And Rollback Notes

- CP10 should be integrated on `codex/integration/checkpoint-10`; `main` remains
  the last verified checkpoint until master closes the gate.
- Persistent changes from other CP10 lanes must be reviewed for migration,
  audit, RLS, and rollback posture before go-live.
- Rollback is operational first: pause new ClinicOS writes, preserve audit and
  outbox evidence, switch the clinic to approved manual workflows, and only then
  decide whether code rollback, data restore, or provider deactivation is
  required.
- Database restore or cloud failover requires the backup/DR runbooks and human
  approval. This release note does not authorize destructive restores or
  Terraform apply.

## Documentation Links

- CP10 launch packet:
  `docs/orchestration/CHECKPOINT_10_RELEASE_CANDIDATE_PILOT_READINESS.md`
- Final report skeleton:
  `docs/orchestration/CHECKPOINT_10_FINAL_REPORT.md`
- Go-live checklist: `docs/release/pilot-go-live-checklist.md`
- Training flow: `docs/training/pilot-training-flow.md`
- Support/admin runbook: `infra/runbooks/pilot-support-admin.md`
- Risk register: `docs/release/known-risks-deferred-work.md`
- Provider alerting: `infra/runbooks/provider-health-alerting.md`
- Backup/restore: `infra/runbooks/backup-restore-drill.md`
- Disaster recovery: `infra/runbooks/disaster-recovery.md`
