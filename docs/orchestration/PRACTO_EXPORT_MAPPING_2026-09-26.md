# Practo export discovery and mapping decision — 26 September 2026

Status: owner-reported CSV structure recorded; offline profile tool tested with
synthetic data. A subsequent bounded patient-demographics trial is implemented
through canonical staging; see the
[trial and parity report](../qa/PRACTO_BASELINE_AND_PATIENT_TRIAL_2026-09-26.md).
No real patient files have been read or imported. Whole-practice and appointment
migration, recurring sync and source validation remain open. The profiling-pass
completion record below describes the earlier work, not the later UI implementation.

## Evidence and scope

- The owner confirmed Healthy Roots- A Family Dental Studio, Sector 50, Gurgaon,
  as the pilot. Authenticated account inspection verified Asia/Kolkata and the
  Ray-Prime-Essentials plan, but not an application build/version.
- After the initial read-only inspection, the owner explicitly authorized the
  official export of Patients and Appointments to the registered practice owner.
  Ray first showed PENDING and subsequently COMPLETED. The owner confirms receipt
  of a ZIP containing `patients.csv` and `appointments.csv`. The UI's word
  "Excel" did not establish an XLS/XLSX format; the received files are CSV.
- The owner supplied headers, described `Date` as `YYYY-MM-DD HH:mm:ss` with
  surrounding apostrophes, and reported `Scheduled` and `Cancelled` statuses,
  also surrounded by apostrophes. These are reported scalar representations,
  not an inspection of the original file's encoding, delimiters or CSV quoting.
- The owner confirms there is no scheduled duration/end column. There are
  check-in and check-out columns, whose use/accuracy at this clinic is unknown.
- No patient identities or rows are needed in Git or chat. Examples below and in
  tests are invented. Authorization to generate an export is not authorization
  to open its contents, send them to an AI provider, or commit them to a database.

## Reported headers

`patients.csv` (21 columns, original order):

```csv
Patient Number,Patient Name,Mobile Number,Contact Number,Email Address,Secondary Mobile,Gender,Address,Locality,City,Pincode,National Id,Date of Birth,Age,Anniversary Date,Blood Group,Remarks,Medical History,Referred By,Groups,Patient Notes
```

`appointments.csv` (8 columns, original order):

```csv
Date,Patient Number,Patient Name,Notes,DoctorName,Status,Checked In At,Checked Out At
```

## What the attendance timestamps mean

