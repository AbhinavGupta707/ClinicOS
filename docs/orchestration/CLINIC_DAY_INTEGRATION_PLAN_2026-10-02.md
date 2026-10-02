# Clinic-day integration plan — 2026-10-02

The owner asked to slice, execute and integrate the completed work. This pass
packages the existing verified product slices, repairs integration defects, and
verifies the combined result. It does not expand product scope or authorize clinic
cutover. The integration-first MVP programme remains authoritative.

## Base and preservation

Verified root: `/Volumes/Spectra/Projects/ClinicOS`.
Starting branch: `codex/import-operator-recovery`.
Starting commit: `f6744e6ffafd6b1b7d16912f5a0b1510d18a2524`.
The prior returning-patient source manifest matches all 154 recorded files.
GitHub PR #5 (staff identity) and #6 (import recovery) remain open and have passing
checks on their current heads. #6 targets #5; #5 targets `mac-latest-20260829`.
No inference that these dependencies have already merged is allowed.

Unrelated `research/`, `scripts/research/`, and
`docs/CLINICOS_CURRENT_STATE_AND_VISION.md` remain outside integration. Desktop,
existing services and real clinic exports remain untouched. No blanket staging.

## Commit sequence

1. **Patient migration and daily clinic workflows.** Reconstruct the 121-file
   finance pre-slice archive as an overlay on the starting commit. Its source
   content matches the daily workflow acceptance boundary (163 routes, schema
   0029; 12 import/front-desk and five daily browser scenarios).
2. **Financial operations and appointment evidence review.** Overlay the
   142-file returning-patient pre-slice archive. It exactly matches the final
   finance manifest (172 routes, schema 0031; 1,184 tests and 20 browser scenarios
   in the dated evidence).
3. **Returning-patient chart review.** Apply the preserved delta to the 154-file
   final manifest (174 routes, schema 0032; 1,200 unit/API tests and nine daily
   browser scenarios). Exclude generated `next-env.d.ts` path drift from product
   changes; keep its normal build reference.
4. **Integration cleanup and evidence.** Preserve/restore generated web inputs on
   acceptance success/failure/graceful shutdown, reject overlapping acceptance
   builds, add service-free lifecycle tests, and record final combined evidence.

Use an explicit temporary Git index to construct the archived commit boundaries;
do not overwrite the live checkout with old snapshots. Verify every archived byte
and staged path before committing. The real index must start empty, then be aligned
with the final committed tree; original working files remain in place throughout.
The branch is `codex/integration/clinic-day-workflows`. No edits to `main` or the
existing dependency PR heads are required.

## Integration gates

- Archive/source identity and dependency/contract inventory review.
- Generated API/client/route drift checks, workspace check/typecheck/lint/build,
  release-scope secret scan, and appropriate final unit/API tests.
- Full combined synthetic rehearsal: migrations 0001–0032, real repository probes,
  5,000-patient import/replay plus front desk, then all nine daily scenarios on
  that same disposable PostgreSQL database. Owned Redis/API/web/test services
  stop afterward. No Docker or production service activation.
- Confirm generated web input contents are restored after browser acceptance.
- Keep one reviewable integration PR above #6, with the coherent commits and
  explicit dependency order. Current-head GitHub checks must be reported honestly;
  local tests do not establish live-provider, staff, security-image or release
  acceptance. Do not merge an unreviewed or failing head.

## Stop boundaries

Real staff/clinic validation, historical clinical data not present in source
exports, chosen deployment identity configuration, live providers and operational
backup/restore remain pilot/release gates. The earlier no-deployment and
no-Desktop-deletion boundaries remain in force. This pass does not imply that
Practo can be retired in live care.
