# CP13 Lane B — Clinical and Dental Evidence

## Lane identity and frozen inputs

- Lane: CP13 Lane B — Clinical and Dental.
- Frozen base: `3d3c5c2e64a4cbb1af6da318c995cdda90b9fb83`.
- Start state: clean detached worktree; `codex/integration/checkpoint-13` resolved to the same commit.
- Frozen contracts consumed without modification:
  `apps/api/src/features/contracts.ts`,
  `apps/api/src/features/cp13-operation-ownership.ts`, the CP12 generated contracts/client,
  and transaction-bound `@clinic-os/db` module ports.
- No credentials, live providers, cloud resources, production records, or PHI were accessed.

## Implemented scope

The exact frozen 22-operation map is implemented and checked at factory construction:

1. `listPatientConsents`
2. `createPatientConsent`
3. `revokePatientConsent`
4. `createEncounter`
5. `getEncounter`
6. `startEncounter`
7. `saveEncounterClinicalNoteDraft`
8. `signEncounterClinicalNote`
9. `amendEncounterClinicalNote`
10. `createEncounterPrescription`
11. `signPrescription`
12. `getPatientDentalChart`
13. `createPatientDentalFinding`
14. `createEncounterDentalFinding`
15. `updateDentalFinding`
16. `listDentalFindingHistory`
17. `createDentalChartSnapshot`
18. `requestMediaUploadUrl`
19. `receiveMediaUploadContent`
20. `completeMediaUpload`
21. `listPatientMediaAssets`
22. `createSignedMediaAccess`

Handlers consume only centrally parsed requests and verified access context, use an injected clock,
and mutate through the transaction-bound `clinicalCare`, `dentalTreatment`, `clinicalMedia`, and
`evidence` ports. Patient/appointment/provider/finding relationships are resolved by the required
typed `ClinicalDentalRelationshipAuthority`; storage and inspection are required typed providers
for media operations and have no product fallback.

The generated-client web feature contains real list, upload, completion, and signed-access calls.
It exposes honest loading, denied, unavailable, and error states and has no fixture or direct-fetch
fallback. A latest-load generation guard prevents a deferred patient/encounter A response or error
from overwriting the current patient/encounter B state.

## Safety and integrity controls

- Treatment consent gates encounter treatment, clinical notes, prescriptions, and dental changes.
- Photo capture gates patient-supplied media ingestion; photo sharing gates signed access. Durable
  raw-audio ingestion and access require both AI-audio capture and raw-audio retention consent.
- Consent revocation is effective immediately under the injected clock and blocks subsequent gated
  activity. A note amendment remains permitted after revocation only as an additive correction to
  an already signed clinical record; it cannot replace or delete the signed version.
- Only an active doctor may own an encounter. Signing notes, appending amendments, and signing
  prescriptions additionally require that the doctor is the encounter's assigned provider;
  delegation is unsupported and fails closed until a durable delegation model exists. Assistants
  may draft but cannot sign.
- Tenant, clinic, patient, appointment, encounter, dental-finding, and media relationships fail
  closed. AI-originated dental findings remain drafts until a doctor explicitly reviews them.
- Dental numbering is validated as FDI permanent dentition; revisions are additive, history is
  ordered, and snapshots retain the source finding versions.
- Media has a 100 MiB binary budget, allowlisted MIME types and filename extensions,
  SHA-256/size/MIME verification, expiring reservations, provider identity checks, restart-safe
  provider stat verification, required inspection/quarantine for patient-supplied content, and
  short-lived signed access. Client basenames are not persisted or returned; a server-generated
  non-PHI basename retains only the validated extension.
- Upload and signed-access provider results are projected into narrow DTOs after method, mediated
  URL, byte budget, header, and expiry validation. Provider-only fields are discarded.
- Responses and audit/outbox metadata never expose storage object keys, filesystem paths, provider
  internals, or signed URLs except the dedicated signed-access response.
- Successful mutations emit transaction-bound audit/outbox evidence, and clinical/dental mutations
  append timeline events. Outbox idempotency keys are scoped to tenant, clinic, actor, operation,
  and request key so the database-wide uniqueness constraint cannot suppress unrelated clinic or
  actor evidence.

