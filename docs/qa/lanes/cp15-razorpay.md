# CP15 Razorpay implementation lane evidence

**Lane:** Razorpay official-provider boundary
**Base revision:** `87c1be0119aa1a3c93b6f27c3cebf27a716108c7`
**Executed at:** 2026-07-13T18:57:13Z
**Evidence tier:** E1 isolated automated plus E0 schema/integration proposal
**Data:** synthetic identifiers and amounts only; no PHI
**Release truth:** **NO-GO** for production, live payments, provider traffic or clinical reliance

## Outcome

The owned additive paths implement a fail-closed Razorpay boundary for Payment Links and single-use
fixed-amount QR collection. The boundary limits the exact raw body, verifies HMAC-SHA256 against a
bounded current/previous secret ring before JSON parsing, requires the provider event identifier,
binds the signed payload to the registered Razorpay account, and returns no secret material.

The domain layer independently decides financial effects. Only captured, account-bound,
invoice-bound, currency-matched events can apply value. `payment.authorized`, browser/client return
parameters, Payment Link creation and unsigned data are never settlement evidence. Separate
provider-event and business-effect keys prevent `payment.captured`, `payment_link.paid` and retry
events from applying the same payment twice.

Partial payments apply the captured installment. Overpayment is capped at the outstanding balance
and creates reconciliation evidence for the unallocated amount. Processed refunds require the
matching captured payment and cannot exceed its captured total. Every dispute state creates review
evidence without silently reversing or re-settling the invoice. Lower-ranked delayed events are
ignored after stronger durable state.

The API service opens its transaction only after the injected official verifier succeeds. Within
one explicit unit-of-work contract it claims the provider event and business effect, resolves the
invoice/request/payment binding, writes the financial/request effect, audit and outbox records,
creates reconciliation where required, and completes the durable event. Official API reads may
detect drift but have `settlementAllowed: false` and use bounded retry/dead-letter scheduling.

## Security and failure behavior

- Raw body default limit: 262,144 bytes; limit failure occurs before HMAC or parsing.
- HMAC: SHA-256 over exact bytes with timing-safe comparison; raw signature is reduced to a digest.
- Rotation: current secret plus one explicitly expiring previous version; verified output contains
  only version/role evidence and account scope, never secret values.
- Account binding: top-level `account_id`, registered tenant/clinic account scope and optional
  signed opaque notes must agree.
- Event uniqueness: account-scoped provider event ID plus a distinct business-effect uniqueness key.
- Provider POST ambiguity: no automatic create retry; timeout/5xx is marked outcome-unknown for
  reconciliation. Official GET reconciliation retries at most three attempts.
- Provider identifiers and normalized status fields are syntax/length bounded; official API
  responses are streamed and capped at 512 KiB before parsing or error projection.
- Reconciliation retry: exponential schedule capped at one hour, eight attempts, then dead letter.
- Health: missing registration/secret/API credentials is unavailable or not configured; an API
  outage is degraded; request creation is false until both API and signed webhook activation are
  verified.
- Telemetry/evidence fields are provider IDs, internal opaque IDs, event names, reason codes and
  SHA-256 digests. Raw payload, contact, email, payment instrument data, secrets and authorization
  headers are excluded.

## Automated evidence

| Evidence ID                            | Tier | Command                                                                 | Result                                      |
| -------------------------------------- | ---- | ----------------------------------------------------------------------- | ------------------------------------------- |
| CP15-RZP-E1-DOMAIN-TYPE-001            | E1   | `npm run typecheck --workspace @clinic-os/domain`                       | PASS                                        |
| CP15-RZP-E1-INTEGRATION-TYPE-001       | E1   | `npm run typecheck --workspace @clinic-os/integrations`                 | PASS                                        |
| CP15-RZP-E1-INTEGRATION-BUILD-001      | E1   | `npm run build --workspace @clinic-os/integrations`                     | PASS                                        |
| CP15-RZP-E1-API-TYPE-001               | E1   | `npm run typecheck --workspace @clinic-os/api`                          | PASS after canonical shared-workspace build |
| CP15-RZP-E1-DOMAIN-TEST-001            | E1   | `node --test packages/domain/test/cp15-razorpay-domain.test.ts`         | PASS, 7/7, 0 skipped                        |
| CP15-RZP-E1-INTEGRATION-TEST-001       | E1   | `node --test packages/integrations/test/cp15-razorpay-boundary.test.ts` | PASS, 8/8, 0 skipped                        |
| CP15-RZP-E1-API-TEST-001               | E1   | `node --test apps/api/test/cp15-razorpay-service.test.ts`               | PASS, 6/6, 0 skipped                        |
| CP15-RZP-E1-SYNTAX-001                 | E1   | `node --check` on all three CP15 test files                             | PASS                                        |
| CP15-RZP-E1-DOMAIN-REGRESSION-001      | E1   | `npm test --workspace @clinic-os/domain`                                | PASS, 79/79, 0 skipped                      |
| CP15-RZP-E1-INTEGRATION-REGRESSION-001 | E1   | `npm test --workspace @clinic-os/integrations`                          | PASS, 150/150, 0 skipped                    |
| CP15-RZP-E1-API-LINT-001               | E1   | `npm run lint --workspace @clinic-os/api`                               | PASS                                        |
| CP15-RZP-E1-OWNED-SECRET-PATTERNS-001  | E1   | Repository scanner patterns via `rg` over owned paths                   | PASS, no matches                            |

