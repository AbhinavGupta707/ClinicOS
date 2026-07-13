# Checkpoint 15 — Official Messaging, Payments and Telephony

**Status:** Local implementation complete at E3 candidate `f1cfe7bb`; deployed callbacks, official sandbox evidence and full exit remain open
**Evidence target:** E4 official sandbox, production activation still gated
**Workers:** provisionally two to three initial provider worktrees; count follows official activation state
**Primary findings:** PRR-008 and PRR-026

## 1. Outcome

Build complete official-provider workflows for Meta WhatsApp, Razorpay and the selected telephony provider against the frozen CP14 callback/security contracts. The owner-directed CP14 cloud deferral means the public edge is not deployed: local implementation, deterministic contract tests and honest unavailable states may proceed, but provider credentials, adapters or simulator tests alone do not satisfy this checkpoint.

No lane may require or assume AWS, DNS, public callback registration, live provider traffic or
provider-dashboard mutation during this implementation wave. Those remain external E4 gates.

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

### Optional second wave — Provider Operations, UI and QA (`gpt-5.6-sol`, `high`)

**Launch condition:** the active provider adapters are reviewed and merged, and their registry/health/event contracts are frozen. Otherwise the master owns this work.

**Owns:** namespaced provider registry/health projections, `apps/web` provider-operations feature paths, CP15 Playwright/acceptance tests and CP15 QA/runbook drafts.

**Goal:** expose `absent`, `registered`, `configured`, `sandbox_verified`, `production_verified`, `degraded` and `disabled` truth; provider health, DLQ/replay/reconciliation operations; role-safe responsive UI; adversarial provider test matrix.

**Forbidden:** provider adapter namespaces, shared route/bootstrap/env, memory/log/release decision.

## 3. External Registration

After the owner reopens cloud activation and code plus staging callback endpoints pass local/deployed tests, the master requests explicit provider authority and uses official provider dashboards/APIs to register callbacks and events. Chrome may be used for the user’s authenticated dashboard state; this is an activation procedure, never a product dependency or scraping integration.

Record provider-side registration, account/mode, callback URL, event subscriptions, credential rotation owner and verification time without secrets. Run invalid signature, duplicate, delayed, out-of-order, retry, outage and reconciliation cases in official sandboxes.

## 4. Merge and Exit

The local implementation wave may launch Meta and Razorpay when their official API/signature
contracts are stable enough for meaningful deterministic work. The later activation wave waits
until their official sandboxes can make material progress. Launch telephony only after the official
provider is selected; otherwise preserve the entire workflow as disabled and do not create an idle
worker to satisfy a count. Provider namespaces may merge in any dependency-safe order. The master
then freezes shared contracts and either launches the optional operations/UI/QA second wave or owns
it directly. Master assembles the registry/routes/env/secrets, reconciles the lockfile and runs every
available cross-provider rate/cost/DLQ/health check without inventing external evidence.

Implementation promotion may occur after all executable local/durable/security/browser gates pass
and the external evidence gap is recorded. Full CP15 exit still requires:

- Meta and Razorpay official sandbox callback/send/payment evidence;
- telephony official sandbox evidence, or the workflow remains open/disabled and CP15 cannot be called fully complete for blue-sky scope;
- signature-before-parse, replay/deduplication, monotonic state, reconciliation and outage tests;
- provider operations UI, roles, tenant isolation, desktop/390px and console/network checks;
- no invented sent/delivered/read/paid/captured state;
- threat/register/evidence/runbook/memory/log/final report complete;
- integration promoted to `main` before CP16.

## 5. Local Implementation Result — 2026-07-13

The Meta, Razorpay and later reconciliation worktree lanes were reviewed and integrated. Shared
runtime, migrations `0020`/`0021`, route/registry/secret wiring, worker scheduling, provider
operations UI, clean PostgreSQL proof, security delta, activation runbook and browser evidence are
complete at local E3 candidate `f1cfe7bb`. See `docs/qa/checkpoint-15-evidence.md` and
`docs/orchestration/CHECKPOINT_15_FINAL_REPORT.md`.

This is an implementation result, not a full checkpoint-exit claim. Meta/Razorpay official E4
activation and the unselected telephony workflow remain open; the release remains NO-GO.
