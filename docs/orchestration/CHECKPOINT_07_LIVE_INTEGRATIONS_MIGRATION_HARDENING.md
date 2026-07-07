# Checkpoint 7 - Live Integrations And Migration Hardening

- Launch date: 2026-07-07
- Launch base before this packet: `e7139c4`
- Source plan: `clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md` section 15
- Integration branch: `codex/integration/checkpoint-7`

## Outcome

ClinicOS exposes pilot-ready integration foundations for messaging, source capture, migration/import review, provider capability health, and replay operations. Live providers must be represented honestly: sandbox-capable where credentials and callbacks exist, contract-tested where live callbacks are not available, and visibly unavailable when credentials are missing.

## Credential And Provider Preflight

`.secrets/orchestration.env` is present and ignored by Git. Values were not printed.

| Surface | Preflight result | CP7 posture |
| --- | --- | --- |
| Meta WhatsApp Cloud | Provider, access token, app id, app secret, WABA id, phone number id, and webhook verify token are present | Build direct Meta Cloud adapter with fetch-injected sandbox tests and signed/verified webhook normalization; live outbound smoke only behind an explicit env flag |
| Razorpay | Sandbox key id, key secret, and webhook secret are present; webhook URL is empty | Do not reopen CP5 payment scope except provider-health display and capability status |
| Telephony | Provider key is present, but Exotel-style account/API variables are empty | Build manual missed-call entry and provider-unavailable capability gates; no fake live missed-call capture |
| Google Business Profile | Account/location variables are empty | Build source attribution/manual Google source support; no live Google API dependency |

## Lane Ownership

| Lane | Ownership | Forbidden/shared policy | Required verification |
| --- | --- | --- | --- |
| Messaging Provider | WhatsApp/Meta provider contract, template lifecycle types, delivery/read/failure status parsing, inbound/status webhook normalization, opt-out enforcement at provider boundary | Do not edit DB migrations or web UI. Do not print secrets or call live Meta APIs unless guarded by an explicit env flag. Schema needs go into handoff notes for Migration/Data. | `npm --workspace @clinic-os/integrations test`, package typecheck/build if present, contract tests for no-key and sandbox/fetch-injected Meta paths |
| Telephony/Source | Telephony provider contract, manual missed-call capture model, source attribution normalization for phone/WhatsApp/Google/Practo/manual/referral/walk-in, conversion-source preservation helpers | Do not edit DB migrations. Do not scrape Practo/Google/telephony dashboards. Live Exotel/Google must remain unavailable until credentials/callbacks exist. | Domain/integration tests for source attribution and unavailable provider gates |
| Migration/Data | Canonical CP7 migration `0008_live_integrations_migration_hardening.sql`, migration batches/rows/conflicts/commits, imported/unverified record links, duplicate/conflict review, DB repositories, API migration routes | Own the only CP7 database migration. Coordinate with Messaging/Telephony handoffs before merging. No silent overwrite of verified ClinicOS records. | DB typecheck/tests, API typecheck/tests, import fixture validation, conflict/rollback/commit tests |
| Integration Ops/QA | Provider health/capability dashboard, dead-letter/replay UX and backend wiring where missing, CP7 fixture and contract smoke scripts, browser/user smoke, runbook docs | Web may consume only implemented APIs or explicit fixture mode. No fake provider success states. Browser smoke must prove unavailable states and 390px mobile reachability. | Web tests/typecheck/lint/build, CP7 contract smoke, Playwright desktop/mobile smoke, docs/runbook evidence |

## Worker Sessions

| Lane | Pending worktree ID | Thread ID | Worktree path |
| --- | --- | --- | --- |
| Messaging Provider | `local:3dace615-d0fc-404d-b5cf-55a4f8160e05` | `019f3c69-e395-7f43-85e0-9513a2546ad6` | `/Users/abhinavgupta/.codex/worktrees/aa0f/ClinicOS` |
| Telephony/Source | `local:480585d3-3208-4e03-9377-ff468927e57b` | `019f3c6a-2d9c-7c01-bbad-d95e05fdcf9c` | `/Users/abhinavgupta/.codex/worktrees/046c/ClinicOS` |
| Migration/Data | `local:e2e401d4-7304-4cbf-9b5d-fb87c28b44f1` | `019f3c6a-655d-7223-8cf2-8cde3cf10b80` | `/Users/abhinavgupta/.codex/worktrees/9644/ClinicOS` |
| Integration Ops/QA | `local:6c4aa04d-328a-415f-ad92-21d4bf54c75a` | `019f3c6a-9b72-7642-ab14-ce002f1d9511` | `/Users/abhinavgupta/.codex/worktrees/386a/ClinicOS` |

## Merge Order

Messaging Provider -> Telephony/Source -> Migration/Data -> Integration Ops/QA -> master integration patch.

The master integration pass owns cross-lane reconciliation of route names, permission/audit classes, provider-health projections, dead-letter/replay contracts, and fixture flags.

## Expected Product Behaviors

- Provider health surfaces distinguish `available`, `degraded`, `unavailable`, and `not_configured`.
- WhatsApp template sends, inbound messages, status events, and opt-out flows are modeled through typed contracts and audited persistence once merged with data lane work.
- Missed-call lead capture works through manual entry and provider-normalized events where a provider is configured; unavailable provider state is visible.
- Source attribution survives lead, appointment, encounter, invoice, payment, and analytics handoffs without external systems becoming the source of truth.
- CSV import validates required fields, separates bad rows, shows duplicate candidates, marks imported records as unverified/imported, and never overwrites verified records silently.
- Dead-letter/replay works for failed provider events with idempotency and audit evidence.

## Accepted Non-Goals

- No dashboard scraping for WhatsApp Web, Practo, payment, Google, or telephony providers.
- No production Meta webhook dashboard registration until there is a deployed HTTPS callback with verification and signature handling.
- No live Exotel/Google integration unless credentials and callback/authorization surfaces are provided.
- No weakening of CP5 payment reconciliation; CP7 may display health/capabilities but does not replace the CP5 payment provider workflow.

## Integration Verification

- Integration branch: `codex/integration/checkpoint-7`.
- Master integration patch commit: `c193b81`.
- Main promotion merge commit: `92fb2b9`.
- Worker commits merged in dependency order: Messaging Provider `9ce137a`, Telephony/Source `945c248`, Migration/Data `9aa5a29`, and Integration Ops/QA `f839d03`.
- Master integration reconciled cross-lane route drift:
  - CP7 live provider health routes are registered and backed by real adapter health checks or explicit manual/unavailable states.
  - CP7 dead-letter read/replay routes are backed by `integration_dead_letters`; replay records an audited request and outbox event without fake delivery/read completion.
  - CP7 migration collection reads are backed by durable migration batches.
  - Web/live migration resolution now uses the canonical row route: `POST /v1/migration-batches/{migrationBatchId}/rows/{rowId}/resolve`.
- The Ops/QA fixture remains fixture-only and local/test-only. Live route implementation is tested at the API operations layer because deterministic fixture IDs are not guaranteed in every API runtime.
- Checks passed:
  - `npm run typecheck`
  - `npm run test`
  - `npm run lint`
  - `npm run security:secrets`
  - `npm --workspace @clinic-os/web run build`
  - `node scripts/validate-cp7-fixtures.mjs`
  - `node scripts/cp7-contract-smoke.mjs --dry-run`
  - `CLINICOS_CP7_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/checkpoint-7-integration-ops-flow.spec.ts`
- Browser smoke passed for desktop provider/dead-letter/migration review and 390px mobile reachability/no-horizontal-overflow.
