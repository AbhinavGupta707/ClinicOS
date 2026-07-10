# Checkpoint 13 — Durable Clinic-Day Vertical Slices

**Status:** E3 candidate verified; controlled promotion to `main` pending
**Evidence target:** E3 complete durable local, E4 staging where available
**Workers:** provisionally three to four initial vertical worktrees, selected after the CP12 seam audit
**Primary findings:** PRR-014, remaining PRR-027, durable workflow portion of PRR-025

## 1. Outcome

Make every selected clinic-day workflow operate through PostgreSQL, RLS, generated contracts/clients, modular API, durable outbox/Temporal, and real web loaders. No claimed product workflow may require a fixture repository or fake aggregate route.

CP12 must first establish namespaced feature/module/repository seams. If it does not, CP13 launch is blocked; do not send multiple workers into the current monolithic files.

## 2. Shared Rules

- Each lane owns one namespaced feature path across domain/repository/API/web/test layers created by CP12.
- Master owns canonical migration numbering, shared exports, app route/navigation composition, root manifests/lockfile and cross-domain read models.
- Workers do not edit existing giant compatibility files except a lane-specific adapter explicitly assigned by master.
- Schema needs are proposed under `packages/db/schema-proposals/cp13/<lane>.sql`; proposals are not product migrations. Master reconciles approved requirements into one canonical forward migration and reruns the clean lifecycle.
- Every worker proves success, wrong role, wrong tenant, invalid state, duplicate/retry, restart and audit/outbox behavior for its slice.

## 3. Lanes

### Lane A — Front Office and Intake (`gpt-5.6-sol`, `high`)

**Owns:** namespaced lead/source, patient match/create, appointment, queue, day-start, intake and form-response module/repository/web paths plus local tests.

**Goal:** complete durable manual/official-source lead capture, ambiguity-safe patient matching, appointment/conflict/check-in/no-show, queue/day-start and intake handoff with source attribution.

**Must preserve:** runtime IDs, clinic-local date, no silent patient merge, receptionist/assistant boundaries, audit/outbox/timeline evidence.

### Lane B — Clinical and Dental (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced consent, encounter, clinical note, prescription, dental finding/snapshot and clinical media-metadata paths plus tests.

**Goal:** complete consent-gated encounter, draft/sign/amend, prescription draft/sign, dental chart/history/snapshot and mediated media-metadata workflows.

**Must preserve:** doctor-only signatures, additive amendment, wrong-patient/tenant denial, AI remains non-authoritative, no object key/path disclosure.

### Lane C — Treatment, Billing and Instructions (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced treatment plan/estimate, completed-procedure evidence, invoice, payment-state foundation, receipt and patient-instruction paths plus tests.

**Goal:** complete accepted-plan-to-invoice behavior and manual/provider-ready payment states without inventing settlement or delivery/read confirmation.

**Must preserve:** minor-unit money, idempotency, overpayment reconciliation, accountant versus clinical separation, signed-provider evidence requirement.

### Lane D — Continuity, Operations and Analytics (`gpt-5.6-sol`, `high`)

**Owns:** namespaced tasks, recalls, post-op, SOP, lab, inventory, event/CAPA and owner read-model paths plus tests.

**Goal:** complete due generation, assignment/transition/evidence, lab and inventory reconciliation, incident/CAPA, and source-backed owner analytics with explicit freshness/rebuild behavior.

**Must preserve:** no fake procurement/provider completion, retry-safe due generation, PHI-safe analytics and durable reconciliation.

## 4. Master Integration

These four lanes are candidates, not a required launch set. The master launches three or four only after proving that the selected verticals edit their own namespaces and do not share an unfinished CP12 adapter. The master then:

1. reviews schema proposals and produces the single CP13 canonical migration if necessary;
2. merges lanes in schema/contract dependency order determined from handoffs;
3. wires shared exports, route registration, navigation and generated client composition;
4. builds cross-domain read models and clinic-day orchestration only after canonical route/state contracts settle;
5. implements Temporal workflows/activity versioning, stale-lease recovery, replay and reconciliation across the lane events;
6. reconciles lockfile and shared configuration once;
7. runs the end-to-end clinic day against the durable repository and real loaders.

## 5. Required User-Perspective Evidence

- assistant/receptionist: lead → patient → appointment → check-in → intake;
- doctor: consent → encounter → note/prescription → dental chart/media metadata;
- assistant/accountant: treatment/estimate → invoice → valid manual/provider-ready payment state → instructions;
- operations/owner: tasks/recalls/lab/inventory/CAPA → analytics;
- denied accountant clinical routes, assistant signature, wrong tenant and expired/revoked consent;
- desktop and 390px Browser Use plus repeatable Playwright;
- refresh/restart and durable state recovery;
- no console/network errors, fixture fallback, stale route or fake completion.

## 6. Exit Gate

- selected lead-to-continuity clinic day passes twice using runtime IDs and PostgreSQL;
- no claimed UI workflow uses fixture data or an unavailable aggregate route;
- domain, database, audit, timeline, outbox, Temporal and read-model state reconcile;
- crash after commit, duplicate delivery, stale lease, worker restart, workflow replay/version and dead-letter/reconciliation tests pass;
- generated contract/client and live loader shapes match;
- role/tenant/consent/signature/financial negative matrices pass;
- full repository/security/build/browser gates pass;
- CP13 evidence/threat/register/memory/log/final report complete and integration promoted to `main`.

## 7. Final E3 Result — 2026-07-10

The integrated code candidate `9116a8ea` satisfies the CP13 exit gate at durable-local E3:

- the selected clinic day passed twice on clean-origin PostgreSQL with runtime IDs and no fixture
  repository fallback;
- 17 migrations, 100/100 forced-RLS tenant tables, least-privilege runtime/worker access and
  cross-tenant isolation passed before and after the smokes;
- domain, audit, outbox, payment/continuity recovery and reconciliation evidence matched;
- crash-after-commit, stale lease, duplicate delivery, worker restart and Temporal replay passed;
- generated route/client drift stayed clean across all 128 operations;
- API 123/123, DB 93/93, web 86/86, worker 16/16 and enabled Playwright 4/4 passed with zero skips;
- root check, typecheck, lint, test, build, secret scan, SBOM and diff gates passed.

The in-app Browser backend was unavailable, so repeatable Playwright was the documented executed
fallback. Production session/BFF, official providers, production media, cloud/security operations,
restore/failover, devices and real-clinic evidence remain CP14-CP18 gates. CP14 is not started.
