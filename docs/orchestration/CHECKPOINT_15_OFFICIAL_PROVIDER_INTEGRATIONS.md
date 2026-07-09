# Checkpoint 15 — Official Messaging, Payments and Telephony

**Status:** Planned; official accounts and external registration required
**Evidence target:** E4 official sandbox, production activation still gated
**Workers:** four provider-isolated worktrees
**Primary findings:** PRR-008 and PRR-026

## 1. Outcome

Activate complete official sandbox workflows for Meta WhatsApp, Razorpay and the selected telephony provider through the deployed CP14 edge. Provider credentials, adapters or simulator tests alone do not satisfy this checkpoint.

Every provider lane owns a separate namespace. The master owns the shared provider registry, public route aggregation, environment schema, secret wiring, root lockfile and provider-dashboard mutation authorization.

## 2. Lanes

### Lane A — Meta WhatsApp Cloud (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced Meta adapter, WhatsApp webhook/API module and tests.

**Goal:** official verification challenge, raw-body `x-hub-signature-256`, inbound/status/template lifecycle normalization, consent/opt-out/service-window rules, template send, event uniqueness, out-of-order transitions, retries, reconciliation and redacted evidence.

**Must not:** claim delivery/read from request or replay, log message PHI/tokens, or register the provider dashboard without master authorization.

### Lane B — Razorpay (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced Razorpay adapter, payment webhook/API module and tests.

**Goal:** Payment Link/QR scope, raw signature verification, invoice/amount/currency match, partial/duplicate/out-of-order/overpayment/refund/dispute behavior, reconciliation and secret rotation/outage states.

**Must not:** mark paid from unsigned/client data, hide reconciliation differences or expose provider secrets.

### Lane C — Telephony (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced official telephony adapter, call/missed-call webhook module and tests.

**Goal:** official callback validation, event deduplication, missed-call/source attribution, patient ambiguity queue, recording URL redaction, retry/reconciliation and honest unconfigured/degraded states.

**Activation:** credentials/provider account were absent at CP11. Diagnose registration and request the smallest user action before runtime debugging. Keep the entire workflow disabled if not activated.

### Lane D — Provider Operations, UI and QA (`gpt-5.6-sol`, `high`)

**Owns:** namespaced provider registry/health projections, `apps/web` provider-operations feature paths, CP15 Playwright/acceptance tests and CP15 QA/runbook drafts.

**Goal:** expose `absent`, `registered`, `configured`, `sandbox_verified`, `production_verified`, `degraded` and `disabled` truth; provider health, DLQ/replay/reconciliation operations; role-safe responsive UI; adversarial provider test matrix.

**Forbidden:** provider adapter namespaces, shared route/bootstrap/env, memory/log/release decision.

## 3. External Registration

After code and staging callback endpoints pass local/deployed tests, the master requests explicit authority and uses official provider dashboards/APIs to register callbacks and events. Chrome may be used for the user’s authenticated dashboard state; this is an activation procedure, never a product dependency or scraping integration.

Record provider-side registration, account/mode, callback URL, event subscriptions, credential rotation owner and verification time without secrets. Run invalid signature, duplicate, delayed, out-of-order, retry, outage and reconciliation cases in official sandboxes.

## 4. Merge and Exit

Provider namespaces may merge in any dependency-safe order; merge Lane D after the three provider contracts. Master assembles the registry/routes/env/secrets, reconciles lockfile and runs cross-provider rate/cost/DLQ/health evidence.

Exit requires:

- Meta and Razorpay official sandbox callback/send/payment evidence;
- telephony official sandbox evidence, or the workflow remains open/disabled and CP15 cannot be called fully complete for blue-sky scope;
- signature-before-parse, replay/deduplication, monotonic state, reconciliation and outage tests;
- provider operations UI, roles, tenant isolation, desktop/390px and console/network checks;
- no invented sent/delivered/read/paid/captured state;
- threat/register/evidence/runbook/memory/log/final report complete;
- integration promoted to `main` before CP16.
