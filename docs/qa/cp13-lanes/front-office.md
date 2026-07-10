# CP13 Lane A — Front Office and Intake Evidence

## Scope and claim

This lane implements the complete frozen `CP13_FRONT_OFFICE_OPERATION_IDS` handler map (26
operations), namespaced front-office domain invariants, generated-client web loaders/components,
and lane-specific deterministic tests. Evidence in this lane is E1 only. Durable PostgreSQL,
registered-route, rendered-browser and checkpoint-wide E3 claims remain master integration gates.

Data is synthetic and contains no real PHI. The lane performed no provider, credential, cloud,
dashboard or other live external actions.

## Handler boundary

- Every handler receives only the parsed CP12 request, verified clinic access, bounded request
  metadata, injected clock and transaction-bound module ports.
- Patient, lead and attribution work uses `patientAdministration`; appointments and queue use
  `scheduling`; intake and preparation use `clinicalCare`; audit/outbox uses `evidence`.
- Per the master resolution, only `getMorningDashboard` additionally consumes the authoritative
  transaction-bound `clinicOperations.loadDashboardData(date)` read model. It supplies durable
  open tasks and returning-patient classification. No Lane D path or shared port was edited.
- Tenant, clinic and actor authority never comes from a request body. Scoped-port tests prove the
  verified scope is injected by the transaction binding and that ports expire after the unit of
  work.
- Mutation retry/replay and optimistic concurrency remain owned by the CP12 transactional mutation
  coordinator. Handler outbox evidence carries the parsed idempotency key and request correlation
  ID. Semantic duplicate check-in and same-state transitions do not repeat queue or status effects.

## Functional coverage

- Patients: search/list, ambiguity-safe create, explicit lead match, read, update and public timeline
  projection. Any duplicate candidate fails closed before creation until an explicit master-owned
  resolution contract exists.
- Leads and attribution: manual/official-source capture, first-touch and booking-touch attribution,
  explicit patient matching, state validation and appointment conversion.
- Scheduling: configuration reads, appointment list/create, active clinic appointment-type/chair and
  provider-schedule validation, provider/chair conflict detection, confirm/update/check-in/no-show
  transitions and runtime IDs. Conflict override fails closed because current durable exclusion
  constraints cannot honor it.
- Queue/day start: clinic-local date derivation, no UTC date slicing, transition validation,
  idempotent same-day check-in queue behavior, clinic-local appointment/day equality and
  authoritative morning dashboard composition.
- Intake/preparation: versioned template list/create, active-template validation, durable form
  submission evidence and authorized patient preparation from patient, appointment, intake,
  consent and timeline ports. All reported data coverage is actually loaded; no unavailable
  aggregate or fixture fallback is returned.
- Web: generated `ClinicOsApiClient` loaders for clinic day, patient preparation and scheduling
  configuration; mutation helpers for patient create, check-in and intake; honest loading,
  unavailable and error states; refresh drops stale data after a failure; responsive grids use
  `minmax(min(100%, 18rem), 1fr)` with bounded width/min-width.

## Verification

Base revision before lane commit: `3d3c5c2e64a4cbb1af6da318c995cdda90b9fb83`.

| Command                                                                                                                                                                       | Result                                                                                                                                                                                                                                                                                                                                         | Skips |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----: |
| `node --test packages/domain/test/cp13-front-office-domain.test.ts packages/db/test/cp13-front-office-port-boundary.test.ts apps/api/test/cp13-front-office-handlers.test.ts` | Pass, 18/18. Includes exact 26-ID coverage, response-contract parsing, duplicate fail-closed behavior, scoped active scheduling configuration and provider-window checks, disabled override, same-day check-in, attribution category/evidence, wrong-scope defense, queue invalid state, clinic-local date and authoritative dashboard inputs. |     0 |
| `npm --workspace @clinic-os/web test -- cp13-front-office-loaders.test.ts`                                                                                                    | Pass, 6/6. Generated-client calls, refresh-safe failure, authentication versus permission classification, unknown-error masking, scoped-resource versus registration failure classification, patient preparation and 390px-relevant structure.                                                                                                 |     0 |
| `npm --workspace @clinic-os/api run typecheck`                                                                                                                                | Pass using the existing primary-checkout dependency installation through ignored local symlinks.                                                                                                                                                                                                                                               |     0 |
| `npm --workspace @clinic-os/domain run typecheck`                                                                                                                             | Pass.                                                                                                                                                                                                                                                                                                                                          |     0 |
| `npm --workspace @clinic-os/db run typecheck`                                                                                                                                 | Pass.                                                                                                                                                                                                                                                                                                                                          |     0 |
| API/domain/DB lane lint and `node --check`; lane Prettier check                                                                                                               | Pass.                                                                                                                                                                                                                                                                                                                                          |     0 |

The isolated worktree initially had no dependencies. `npm ci --ignore-scripts` was attempted but
failed with `ENOSPC` and its partial ignored install was removed. Read-only dependency symlinks to
the already-installed primary checkout were used for focused verification without changing a
manifest or lockfile.

For this correction pass the worktree again had no dependency links. Domain/port tests ran directly;
API and web tests used temporary `/private/tmp` resolution configuration against the repository
sources and the read-only primary-checkout test binaries. Targeted strict API/domain compilation
passed. No dependency, manifest, lockfile or product path outside this lane was changed.

The web package's full typecheck could not be claimed in this lane: the primary checkout currently
provides a newer TypeScript/toolchain that fails existing `globals.css` side-effect resolution and
the generated client's existing `Uint8Array` `BodyInit` line. The compiler reached the lane files;
the only lane-local literal error it reported was corrected. Focused Vitest execution passes.

## Schema decision

No schema proposal was created. Existing durable patients, leads, attribution touches,
appointments/status history, queue entries, intake templates/submissions, audit, timeline and
outbox schema plus the frozen module ports cover this lane. The previously reported morning
dashboard issue was a port-discovery issue resolved by the existing transaction-bound
`clinicOperations.loadDashboardData` read model; it was not a schema gap.

## Master integration follow-ups

1. Register `createFrontOfficeFeatureHandlerMap()` in shared feature composition and remove the
   corresponding internal legacy-dispatch fallback for these 26 operations.
2. Add the namespaced web surface to shared routes/navigation and run real generated-client loader
   smoke against the integrated API; do not enable a fixture fallback.
3. Declare `@clinic-os/api-client-generated` in the web app manifest and reconcile the root lockfile.
4. Export the namespaced front-office domain helpers through the master-owned domain barrel (and
   replace the temporary repository-relative import if desired).
5. Ensure the continuity/workflow integration consumes the durable
   `appointment.confirmation_requested` outbox event to create/maintain confirmation tasks. The
   front-office lane does not call Lane D's continuity repository directly.
6. Run route-level wrong-role/wrong-tenant, same-key replay, ETag conflict, clean PostgreSQL restart,
   audit/outbox/timeline reconciliation, Browser Use and repeatable Playwright at desktop and 390px.
7. Add frozen event/audit taxonomy and durable timeline support for lead status changes and intake
   template creation before requiring evidence for those mutations. This lane deliberately does not
   mislabel them as existing lead-created, form-response, or unrelated audit events.
8. Add an explicit duplicate-resolution operation/contract before allowing staff to create a patient
   when scoped duplicate candidates exist; the lane currently fails closed without writing.
