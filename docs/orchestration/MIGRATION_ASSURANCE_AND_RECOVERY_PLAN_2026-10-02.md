# Migration assurance and recovery

Owner-authorized next slice, 2026-10-02. Baseline `7638f99755ec067e57eae9861e0be787e666b7ca`
on `mac-latest-20260829`; implementation branch `codex/migration-assurance-recovery`.
Subordinate to the integration-first MVP plan and canonical specifications 01, 02,
03 and 15. This is a synthetic engineering milestone, not clinic cutover approval.

## Outcome and scope

Extend the existing importer, scoped data and recovery controls. Give an operator
an independently calculated, aggregate-only report of one saved import run, its
historical coverage and optional explicitly selected comparison/appointment file.
Prove a real backup/restore of the current synthetic ClinicOS database, rather than
counting the older CSV smoke or simulated recovery phases as a restore.

The parent is the sole source writer and owns architecture, data semantics,
permissions, evidence and integration. Two bounded read-only agents map the existing
import and restore paths. Preserve unrelated vision/research work and all assets.

## Delivery sequence

1. **Reconciliation contract and data.** One scoped, consistent SQL snapshot reads
   actual staged row states and active identity links, checks stored counters and
   manifest completeness, and counts historical-context review states. No raw CSV,
   names, contact values, clinical text, error messages or source row IDs leave this
   report. Report times describe database observation, never vendor freshness.
2. **Repeat-export and appointment evidence.** Compare only complete patient files
   with the same source/profile and unambiguous external IDs. Report source rows
   present/changed/absent without inferring deletion, cancellation or automatic
   update. Appointment evidence is separately selected: a shared source label does
   not establish that two files belong to the same export. Preserve explicit
   history/exclude/link/create/pending decisions; do not infer booking duration.
3. **Operator report.** Add a readable report to saved imports, with bounded
   selectors, explicit refresh, issue explanations/next actions and a minimized
   downloadable report. Hide stale evidence while a write is pending or selection
   changes. Separate accounted-for records from accepted clinical history, source
   completeness, provider activation and permission to replace Practo.
4. **Recovery and real restore.** Reuse the native synthetic harness and existing
   ownership markers. Quiesce app writers, capture a PostgreSQL snapshot/dump,
   restore into a fresh separately owned local cluster, and compare canonical table
   content, schema/constraints/RLS/privileges, sequences and saved document hashes.
   No arbitrary target, overwrite, database reset, Docker activation or production
   credentials. A local database restore does not restore private object bytes,
   Keycloak, external providers or establish an independent backup.
5. **Acceptance and review.** Targeted domain/API/database/UI negatives plus final
   workspace checks, generated contracts, 5,000-patient two-file reconciliation,
   interrupted/resumed import and restored-state verification. Extend tests where
   current coverage is missing, preserve failed evidence, and record exact scope.

## Acceptance matrix

- Row-state totals partition received rows; invalid/skipped/rolled-back records do
  not count as successfully imported. Replayed rows are not described as new patients.
- Counter/manifest/link mismatches prevent a clean report; empty/partial uploads
  stay incomplete. Reads are tenant/clinic scoped, permission checked and audited.
- Comparisons reject wrong scope/source/profile/incomplete/ambiguous files. Absence
  and changed evidence require review; no source mutation or automatic reconciliation.
- Historical counts describe immutable versions and exact review decisions, never
  current diagnoses or inferred consent. Coverage clearly lists unsupported domains.
- Browser report/selection/download/error/mobile checks use the real API contract.
- Existing interrupted upload, lost-response, session and idempotency coverage is
  reconciled with this slice; any added fault injection is synthetic and bounded.
- Dump and restored data/schema/sequence evidence agree; tampering/missing evidence
  fails verification. Restored documents render the same archived HTML. Runtime RLS
  and tenant isolation remain enforced after restore.
- All temporary data, caches and logs stay on Spectra; owned services stop afterward.

## External boundaries

No real patient/payment data, provider calls, deployment, Desktop changes or local
Docker lifecycle operations. Existing approval covers isolated native synthetic
Postgres/Redis/API/web. A separate independent backup destination, clinic-approved
source/field policy, actual export validation, stationery/registration details and
staff/physical-printer checks remain later gates. Do not infer them from this report.

## Progress

- [x] Baseline, instructions, existing integration contracts and restore limitations inspected.
- [x] Aggregate report and comparison implemented and verified.
- [x] Operator UI and real-browser acceptance complete.
- [x] Real isolated database restore and integrity verification complete.
- [x] Final review, local checks and scoped handoff recorded in
  `../qa/MIGRATION_ASSURANCE_RECOVERY_2026-10-02.md`. Fresh online advisory
  verification awaits specific network-payload authorization. GitHub checks,
  merge, independent backup and clinic acceptance are not claimed.
