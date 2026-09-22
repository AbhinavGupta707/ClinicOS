# PR #1 pre-merge repair status — 22 September 2026

**Merge decision: NO-GO pending image security and final-commit CI.**
The owner-approved synthetic durable acceptance run passed after the two
integration fixes below. The verified source/dependency/acceptance repair paths
are separated from the unverified image candidates on `codex/pr1-quality-repairs`,
based on `5d11479050b2b5435c41f9397c68212d054b5dce`. Nothing was pushed or merged.
This report updates the dated [20 September review](PR1_MAC_REPAIR_REVIEW_2026-09-20.md).
It concerns PR readiness and continued development, not Desktop retirement.

## What this pass changed

- Added `npm run mvp:test:real-stack` and documented its exact boundary in
  [MVP_REAL_STACK_ACCEPTANCE.md](MVP_REAL_STACK_ACCEPTANCE.md). It owns temporary
  API/web processes and runs the four existing browser scenarios against real
  PostgreSQL repositories, Redis and the web API proxy without response
  interception. Authentication remains the existing synthetic local adapter;
  the browser calls the real `/v1/me`. This is not OIDC acceptance.
- Require explicit synthetic/disposable opt-ins, loopback database and Redis,
  the runtime database role, and a matching random database provenance marker
  placed by the fresh-cluster provisioner. Reject ambient web environment files.
  No default connection to the existing development stack is permitted.
- Put browser artifacts and temporary files under the selected artifact folder,
  use a separate ignored Next build/config, and bound child-process cleanup.
  Refuse passing evidence if any browser case fails, is skipped or flaky, or
  fewer than four cases execute. Eleven negative configuration checks pass,
  including rejection of URL query parameters that could override a host.
- Add the acceptance command to the quality workflow after its existing fresh
  synthetic database setup and workspace build, with always-on artifact upload.
  Browser installation is a CI-runner step only. This workflow has not run yet.
- Ignore the named local audit scratch directory. Its accumulated generated
  filenames exceeded the secret scanner's child-process output buffer. No
  secret was reported; rerunning the unchanged scanner now passes. No source
  security rule or vulnerability severity gate was weakened.

The earlier import identity, rollback, duplicate-choice, stale-search,
unavailable-state, generated-contract and compatible dependency repairs remain
in the candidate. They are described individually in the 20 September report.
An independent read-only review found no remaining material safety or false-pass
defect in the new test runner after the provenance and cleanup corrections.

## Defects found by the approved durable run

1. **Rollback returned stale evidence.** PostgreSQL saved the blocking reason
   but returned the pre-update link on the first request. Both dependency and
   reaffirmation branches now map the authoritative `UPDATE ... RETURNING *`
   row. The durable regression checks the reason/timestamp immediately and
   equality with an idempotent retry. Existing transaction/row locks remain.
2. **The web shell rejected the actual identity contract.** The API returns
   `clinics` with clinic-specific `roleSlugs`; the shell expected the old
   singular `clinic`/top-level `roles` fixture shape. It now reads the canonical
   same-tenant membership and maps `owner_admin` to the owner UI role. It never
   substitutes token roles or legacy authority when canonical membership data
   is unusable. Multiple memberships produce an explicit unavailable-selection
   diagnostic, rather than selecting a clinic or combining their roles.

Six added identity cases cover the real payload, token-role disagreement,
cross-tenant rejection, multiple clinics and malformed canonical memberships.
Independent read-only review found no material defect in these two corrections.
The single-clinic boundary remains deliberate: multi-clinic selection and
tenant-wide-only role presentation require future contract/workflow work.

The native test harness needed Java's IPv4 preference to operate inside the
loopback-only macOS sandbox. An initial run failed before migrations; its owned
services were stopped cleanly. Lint later encountered generated acceptance
bundles; those outputs now have the same source-lint exclusion as normal Next
builds. Neither correction relaxed product or vulnerability checks.

## Verification of this working-tree candidate

Evidence is retained in the local ignored directory
`.audit-spectra-retirement-20260920/pr1-merge-20260922/`.
Node 22.22.2 and npm 10.9.7 were selected for the workspace gates. Those gates and
the production web build ran with OS-level denial of Desktop ClinicOS access
and non-loopback outbound traffic; logs, temporary files and npm cache were on
Spectra. The dependency audit separately read public registry metadata.

| Check | Current result |
| --- | --- |
| Workspace check, typecheck, lint | PASS; workspace check rerun after runner corrections |
| Full workspace tests | PASS: 832 TAP + 175 Vitest = **1,007**, zero failures/skips |
| New acceptance configuration guards | PASS: **11/11**, no services started |
| All workspace builds, including normal production web | PASS; `.next` and normal `tsconfig.json` remain selected for the normal web build |
| Secret scan | PASS after the scratch-file enumeration correction described above |
| Diff whitespace and runner syntax | PASS |
| Rebuilt web portability | PASS: 3,323 files and 4,346 traces checked; no Desktop dependency or broken/external trace |
| Comparison image preservation | PASS: all 1,875 images; 3,750 per-file hashes and 1,875 hardlink pairs preserved |
| Current npm advisory metadata | **0 critical, 0 high, 13 moderate**; JSON audit exits 1 because moderate findings exist |
| Prior seven intercepted browser regressions | Passed on the 20 September candidate; retained as dated evidence, not rerun here |
| Fresh Postgres migrations/repository/concurrency/worker tests | **PASS**: all 23 canonical migrations validate; drift/locking/failure rollback, RLS/atomicity/replay/concurrency and worker retry/dead-letter probes pass |
| Four real API/Postgres browser scenarios | **PASS: 4/4**, zero failures/skips/flaky cases; import/rollback, named-doctor appointment-to-Today, patient search/profile handoff, mobile controls |
| Wrong database provenance marker | **PASS**: rejected against the real disposable database before API/web startup |
| Owned-process cleanup | **PASS**: API/web stopped, Postgres/Redis exited 0, owned database/cache ports are free |
| Real OIDC login/refresh/logout | **NOT RUN**; application session wiring remains separate product work |
| Final assembled images: build/runtime/SBOM/security | **NOT RUN**; known Keycloak findings remain |
| Clean-checkout CI and CodeQL on the repaired commit | **NOT RUN**; local repairs have not been pushed |

