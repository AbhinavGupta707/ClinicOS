# CP13 Lane C — Treatment, Billing, Payments, and Instructions

## Evidence record

- Evidence ID: `CP13-LANE-C-E1-20260710`
- Base revision: `3d3c5c2e64a4cbb1af6da318c995cdda90b9fb83`
- Result revision: exact clean worker commit is reported in the lane handoff
- Executed at: `2026-07-10T10:12:25Z`
- Evidence tier: E1 isolated automation and typed integration contracts
- Environment: Codex project worktree, Node `v22.22.2`, synthetic identifiers/data only
- Scope: the eleven frozen clinic operations plus the verified Razorpay provider-event service
- External actions: none; no credential reads, provider calls, cloud actions, PHI, push, or merge

## Implemented behavior

- Exact frozen handler map for all eleven `CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS`.
- Defensive clinic-scoped permissions in addition to the CP12 central policy:
  clinical plan/procedure work remains unavailable to accountants, while invoice/payment/receipt
  work remains available through billing permissions.
- Server-authoritative pricebook and immutable minor-unit treatment, performed-procedure, invoice,
  payment, and receipt projections through transaction-bound `dentalTreatment`, `billing`,
  `clinicalCare`, and `evidence` ports.
- Acceptance attribution and completed-procedure evidence are required before invoice creation;
  invoice-line evidence is checked against persisted procedure links rather than caller prices.
- Manual payment requires positive safe-integer INR, a supported method, reason, reference, and
  non-empty supporting evidence. Duplicate request keys replay before balance revalidation.
- Payment request provider is captured through the typed handler factory. Provider capability,
  amount, currency, request kind, and provider reference are validated before persistence.
- Patient instructions remain `ready_for_print` or `send_requested`; output cannot claim provider
  confirmation, delivery, or patient read.
- Typed Razorpay service accepts only already signature-verified, digest-bound normalized events.
  It requires a durable event/reconciliation port, applies only the invoice balance, persists the
  unallocated overpayment for review, and replays completed provider events after service restart.
- Web loader calls only the CP12 generated client's `listPricebookProcedures` and `getInvoice`
  methods, starts independent reads together, and has no direct fetch, fixture, or stale aggregate
  route. Components show denied, unavailable, empty, partial-payment, reconciliation, and
  instruction-request truth.

## Correction pass

- Manual-payment, provider-request, and clinic-operation outbox keys are now namespaced by verified
  tenant, clinic, actor, operation, resource and caller key. Manual-payment replay also requires the
  stored canonical intent digest to match invoice, amount, method, reason, reference, timestamp and
  structured evidence; drift returns a conflict without another payment effect.
- Provider payment links require a usable HTTPS payment URL. Invoice QR requests require either a
  non-empty QR string or a usable HTTPS QR image URL before any payment-request row is persisted.
- The provider-event claim/result boundary now carries the stored raw-body fingerprint, signature
  fingerprint and normalized event evidence. A duplicate whose stored or result evidence differs
  returns an explicit reconciliation-required conflict instead of replaying a settlement result.
- Patient-instruction API and event projections no longer claim a generated `outboxEventId`. The
  frozen repository may still generate an internal unbound value; replacing that shared behavior
  requires an event port that returns and atomically binds the actual durable outbox row ID.

## Schema decision

The existing CP5 treatment, invoice, payment, receipt, and instruction tables are sufficient for
the eleven clinic operations. A durable provider-event gap is proven:

- the frozen billing port can record a payment only after resolving an invoice;
- it cannot atomically claim every verified provider event or persist missing-invoice, scope,
  currency, duplicate non-payment, and overpayment reconciliation evidence;
- the existing `raw_webhook_events` table is not exposed through the frozen transaction-bound
  ports, and no payment reconciliation table exists.

The exact non-canonical proposal is
`packages/db/schema-proposals/cp13/treatment-billing.sql`. It specifies a registered-account-scoped,
leased, unique provider-event ledger and tenant/RLS-scoped payment reconciliation items. The master
must reconcile it with `raw_webhook_events` into one canonical forward migration and one
transaction-bound provider adapter; it should not create duplicate integration ledgers merely
because this worker proposal exists.

## Verification

Final results:

- `npm --workspace @clinic-os/domain run typecheck` — pass.
- `npm --workspace @clinic-os/api run typecheck` — pass.
- `npm --workspace @clinic-os/web run typecheck` — pass.
- `npm --workspace @clinic-os/web run lint` — pass, zero warnings.
- focused Node lane matrix — 20/20 pass, zero skips.
- focused web loader/component matrix — 4/4 pass, zero skips.
- complete domain package — 57/57 pass, zero skips.
- complete DB package — 69/69 pass, zero skips.
- complete web package — 65/65 pass, zero skips.
- complete API package with local loopback binding outside the socket-restricted sandbox — 91/91
  pass, zero skips. The preliminary sandbox run named 17 socket-only skips; the authoritative local
  rerun executed all of them.
- `git diff --check` — pass before evidence finalization; rerun at handoff.

`npm install --ignore-scripts` was needed because the worktree had no installed dependencies. Its
default npm audit summary reported the same 21 moderate transitive advisories already recorded for
CP12. No audit fix, force fix, provider action, or credential use was run. The one npm-normalized
lockfile metadata line was restored; the lane has no manifest or lockfile diff.

## Limitations and master follow-ups

1. `CreateInvoiceRequest.body` in the frozen generated client is incorrectly emitted as
   `Readonly<Record<string, never>>`; the runtime contract correctly requires treatment-plan or
   completed-procedure references. Master must fix the generator and regenerate the client.
2. Importing the generated TypeScript client into the DOM-typed Next workspace also fails inside
   its raw `Uint8Array` webhook fetch body. The lane web consumer is a narrow structural port with
   the exact generated read methods and no route strings or direct fetch. Master must repair the
   generated DOM body type and prove `ClinicOsApiClient` satisfies this port during composition.
3. The provider service is intentionally not registered without the canonical migration and real
   durable provider-event adapter. Master must compose it behind the existing raw-body
   signature-before-parse route and registered provider-account authority. The canonical ledger
   and every provider-event/idempotency uniqueness decision must remain provider-account scoped;
   the lane proposal is not a substitute for that master-owned migration and adapter.
4. The canonical domain event taxonomy has no `treatment_plan.updated` event. The update handler
   persists its audit evidence but does not mislabel an outbox event. Master should add the shared
   event deliberately if CP13 orchestration requires downstream plan-update consumption.
5. Route registration, generated-client construction, navigation, browser/390px smoke, and E3
   Postgres restart evidence are master-owned integration work. This lane does not claim browser,
   durable-local provider-ledger, official Razorpay sandbox, delivery/read, or settlement evidence.
6. The frozen billing port has no durable payment-request intent claim/completion record. A crash
   after provider creation but before local persistence cannot be proven recovered by this lane;
   master must add one atomic intent/recovery design rather than treating a provider note as an
   idempotency guarantee.
7. The frozen clinical-care/evidence ports cannot bind a patient instruction to the actual outbox
   row ID because append returns no ID and the repository independently generates one. This lane
   returns `null` instead of making that false association; master must reconcile the shared ports
   and repository before exposing an outbox linkage.
