# CP15 Meta WhatsApp Cloud lane evidence

## Decision and evidence tier

- Status: implementation complete within the lane-owned additive paths and committed for master integration.
- Expected base: `87c1be0119aa1a3c93b6f27c3cebf27a716108c7`.
- Commit identity and final clean status are reported in the worker handoff rather than embedded in this evidence file.
- Evidence: E1 isolated automated contract/unit evidence for TypeScript behavior and E0 static review evidence for the unapplied SQL proposal. No E3 deployed-system or E4 official-provider evidence is claimed.
- Release decision: **NO-GO**. CP14 cloud deferral and CP15 official Meta sandbox/deployed HTTPS evidence remain open.

## Implemented scope

The lane implements an official-semantics Meta WhatsApp Cloud boundary without provider or cloud mutation:

- registry-first verification challenge and webhook dispatch;
- bounded exact raw-body `x-hub-signature-256` verification before content-type validation or JSON parsing;
- strict inbound message, status and template lifecycle normalization with unsupported-change reconciliation;
- signed WABA and phone-number account binding;
- exact opt-out command classification, manual-review-only opt-in requests, consent enforcement and the 24-hour customer service window;
- durable provider-event uniqueness contracts and monotonic out-of-order lifecycle decisions without inventing `sent`, `delivered` or `read` states;
- explicit accepted, rejected, proven-not-dispatched and ambiguous-dispatch outcomes;
- retry, reconciliation, audit and outbox contracts;
- activation-aware provider health and PHI-safe evidence summaries;
- a private encrypted-raw-body pointer contract rather than raw provider payload persistence in general-purpose event rows;
- an additive PostgreSQL schema proposal with RLS, uniqueness, status monotonicity and timestamp immutability controls.

Simulated transports and stores exist only in focused tests behind the same typed contracts. No live message was sent and no provider result was fabricated.

## Verification results

Final native worktree dependency registration:

- Initial `npm ci --prefer-offline --no-audit` attempts failed with npm 10.9.7's `Exit handler never called` error and a non-writable log/cache path.
- A worktree-local writable cache retry exposed sandbox DNS failure; the approved network retry downloaded dependencies but stopped during `protobufjs` postinstall.
- A final cache-only `npm ci` retry completed: 1,218 packages installed in this worktree. No dependency or type was resolved from the primary checkout.
- `npm ls --depth=0 --workspaces --json`: PASS (exit 0). npm reports optional native WASM support packages as extraneous after the interrupted reification; focused build, test and type gates are green.

Executed checks:

| Command | Result |
| --- | --- |
| `npm run build:shared` | PASS |
| `node --test packages/domain/test/cp15-meta-whatsapp-domain.test.ts packages/domain/test/cp15-meta-whatsapp-schema.test.ts` | PASS, 8/8 |
| `node --test packages/integrations/test/cp15-meta-whatsapp-client.test.ts packages/integrations/test/cp15-meta-whatsapp-webhook.test.ts packages/integrations/test/cp15-meta-whatsapp-recovery.test.ts` | PASS, 22/22 |
| `node --test apps/api/test/cp15-meta-whatsapp-routes.test.ts` | PASS, 7/7 |
| `npm run typecheck --workspace @clinic-os/domain` | PASS |
| `npm run typecheck --workspace @clinic-os/integrations` | PASS |
| `npm run typecheck --workspace @clinic-os/api` | PASS after `npm run build:shared` generated native workspace outputs |
| `npm run lint --workspace @clinic-os/integrations` | PASS |
| `npm run lint --workspace @clinic-os/api` | PASS |
| `node --check packages/domain/test/cp15-meta-whatsapp-domain.test.ts packages/domain/test/cp15-meta-whatsapp-schema.test.ts` | PASS |
| Manual owned-path conflict-marker and trailing-whitespace scan with `rg` | PASS, no matches |
| Manual owned-path credential/private-key pattern scan with `rg` | PASS, no matches |
| `npm run security:secrets` | PASS: release-scope tracked and untracked file scan |
| `git diff --check` and `git diff --cached --check` | PASS |

Focused total: **37 passed, 0 failed, 0 skipped**.

The API typecheck initially produced cascading unresolved shared-package output errors before `build:shared`; it passed after using this worktree's native build outputs. This was dependency/build registration state, not an API implementation defect.

## Security coverage

Automated tests cover:

- oversized bodies and declared-length rejection;
- missing, malformed, repeated and invalid signature headers;
- signature verification over exact bytes before parsing;
- signed non-JSON and malformed JSON rejection;
- event, entry, change and response size bounds;
- strict identifier, template and timestamp validation;
- WABA and phone-number account smuggling rejection;
- duplicate event idempotency and atomic raw/event/audit/outbox persistence contracts;
- encrypted raw-body cleanup on failed persistence;
- stale, advanced, failure and terminal status ordering;
- opt-out versus non-automatic opt-in commands;
- consent, template and service-window fail-closed decisions;
- provider activation gating, redirect refusal and ambiguous network outcomes;
- synchronous provider acceptance without inferred delivery state;
- retry versus reconciliation routing;
- PHI-safe evidence and omission of provider error prose.