The completed durable run is `native-zwsn6dgh/`; its browser evidence is under
`browser/run-WxWCZf/`. `checks.json`, `cleanup.json`, `preflight.json`,
`browser-results.json` and `result.json` record execution and cleanup. Screenshots
of the actual synthetic Today and mobile import workflows were visually reviewed.
The in-app browser backend was unavailable; repeatable installed Playwright
Chromium executed the browser checks without downloads or response interception.
Earlier unsuccessful runs remain as failure evidence. The workflow added to CI
has not run remotely, and Windows checks on `0491c7e` cannot verify this candidate.

The captured API readiness is `repository_mode: postgres` and
`auth_mode: local_synthetic_fixture`. The local run does not exercise Docker
images, real Keycloak login, deployed/cloud services, or authorized clinic data.
A pg driver warning about concurrent queries on one client is informational on
the installed pg 8 line; it does not establish compatibility with a future pg 9
upgrade.

## Security findings that still block a clean merge gate

Correction to the earlier report's severity wording: the saved Keycloak 26.7.4
base scan includes **two distinct critical CVEs and a high CVE** in retained
server libraries, not only high findings:

| Library in candidate | Finding | Fixed library version reported by scanner |
| --- | --- | --- |
| Netty handler 4.1.136.Final | CRITICAL `CVE-2026-75595` | 4.1.137.Final / 4.2.17.Final |
| Bouncy Castle 1.84 | CRITICAL `CVE-2026-8763`; HIGH `CVE-2026-13506` | 1.85 |

Evidence: `pr1-quality/clinicos-keycloak-base-scan.json` under the same audit
parent. Removing the client-tools copy does not remove the retained server
copies. The [official release checked during this review](https://www.keycloak.org/downloads)
was Keycloak 26.7.4;
an official patched server distribution was not established. Resolution needs
a compatible supported distribution update, or a deliberately maintained,
fully dependency-aligned rebuild with provenance, assembled-image scan and
identity regression evidence. Blind individual-JAR replacement or scan
suppression is not an accepted repair.

The 13 npm moderate graph findings derive from two advisory roots. Expo Router's
query-string/decode-uri-component path is used for mobile/deep-link parsing and
must be addressed before that exposure is enabled. The inspected Xcode tooling
uses `uuid.v4()` without an output buffer; the reported uuid issue concerns
other versions of the UUID algorithm with caller-supplied buffers. This is a
bounded call-site assessment, not a general exemption for every uuid consumer.
No forced framework-major update was introduced.

## Concrete next execution and promotion steps

1. **Local durable acceptance is complete.** With the owner's approval, native
   PostgreSQL 16.14, Redis 8.8.0 and Flyway 12.11.0 used new synthetic data under
   Spectra on ports 55439/56389. No existing database or Docker service was used.
   The two discovered product defects were corrected and the full fresh-cluster
   sequence passed. Only owned processes were stopped; evidence is retained.
2. Resolve Keycloak's retained library findings and verify all six assembled
   images. Docker was already available at the read-only inventory; it was not
   launched by this work. Its image store is on the internal disk, which had
   only about 1.3 GiB free, so local image downloads/builds were not attempted.
   Use an approved adequately provisioned build environment; existing Docker
   containers/volumes must remain untouched. Current native-test plans do not
   move Docker storage or require new downloads.
3. Commit only explicitly listed, reviewed repair paths after their applicable
   gates pass. Keep the database implementation, fixture and regression probes
   coherent. Include the acceptance runner, CI configuration, normal/acceptance
   build isolation and instructions together. Keep dependency and image repairs
   reviewable; image candidates must not be described as validated before their
   assembled checks pass. Preserve unrelated vision/research files and images.
4. With separate push authorization, update PR #1 and require all quality,
   CodeQL and image checks on the **same final remote SHA**. Recheck the PR head
   immediately before any later authorized merge. The current PR target is
   `mac-latest-20260829`; do not silently retarget to the older remote `main`.

The scoped source commit includes product/API/database fixes and their tests,
generated contracts, dependency manifests/lockfile, the acceptance runner and CI,
build/lint artifact isolation, host/programme guidance and QA documentation.
Its explicit path list and source hashes are retained as `commit-paths.txt` and
`committed-file-hashes.json` in this run's audit directory. The pending image
work is separate: the API, web, worker, media-scanner, Temporal and Keycloak
Dockerfiles, Keycloak runtime probe, and `cp14-image-contract.test.mjs` remain
uncommitted candidates. Unrelated vision/research files remain untracked and
outside the repair commit.

## Development after this PR

This work supports the active integration-first plan while preserving the
blue-sky product architecture. The next clinic-specific slice requires the
authorized de-identified Practo Ray export, verified field/identity/timezone and
update/cancellation semantics, and a tested mapping into the canonical import.
Then prove repeated import/reconciliation, honest source freshness, and the
pilot's daily workflow. Real identity session completion and controlled pilot
acceptance remain required before real clinic use. None of those missing
capabilities should be inferred from the generic synthetic import tests.

No migration of an existing database, Docker lifecycle action, live patient or
payment operation, provider/cloud mutation, deployment, push or merge occurred.
