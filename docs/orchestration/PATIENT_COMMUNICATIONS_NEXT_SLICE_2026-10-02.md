# Next engineering slice: patient communications

Status: implemented on `codex/patient-communications`, with local engineering
acceptance passed. Final-head CI is required before merge. This is the bounded
first delivery below, following the owner's request
to prioritize necessary engineering over private export validation. Reviewed
baseline: `de3b1dc79fac060e4ed9c6a44df5d1631bddee95`
on `mac-latest-20260829`, after PR #11. The integration-first MVP programme remains
authoritative. Staff rehearsal, real-data handling and provider activation remain
separate decisions.

## Why this next

The small export profile answers whether actual clinic files match known shapes;
it cannot establish a successful migration. It needs either owner-run aggregate
output or explicit authorization and file paths. The owner currently wants heavy
engineering work that would be needed anyway, without waiting for clinic data.
No real files have been opened or imported.

The product already supports patient migration, appointment evidence review,
daily clinical/billing work, financial adjustments, source context, saved documents,
migration assurance and a synthetic database restore. Setup, manual recalls, task
management, inventory and expenses also have active UI/backend workflows. Building
another implementation of these would not address the next gap.

Patient communications is P0 in the canonical PRD, integration specification and
acceptance stories: staff must receive enquiries, identify the correct patient,
act on appointment requests, issue approved messages and see their actual outcome.
It also preserves a service the pilot already uses in Ray. The aim is an operational
communication loop, not an AI chatbot or a new provider selection.

Canonical references:

- `clinic_os_specs_v2/01_PRD.md`, sections 7, 10, 14.
- `clinic_os_specs_v2/04_INTEGRATIONS_SPEC.md`, WhatsApp inbound/outbound flows.
- `clinic_os_specs_v2/08_USER_STORIES_AND_ACCEPTANCE_CRITERIA.md`, Epic 4.
- `clinic_os_specs_v2/15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`, morning workflow.
- `docs/orchestration/MVP_EXECUTION_PLAN.md` and existing cloud activation deferral.

## Existing implementation to extend

| Area                       | Current implementation                                                                                                                                                                                                                                      | Missing seam                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incoming provider events   | Registered Meta challenge/signed callback routes; deduplicated event receipts and normalized events. `apps/api/src/providers/cp15/postgres-meta-whatsapp.ts` updates inbound service windows and opt-out evidence.                                          | A scoped conversation/message read model and staff inbox consuming the verified events. Provider receipt alone is not a handled patient enquiry.               |
| Outgoing messages          | `packages/integrations/src/cp15/meta-whatsapp/client.ts` implements approved-template transport. `apps/worker/src/cp15/scoped-meta-instruction-sender.ts` binds patient instructions to consent, registration, leases, durable outcomes and reconciliation. | General operator-reviewed appointment communication requests using the same boundaries. Do not disguise every message as a patient instruction.                |
| Delivery truth             | `meta_whatsapp_outbound_messages`, signed status callbacks, monotonic status updates and reconciliation already exist.                                                                                                                                      | Show this truth alongside the operator request, including uncertain dispatch and failures. A click or accepted request must not mean sent/delivered/confirmed. |
| Enquiries and appointments | `LeadsWorkspace` records enquiries, explicitly matches patients and converts leads through real scheduling checks.                                                                                                                                          | Connect communication work to these existing records and routes; do not create a second booking system.                                                        |
| Recall                     | Active rules, due generation and evidenced manual actions in `OperationsWorkspace`.                                                                                                                                                                         | Communication attempts/outcomes connected to the existing recall, rather than another recall engine. Sequence after the first appointment communication loop.  |

The deferred HTTP inventory includes historical aliases. It must be reconciled
against current native registration, not treated as proof that the official Meta
callback is missing. The old confirmation-request draft is genuinely not a current
native operator messaging workflow.

## Bounded first delivery

An authorized staff member can open the clinic inbox, inspect a text conversation,
resolve its patient/enquiry association explicitly, prepare an appointment message,
review its exact recipient and approved template, submit it through the durable
worker and inspect the actual result. A reply can be handed to the existing
booking/confirmation workflow with explicit staff action. Without an activated
provider, sending stays unavailable with a clear reason.

Implement in dependency order, keeping one source writer for shared contracts:

1. **Freeze the communication model.** Define thread/account/participant scope,
   verified inbound message identity, operator assignments, unread/handled state,
   manual contact evidence, patient-link review and message-request states. A phone
   number is a contact endpoint, not proof of a unique patient; family-shared numbers
   require explicit selection. Linking must not expose prior conversation content
   under another patient's chart or grant clinical permissions.
2. **Persist and expose the inbox.** Extend existing verified-event application
   transactionally, with forward-only migrations, composite scope constraints,
   forced RLS, stable keyset pagination, current versions and audit. Store provider
   provenance once and preserve deduplication on callback replay. Use typed native
   routes, generated contracts and the current BFF allowlist. Do not expose raw
   provider payloads, storage references, tokens or unsigned ingestion endpoints.
3. **Complete appointment-message requests.** Reuse the official provider adapter,
   consent/template/registration checks, transactional outbox, worker ownership and
   reconciliation. Generalize only the proven common dispatch code; preserve the
   existing instruction path. Bind requests to the reviewed recipient and source
   appointment revision. Recheck current consent, appointment state and template
   eligibility immediately before dispatch; expired or changed approvals must not
   silently send changed content. Verify current official provider requirements
   before extending any transport behavior.
4. **Implement the staff workspace.** Show conversations, unresolved patient matches,
   assignment and waiting/handled work. Provide named patient selection, visible
   source context, preview/approval, honest provider availability and recoverable
   errors. Distinguish staff-recorded manual contact from provider-confirmed
   delivery. Preserve patient/clinic switching guards and mobile reachability.
