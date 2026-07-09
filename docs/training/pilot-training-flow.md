# Pilot Training Flow

> **Pre-production draft (2026-07-09):** No pilot is authorized. This CP10-era flow may be reused only after CP17 updates it against the exact production workflows, roles, devices, fallback and current go-live checklist.

Date: 2026-07-07

Status: Historical draft requiring CP17 validation

Training data rule: start with synthetic data; real clinic data requires explicit
authorization and every gate in `docs/release/pilot-go-live-checklist.md`.

## Training Principles

- Train the real day-one workflow, not a tour of screens.
- Use role accounts and permissions that match pilot staff responsibilities.
- Stop and record any mismatch between training instructions and product
  behavior. Do not teach workarounds that bypass permissions, audit, consent, or
  provider evidence.
- Teach unavailable/provider no-key states as normal operating states, not as
  errors to force through.
- Teach manual fallback only when the clinic has approved it and reconciliation
  is clear.

## Session Plan

| Session                    | Audience                                                                   | Duration | Goal                                                                                   | Evidence                                                  |
| -------------------------- | -------------------------------------------------------------------------- | -------: | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Pilot scope briefing       | Owner, doctor lead, assistant lead, receptionist, accountant, support lead |   30 min | Confirm what is live, unavailable/manual, and deferred.                                | Signed scope note or final report sign-off.               |
| Front-desk day start       | Assistant, receptionist, owner observer                                    |   45 min | Lead, patient match, appointment, queue, check-in, source attribution.                 | Staff completes synthetic patient flow.                   |
| Clinical encounter         | Doctor, assistant                                                          |   60 min | Intake/consent, encounter, notes, prescription, dental chart/media.                    | Doctor signs only authorized clinical outputs.            |
| Checkout and instructions  | Receptionist, accountant, doctor observer                                  |   45 min | Treatment plan, invoice, payment request/manual payment, receipt, instruction request. | Accountant verifies finance view and denial boundaries.   |
| Continuity operations      | Assistant, owner                                                           |   45 min | Recall, lab, inventory, SOP tasks, event diary, owner dashboard.                       | Owner validates source-attributed dashboard expectations. |
| Support and fallback drill | All pilot staff plus support/admin                                         |   45 min | Provider unavailable/no-key, dead-letter review, manual fallback, escalation.          | Incident drill record and support contact test.           |

## Role Competency Checklists

### Owner

- Can open the owner dashboard and explain which metrics are source-attributed
  and synthetic/local versus live.
- Can identify provider-health statuses and distinguish simulator,
  `not_configured`, unavailable/manual, sandbox, and live.
- Can approve or reject pilot go-live based on the hard gates in
  `docs/release/pilot-go-live-checklist.md`.
- Can request a privacy/export/break-glass review only through authorized
  workflows.
- Can explain when the clinic must fall back to manual operations.

### Doctor

- Can review intake and consent state before starting an encounter.
- Can create/update dental findings and read chart/media evidence without seeing
  raw storage internals.
- Can draft/sign/amend clinical notes and prescriptions only where authorized.
- Can review AI scribe output as review-only evidence and avoid treating it as
  signed clinical truth until a human applies/signs a later workflow.
- Can stop the workflow if consent, PHI, provider, or role state is unsafe.

### Assistant

- Can capture a lead, match/create a patient, schedule an appointment, and manage
  queue/day-start flow.
- Can assist with intake/history and consent capture without bypassing patient
  consent state.
- Can help record dental/media evidence under doctor-supervised workflow.
- Can create recall, post-op, lab, inventory, SOP, and incident diary tasks where
  assigned.
- Can recognize no-key/provider-unavailable states and switch to the approved
  manual workflow without marking fake completion.

### Receptionist

- Can manage check-in, checkout handoff, invoice/payment request, receipt
  request, and patient instruction request.
- Can record manual payment evidence only when the clinic has actual payment
  evidence.
- Can explain why provider delivery/read/payment success is not marked complete
  without provider or authorized manual evidence.
- Can route patient communication issues to support/admin without exposing
  credentials or PHI in screenshots.

### Accountant

- Can review finance/payment evidence available to the accountant role.
- Can verify that accountant access does not expose unauthorized clinical PHI or
  patient-create controls.
- Can identify payment reconciliation mismatch and escalate using
  `infra/runbooks/pilot-support-admin.md`.
- Can distinguish manual payment evidence from provider-confirmed payment state.

### Support/Admin

- Can follow layer-order diagnosis: registration/discovery, official activation,
  then permissions/runtime.
- Can read provider-health, dead-letter, backup/restore, and DR runbooks without
  printing secrets.
- Can classify incidents, collect safe evidence, and route to the correct owner.
- Can say "not in pilot scope" for deferred workflows rather than creating an
  unsafe workaround.

## Provider No-Key Training Drill

Use the provider-health surface or a fixture state that shows a provider as
`not_configured`, `unavailable`, or manual-only.

Expected trainee behavior:

1. Confirm whether the provider is expected live for this pilot.
2. If not expected live, keep the workflow unavailable/manual and record the
   deferred state.
3. If expected live, confirm official activation evidence: route registration,
   signed callback URL, provider dashboard status, account id, approved
   templates, and secret loading.
4. Do not print secret values or retry live side effects blindly.
5. Use clinic-approved manual fallback when patient operations cannot wait.

## Completion Record

| Role          | Trainee | Synthetic drill passed | Real-data approval needed | Notes |
| ------------- | ------- | ---------------------- | ------------------------- | ----- |
| Owner         | Pending | Pending                | Pending                   |       |
| Doctor        | Pending | Pending                | Pending                   |       |
| Assistant     | Pending | Pending                | Pending                   |       |
| Receptionist  | Pending | Pending                | Pending                   |       |
| Accountant    | Pending | Pending                | Pending                   |       |
| Support/Admin | Pending | Pending                | Pending                   |       |