## Schema decision

A durable gap is proven, so the lane includes the noncanonical proposal
`packages/db/schema-proposals/cp13/clinical-dental.sql`. Existing tenant-only foreign keys do not
prove that an appointment, encounter, dental finding, note, prescription, or media association
belongs to the same patient. The proposal adds patient-scoped composite identities/foreign keys and
a preflight that fails on historical wrong-patient associations.

The proposal also describes provider-receipt fields between object upload and completion. This
does not fix durable receipt persistence: master integration must reconcile the fields into the
single canonical CP13 migration and add a transaction-bound
`clinicalMedia.recordReceivedContent` repository port. The corrected proposal references
`patients.clinic_id` and retains restrictive deletion for clinical notes and prescriptions.
Active-doctor assignment is time-varying and deliberately remains an application/RLS
relationship-authority decision rather than a static foreign key.

## Verification

All commands were run from the lane worktree with no live service or provider dependency.

| Verification                         | Result                                                                                        | Skips |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | ----- |
| Focused API/domain/db/web CP13 tests | 17/17 passed                                                                                  | 0     |
| `npm run test -w @clinic-os/api`     | 83/83 passed (rerun with sandbox permission for loopback sockets)                             | 0     |
| `npm run test -w @clinic-os/web`     | 66/66 passed                                                                                  | 0     |
| `npm run test -w @clinic-os/domain`  | 57/57 passed                                                                                  | 0     |
| `npm run test -w @clinic-os/db`      | 69/69 passed                                                                                  | 0     |
| Root `npm run test`                  | Passed across every workspace                                                                 | 0     |
| Root `npm run check`                 | Passed, including formatting, clock guard, environment validation, and 15-migration integrity | 0     |
| Root `npm run typecheck`             | Passed                                                                                        | 0     |
| Root `npm run build`                 | Passed                                                                                        | 0     |
| `node scripts/check-clock-usage.mjs` | Passed                                                                                        | 0     |

The initial sandboxed API test invocation could not open its loopback test listener and reported 17
environmental skips. The approved loopback rerun passed all 83 API tests with zero skips, and the
final root test gate also passed with zero skips.

Evidence level is E1/E2 for the isolated lane: policy, handler, provider-contract, generated-client
loader, schema-proposal, build, and regression evidence is deterministic. E3 is not claimed. The
lane does not own route registration, canonical migrations/repositories, application navigation,
or production provider wiring, so it cannot honestly prove an actual Postgres transaction,
restart across processes, rendered registered route, RLS enforcement, or live storage/scanner.

## Limitations and master follow-ups

1. Reconcile the SQL proposal into the canonical CP13 migration, implement the receipt repository
   port, run it against real Postgres, and verify RLS plus wrong-patient/tenant negatives.
2. Implement the transaction-bound relationship authority over patient/scheduling data and active
   clinic doctor assignment; do not add an allow-all fallback.
3. Wire the exact handler map into the master feature/route composition and retain central parsed
   request, authorization, idempotency, concurrency, and denial controls.
4. Fix the generated-client source generator's raw `Uint8Array` to `BodyInit` narrowing, regenerate
   master-owned artifacts, and declare the web package dependency. The lane web loader accepts the
   exact structural subset, so a real generated `ClinicOsApiClient` instance is compatible without
   a fallback.
5. Export the new domain module through the master-owned shared barrel/subpath and then replace the
   lane's temporary deep relative type imports.
6. Wire official storage and inspection/quarantine providers. Keep media operations honestly
   unavailable when either provider is absent; production object storage/scanning remains CP14
   work.
7. Persist denied-attempt audit evidence at the central boundary if required. An audit append inside
   a failed mutation transaction rolls back with that mutation and must not be presented as durable
   denial evidence.
8. After composition, run route-level Postgres/restart/idempotency/audit/outbox/timeline checks and
   Browser Use plus repeatable Playwright at desktop and 390 px. Browser evidence was not possible
   without writing forbidden navigation/route composition files.
9. Reconcile deterministic fixtures, live API routes, and web loaders to this single production
   contract before checkpoint promotion. This lane does not claim checkpoint or release completion.
