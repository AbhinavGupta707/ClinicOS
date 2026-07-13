# CP15 durable provider-reconciliation processor lane evidence

## Decision and evidence tier

- Status: lane-owned implementation complete and ready for master review/integration.
- Stable base: `82928f9416d9ca35dc83e5ea57b46260630a471d`.
- Commit identity is reported in the Git handoff because a commit cannot embed its own SHA.
- Evidence: E1 isolated and package-level automated evidence. No live database, deployed worker,
  provider sandbox or production-provider evidence is claimed.
- Data: synthetic UUIDs, provider IDs, amounts and errors only. No PHI or live secret material.
- Release truth: **NO-GO** remains unchanged. This lane does not claim CP15 completion.

## Implemented behavior

`ProviderReconciliationProcessor` consumes the frozen migration-0020 job tables under an explicit
tenant/clinic scope. Each poll:

1. starts a transaction and applies the standard tenant/clinic RLS context with no user authority;
2. atomically sweeps due/stale jobs already at the frozen eight-attempt ceiling;
3. claims due or stale-leased jobs with `FOR UPDATE ... SKIP LOCKED`, a unique lease owner and a
   bounded lease; and
4. processes each official provider read outside the claim transaction, then re-locks the exact
   lease and registration before finalizing the job and registration in one transaction.

The processor recovers after crash/restart through expired-lease reclamation. A superseded lease
cannot finalize or mutate registration truth. Retry scheduling uses deterministic bounded
exponential backoff, and attempt eight dead-letters. Credential-reference drift detected under the
final registration lock is classified as `credential_rotation_race` and does not claim a health
check against the new credential.

Meta WhatsApp Cloud has no documented authoritative read endpoint for reconstructing an arbitrary
outbound message's sent/delivered/read state. Meta jobs therefore finalize as `unsupported` with
`authoritative_lookup_unsupported`, update reconciliation/failure truth atomically, and remain
manual-review truth. The processor never guesses a Meta lifecycle state and does not mark a provider
health check when it performed none.

For Razorpay jobs with a known `provider_payment_id`, the processor consumes the existing official
`GET /v1/payments/:id` snapshot. It stores only a SHA-256 digest and bounded classification on the
job; it never writes invoices, payment requests, payment transactions or business effects. A
successful provider read can close outage/capture checks as matched or variance according to the
frozen reason. The official missing-ID response (documented as HTTP 400; 404 is also handled) is an
authoritative `provider_payment_not_found` variance. Provider outages, throttling, credential
unavailability and invalid responses retry or dead-letter without inventing captured/paid truth.

For `creation_outcome_unknown`, the new read-only Razorpay client:

- performs the official exact Payment Link query by ClinicOS `invoice_id`, which is the
  `reference_id` used by the frozen creation client;
- performs the official QR list query in a 15-minute window around job creation, with the official
  maximum page size of 100 and a hard ceiling of five pages;
- requires exact ClinicOS tenant, clinic and invoice notes on every candidate and rejects QR
  entities outside the requested window;
- returns ambiguity for duplicates or cross-scope evidence and `inconclusive` when the bounded list
  is saturated; and
- treats a found collection as creation evidence only. Returned `paid`, `active` or other collection
  status is hashed as evidence but is never projected as payment settlement or capture.

Responses are capped at 512 KiB before parsing, time out within configured bounds, retry GET-only
transport/429/5xx failures at most three times, and expose only bounded safe error fields.
Verified and degraded registrations with correctly mode-bound credentials can perform read-only
recovery; absent, registered, configured and disabled registrations cannot call Razorpay.

## Owned files

- `apps/worker/src/cp15/provider-reconciliation-processor.ts`
- `apps/worker/src/__tests__/cp15-provider-reconciliation-processor.test.ts`
- `packages/integrations/src/cp15/razorpay/reconciliation-client.ts`
- `packages/integrations/test/cp15-razorpay-reconciliation-client.test.ts`
- `docs/qa/lanes/cp15-provider-reconciliation.md`

No migration, shared database file, runtime/configuration file, API route/contract, manifest,
lockfile, generated source, shared release document or release decision was changed.

## Automated evidence

| Command                                                                                 | Result                                                               |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `npm ci --prefer-offline --no-audit`                                                    | PASS; 1,219 packages added from the native worktree lock             |
| `npm run build:shared`                                                                  | PASS                                                                 |
| `npm --workspace @clinic-os/integrations run build`                                     | PASS                                                                 |
| `npm --workspace @clinic-os/integrations run typecheck`                                 | PASS                                                                 |
| `npm --workspace @clinic-os/integrations run lint`                                      | PASS                                                                 |
| `node --test packages/integrations/test/cp15-razorpay-reconciliation-client.test.ts`    | PASS, 6/6, 0 skipped                                                 |
| `npm --workspace @clinic-os/integrations test`                                          | PASS, 184/184, 0 skipped                                             |
| `npm --workspace @clinic-os/worker run build`                                           | PASS                                                                 |
| `npm --workspace @clinic-os/worker run typecheck`                                       | PASS                                                                 |
| `npm --workspace @clinic-os/worker run lint`                                            | PASS                                                                 |
| `node --test apps/worker/dist/__tests__/cp15-provider-reconciliation-processor.test.js` | PASS, 12/12, 0 skipped                                               |
| `npm --workspace @clinic-os/worker test`                                                | PASS, 44/44, 0 skipped                                               |
| `npm run security:secrets`                                                              | PASS, tracked and untracked release-scope scan                       |
| Owned-path credential/private-key/PHI pattern scan                                      | PASS, no matches                                                     |
| `npx prettier --check` on all five owned paths                                          | PASS after formatting                                                |
| `npm run check:clock`                                                                   | FAIL on three pre-existing CP15 runtime files; no owned-path finding |