Practo's [Ray v7 patient queue guide](https://help.practo.com/practo-ray-v7/calendar-practo-ray-v7/understanding-the-patient-queue-2/)
describes three actions: Check in records arrival and starts waiting time;
Engage marks entry into consultation; Check out ends the consultation. The
[Ray v6 guide](https://help.practo.com/practo-ray/calendar/understanding-the-patient-queue/)
describes the same sequence. These are workflow timestamps. Late or omitted staff
actions can make them unsuitable as precise measurements; that is an inference
from the documented mechanism, not proof of this clinic's practices.

Consequently, check-out minus check-in includes waiting and consultation, when
both are accurate. It does not recover scheduled duration or isolate treatment
time. This CSV has no Engage timestamp. Never create a booking end time from
these columns, and never infer completed/no-show solely from old Scheduled rows.

Practo separately documents [entering appointment duration while booking](https://help.practo.com/practo-ray-v7/calendar-practo-ray-v7/adding-an-appointment/).
Duration can exist in Ray even though this export omits it. The observed
30-minute calendar display grid does not establish any appointment's duration.

There are additional workflows: [Prime integration](https://help.practo.com/practo-prime/prime-integration/)
can mark a patient checked in on the **Prime dashboard** after billing,
prescribing or file sharing. That documentation does not prove that these
actions populate this CSV's `Checked In At` field. Keep the products/fields
distinct until verified. Do not describe exported numeric values as Unix seconds
or milliseconds without a source contract or representative deidentified sample.

The [appointment reports guide](https://help.practo.com/practo-ray/reports/reports-on-appointments/)
lists scheduled time, check-in, waiting, engagement, check-out and category. It is
a possible official route for further investigation, not evidence that those
reports include stable booking IDs or planned duration. No additional export,
provider request or clinic record inspection was performed for this research.

## Proposed mapping and current gates

| Source | Proposed treatment | Evidence still required |
| --- | --- | --- |
| Patient Number | Candidate external patient key; retain as text, including leading zeros | Missing/duplicate counts; stability/reuse across exports; whether apostrophes are literal ID data |
| Patient Name | Canonical full name after validation | Blank-name count; no forced first/last-name split |
| Mobile Number | Candidate primary contact | Missing/invalid values; clinic-approved alternate-phone policy; never invent numbers or merge by shared family phone |
| Email Address / Gender / Date of Birth | Validate explicitly before mapping | Actual vocabulary and birthdate format; do not derive a precise DOB from Age |
| Date | Candidate scheduled start | Confirm one value privately against Ray's displayed booking; verify export timezone rather than assuming the browser/computer timezone |
| Scheduled | Candidate `booked`, not `confirmed` or `completed` | Clinic review; this is source scheduling status, not proof of attendance |
| Cancelled | Candidate `cancelled` for reviewed initial import | Stable booking identity required before an existing record can be cancelled or updated |
| DoctorName | Explicitly map to an existing eligible ClinicOS doctor | Historical names may differ from today's active roster; no automatic staff/account creation |
| Checked In At / Checked Out At | Exclude from scheduled start/end derivation; preserve only under an approved provenance policy | Timestamp format/units and actual clinic use remain unverified |
| Notes and patient free-text/clinical fields | Exclude from initial demographics/schedule mapping | Separate clinical-history migration scope, review, privacy and provenance policy |

Other patient columns (including National Id, Address and Medical History) are not
needed for the first bounded mapping trial. The discovery tool reads CSV text
locally but emits none of those values. A future importer must decide explicitly
which fields it retains, even in raw staging; do not upload the entire raw export
to canonical staging just because the adapter ignores some fields later.

Single apostrophes are not standard CSV quote characters. First parse normal CSV
double-quote escaping correctly. Recognize a paired apostrophe wrapper only for
known scalar fields with a validated grammar. Never globally remove apostrophes
from names, IDs or notes, and never evaluate spreadsheet formulas.

The configured clinic timezone is Asia/Kolkata. If the export is confirmed to use
that local time, an invented `2030-04-20 11:00:00` would become
`2030-04-20T11:00:00+05:30` (05:30 UTC). This conversion is a proposed mapping,
not yet proof of the export's timezone semantics.

### Three appointment gaps that must remain explicit

1. **No stable appointment ID.** Patient number + doctor + time can collide and
   changes when a booking is rescheduled. A hash does not solve that problem.
   Row position also changes across exports. A zero-collision profile of one
   snapshot cannot establish durable identity. Recurring reconciliation remains
   blocked until an official ID is obtained or a reviewed, durable migration
   ledger with explicit reschedule decisions is designed and proven.
2. **No planned duration/end.** Prefer obtaining this through a supported export
   or Practo support. Otherwise a separately approved initial-trial policy must
   visibly label an assumed duration and review every affected booking. No
   default is approved now. Historical source observations should remain outside
   the operational schedule if representing them would require invented facts.
3. **No appointment type.** ClinicOS requires an eligible type. A clinic-approved
   mapping is needed; a Ray location/category label is not a clinical visit type.

Current ClinicOS validation also requires patient phone, stable external
references, explicit-offset start/end instants and doctor/type resolution.
See `packages/domain/src/migration.ts`. The existing UI accepts canonical CSV,
up to 100 rows per entity step in a saved run. A full Ray export must not be
presented as already supported; scalable chunking and reconciliation need their
own complete implementation. Import provenance from Ray must not automatically
label every record's patient-acquisition channel as Practo.

## Offline profile: the next privacy-preserving check

Implemented: `scripts/practo-export-profile.mjs`. This is a developer/clinic
discovery utility, not a migration adapter. It has no network calls, provider
keys, database access, writes, or dependency installs. It reads only the two
explicitly supplied files. Run it yourself on the local machine if you want the
model to see only the resulting summary. Do not upload the original ZIP/CSV.

Keep the ZIP and extracted files outside the repository, for example:
`/Volumes/Spectra/ClinicOS-Pilot-Private/Practo/2026-09-26/`.
With files in that directory, run in Terminal:

```sh
cd /Volumes/Spectra/Projects/ClinicOS
node scripts/practo-export-profile.mjs \
  --patients '/Volumes/Spectra/ClinicOS-Pilot-Private/Practo/2026-09-26/patients.csv' \
  --appointments '/Volumes/Spectra/ClinicOS-Pilot-Private/Practo/2026-09-26/appointments.csv'
```

Adjust the two paths locally if extraction created a subfolder. No report file
is created. Review the terminal output before sharing it: it contains aggregate
clinic counts, not patient records, but aggregate business information may still
be sensitive. The agent has not executed this against clinic files.

Output includes row totals; missing/duplicate patient identifiers; unlinked or
ambiguous appointment references; distinct doctor count (no names); known status
counts (unknown values counted, not printed); timestamp-format counters;
missing phone/name counts; and candidate appointment-key collisions. Duplicate
and collision counts include **all rows in colliding groups**, not only excess
rows. Phone presence is not phone validity. Patient identity checks preserve the
CSV-decoded text exactly, including leading zeros, apostrophes and outer spaces;
whitespace-only IDs count as missing and nonempty padded IDs are flagged. Doctor
name counts trim outer whitespace for diagnostics only, not automatic mapping.

There are no patient values, date ranges, source hashes, row numbers, filenames,
paths, free text, arbitrary header labels or raw errors in the report. Error
messages use a closed set of codes. Malformed quoting/widths, changed headers,
non-UTF-8 content, NULs, nonregular files and exceeded limits fail closed. Input
limits are 32 MiB/file, 100,000 data rows/file, 64 columns, 262,144 characters/cell.
The profile accepts exactly the reported header set, in any order. Files with
other formats need a deliberate reviewed extension; do not resave the originals
to force them through. ZIP extraction is performed locally by the owner.

`importReady` is always false: successful profiling is not successful migration.
Exit code 0 means profiling completed, including any reported issues. Exit 1
means the profile could not safely be produced. No partial profile is printed.

## Completion and next validation

Implemented and locally verified with synthetic data: bounded CSV profiling,
safe error/output handling, exact header checks, date/status counters, cross-file
identifier diagnostics, attendance ordering and collision detection. The tests
are wired into the quality workflow. No production/UI behavior was changed.

Verification on the final local files: all 18 synthetic profile tests passed;
targeted ESLint and Prettier checks passed; `git diff --check` passed. Independent
read-only review found an ID-trimming issue, which was corrected and covered by a
whitespace-distinct-identifier regression. Tests used invented data only. Full
app builds, Docker/database tests, real exports and remote CI were not run for
this isolated discovery utility. Changes remain uncommitted; no push or merge.

Next evidence, in order:

1. Owner-run aggregate profile (optional alternative: answer its checks manually).
2. Privately verify one Date value against the scheduled time shown in Ray; report
   only whether it matches, not the patient or actual date.
3. Obtain a supported duration/ID route or approve a reviewed initial-import
   policy with clearly constrained recurring behavior; approve doctor/type mapping.
4. Make a small synthetic pack matching the confirmed wire format. Include
   repeats, reschedules, cancellations and collisions across two snapshots.
5. Implement the source adapter through existing canonical staging/review, then
   prove replay/recovery/reconciliation against the synthetic real stack before
   requesting permission for a scoped real clinic trial.

No real data import, browser scrape, source writeback, service start, merge or
push is part of this discovery pass.
