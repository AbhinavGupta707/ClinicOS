# ClinicOS Integration-First MVP Execution Plan

Status: active owner-approved programme

Started: 2026-08-30

Baseline: `mac-latest-20260829` at `2a4cd31f57d892810c5dfb692266b3965412aff2`

Integration branch: `codex/integration/mvp-0`

Authoritative WSL root: `/home/abhinav/code/ClinicOS`

## Outcome

Prove that ClinicOS can ingest authorized data from one real clinic system and
turn it into a useful, trustworthy clinic-day workflow. The MVP succeeds when a
clinic can see its operational data in ClinicOS, find a patient, understand
today's schedule, detect import/sync problems, and repeat the process safely.

The blue-sky architecture remains the long-term direction. The MVP does not
complete every production-readiness checkpoint before product value is proven.

## Fixed principles

1. Integrate with exactly one named clinic system first.
2. Prefer an official API. If unavailable, use an authorized CSV/XLS export or
   explicit clinic-approved manual handoff. Never scrape.
3. Begin read-only. No source-system writeback until identity, idempotency,
   reconciliation, and operator review are proven.
4. Use synthetic or de-identified data until the owner explicitly authorizes real
   clinic data and its handling conditions.
5. Ship fewer complete vertical slices. Do not create placeholders, fake success
   states, a shadow datastore, or a second parallel architecture.
6. Extend existing provider, migration, patient, appointment, database, and API
   contracts.
7. Every completed checkpoint requires executable acceptance evidence.

## Scope boundary

Required now:

- one clinic and one source system;
- patient, practitioner, and appointment ingestion;
- canonical normalization and external-to-internal identity links;
- duplicate/conflict review with honest partial-failure reporting;
- repeatable read-only import or sync;
- useful Today and patient-search workflows backed by the real API/database;
- local real-stack verification and a clinic trial recipe.

Deferred until value is proven:

- multi-clinic scale and broad provider coverage;
- production cloud/DR, formal certification, and full enterprise IAM;
- live AI, FHIR/ABDM, telephony, accounting, and mobile distribution;
- bidirectional writeback, except as a later separately approved experiment;
- final visual polish outside MVP workflows.

Deferred work must remain unavailable or clearly labelled; it must not look live.

## MVP0 — Reproducible foundation and frozen experiment contract

Goal: establish one trustworthy baseline and remove ambiguity about MVP1.

Deliverables:

- verified clean WSL checkout and exact baseline commit;
- deterministic install, check, typecheck, lint, tests, build, secret scan, and
  dependency-advisory record;
- local Postgres/Redis/Temporal/Keycloak startup, all migrations, synthetic seed,
  database verification, and repository/worker persistence tests;
- clean-checkout gate ordering fixed where generated declarations are required;
- this owner-approved scope and orchestration contract;
- an integration intake naming software/version, access mode, export/API
  documentation, de-identified sample, cadence, timezone, and record counts.

Exit gate:

- deterministic gates pass or a defect is fixed and covered;
- local stack and durable database tests pass;
- dependency risks are fixed or classified for MVP exposure;
- the target source contract and sample are available.

MVP1 must not guess a vendor schema. Without the source contract, MVP0 is
technically ready but connector work is blocked on owner/clinic input.

## MVP1 — One-way clinic-system ingestion

Goal: ingest patients, practitioners, and appointments into the existing
ClinicOS source of truth without changing the clinic's source system.

Implementation sequence:

1. Add a typed adapter profile declaring only verified capabilities.
2. Parse and validate bounded batches at the provider boundary.
3. Normalize into canonical patient, practitioner mapping, and appointment
   commands with explicit field-level errors.
4. Stage rows in existing migration/integration tables.
5. Resolve duplicates and external identities before commit.
6. Commit atomically where possible; retain retryable evidence where not.
7. Reconcile received, valid, rejected, duplicate, committed, unchanged, missing,
   and unresolved records.
8. Expose operator-readable status without raw sensitive payload leakage.

Acceptance:

- first representative de-identified import succeeds;
- exact replay produces no duplicate domain records;
- changed appointments update the correctly linked record;
- cancellation and missing-source states remain honest;
- malformed/ambiguous rows cannot corrupt committed rows;
- tenant isolation and durable retry are proven;
- no source-system write occurs.

