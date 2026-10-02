# Daily-workflow UI implementation plan — 2026-09-26

Status: the defined backend-supported frontend scope is implemented and locally verified. See [the acceptance report](../qa/DAILY_WORKFLOW_UI_ACCEPTANCE_2026-09-26.md) for 809 focused package tests, 17 real API/PostgreSQL browser scenarios, independent reconciliation and remaining external gates. No clinic cutover or production approval.

## Outcome and scope

The owner requested completion of the remaining identified frontend gaps before a clinic walkthrough. Extend the current native API and database, not the bypassed legacy workflow aggregates. Preserve the existing import and front-desk changes. Test only synthetic records using installed dependencies on Spectra.

## Registration-first findings

At the start of this work, active CP13 routes shadowed older interactive CP3–CP6 forms. Consultation, checkout and operations consequently exposed mainly read-only summaries despite existing native mutation endpoints. Intake was routed to a front-office summary, and record discovery was incomplete. The implemented replacements use generated native contracts and named selection rather than reconnecting incompatible legacy aggregates.

## Ordered delivery

1. **Shared safety and selection.** Clinic/user-scoped named patient and resource selection; capability-gated actions; version-aware writes; exact-command retry after uncertain network results; readable validation and stale-data handling. No clinical payloads in browser persistence.
2. **Operations.** Task assignment/completion, recall actions, SOP templates/schedules/runs, lab vendors/cases, inventory items/ledger/checks, incidents and corrective actions. Use existing native operations; add bounded discovery only where required. Preserve evidence and history.
3. **Patient and setup seams.** Safe demographic editing, explicit duplicate/family-contact decisions, no invented phone numbers; appointment types/chairs/provider schedules and clinic setup; reconcile staff discovery and authority constraints. Staff access changes must revoke stale authority and protect the last owner; external identity provisioning must use its official flow.
4. **Consultation.** Selected-patient intake/history and consent, visit discovery/start, structured draft notes/sign/amend, dental findings, prescription draft/sign, media and print. Signed records remain immutable except through audited amendments. Never infer clinical facts from absent import fields.
5. **Treatment and checkout.** Discover durable plans/invoices, build a priced treatment plan, record acceptance and performed procedures, invoice completed work, record evidenced manual payments, obtain receipt/print and patient instructions. No provider intent displayed as settlement. Clinical actions remain inaccessible to front-desk-only roles.
6. **Navigation and daily usability.** Preserve selected-patient scope through authorized routes, week/day schedule and named resource views, honest capability activation states, relevant report/drill-down paths. Separate unimplemented expense/report contracts and externally configured messaging from available functions; no fake placeholders.
7. **Acceptance.** Focused domain/contract/UI regressions, generated-contract drift, lint/typecheck/build, isolated real PostgreSQL/API/browser rehearsal with role denial, version conflict, uncertain-result retry, responsive controls and independent database reconciliation. Stop only owned synthetic processes. Document executed evidence and every remaining external or product gap.

## Gate before describing a workflow as complete

Its active navigation entry must reach the generated native client, durable scoped repository and permitted action; an operator must discover records without copying IDs. Happy path, denial/error/retry and subsequent read must work. Clinical signing, financial balances, access administration and provider activation require explicit backend validation, not UI-only checks. A successful synthetic rehearsal does not prove real identity/provider readiness or clinic acceptance.

## Explicit boundaries

No automated attendance detection, new AI feature, email programme, production deployment, provider activation, real patient/payment data or source-system writeback. Raw Practo appointments still require verified source identity and planned-duration/type decisions. Existing enabled clinic reminders must be reconciled before cutover. Broader cloud/compliance/DR and independent backup remain separate release concerns.
