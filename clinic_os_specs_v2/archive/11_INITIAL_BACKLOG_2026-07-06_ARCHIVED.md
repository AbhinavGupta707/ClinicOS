# 11 - Initial Engineering Backlog

**Date:** 2026-07-06

## Milestone A - Project foundation

- [ ] Create monorepo structure.
- [ ] Configure TypeScript, ESLint, Prettier.
- [ ] Configure Docker Compose: Postgres, Redis.
- [ ] Configure environment variables and secrets pattern.
- [ ] Add test framework.
- [ ] Add CI pipeline.
- [ ] Add OpenAPI generation with request/response schemas and auth/error conventions.

## Milestone B - Auth and tenancy

- [ ] Define tenant/clinic/user/role/permission schema.
- [ ] Implement login/session strategy.
- [ ] Implement tenant resolver.
- [ ] Implement RBAC guard.
- [ ] Implement audit log helper.
- [ ] Seed demo tenant, clinic, owner, doctor, assistant.
- [ ] Write tenant isolation tests.

## Milestone C - Patients and timeline

- [ ] Patient CRUD.
- [ ] Patient contacts/identifiers.
- [ ] Duplicate detection by phone/name.
- [ ] Patient timeline query/projection.
- [ ] Patient profile UI.
- [ ] Audit patient record view.

## Milestone D - Appointments and queue

- [ ] Appointment types.
- [ ] Provider schedule/chair configuration.
- [ ] Appointment CRUD.
- [ ] Appointment statuses.
- [ ] Check-in and queue.
- [ ] Assistant morning dashboard.

## Milestone E - Encounter and clinical notes

- [ ] Encounter lifecycle.
- [ ] Clinical note template.
- [ ] Draft note.
- [ ] Sign note.
- [ ] Amend signed note with reason.
- [ ] Prescription template and doctor sign-off workflow.

## Milestone F - Dental module

- [ ] Tooth numbering config.
- [ ] Odontogram UI.
- [ ] Dental findings CRUD.
- [ ] Treatment plan model.
- [ ] Estimate items.
- [ ] Dental chart history.

## Milestone G - Media/documents

- [ ] Upload URL endpoint.
- [ ] Object storage adapter.
- [ ] Media metadata and tagging.
- [ ] Patient media gallery.
- [ ] Signed URL access and audit.

## Milestone H - Billing/payments

- [ ] Pricebook.
- [ ] Invoice and invoice items.
- [ ] Manual payment recording.
- [ ] Payment provider interface.
- [ ] Mock payment provider.
- [ ] Razorpay adapter contract with signature verification, idempotency, retry, and reconciliation design.
- [ ] Payment webhook framework.

## Milestone I - Communication

- [ ] Conversation thread model.
- [ ] Message model.
- [ ] Template model.
- [ ] Provider interface.
- [ ] Mock WhatsApp provider.
- [ ] Webhook ingestion framework.
- [ ] Assistant inbox UI.

## Milestone J - Tasks, recalls, SOP

- [ ] Task model.
- [ ] Recall rule model.
- [ ] Recall due generator.
- [ ] SOP checklist templates.
- [ ] SOP recurring task generator.
- [ ] Event/incident diary.

## Milestone K - Analytics MVP

- [ ] KPI materialized queries.
- [ ] Owner dashboard UI.
- [ ] Appointments/no-shows.
- [ ] Revenue/dues.
- [ ] Recall performance.
- [ ] Treatment plan status.

## Milestone L - AI scaffolding

- [ ] AI jobs table.
- [ ] Transcript segment table.
- [ ] AI output table.
- [ ] Structured output schemas.
- [ ] Mock AI note generator.
- [ ] Review UI.
- [ ] AI consent enforcement.

## Milestone M - Security/compliance hardening

- [ ] MFA for privileged roles.
- [ ] Audit viewer.
- [ ] Data export endpoint.
- [ ] Retention policy jobs.
- [ ] PHI log redaction.
- [ ] Backup/restore runbook.
- [ ] Security tests.

## Milestone N - Pilot readiness

- [ ] Clinic onboarding wizard.
- [ ] CSV patient import.
- [ ] Template configuration.
- [ ] WhatsApp/payment sandbox credentials.
- [ ] Pilot monitoring dashboard.
- [ ] Training/demo data.
- [ ] Support/admin tools.


## v0.2 backlog additions

### P0 - Overlay and source attribution foundation

- Create `external_systems` and `external_accounts` schema.
- Create provider capability model.
- Create `external_entity_links` schema.
- Create `leads` and `attribution_touches` schema.
- Build lead inbox UI with source filters.
- Add source field to appointment creation.
- Add source attribution to invoice/revenue reporting.
- Build manual Practo booking entry flow.
- Build Google/direct booking source tracking with UTM parameters.
- Build missed-call lead creation interface gated by provider capability and source attribution.

### P0 - Migration foundation

- Create `migration_batches` and `migration_rows` schema.
- Build CSV upload for patients.
- Build CSV upload for appointments.
- Build duplicate detection for patients by phone/name/email.
- Build migration review UI.
- Mark imported records as imported/unverified.

### P0 - Workflow/action foundation

- Create `workflow_definitions` and `workflow_runs` schema.
- Create `action_proposals` and `approval_decisions` schema.
- Build approval inbox UI.
- Implement action executor for internal task creation.
- Implement action executor for draft WhatsApp message.
- Implement audit trail for proposal -> approval -> execution.

### P1 - Practo/Ray replacement support

- Build Ray-like appointment import template.
- Build Ray-like patient import template.
- Build source-of-truth policy UI.
- Build dashboard: revenue by source.
- Build dashboard: no-show by source.
- Build dashboard: recall revenue by source.

### P1 - Plena-style primitives

- Build trigger/condition/action workflow builder vertical slice.
- Add template workflow: fluoride varnish -> post-op instruction + six-month recall.
- Add template workflow: missed call -> callback task.
- Add template workflow: unpaid invoice -> payment reminder draft.
- Add template workflow: lab case due tomorrow -> assistant task.

### P1 - Agent harness

- Build agent proposal API.
- Build policy engine for approval requirements.
- Add lead triage agent.
- Add scheduling reply draft agent.
- Add recall message draft agent.
- Ensure clinical agents remain doctor-sign-off only.