## MVP2 — Repeatable sync plus useful clinic-day product

Goal: turn imported truth into a daily workflow a clinic can evaluate.

Deliverables:

- bounded scheduled or operator-triggered incremental sync with a durable cursor
  or watermark, lease, idempotency, retry, and last-success visibility;
- a real Today page with appointments, status, patient identity, practitioner,
  time, and sync freshness;
- search-first patient lookup with identity confirmation and a concise summary;
  no pasted opaque UUIDs;
- visible sync health, unresolved conflicts, and recovery action;
- browser acceptance against the real local API/Postgres stack without network
  interception.

Exit gate:

- two sync cycles prove create, update, unchanged, cancellation, replay, and
  recovery behavior;
- Today and search use durable data and honest loading/error/stale states;
- a non-developer can run the trial recipe and explain discrepancies.

## Later checkpoints

- MVP3: clinic-selected minimal mutations: check-in, manual note, invoice/manual
  payment evidence, and recall.
- MVP4: one controlled official writeback or explicit manual handoff.
- MVP5: staging, stronger security/operations, provider activation, and broader
  real-stack regression appropriate to the pilot.
- MVP6: measured clinic experiment and a go/iterate/stop decision.

## Testing strategy

| Layer | Required evidence |
| --- | --- |
| Parser | Golden source samples, malformed input, encoding/date/time edges |
| Domain | Normalization invariants, duplicate matching, status mapping |
| Contract | Capability truth, schemas, stable errors |
| Repository | Transactions, idempotency, external links, RLS, retries |
| Integration | Real Postgres plus representative de-identified batch |
| Browser | Real API/database Today and search; no request interception |
| Operational | Replay, partial failure, recovery, reconciliation, freshness |

Every defect receives the smallest durable regression test at the lowest layer
that can prove it.

## Orchestration and model routing

- The master owns architecture, domain/API/database contracts, migrations,
  security boundaries, integration, acceptance, and checkpoint decisions. Use a
  frontier coding model with high or extra-high reasoning for these decisions.
- Use read-only subagents for bounded evidence mapping or independent review: an
  efficient model at medium effort for mechanical discovery and a balanced model
  at high effort for contract/acceptance review.
- Use an implementation subagent only after inputs are frozen, ownership is
  path-exclusive, and deterministic verification is specified.
- MVP0 stays in one master session. MVP1 stays sequential until the source and
  normalization contracts are frozen.
- MVP2 may use worktrees only if two substantial lanes are truly independent,
  such as frozen sync/reconciliation backend and frozen Today/search frontend.
  Shared contracts and generated files remain master-owned.
- Never create an agent or worktree merely to satisfy an orchestration pattern.

## Required owner/clinic input

Before connector-specific MVP1 code begins, obtain:

- exact clinic software/vendor and version;
- official API, export, or manual access the clinic is authorized to use;
- de-identified patient, practitioner, and appointment samples;
- timezone, identifiers, update/cancellation semantics, and expected volume;
- desired cadence and whether the first trial is import-once or recurring;
- explicit approval before any real patient data or writeback.

## Decision log

- 2026-08-30: owner selected integration-first MVP over enterprise readiness first.
- 2026-08-30: owner approved selective subagents and conditional worktrees.
- 2026-08-30: baseline typecheck, lint, workspace tests, and production build
  passed after shared declarations were built. The clean-checkout `check`
  ordering defect was repaired and the standalone gate now passes.
- 2026-08-30: audit reported 12 high and 10 moderate advisories, none critical.
  Next.js is pinned to the compatible patched line; the remaining advisories are
  classified in the MVP0 evidence record and automatic force-fixing remains
  prohibited.
- 2026-08-30: the WSL local stack, all 22 migrations, synthetic seed, database
  verification, migration/repository suites, worker persistence, API readiness,
  workspace checks, web tests/build, root build, and secret scan passed.
- 2026-08-30: MVP0 technical recovery is green. Checkpoint exit remains blocked
  on explicit authority for a current-lock clean reinstall and on the real source
  contract plus deidentified samples required to define MVP1 without guessing.
