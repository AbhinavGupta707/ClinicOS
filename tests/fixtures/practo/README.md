# Synthetic Practo patient trial

`patients-synthetic.csv` contains two wholly invented patients, using the
owner-reported 21 headers. It is a test fixture, not a deidentified clinic export
and not proof of the actual Ray wire format. Never upload it into Practo or a real
clinic database. Use only the isolated ClinicOS synthetic environment.

1. Open Import clinic data, start a new run with a unique trial import name.
2. Choose **Practo Ray patients.csv — demographics trial** and select this file.
3. Expect two prepared rows. Address, National Id, Medical History and Patient Notes
   are excluded. Acknowledge the limited scope, then validate.
4. Review two ready rows (or resolve an existing synthetic duplicate explicitly).
   No record is created until commit. Commit, reload, and verify the same saved
   run and patient-only scope.
5. Search for `Synthetic Trial One` and `Synthetic Trial Two` in Patients. An exact
   repeated file in the saved run must recover the same batch rather than create
   duplicate patients. Keep the same import name for later snapshots of the same
   source; changing it creates a separate external-identity namespace.
6. Rollback is best-effort. Accessing a full patient profile creates audit evidence
   and can correctly prevent deletion. Disposable test databases are not a promise
   that production imports can be universally undone.

The file contains no appointments. A successful trial does not establish full
practice migration, historical clinical/financial transfer, scheduled sync or
live staff identity. See `docs/qa/PRACTO_BASELINE_AND_PATIENT_TRIAL_2026-09-26.md`.


## Whole patient-file workflow (up to 5,000)

The small demographics trial remains available for compatibility. For the new
workflow, start an empty run and choose **Whole Practo patient file (up to 5,000)**.
Select the CSV, review field exclusions, upload, review any identity conflicts,
and explicitly approve commit. The browser handles groups of at most 100; staff
must not split the original file. Closing the page pauses new groups. Reopen the
run and reselect the same CSV to finish an upload, or resume committed progress
without the file once upload is complete. Each group commits separately.

The real-stack Playwright suite generates 5,000 synthetic patients in memory;
there is no large PHI-containing fixture to download. It tests upload/commit
pause and reload, a 5,001-row rejection, final patient search and a complete
repeat snapshot. `scripts/test-patient-file-repositories.mjs` follows it with
independent SQL reconciliation, concurrent receipt/commit, RLS, immutable
metadata and same-file identity review checks. Both require an explicitly marked
local disposable database and synthetic-data guards. They do not provision or
reset an existing clinic database. See
`docs/qa/PATIENT_FILE_5000_ACCEPTANCE_2026-09-26.md` for results and limits.
