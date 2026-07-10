# CP13 Lane D — Continuity, Operations and Analytics

## Scope and outcome

Lane D implements an exact 34-operation handler map for `CP13_CONTINUITY_OPERATIONS_OPERATION_IDS` under the CP13 feature seam. Handlers consume only contract-parsed verified requests, the injected clock, transaction-bound `continuity`, `clinicOperations`, and `evidence` ports. No handler accepts caller-supplied tenant, clinic, actor, or unparsed request authority.

The lane also provides:

- continuity/operations domain policies for terminal states, attributable evidence, manual/provider truth, aggregate freshness, and PHI-safe inventory analytics inputs;
- a generated-client-shaped web loader with parallel durable reads, explicit fresh/stale/unavailable states, and no fixture or handwritten-fetch fallback;
- an accessible overview component that does not infer procurement, delivery, payment, or workflow completion;
- lane tests covering exact map ownership, contract parsing, role/tenant denial, state rejection, retry skips, audit/outbox, reconciliation truth, RLS/durable uniqueness, freshness, and the real generated-client route/header family.

## Schema decision

No schema proposal was created. The existing CP6 schema already provides:

- forced tenant/clinic RLS for continuity, lab, inventory, incident, and CAPA tables;
- unique task idempotency and SOP generated-from keys;
- append-only lab status and stock ledger evidence;
- durable lab reconciliation rows and entries;
- procurement suggestions explicitly separated from purchase execution;
- task, SOP, and CAPA completion evidence constraints.

The identified gaps are shared repository/public composition and orchestration concerns, not missing durable tables. The master owns the corrected `loadOwnerDashboardProjectionData` adapter and bounded due catch-up/reconciliation contract.

## Emitted outbox event types

The lane emits only frozen `DomainEventType` values:

- tasks: `task.created`, `task.status_changed`, `task.completed`, `task.due`;
- recalls: `recall.rule_created`, `recall.due`, `recall.sent`, `recall.action_recorded`, `recall.completed`;
- SOP: `sop_template.created`, `sop_schedule.created`, `sop_run.created`, `sop_run.updated`, `sop_run.completed`;
- lab: `lab_vendor.created`, `lab_slip.generated`, `lab_case.created`, `lab_case.sent`, `lab_case.received`, `lab_case.returned`, `lab_case.completed`, `lab_case.cancelled`, `lab_case.status_changed`, `lab_reconciliation.created`;
- inventory: `inventory_category.created`, `inventory_item.created`, `inventory_stock.adjusted`, `inventory_check.created`, `inventory_check.completed`, `inventory.low_stock_detected`, `inventory.procurement_suggested`;
- incident/CAPA: `incident.created`, `corrective_action.created`, `corrective_action.status_changed`, `corrective_action.completed`.

`inventory_check.created` is emitted for both `inventory_check_template` and `inventory_check_run` aggregate types because the frozen taxonomy has no distinct template-created event. Consumers must branch on `aggregateType`/`entityKind`; the master should decide whether to extend the shared taxonomy before Temporal registration.

Every emitted event is paired with classified audit evidence in the same transaction-bound evidence port. Audit identifiers are deterministic per request/action/resource/ordinal, event timestamps come only from the injected clock, correlation uses the verified request ID, and mutation idempotency uses the parsed header.

## Temporal and reconciliation requirements for master

The master must not register workflows until these integration requirements are met:

1. Wire the exact handler map into shared feature dispatch inside the existing atomic mutation transaction. Do not route these operations through the legacy compatibility handler after activation.
2. Add bounded due-generation catch-up with a durable batch limit/cursor, deterministic window identity, continuation/retry policy, and reconciliation for partial/dead-lettered batches. The current frozen port exposes only `asOf`; lane code intentionally does not invent a conflicting public contract.
3. Version Temporal workflows and activities for task/recall/SOP due processing. Replay must use outbox identity/idempotency keys, not wall-clock time or an unversioned current rule definition.
4. Prove crash-after-commit recovery: committed outbox rows must be delivered after worker restart without recreating source rows, audit rows, tasks, recalls, or SOP runs.
5. Prove duplicate delivery and workflow replay do not advance terminal task, recall, SOP, lab, inventory-check, or CAPA states twice.
6. Reconcile outbox, workflow state, domain rows, audit rows, and any timeline projection. Dead-letter evidence must expose an honest retry/review state without asserting provider delivery, vendor completion, procurement execution, or payment.
7. Treat `recall.sent` as attributable manual contact/request evidence only. It is not provider accepted/delivered/read evidence.
8. Treat `lab_reconciliation.created` as matching/variance evidence only. It never pays a vendor or settles an accounting liability.
9. Treat `inventory.procurement_suggested` as a review suggestion only. It never creates a purchase order or confirms receipt. Stock changes occur only through an evidenced ledger entry.
10. Apply optimistic concurrency at the shared coordinator for `updateTask`, `updateSopRun`, `updateLabCase`, `updateInventoryCheckRun`, and `updateCorrectiveAction`; rerun stale-ETag and rollback tests after wiring.
11. Use the master-corrected owner projection port and preserve its `dataSources` truth. Request-time analytics has no materialized rebuild action; if a source is unavailable, the API/web state must remain unavailable rather than return empty-array completeness.

## Web composition requirements for master

- Add the generated API client as an explicit web workspace dependency in the master-owned manifest/lockfile and inject the real `ClinicOsApiClient` into `loadContinuityOperationsOverview`.
- Fix or adapt the generated raw-body `Uint8Array<ArrayBufferLike>` type for DOM `BodyInit`; direct TypeScript source import currently fails the web DOM type gate. The lane loader therefore uses the exact structural generated-client subset while a runtime test proves the real generated client calls all nine durable route families with bearer and clinic headers.
- Wire the overview into master-owned navigation/layout only after route dispatch is active.
- Run Browser Use plus repeatable Playwright at desktop and 390px. Verify no horizontal overflow, reachable controls, loading/error/unavailable states, refresh durability, no console/network errors, and no fixture fallback.

## Verification

Passed locally:

- `npm run build:shared`
- `npm run typecheck --workspace @clinic-os/domain`
- `npm run typecheck --workspace @clinic-os/api`
- `npm run typecheck --workspace @clinic-os/web`
- `npm run lint --workspace @clinic-os/domain`
- `npm run lint --workspace @clinic-os/api`
- `npm run lint --workspace @clinic-os/web -- --no-warn-ignored`
- domain full suite: 59 passed, 0 failed;
- API full suite: 67 passed, 0 failed, 17 skipped because sandbox socket binding is unavailable;
- DB full suite: 71 passed, 0 failed;
- web full suite: 67 passed, 0 failed;
- focused lane tests: 8 API handler tests, 5 domain policy tests, 4 DB durability tests, and 6 web loader/generated-client tests passed.

`npm run check:clock` could not provide a clean repository result after dependency installation because it scans generated nested `packages/config/node_modules/zod/**` benchmark/test sources. All reported findings were third-party Zod files; a direct scan of lane product paths found no `new Date()` or `Date.now()` wall-clock read. The only date construction in the lane parses an explicit timestamp, while current time always comes from the injected clock.

## Honest limitations and follow-ups

- Shared route registration/dispatch, public exports, manifests/lockfile, generated artifacts, navigation, Temporal composition, and canonical repository changes are master-owned and intentionally untouched.
- The lane does not claim live PostgreSQL, worker restart, workflow replay, browser, provider, cloud, or physical-device evidence. Full suites use repository/domain test doubles or static durability checks where applicable.
- The API suite's 17 socket-based integration tests remain skipped by the sandbox; master must rerun them where loopback binding is permitted.
- Browser smoke is blocked until the master wires the new feature into registered routes and navigation.
- Bounded due-generation batching/cursors and the corrected owner projection are accepted master integration work and remain checkpoint exit gates.
