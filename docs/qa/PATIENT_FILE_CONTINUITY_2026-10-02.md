# Patient-file continuity — 2026-10-02

## Integrated baseline

PR #7 merged into `mac-latest-20260829` as `07275ce3facd08d81f1843f7d525c3ee2371c862`, from reviewed head `d92c54be3f296a1ca748bfc0908c03511cf5deb5`. The merge tree is identical to the reviewed head. Both final quality runs (37014136189 and 37014130609), both real staff identity jobs, CodeQL, SCA/IaC/secrets/SBOM/licenses and all six image checks passed. PR #5 was automatically marked merged. All commits of draft PR #6 are ancestors of the merge; the redundant draft was closed without deleting its branch.

This separate patient-file slice builds on that baseline. It does not change source records on Practo, enable providers, deploy, or establish live clinic acceptance.

## Scope and behavior

- Documents, X-rays and intraoral photographs have an explicit type and source clinic/system. An optional source record date is independent of upload time; unknown dates remain unknown.
- The existing mediated upload contract and idempotent reserve/content/complete requests are retained. Local filename/read errors leave the form editable; an uncertain server outcome retains the original request and retry keys.
- Patient files use bounded, type-filtered keyset pages with upload time and UUID tie-breaking. Metadata and exact history reads enforce tenant, clinic, patient and deleted-file boundaries. Migration 0033 adds partial indexes without changing existing assets.
- History opens the exact linked media asset, independent of whether it is in the first file page. Metadata reads are audited and expose sanitized filenames, without private storage pointers.
- Content access remains separate from metadata. Consent, provider verification and clean scan evidence govern the server's signed access operation. Pending/quarantined/failed files remain unavailable; a client label or source date cannot grant access. The UI exposes an explicit short-lived link and clears it on expiry, eligibility/selection change or unmount.

## Rehearsal recipe

Use only a disposable synthetic environment until the clinic authorizes real-data handling. Select a synthetic patient in Dental and media. Add a PDF with a former-clinic source and known historical date, then add an X-ray with an unknown date. Verify exact type/source/date, filter the list, refresh and open the corresponding history metadata. An interrupted response must use **Retry previous request**, and result in one asset. Check another patient and a restricted staff role cannot access the record.

The default local media simulator deliberately remains pending. It can rehearse upload and metadata, but cannot prove clinical file viewing. Private content viewing requires the existing registered storage/scanner contracts to be configured and verified with synthetic files, including clean and quarantined results, consent revocation and expired access. Follow `infra/runbooks/private-media-s3-kms.md`; credentials alone do not prove activation. No live provider activation was performed in this task.

Raw Practo Contacts/Appointments exports do not supply all historic clinical files. Before retiring the clinic's old workflow, agree an authorized file export/manual attachment procedure and record what history is covered or still available only in the source system. Do not reinterpret an uploaded historic document as a signed ClinicOS note or infer missing dates/treatment.

## Verification

Evidence is retained under `.audit-spectra-retirement-20260920/patient-files-20261002/`. Results:

- `final-gates.json`: all eight gates passed — workspace check, typecheck, lint, tests, production builds, generated contract drift, registered route inventory and secret scan. The inventory covers all 175 current routes.
- Workspace tests: 1,190 passed, with 17 HTTP tests skipped because the sandbox denies socket binding. `api-socket-tests.log` then executes the complete API suite outside that restriction: 226 passed, zero skipped. Together these cover 1,207 distinct workspace tests.
- `native-6hqvc788/`: all 12 import/front-desk browser scenarios passed, including 5,000 patients and duplicate-free replay. The independent import repository probe reconciles 5,000 patients and 10,000 staged rows across two snapshots, with concurrency and isolation checks. This run's subsequent new daily scenario initially failed because its synthetic consent fixture omitted required provenance; it is superseded below for daily evidence.
- `native-oq4f4nu8/`: fresh PostgreSQL/Redis, all 33 migrations/validation/seed/grants/verification, API integration checks, financial/appointment/history repositories, and 137 equal-time media records across stable pages passed. All ten daily browser scenarios passed. Independent read-only reconciliation confirms 53 file assets, 53 timeline entries, 53 audit events and 53 outbox events, all still pending scanning, alongside unchanged clinical/financial workflow totals.
- Browser coverage includes local invalid-file recovery, interrupted completion with the same idempotency key and one resulting asset, 52-document paging, exact old metadata, DICOM with generic browser MIME, unknown dates, pending-scan denial, restricted-role/wrong-patient denial, patient switching and 375px layout. Expiring-link rendering uses an explicitly labelled typed HTTP response fixture; it does not prove an external scanner cleared a file. Actual database reconciliation proves that fixture never changed scan state.
- Read-only peer review identified the preflight filename lock; repaired and regression covered. Final review found no further actionable defect. Mobile screenshot inspected. The in-app Browser Use backend was unavailable; repeatable Chromium/screenshot evidence is retained instead, without claiming interactive in-app verification.
- `security-audit-final.log`: the fail-closed advisory gate passed with the verified Forge backport. Raw counts remain 0 critical, 4 high paths for that backported advisory, and 13 moderate; see `docs/security/DEPENDENCY_BACKPORTS.md` for expiry and replacement requirements.
- Every owned native test process stopped; each run's `cleanup.json` records successful Postgres/Redis shutdown. No local Docker container was started or altered.

The new historical-file slice's remote PR checks are distinct from the green merged PR #7 baseline; consult its exact-head checks before merging it. Failed development runs remain available and do not count as passing evidence.

Existing local dependencies were used. All disposable database/cache/build/log state is on Spectra. Desktop, unrelated research, live clinic data and local Docker services remain untouched.
