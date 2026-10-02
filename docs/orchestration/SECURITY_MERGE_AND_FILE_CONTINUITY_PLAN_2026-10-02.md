# Clinic-day review, merge and next slice

The owner authorized review, repairs and merge of the current work, followed by
the next useful functionality before staff rehearsal. Desktop remains read-only.
All local synthetic state stays on Spectra. No live clinic data, provider calls,
deployment or local Docker service changes are part of this work.

## Merge acceptance

The reviewed stack is PR #5 (staff identity), #6 (durable import recovery), and
#7 (migration through return-visit workflows). Starting heads are `89d81e6f`,
`f6744e6f`, and `f176504b`. The integration target is `mac-latest-20260829`.
`main` is not the target. Preserve feature commits and unrelated research.

1. Repair current dependency/image failures without disabling vulnerability,
   integrity, runtime, license or permission checks. Backported vulnerabilities
   must have exact provenance, executable negative/positive regression evidence,
   fail-closed integrity checks and an expiry; raw findings remain visible.
2. Repair review findings: lock clinical note edits during submission and use
   recovered patient-registration results to continue with the created patient.
3. Rerun local quality checks and synthetic real API/database browser regression.
   Require fresh GitHub functional, identity, CodeQL, security and ARM64 image
   evidence on the final reviewed head. Historical greens are insufficient.
4. Consolidate the dependent stack into the final integration PR if that avoids
   testing incomplete intermediate combinations. Review the combined diff and
   merge only the exact passing head into the approved target. Close or reconcile
   predecessor PRs only when their commits are demonstrably included.

## Next candidate: historical file continuity

The clinic already has configuration editors, daily work, finance and returning
history. The remaining file workflow has concrete gaps: ordinary X-ray images
are inferred as intraoral photos; source provenance is not collected/displayed;
the list stops at 50 with no continuation; timeline upload evidence cannot open
the exact file. Build on existing media records and private-storage contracts.

Before implementation, freeze a bounded contract for patient-scoped paging,
explicit file type/source/date/context and exact-record retrieval. Preserve
scan-pending/quarantined denial, tenant/role checks, patient matching, expiring
signed access, audit and source provenance. Do not relabel imported source
documents as signed ClinicOS notes, infer missing dates, or claim that current
Practo CSVs contain historical files.

Acceptance must cover more than 50 files, chronological stability, wrong-patient
and role denial, exact timeline lookup, pending/quarantined scans, signed-access
expiry, failed/retried uploads, desktop/mobile operation, and the generated
client's actual durable routes. Synthetic scanner fixtures are test-only and do
not activate real private storage. Real clinic history export and official
storage/scanning activation remain separately authorized external evidence.

The staff rehearsal itself remains necessary. No feature or CI result substitutes
for clinic staff validating migration → booking → visit → checkout → return visit.
