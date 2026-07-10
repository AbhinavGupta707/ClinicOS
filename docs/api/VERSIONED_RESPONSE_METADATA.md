# Versioned Resources and HTTP Response Metadata

**Evidence level:** generated contract truth only

**Runtime activation:** not yet claimed; the master-owned API/repository follow-up below is required

## Canonical version shape

`VersionedPublicResource` is a bounded public record that requires:

- `id`: the canonical UUID of the mutable table row;
- `rowVersion`: a positive JavaScript-safe integer; and
- recursively filtered additional public fields.

The canonical strong ETag for row version `N` is `"rv-N"`, including the quotes. Weak, unquoted,
zero, signed, padded and unsafe-integer values are invalid. `If-Match` uses exactly this format.

Reduced search hints, summaries, history entries, snapshots and other projections are not mislabeled
as versioned resources. In particular, duplicate patient suggestions and patient-preparation patient
or appointment fragments remain bounded projections without `rowVersion`.

## Existing response mapping

No routes were added. The registry maps the current 128-operation surface as follows; `[]` means
that every item carries its own `rowVersion`.

| Family              | Conditional update               | Existing version sources                                                                                                                                                                                                                                                                                                                                              |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Patient             | `updatePatient`                  | `listPatients.patients[]`; `createPatient.patient`; `getPatient.patient`; `updatePatient.patient`                                                                                                                                                                                                                                                                     |
| Lead                | `updateLeadStatus`               | `createPatient.matchedLead`; `listLeads.leads[]`; `createLead.lead`; `matchLeadToPatient.lead`; `convertLeadToAppointment.lead`; `updateLeadStatus.lead`; `getMorningDashboard.dashboard.openLeads[]`                                                                                                                                                                 |
| Appointment         | `updateAppointment`              | `convertLeadToAppointment.appointment`; `listAppointments.appointments[]`; `createAppointment.appointment`; `updateAppointment.appointment`; `confirmAppointment.appointment`; `checkInAppointment.appointment`; `markAppointmentNoShow.appointment`; `getMorningDashboard.dashboard.unconfirmedAppointments[]`; `getMorningDashboard.dashboard.todaysAppointments[]` |
| Queue entry         | `updateQueueEntry`               | `checkInAppointment.queueEntry`; `listQueue.queue[]`; `updateQueueEntry.queueEntry`; `getMorningDashboard.dashboard.queue[]`                                                                                                                                                                                                                                          |
| Encounter           | `saveEncounterClinicalNoteDraft` | `createEncounter.encounter`; `getEncounter.encounter`; `startEncounter.encounter`; `saveEncounterClinicalNoteDraft.encounter`; `signEncounterClinicalNote.encounter`; `amendEncounterClinicalNote.encounter`                                                                                                                                                          |
| Dental finding      | `updateDentalFinding`            | `getPatientDentalChart.findings[]`; `createPatientDentalFinding.finding`; `createEncounterDentalFinding.finding`; `updateDentalFinding.finding`                                                                                                                                                                                                                       |
| Treatment plan      | `updateTreatmentPlan`            | `createPatientTreatmentPlan.treatmentPlan`; `updateTreatmentPlan.treatmentPlan`; `acceptTreatmentPlan.treatmentPlan`; `createEncounterProcedurePerformed.treatmentPlan`                                                                                                                                                                                               |
| Task                | `updateTask`                     | `listTasks.tasks[]`; `createTask.task`; `updateTask.task`; `generateDueContinuityTasks.recallTasksCreated[]`; `generateDueContinuityTasks.followUpTasksCreated[]`; `getMorningDashboard.dashboard.openTasks[]`                                                                                                                                                        |
| SOP run             | `updateSopRun`                   | `listSopRuns.sopRuns[]`; `generateDueSopRuns.sopRunsCreated[]`; `updateSopRun.sopRun`                                                                                                                                                                                                                                                                                 |
| Lab case            | `updateLabCase`                  | `listLabCases.labCases[]`; `createLabCase.labCase.labCase`; `updateLabCase.labCase.labCase`                                                                                                                                                                                                                                                                           |
| Inventory check run | `updateInventoryCheckRun`        | `createInventoryCheckRun.checkRun.run`; `updateInventoryCheckRun.checkRun.run`                                                                                                                                                                                                                                                                                        |
| Corrective action   | `updateCorrectiveAction`         | `listCorrectiveActions.correctiveActions[]`; `createCorrectiveAction.correctiveAction`; `updateCorrectiveAction.correctiveAction`                                                                                                                                                                                                                                     |

Lab-case and inventory-check mutations return detail objects. Their canonical row-version sources are
therefore nested; flattening those response contracts would contradict current runtime behavior.
SOP-run and treatment-plan public helpers already flatten their canonical records and remain
top-level versioned resources.

## Response header contract

- Every declared response requires `x-request-id`.
- Every successful header-idempotent mutation requires `idempotency-replayed` with wire value
  `false` on first execution or `true` on replay.
- A successful representation with exactly one discoverable singleton versioned resource requires
  `ETag`, including singleton GETs. The ETag is derived from the mapped nested or top-level
  `rowVersion`.
- Collection responses do not emit a collection ETag. Each versioned list item carries its own
  `rowVersion`.
- Every `429` response requires `Retry-After` as bounded delta-seconds from `1` through `86400`.

The generated client preserves all body-returning methods and adds `<operation>WithMetadata`
companions. Metadata exposes status, request ID, ETag, replay truth and parsed retry seconds. A
`ClinicOsApiError` carries the same response metadata so callers can honor `Retry-After`.

## Master-owned integration requirements

Before these contracts can be activated, the master/API-repository integration must:

1. Select and return each canonical table's `row_version` as public `rowVersion` in every mapping
   above, including list and dashboard aggregate loaders.
2. Update explicit public shapers that currently omit the field, notably `publicTask`, and preserve
   the nested `LabCaseDetail.labCase` and `InventoryCheckRunDetail.run` shapes.
3. Make `saveEncounterClinicalNoteDraft` fail closed if the post-write encounter cannot be loaded;
   its response contract no longer permits a null version source.
4. Parse canonical `If-Match`, perform the conditional update and increment in one repository
   statement/unit of work, then derive the response ETag from the committed `rowVersion`.
5. Emit `x-request-id` on every response, `idempotency-replayed: false|true` on every successful
   header-idempotent mutation, the required singleton ETag, and bounded `Retry-After` on `429`.
6. Validate response bodies and declared response headers before sending them. Do not synthesize a
   collection ETag.
7. Remove the fixture-only Razorpay content-type rewrite. Provider requests remain
   `application/json`; the parser must retain the exact bounded raw bytes for signature verification
   before JSON parsing.

Until those changes pass integrated durable tests, generated OpenAPI/client output describes the
required target boundary and does not prove that the native runtime already emits the new fields or
headers.
