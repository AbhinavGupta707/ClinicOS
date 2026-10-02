# Operator import runs

Scope: canonical ClinicOS CSV, one immutable file per entity type per run, at most
100 rows per file. This extends the existing migration repository and external
identity links. It is not a Practo connector, incremental sync, or approval to use
real patient data.

## Operator walkthrough

1. Sign in to the selected clinic, then open **Import clinic data**. Use synthetic
   data until the clinic's handling conditions and real-data use are approved.
2. Enter an import name identifying the source, then **Start new run**. Use exactly
   the same name for repeat exports from that source: the name scopes external
   identity links. Changing it can prevent replay recognition.
3. Add the patients CSV, inspect every rejected or ambiguous row, resolve only
   identities you can confirm, then explicitly commit accepted rows.
4. Open Practitioners, add the CSV and select existing eligible named doctors.
   Importing a practitioner never creates a staff account or grants access.
5. Open Appointments, validate and commit. The file must reference the patient and
   doctor external IDs and active appointment type/chair codes.
6. Read the run totals. Received rows partition into invalid, needs review, ready,
   committed, skipped, rolled back and failed. Reconciled rows are a subset of
   committed rows: they include reaffirmed evidence, not necessarily unchanged
   source content. Exceptions must remain visible.
7. Open Today and find the patient to verify names, times in the clinic timezone,
   practitioner, source and status. A committed file does not establish that a
   vendor export is complete or current.

## Return, retry and recover

- Saved runs are kept in the database and listed with paginated history. Returning
  to this browser remembers only a run UUID scoped to tenant, clinic and user;
  CSV, patient data and credentials are never put into browser storage by this
  workflow. If browser storage is unavailable, select the run from Saved runs.
- A file is immutable once staged. The server hashes the type, source, file name
  and CSV itself. Retrying exactly that file in the same step recovers its existing
  batch even after ordinary HTTP idempotency retention has expired. A changed
  file or file name conflicts; it cannot silently replace reviewed evidence.
- To correct an occupied step, start a new run with the **same import name**.
  External IDs still control replay and duplicate review. Invalid-only files
  cannot unlock the next step. There is no cancellation or missing-record inference.
- If a response is lost, the interface reloads the exact run and asks you to review
  saved progress before retrying. If that read also fails, it hides the actionable
  review and shows unavailable. It never invents a successful completion.
- Rollback is best-effort compensation. Records with later changes or dependencies
  remain protected. Review blocked counts; reverse-order rollback may be possible
  for untouched imports (appointments, practitioners, patients). Opening a patient
  profile creates a patient-linked access audit record, which can itself block
  deletion. Rollback is not
  a general undo mechanism for subsequent clinic activity.
- Existing ungrouped migration batches remain available through the integration
  operations surface and existing API. They are not silently assigned to a new run.

## Engineering and verification boundary

Migration `0027_operator_import_runs.sql` introduces immutable, forced-RLS run
metadata and a tenant/clinic-scoped foreign key from existing migration batches.
The run/type unique index limits each run to three files. Staging serializes on the
run and locks the previous batch before checking prerequisites. Run creation and
batch creation are audited inside the existing transaction. Only creation emits
creation evidence; identical recovery does not emit duplicate events.

Generated contracts cover create/list/detail. The existing staff BFF allowlist
includes the registered migration-runs family. Reads never depend on the unrelated
provider-health or dead-letter dashboards.

Safe local evidence covers domain, schema, API fixtures, generated routes, web
transport, lint/type/build and secret scanning. Real PostgreSQL race/RLS and the
combined real Keycloak/cookie-BFF import acceptance run only in the existing
marked disposable CI environment. They must pass on the submitted commit before
this work is considered merge-ready.

The combined staff acceptance imports all three files, reopens the run, loses a
completed stage response, retries it, restarts only its owned API process, checks
Today/search, repeats the dataset without duplicate identities, quarantines
changed evidence, and checks guarded reverse-order rollback, preservation after an audited patient
profile read, and safe compensation of a separate untouched patient. The one
intentional response-loss hook forwards the actual request to the API before
aborting delivery; no business response is fabricated. Ordinary success flows
remain unintercepted. Synthetic tests do not prove a real clinic's source mapping,
consent, accuracy, hosted deployment or operational approval.
