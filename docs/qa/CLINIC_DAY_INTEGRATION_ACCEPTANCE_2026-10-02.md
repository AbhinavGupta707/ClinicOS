# Clinic-day integration acceptance — 2026-10-02

Scope: integrate previously implemented MVP workflows into reviewable commits and
verify their combined behavior. This is not a production or live-clinic approval.
The integration-first MVP execution plan remains authoritative.

## Integration boundaries

Verified checkout and Git root: `/Volumes/Spectra/Projects/ClinicOS`.
Starting branch/commit: `codex/import-operator-recovery`,
`f6744e6ffafd6b1b7d16912f5a0b1510d18a2524`.
Integration branch: `codex/integration/clinic-day-workflows`.

| Commit | Review boundary |
| --- | --- |
| `430bcbf21005a6e91166a0702cf696ec23691bfc` | Practo patient-file preparation/import up to 5,000 patients; front desk and daily clinical, billing, operations and setup workflows. |
| `17ff9cc077aefbb5eeec3496aeff2cf3f542ae47` | Financial operations and explicit review of Practo appointment evidence. |
| `ebdc4b1f4275ec4e56feb9eb57e65819099d6d58` | Authorized returning-patient history, exact source reads and saved dental comparison. |
| Integration cleanup commit containing this report | Acceptance build-input preservation, interruption/concurrency regression tests, plan and combined evidence. |

These boundaries were recovered from existing source archives and SHA-256
manifests: 121 files at the daily workflow boundary, 142 at the financial boundary,
and 154 at the returning-patient boundary. Every archive member was verified before
staging. A temporary Git index assembled the historical overlays; the current
working files were not replaced with older versions. The default index was empty
before integration and was aligned after each commit. No blanket staging was used.

The temporary `.next-mvp-acceptance` reference in tracked `next-env.d.ts` was
excluded; its normal `.next` reference was retained. Other source bytes match the
recorded implementation boundaries. Earlier dated reports retain their original
uncommitted/no-push statements as historical evidence; this report describes the
later integration state.

## Integration defect repaired

Next writes `next-env.d.ts` even with a separate acceptance output directory. The
runner now saves exact original bytes, file presence and permissions for that
declaration and its temporary TypeScript configuration. It restores them after
success, failure and graceful shutdown. A lock rejects overlapping acceptance
builds. An ungracefully killed process leaves a recovery backup for inspection;
the runner does not delete another process's lock automatically.

Independent review found a signal arriving during asynchronous preservation could
exit before cleanup acquired the restore function. A synchronous guard now exposes
a pending acquisition and deduplicated cleanup. Shutdown waits for acquisition,
and startup stops if shutdown was requested. A regression explicitly requests
cleanup before acquisition finishes. This lock coordinates acceptance runners;
normal Next builds must still be run sequentially with acceptance in one checkout.

## Combined verification

Evidence root:
`.audit-spectra-retirement-20260920/clinic-day-integration-20261002/`.

| Gate | Result |
| --- | --- |
| Full workspace unit/API tests | 1,200 passed: 917 Node and 283 Vitest; zero failed/skipped. |
| Offline export-profile and runner tests | 33 passed, including preservation, early/concurrent shutdown and unsafe-input rejection. The workspace check also passed its typecheck-gate regression. |
| Workspace checks | Check, typecheck, lint and all builds passed using existing dependencies. |
| Generated contracts | OpenAPI/client drift and route inventory passed; 174 registered routes covered. |
| Fresh PostgreSQL | All 32 migrations applied/validated; runtime grants, synthetic seed and database verification passed. |
| Import/front-desk browser | 12 passed, including pause/resume, incomplete-file rejection, mobile controls, 5,000 patients and replay. |
| Independent patient-file reconciliation | Two complete files, 100 groups, 10,000 committed staging rows, exactly 5,000 patients and source links; zero extra patients on replay. Concurrency, manifest, identity review and isolation probes also passed. |
| Daily browser on the same database | Nine passed: setup, front desk, clinical work, checkout, operations, financial corrections/concurrency/permissions, appointment review and returning-patient history. |
| Financial/appointment repositories | Limits, stale-version/duplicate/wrong-patient rejection, RLS/immutability, pagination, provider refund projections/backfill and source completeness/replay passed. |
| History repositories | 137 equal-time events without pagination loss; 25 saved snapshots; 132 consent records reduced consistently; cursor, patient/clinic and permission isolation passed. |
| Independent clinic-day SQL | Expected invoice/credit/return totals, nine financial records with matching audits/outbox events, three appointment decisions and zero imported confirmation requests. |
| Cleanup | Both original web inputs restored byte-for-byte; guard lock removed; API/web reported stopped, owned PostgreSQL/Redis exited zero and their PIDs were absent. |
| Repository hygiene | Scoped secret scan and diff whitespace check passed; normal `next-env.d.ts` has no diff. The synthetic CSV's intentional CRLF bytes were preserved. |

Reproducible evidence: `final-gates.json`, `*-final.log`,
`offline-acceptance.log`, `cleanup-and-inputs.json`, and
`native-p0mqkv0x/checks.json`. Browser evidence is under
`native-p0mqkv0x/browser/run-crERVx` (12 cases) and `run-XwBdAL` (nine cases).
The final shutdown guard was loaded by the daily run; the earlier import process
had already loaded the first cleanup implementation. Product source was identical
throughout; the shutdown change also passed the final service-free regression.
Import and returning-patient mobile screenshots were visually reviewed.

Local browser tests use synthetic authentication with real API/PostgreSQL/Redis.
They do not prove real OIDC, clinic usability or provider activation. A nonfatal
existing `pg` concurrent-query deprecation warning remains; these results do not
claim compatibility with a future major driver version. No local network dependency
audit, image scan, Docker/Keycloak/Temporal acceptance, deployed-cloud or real
patient trial was run. Fresh remote CI results must be evaluated on the published
head, separately from these local gates.

## PR integration order

GitHub was queried during this pass. PR #5 (`codex/staff-sign-in`) and PR #6
(`codex/import-operator-recovery`) were both open, mergeable, with passing checks
on their then-current heads. #6 targets #5; #5 targets `mac-latest-20260829`.
PR #6 is still a draft. They were not assumed merged because their historical
checks passed.

This integration is proposed as one PR above #6, with the separate commits above.
Review/merge dependencies in order: #5 → #6 → this integration, updating bases
and checking the actual resulting heads. Do not merge this integration while its
dependencies or current-head gates remain unreviewed/failing. No `main` promotion,
existing PR merge, deployment or live clinic cutover is part of this pass.

## Preservation and practical next step

Unrelated `research/`, `scripts/research/`, and
`docs/CLINICOS_CURRENT_STATE_AND_VISION.md` were not staged. Desktop and comparison
images were not edited. Test data, logs, caches and heavy generated outputs stay
on Spectra. No dependency installation, Docker service operation, provider call,
real patient export, or live payment was used.

The next product milestone is the supervised staff rehearsal: import → schedule
and front desk → consultation → checkout and correction → return visit. Validate
chosen staff identity configuration and clinic roles, then a separately approved
representative export and two-cycle reconciliation. Historical notes/images/bills
absent from the available exports remain an explicit migration decision. Live
provider activation, deployment security and independent backup/restore remain
separate gates before live use. Passing this integration does not establish full
Practo parity or authorize replacing it in patient care.