No real credential, secret, PHI, AWS resource, DNS record, provider dashboard, official sandbox or live Meta endpoint was accessed. A manual owned-path secret-pattern scan is recorded alongside this evidence because the Git-backed repository scanner is unavailable.

## Owned changed paths

- `packages/domain/src/cp15/meta-whatsapp/index.ts`
- `packages/domain/test/cp15-meta-whatsapp-domain.test.ts`
- `packages/domain/test/cp15-meta-whatsapp-schema.test.ts`
- `packages/integrations/src/cp15/meta-whatsapp/client.ts`
- `packages/integrations/src/cp15/meta-whatsapp/errors.ts`
- `packages/integrations/src/cp15/meta-whatsapp/health.ts`
- `packages/integrations/src/cp15/meta-whatsapp/index.ts`
- `packages/integrations/src/cp15/meta-whatsapp/service.ts`
- `packages/integrations/src/cp15/meta-whatsapp/types.ts`
- `packages/integrations/src/cp15/meta-whatsapp/webhook.ts`
- `packages/integrations/test/cp15-meta-whatsapp-client.test.ts`
- `packages/integrations/test/cp15-meta-whatsapp-recovery.test.ts`
- `packages/integrations/test/cp15-meta-whatsapp-webhook.test.ts`
- `apps/api/src/features/cp15-meta-whatsapp/index.ts`
- `apps/api/test/cp15-meta-whatsapp-routes.test.ts`
- `packages/db/schema-proposals/cp15/meta-whatsapp.sql`
- `docs/qa/lanes/cp15-meta-whatsapp.md`

## Master-owned integration requirements

The lane intentionally did not edit shared indexes, contracts, configuration, manifests, migrations or route registration. Integration requires these master-owned changes:

1. Export `./cp15/meta-whatsapp/index.js` from `packages/domain/src/index.ts` and `packages/integrations/src/index.ts`.
2. Convert `packages/db/schema-proposals/cp15/meta-whatsapp.sql` into a reviewed canonical numbered migration, advance schema-version truth, and implement the DB repository so raw pointer, provider receipt, normalized event, audit and outbox writes share one transaction.
3. Add configuration/environment-schema entries and secret-manager references for enablement, registration/activation state, explicit Graph API version, access-token reference, app-secret reference, verify-token reference, WABA ID, phone-number ID, maximum body bytes and request timeout. Configuration alone must never mark official verification complete; activation requires evidence references.
4. Register `GET` and `POST /v1/provider-callbacks/meta-whatsapp/:registrationKey` (or the master-selected equivalent) in the shared API bootstrap and generated contract. Resolve and validate the current registration before reading the POST body, bypass generic JSON parsing for this route, pass the raw byte stream to the bounded reader, and apply central rate/WAF controls.
5. Provide a restricted encrypted raw-object adapter with managed-key policy, access audit, retention/deletion and orphan reconciliation. Raw provider bodies and message/template parameters must never enter ordinary logs or PHI-unsafe metrics.
6. Wire durable adapters to the existing raw-provider-event, normalized-event, audit and outbox seams, treating uniqueness conflicts as idempotent receipt outcomes.
7. Wire worker consumers for monotonic status/template projections, atomic opt-out revocation, manual review of opt-in requests, service-window updates and unsupported-event reconciliation.
8. Integrate registration and provider-health truth into central health/readiness using only allowlisted non-PHI dimensions.
9. Connect outbound outbox dispatch, bounded retry and reconciliation workers. Ambiguous dispatch must not auto-resend; rejected or synchronous accepted responses must not imply delivery.
10. Add the callback, canonical migration, repository and worker cases to shared integration suites after those master-owned seams exist.

## Residual risks and deferred evidence

- The public callback registry/cache must validate current registration, WABA and phone-number binding on every request. Secret rotation and any bounded dual-secret overlap require a master-owned policy and audit trail.
- If encrypted raw storage succeeds and the database transaction fails, deletion is attempted; production still needs an orphan sweeper and evidence for it.
- Meta may not expose a complete query API for every ambiguous send or unsupported event. Unsupported reconciliation must remain open/manual rather than manufacture closure.
- Template parameters and inbound content may contain PHI. They require restricted encrypted storage and must not be copied to logs, traces, errors, evidence summaries or metric labels.
- For out-of-order status webhooks, only the exact signed status timestamp may populate the corresponding state; intermediate lifecycle timestamps remain null.
- E3 deployed callback, durable database/RLS and observability evidence and E4 official Meta sandbox, provider dashboard and live message evidence are not available in this implementation-only lane.

## Handoff boundary

The lane commit contains only the additive owned paths listed above. It does not merge, push, edit master-owned shared files or claim checkpoint completion. The master must review and integrate the commit, apply the enumerated shared changes, and retain the release `NO-GO` decision until the deferred evidence gates are satisfied.