`npm ci --prefer-offline --no-audit` initially hit npm's exit-handler failure because its log path
was not writable in the managed sandbox. The same locked command succeeded with the required
filesystem permission and installed 1,218 packages. `npm run build:shared` then passed and restored
workspace package discovery after the clean install removed stale `dist` output.

The canonical `npm run security:secrets` command could not enumerate release files because it calls
`git ls-files` and the worktree metadata path is inaccessible. Its exact six patterns were run
directly over every owned path with no matches. This targeted result does not replace the required
master release-scope scan after Git access is restored.

## Covered adversarial cases

- oversized body, absent event ID, missing/invalid signature and signed invalid JSON;
- signature-before-parse ordering and exact-byte validation;
- account mismatch, tenant/clinic signed-note mismatch and currency mismatch;
- current and bounded previous secret verification, expiry and secret-free result contract;
- Payment Link partial/captured behavior and single-use fixed-amount QR request payload;
- duplicate provider event, distinct-event duplicate business effect and late lower-rank event;
- partial payment, overpayment cap/unallocated reconciliation and closed invoice rejection;
- processed refund, refund without capture and refund exceeding captured total;
- every modeled dispute state creates manual reconciliation only;
- provider 5xx/rate/outage retry behavior and unknown POST outcome;
- provider/local reconciliation variance, bounded retry and dead-letter transition;
- unregistered/degraded/disabled health truth and no payment-request readiness before activation.

## Schema proposal

`packages/db/schema-proposals/cp15/razorpay.sql` is E0 only. It reuses the existing
`external_accounts`, `raw_webhook_events`, `payment_provider_request_intents`,
`payment_reconciliation_items`, payment, audit and outbox seams. It proposes:

- secret-reference-only Razorpay account/activation/rotation binding;
- raw-body length and verified secret-version evidence on the canonical raw event;
- account-scoped business-effect uniqueness across product webhook aliases;
- bounded reconciliation jobs whose provider snapshots cannot settle invoices;
- complete CP15 reconciliation reasons; and
- forced RLS with tenant/clinic policies.

The proposal was not applied or parsed against a database in this implementation-only lane. The
master must fold it into one canonical numbered migration, perform historical-data preflight,
reconcile least-privilege grants, run clean bootstrap/RLS/concurrency/restart tests and validate all
foreign keys. This lane does not claim E3 database behavior.

## Master-owned integration requirements

The lane deliberately did not edit shared exports, manifests, route registries, environment schema,
canonical migrations or server bootstrap. The master must:

1. Export the new domain and integration namespaces:
   - `packages/domain/src/index.ts`: `export * from "./cp15/razorpay/index.ts";`
   - `packages/integrations/src/index.ts`: `export * from "./cp15/razorpay/index.js";`
2. Replace the temporary owned-path relative type imports in the CP15 API feature with the public
   `@clinic-os/domain` and `@clinic-os/integrations` exports after rebuilding shared packages.
3. Reconcile the schema proposal into the next canonical migration and implement the
   `RazorpayUnitOfWorkPort` against the existing transaction-bound payment/provider-event/audit/
   outbox repositories. The raw event claim, business-effect claim, domain mutation, audit, outbox,
   reconciliation and completion must remain one PostgreSQL transaction.
4. Register one exact public raw-body route through the uniform security/rate/body pipeline. Resolve
   tenant/clinic/account from the registered route/account binding, never from client headers or
   unsigned payload fields. Do not let general JSON middleware consume the body first.
5. Add master-owned configuration for provider mode, Razorpay account ID, registration reference,
   callback origin, API secret references, current/previous webhook secret references and the
   previous-secret expiry. Enforce production secret-manager references; never expose these values
   to clients, logs or worker handoffs.
6. Bind the health contract into the shared provider registry. Keep routes/workers/request creation
   disabled while activation is `absent`, `registered`, `configured` or `disabled`; only official
   sandbox/production verification can promote readiness.
7. Map the outbox events to the existing canonical domain types (`payment.succeeded`,
   `payment.failed`, `payment.refunded`, `payment.reconciliation_required`, and
   `integration.raw_event.received`) and wire reconciliation jobs to the existing observable
   retry/dead-letter operations.
8. Add route/schema/tenant/RLS/concurrency/crash-after-commit tests and run the complete API,
   database, worker and security gates after merge.

## Evidence limitations and blocked gates

- No AWS, DNS, dashboard, provider registration, provider credentials, live/sandbox payment, public
  callback, PHI or external account mutation was used.
- No official signed sandbox callback, Payment Link/QR creation, refund, dispute, outage or
  reconciliation evidence exists. Those remain E4 and PRR-008/PRR-026 stay open.
- No canonical route/bootstrap/config/migration is changed by this lane, so the feature remains
  undiscoverable/unregistered until master integration.
- Git operations are blocked because this worktree's `.git` points to
  `/Users/abhinavgupta/Desktop/ClinicOS/.git/worktrees/ClinicOS7`, which is not accessible in the
  current filesystem profile. The current filesystem changes are preserved, but commit ID and clean
  status cannot be produced until that exact metadata path is restored.

## Provider contract sources

The implementation was checked against Razorpay's official documentation for
[raw-body HMAC, event IDs, retries and rotation](https://razorpay.com/docs/webhooks/validate-test/),
[payment events](https://razorpay.com/docs/webhooks/payments/),
[Payment Link events](https://razorpay.com/docs/payments/payment-links/subscribe-to-webhooks/),
[QR events](https://razorpay.com/docs/payments/qr-codes/subscribe-to-webhooks/),
[refund events](https://razorpay.com/docs/webhooks/refunds/) and
[dispute events](https://razorpay.com/docs/webhooks/payloads/disputes/).