The focused suites cover scoped transactional claims, stale lease recovery, concurrent lease loss,
atomic rollback when registration finalization fails, bounded retry and exact attempt exhaustion,
credential rotation, degraded recovery, Meta manual-review truth, known-payment matched/variance and
missing-provider truth, creation recovery/absence/duplicates, official pagination, cross-scope
evidence, provider outage and oversized response behavior. All lane tests are mandatory and none are
skipped.

## Master-owned integration requirements and discovered blocker

1. Export `RazorpayCollectionReconciliationClient` from
   `packages/integrations/src/cp15/razorpay/index.ts` and the shared integrations root.
2. In `apps/worker/src/worker-runtime-main.ts`, construct a reconciliation provider client that
   combines the existing `RazorpayApiClient.fetchPayment` with the new read-only creation lookup,
   inject the existing secret resolver, schedule explicit tenant/clinic polls under the worker role,
   add bounded metrics/readiness, and stop polling cleanly on shutdown.
3. Retain the migration-0020 worker grants. The processor needs only `SELECT`/`UPDATE` on
   `provider_callback_registrations`, `meta_whatsapp_reconciliation_jobs` and
   `razorpay_reconciliation_jobs`; it intentionally requires no invoice/payment-table grant.
4. Fix the existing CP13 creation-job insert before runtime activation. At the stable base,
   `apps/worker/src/cp13/postgres-cp13-activity-ports.ts` inserts `status = 'pending'` with a non-null
   `next_attempt_at`. Migration 0020 requires `next_attempt_at IS NULL` for every status except
   `retry_scheduled`, so the current insert violates
   `razorpay_reconciliation_jobs_retry_check`. Prefer an immediately claimable `pending` row with a
   null `next_attempt_at`, or use a policy-approved `retry_scheduled` row; do not weaken the frozen
   constraint.
5. Keep using `invoice_id`, not the internal `provider_request_reference`, for the Payment Link
   lookup. The frozen creation client sends the invoice UUID as Razorpay `reference_id`; the durable
   provider-request reference remains internal evidence.
6. Add live PostgreSQL worker-role/RLS, concurrent-claim, stale-lease, crash-after-provider-read and
   restart tests after master runtime wiring. The lane's SQL tests use a typed scripted pool and are
   E1, not E3 database evidence.

## Official provider assumptions

- Razorpay [Fetch a Payment With ID](https://razorpay.com/docs/api/payments/fetch-with-id/) documents
  `GET /v1/payments/:id`, authoritative payment fields, and HTTP 400 for a nonexistent payment ID.
- Razorpay [Fetch All Standard Payment Links](https://razorpay.com/docs/api/payments/payment-links/fetch-all-standard/)
  documents `GET /v1/payment_links/`, the exact `reference_id` filter and the `payment_links` result.
- Razorpay [Fetch All QR Codes](https://razorpay.com/docs/api/qr-codes/fetch-all/) documents
  `GET /v1/payments/qr_codes`, `from`, `to`, `count` (maximum 100) and `skip` pagination.
- Meta's official WhatsApp Business Platform collection documents message lifecycle status as
  [webhook notifications](https://www.postman.com/meta/whatsapp-business-platform/request/rgtfq23/message-status-update-notifications).
  Review of the current official Cloud API surface found no authoritative arbitrary-message status
  GET. That absence is treated conservatively: unsupported/manual review, never inferred closure.

## Residual and external-only evidence

- No secret file, authenticated provider session, AWS resource, DNS, provider dashboard, official
  sandbox/live account, message, payment, refund or PHI was read or mutated.
- No official signed Meta callback or Razorpay API response was captured. Provider sandbox/live,
  deployed worker, alert, outage, credential rotation and restore/restart evidence remain E4/E3
  master gates.
- Runtime registration/export and the CP13 creation-insert constraint fix are absent by ownership;
  until master completes them, this processor is deliberately undiscoverable and cannot run.
- Secret/PHI scans, final package reruns, `git diff --check` and Git cleanliness are recorded in the
  final handoff after the last owned-file review.

The repository clock ownership guard remains red on
`apps/api/src/providers/cp15/official-provider-callback-runtime.ts`,
`apps/worker/src/cp15/scoped-meta-instruction-sender.ts` and
`apps/worker/src/cp15/scoped-razorpay-payment-provider.ts`. Those pre-existing master-owned paths are
outside this lane. The new processor uses its injected clock or `systemClock` and produced no clock
guard finding.
