# CP13 Wave 2 — Durable Integrity and Provider Recovery

## Evidence record

- Evidence ID: `CP13-DURABLE-INTEGRITY-E1-20260710`
- Frozen base: `e48c787560fc693a43bbefa72849a46bf7683502`
- Result revision: exact clean worker commit is reported in the lane handoff
- Executed at: `2026-07-10T11:44:39Z`
- Evidence tier: E1 deterministic adapter, schema-shape, type, and transaction-command evidence only
- Environment: isolated Codex worktree, Node `v22.22.2`, synthetic identifiers/data only
- External actions: none; no credentials, provider calls, cloud actions, production records, or PHI

The lane inspected producer corrections `f7c9cd4105c8bbfc64c7050ad8e60e089d5626f1`,
`e5934893`, and `a01e8f45` read-only. It remains cherry-pickable from the frozen base.

## Canonical durable model

Migration `0017_cp13_durable_integrity.sql` is a forward-only, transactional migration. It does not
modify migration 0016. It adds these canonical controls:

- clinic/patient-aware composite foreign keys across appointments, queue, encounters, notes,
  prescriptions, dental findings, clinical media, treatment plans, performed procedures, invoices,
  payment artifacts, instructions, and attribution;
- actionable preflight failures for cross-clinic relationships, wrong-patient compositions,
  unbound instruction/outbox identifiers, retained client media names, and verified legacy webhook
  rows whose exact evidence cannot be proved;
- strict server-generated media labels in the integrated
  `clinical-media-<uuid>.<MIME-matched extension>` format;
- forced-RLS `clinical_media_receipts` with provider artifact references represented only by SHA-256
  fingerprints and restrictive clinical/media deletion semantics;
- forced-RLS payment request intents containing provider/account authority, required capability,
  exact request digest, typed request kind/amount/currency, and a validated 32 KiB provider-safe
  request snapshot;
- canonical raw webhook evidence on `raw_webhook_events`: account scope, raw-body, signature, and
  normalized-event fingerprints, normalized event, lease/recovery state, mismatch state, result
  digest, and result projection;
- forced-RLS payment reconciliation items with exact amount balancing; and
- ordinary transactional indexes only. No `CREATE INDEX CONCURRENTLY` is used because the repository
  migration runner wraps Flyway migrations in a transaction. Production rollout must budget table
  locks or use an approved expand/validate maintenance sequence.

Composition-child cascades remain intentionally intact for treatment phases, estimate items, and
invoice items. Clinical/media/patient/provider evidence relationships use restrictive deletion.

## Transaction-bound operations

The additive `durableIntegrity` module port is separate from the frozen 140-operation compatibility
interface. Production Postgres always supplies it; a repository that lacks the new operation throws
`DURABLE_INTEGRITY_REPOSITORY_UNAVAILABLE` rather than simulating durability.

The port provides:

- provider-derived clinical media receipt record/replay/mismatch;
- atomic appointment check-in plus queue creation with row locks, a clinic-day advisory transaction
  lock, conditional status mutation, and exact result flags;
- active user, active tenant membership, current-clinic assignment, and unrevoked current-clinic
  `doctor` role eligibility;
- exact-one current-clinic payment account resolution by provider key and required capability. None,
  ambiguity, degradation, and unavailability fail closed. Only `razorpay` and the approved local
  `simulator` are callable provider keys;
- account-scoped payment request claim/recovery/finalization with immutable canonical request data;
- verified provider-event claim/replay/mismatch/recovery, reconciliation, and completion; and
- payment-provider integration outbox append/replay/mismatch. The operation verifies the current
  account and capability and derives `actor_type = integration` and `actor_id = external account
UUID`; feature handlers cannot supply actor authority.

The legacy `createQueueEntry` operation remains source compatible but now returns an existing queue
row unchanged, uses `ON CONFLICT DO NOTHING`, and appends queue-created evidence only for an actual
insert. It can no longer reset a called/completed queue entry to waiting. Master should still compose
the new atomic check-in operation because separate legacy status and queue calls are not one unit.

WhatsApp patient instructions now persist `outbox_event_id = null` unless the caller explicitly
supplies a real durable outbox row ID. No synthetic outbox identifier is invented.

## Producer adapter mapping

The treatment/billing producer's `DurablePaymentProviderEventPort` must be adapted inside one clinic
unit of work as follows:

1. Resolve `providerAccountKey` at the verified boundary through
   `findActivePaymentProviderAccount({ providerKey, requiredCapability })`; never accept a body UUID
   or query integration tables from the handler.
2. Compute `normalizedEventSha256` over the producer's stable canonical normalized event and pass it,
   the raw-body SHA-256, and signature SHA-256 to `claimVerifiedPaymentProviderEvent`.
3. Map DB `claimed` to producer `claimed`, DB `recovered` to a new executable claim, `in_progress`
   directly, and a completed DB duplicate to producer `duplicate`. Populate `storedEvidence` from the
   stored raw/signature/normalized evidence, not the retry request.
4. The stored DB `resultProjection` is the producer's
   `DurablePaymentProviderEventResultProjection`, including `verificationEvidence`. Evidence mismatch
   is a reconciliation/409 condition and must not be mapped to duplicate.
5. Compute the completion result digest over the same stable result projection, retain the lease
   owner used for claim, and call `completePaymentProviderEvent`.
6. Adapt the C service's outbox append to
   `appendPaymentProviderIntegrationOutboxEvent` in the same unit-of-work callback as billing and
   event completion. This is how the outbox row commits atomically with an integration actor without
   broadening handler authority.

For payment request creation, master must build the canonical request from the server-authoritative
invoice and validated API fields: request type, amount, currency, description, expiry, customer, and
metadata. Use exported `buildPaymentRequestIntentDigest` over the account ID, exact provider key,
required capability, invoice ID, idempotency key, and canonical request; the claim operation rejects
a digest that does not match that snapshot. Claim commits before the provider call; the provider
call remains outside a DB transaction; a second transaction persists the payment request and
finalizes the intent. A stale claimant recovers the stored original request, including provider key,
capability, account, invoice/patient, and idempotency key, even when invoice state later changes.
Credentials, provider secrets, private paths, and unbounded provider responses are rejected.

## Proposal reconciliation

The deleted CP13 clinical/dental and treatment/billing proposals are fully superseded by 0017:

- the clinical proposal's nonexistent `patients.primary_clinic_id` is corrected to `patients.clinic_id`;
- receipt columns are replaced by a scoped receipt ledger with immutable fingerprints and replay
  state;
- the proposed duplicate `payment_provider_events` table is replaced by the canonical
  `raw_webhook_events` extension; and
- provider account text keys are replaced by current-clinic `external_accounts.id` authority, with
  exact evidence/result fingerprints and reconciliation state.

No schema semantics remain solely in those proposal files. Application composition, fixture
reconciliation, and live migration/RLS proof remain master work and are listed below.

## Deterministic verification

- Focused durable-integrity matrix: 9/9 passed, zero skips.
- Focused CP13 schema/module matrix: passed, zero skips.
- Full DB package: 91/91 passed, zero skips.
- `@clinic-os/db` typecheck: passed.
- `@clinic-os/domain` typecheck: passed.
- `@clinic-os/api` typecheck: passed after building local config/integration declarations.
- One bounded Docker availability check: unavailable with local Docker socket permission denied.
  It was not retried.

No real PostgreSQL execution is claimed by this lane. Master reported that migrations 0001-0016
passed on a disposable seeded PostgreSQL 16 cluster. Its first 0017 candidate exposed an explicit
clinical-media constraint auto-name collision; this lane renamed the composite constraint to
`clinical_media_receipts_state_consistency_check`. The candidate transaction rolled back. Applying
the stabilized 0017 and proving real RLS/adapter behavior remain master gates.

## Master gates and blockers

1. Apply the final 0017 to the prepared disposable PostgreSQL 16 clone, then run cross-tenant,
   cross-clinic, restrictive-delete, replay/mismatch, rollback, concurrency, and forced-RLS tests.
2. Reconcile any preflight failure with approved source evidence. Do not delete or silently rewrite
   legacy clinical/provider rows. In particular, clear only proven synthetic instruction outbox IDs
   or bind their real outbox rows.
3. Wire the atomic check-in result, provider eligibility read, media receipt-before-completion flow,
   exact-one provider account resolver, payment request two-transaction seam, provider event adapter,
   integration outbox adapter, and reconciliation result in master-owned application files.
4. Update the master-owned fixture so absent WhatsApp outbox evidence remains null.
5. Update master-owned schema-version configuration/release evidence for migration 0017 and rerun the
   full workspace gate after integration.
6. This lane does not claim browser, official Razorpay, cloud, deployed, release, or checkpoint
   completion evidence.