5. **Connect the daily loop.** Handoff to existing enquiries and appointment actions;
   preserve attribution and require an explicit decision for cancellations,
   confirmation or booking. Delivery/read status alone never changes appointment
   attendance or confirmation. Add recall messaging only after this complete loop
   and its reusable request contract pass acceptance.

No unrestricted bulk campaign builder, email, new AI classifier, automated clinical
advice, automatic attendance, telephony provider, attachment download/forwarding,
new WhatsApp intermediary or browser-based messaging integration is included.
Non-text incoming messages need an honest unsupported-content state; later media
support must use the existing quarantine/consent/private-storage contract.

## Acceptance matrix

- Signed synthetic inbound event -> one durable message -> operator inbox, surviving
  replay, reordered events and restart. Invalid signatures never create inbox work.
- Same/shared contact across patients, unmatched contacts and cross-clinic accounts:
  no silent patient assignment or cross-patient clinical disclosure.
- Owner/receptionist/clinical/accountant permissions: authorized minimum data only;
  tenant/clinic/user switching clears stale content and blocks stale commands.
- Concurrent staff edits and double clicks: row-version/idempotency guards; an
  uncertain response can recover the original command without a duplicate send.
- Consent withdrawn, provider inactive, template paused, recipient changed,
  appointment rescheduled/cancelled: dispatch fails closed or returns to review.
- Timeout after possible provider acceptance: no blind retry. Duplicate/out-of-order
  delivery events cannot regress state or confirm an appointment.
- Worker crash before/after dispatch, expired lease, outbox retry and reconciliation:
  durable pending/unknown/failure states with an explicit recovery path.
- Paging beyond one screen, same-time events, mobile layout, keyboard controls,
  loading/error/empty states and failed refresh: exercised through actual UI/API/DB.
- Existing instructions, recalls, booking and patient migration remain passing.
- Complete relevant workspace checks, fresh migrated synthetic PostgreSQL repository
  tests, browser tests and final-head CI/security review before any merge claim.

Test providers remain behind the same typed production contracts. Local services
must use the existing explicitly approved isolated synthetic harness pattern,
loopback endpoints and Spectra data/logs, with owned-process cleanup. No existing
Docker service or clinic database is started, changed or reset.

## Inputs and completion boundaries

No patient export, AI key or clinic credential is needed to build and test this
slice. Synthetic records, signed synthetic callbacks and injected provider faults
can verify its engineering behavior. They cannot establish actual Meta delivery.

Later live activation needs the clinic-approved WhatsApp account/number arrangement,
official provider registration, approved templates, recorded patient consent,
authorized HTTPS callback deployment, secret handling and an approved test recipient.
The exact existing-number setup must be verified through official provider flows;
do not promise automatic migration or coexistence. Cloud spending/deployment and
real patient contact remain outside this proposal.

Other substantial future candidates are self-service staff onboarding (Settings
currently manages already registered identities) and exceptional calendar availability
(clinic holidays, doctor leave and chair downtime). Current setup already handles
recurring doctor schedules; these must extend scheduling rather than replace it.
Both have value, but the communications gap is closer to the documented daily loop.

## Checks completed during prioritization

During prioritization only, no application source changed. Existing offline profiling tests: **18 passed**.
Patient-file, appointment preparation and related web contracts: **54 passed**.
A separate CLI run profiled **5,000 synthetic patients and 5,000 synthetic
appointments**, verified aggregate-only output, unchanged input bytes and
`importReady: false`. Evidence is on Spectra under
`.audit-spectra-retirement-20260920/pilot-export-validation-20261002/`.
These checks are not implementation or acceptance evidence for the proposed inbox.
That prioritization phase did not open real files, call providers, deploy, create a
PR, merge or change services. Subsequent implementation uses only the approved
isolated synthetic service harness. Acceptance and activation boundaries are in
`docs/qa/PATIENT_COMMUNICATIONS_ACCEPTANCE_2026-10-02.md`.

## Implemented scope and deliberate limits

- Six native operations, generated client/OpenAPI, scoped database repositories,
  audit classification, BFF allowlist and registered staff workspace.
- Forward migration 0036: five forced-RLS tables, immutable message/approval
  evidence, verified-receipt projection and historical backfill. It also repairs
  PostgreSQL's unsupported `{1,512}` template-name regex through new constraints;
  prior migration files remain unchanged.
- Contact/account inbox, explicit patient/enquiry association, eligible staff
  assignment, open/waiting/handled states, paging and per-user read positions.
- Exact appointment preview and approval, a transactional outbox, bounded
  provider-template lookup, dispatch revalidation, lease fencing and honest
  delivery/reconciliation states. Consent withdrawal, contact STOP, changed
  recipient/appointment/template, expired approval and staff authority loss block
  dispatch. Proven no-dispatch retries are capped at three; uncertainty never
  triggers an automatic resend.
- Existing enquiries, booking and patient profiles remain the daily-workflow
  handoffs. No second booking system or automatic appointment changes.

This slice supports approved UTILITY templates consisting of a plain BODY with
one occurrence of the positional `{{1}}` appointment-details parameter. A signed lifecycle callback
must first discover the template; staff can then fetch its official definition.
It does not yet import an existing provider template catalog, create templates,
send free-form replies, download media, build campaigns, automate attendance or
send recalls. An endpoint STOP remains blocked until a separate reviewed opt-in
resolution workflow exists. These are explicit capability limits, not fake
successful paths.

Live activation is still deferred. The old care-instruction sender is a separate
path and was not replaced by this appointment-message slice. Its live activation
requires its own real-database safety review, including direct-SQL RLS setup,
ambiguous-transport handling and reconciliation-index inference. A green test of
the new appointment path does not certify that older provider path.
