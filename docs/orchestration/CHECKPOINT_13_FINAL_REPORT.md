# Checkpoint 13 Final Report — Durable Clinic Day

## Outcome

Checkpoint 13 is complete at E3 durable-local scope. The four CP2-CP6 verticals now execute through
the generated contract boundary, exact namespaced feature handlers, transaction-bound PostgreSQL
modules, forced RLS, atomic audit/outbox evidence, durable worker/Temporal recovery, and mounted
role-scoped web loaders. The integration passed twice on a clean-origin database with runtime IDs
and no fixture repository fallback.

Launch base was verified `main` revision `c3802b73`. The final code candidate before evidence was
`9116a8ea`; promotion and post-promotion hashes are recorded after the controlled merge.

## What is built

- Front office/intake: manual/official-source leads, ambiguity-safe patient creation, appointment
  configuration/conflict checks, clinic-local scheduling, check-in/queue/day start, intake and
  preparation.
- Clinical/dental: consent-gated encounters, note draft/sign/amend, prescription draft/sign,
  dental findings/history/snapshots, mediated clinical media reservation/content/receipt/access,
  and assigned-doctor signature enforcement.
- Treatment/billing: authoritative pricebook and estimates, plan acceptance, completed-procedure
  invoice evidence, manual/provider-ready payment state, signed provider event reconciliation,
  receipts, and instruction request/print truth without invented delivery/read confirmation.
- Continuity/operations: bounded signed-cursor due generation, tasks/recalls, SOPs, lab and inventory
  evidence, incidents/CAPA, procurement suggestions without purchase execution, and PHI-safe owner
  projections with clinic-timezone freshness.
- Durable recovery: account-scoped provider-event evidence, atomic payment-request intent/outbox,
  least-privilege worker activities, deterministic Temporal IDs, duplicate/stale-lease/restart/replay
  handling, and dead-letter/reconciliation paths.
- Web runtime: role-scoped workspaces using the generated client; transient record selection;
  fail-closed token-provider registration; honest pending/unavailable/denied states; desktop and
  390 px coverage.

## Integration defects closed during E3

The clean runtime gate found and closed issues that deterministic lane tests alone could not prove:

- worker SELECT privilege for action outbox events;
- canonical local Flyway prefix/options in the migration harness;
- ambiguous PostgreSQL parameter typing for currency and provider digests;
- invoice/procedure composite-FK write ordering;
- provider object-version leakage in public media output;
- Temporal due-generation progress counting two emitted entities as two processed candidates;
- transaction-bound pg queries overlapped by `Promise.all`;
- smoke fixtures that were not cursor-, contract-, or rerun-safe;
- the post-smoke RLS verifier incorrectly expected an immutable one-patient seed count.

Each correction has regression coverage and the final runtime is warning-free under pg deprecation
tracing.

## Verification and evidence

Authoritative evidence is in `docs/qa/checkpoint-13-evidence.md`; the security delta is in
`docs/security/checkpoint-13-threat-model-delta.md`. Highlights:

- 17 migrations from zero; schema 017 validates and a second migrate is a no-op;
- 100/100 tenant tables forced RLS; no-context runtime rows 0; cross-tenant isolation pass;
- API 123/123, DB 93/93, web 86/86, worker 16/16, workflow 10/10, zero skips;
- root check/typecheck/lint/test/build, secret scan, generated drift/inventory and diff checks pass;
- two full durable clinic-day smokes and the crash/restart/replay recovery proof pass;
- enabled Playwright 4/4 passes; in-app Browser was unavailable with the exact recorded backend
  error;
- CycloneDX 1.5 SBOM contains 756 production components.

## Promotion and release truth

The checkpoint integration is promoted only after the evidence commit and post-promotion checks.
CP14 has **not** started and must consume the verified promoted CP13 base.

ClinicOS remains **NO-GO** for pilot or production. CP13 does not claim deployed Keycloak/BFF,
official provider activation, production media scanning, cloud apply, alerting, signed artifacts,
live restore/failover, physical-device, or real-clinic evidence. Those remain hard gates for
CP14-CP18.
