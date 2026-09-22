# PR #1 Mac repair review — 20 September 2026

> Follow-up: [22 September pre-merge repair status](PR1_MERGE_READINESS_2026-09-22.md)
> records the new acceptance harness, current test results and corrected Keycloak
> severity. The evidence below remains a dated record.

**Local repair candidate: tested. PR merge: NO-GO. Everyday development on Spectra: GO. Deleting Desktop: NO-GO.**

This report records the local continuation of the Windows PR review. It does not
supersede dated Windows evidence or declare a clinic trial, production release,
Docker restore, or Desktop retirement complete.

## Repository and change boundary

- Working directory and Git root: `/Volumes/Spectra/Projects/ClinicOS`.
- Branch: `codex/pr1-quality-repairs`; starting HEAD for the changes below:
  `5d11479050b2b5435c41f9397c68212d054b5dce`.
- That HEAD carries the previously committed Spectra orchestration relocation
  repair onto PR head `0491c7e43dc32d1cf6553ab1ca9281204aa47529`.
- GitHub PR #1 is still open at that original head, targeting
  `mac-latest-20260829` (`2a4cd31f57d892810c5dfb692266b3965412aff2`).
  These new repairs have not been committed, pushed, or merged. Do not mistake
  old PR checks for verification of this local candidate or retarget it to the
  substantially older remote `main` without reconciling ancestry.
- Desktop stayed read-only. The original untracked vision document, `research/`,
  `scripts/research/`, and relocation audit remain local and outside PR #1.
- No Docker service, database, provider, cloud resource, or deployment was
  started, reset, recreated, stopped, or removed. Only temporary loopback web QA
  listeners were used and cleaned up.

## Product repairs

| Finding | Repair and evidence |
| --- | --- |
| Rolling back a mapping to an existing patient could remove the external identity while an imported appointment still depended on it | Extended the existing practitioner-reference rollback protection to patient references in Postgres and the fixture repository, preserving the existing advisory-lock order and tenant/clinic/source scope. API tests cover created and linked-existing patients, retained mappings, exact replay, and safe reverse-order rollback. The corresponding Postgres concurrency probe is written but **not executed on this candidate**. |
| Duplicate review silently chose one opaque candidate | Return only candidate name and phone as review evidence; show all returned candidates; require explicit selection. Do not return candidate email or raw source payload. Enforce candidate/canonical mapping membership in the repository, including rejection of unrelated same-clinic patients. Repeating the same resolution and reaffirming the canonical target remain supported; practitioner selection still uses eligible clinic doctors. |
| The bounded batch summary hid conflicts still present on individual rows | Merge and deduplicate summary and per-row evidence in the web normalizer. Preserve truncation flags, display incomplete-review notices, and block creating a separate patient while that row's conflict evidence is truncated. Existing response bounds remain in force. |
| Patient selection remounted search and allowed stale loads | Keep search state within the same tenant/clinic/user/surface; isolate selected-patient loading with a keyed component and cancellation guard. Sequence search and day-refresh responses so an older request cannot overwrite newer results. Browser coverage exercises out-of-order search responses and retained search context. |
| Missing clinic-day data looked like an empty schedule/queue | Preserve loading, error, and unavailable states in patient context. Qualify results from truncated/bounded lists and format appointment timestamps in the clinic timezone, including midnight boundaries. |
| Invoice schema rejected a handler-supported request containing both a plan and procedures | Restore `anyOf`; test plan-only, procedure-only, both, neither, and forbidden writable totals. Regenerate OpenAPI. |
| Generated types dropped parent nullability when a nested field was nullable | Correct nullable generation and regenerate the client. Patient prep can accurately represent a null appointment; payment-request customer nullability now also matches its existing runtime schema. |
| Import row headings ran into preview/reference text | Add narrowly scoped grid spacing for import review rows. Verify the final rendered mobile layout and reachable selection/link controls. |

These changes advance the existing blue-sky architecture through canonical
identity, durable migration contracts, clinical data isolation, and honest daily
workflows. They do not introduce a second datastore or claim a Practo connection.

## Dependencies and image candidates

Installed dependency audit: **0 critical, 0 high, 13 moderate**. The repository's
`security:audit` gate passes, and the local Trivy source dependency gate passes.

- Retain Next **15.5.25**, Nest **11.1.28**, Expo **57.0.2**, and React Native
  **0.86.0**. No framework-major upgrade or `--force` audit fix was used.
- Scope a Multer **2.3.0** override beneath Nest platform-express and pin PostCSS
  **8.5.23**. Update Vitest to **4.1.11** and explicitly retain its existing Vite
  **8.1.3** peer. Resolve compatible security updates for Metro **0.84.5**,
  `@expo/metro` **56.0.2**, Sharp **0.35.4**, XML DOM, brace expansion, fast-uri,
  browserslist, js-yaml, nanoid, qs, and related required packages.
- npm's existing installation and workspace resolution produced a peer resolver
  crash and stale overrides. A manifests-only scratch resolution supplied the
  patched package metadata; the final lockfile retained the unrelated dependency
  lines rather than adopting the broad fresh resolution. npm then installed and
  reconciled the scoped candidate successfully: 27 packages added, 3 removed,
  48 changed. Global npm was unchanged. `npm ci` was not run locally.
- The actual installed tree has no missing or invalid dependencies. npm lists
  seven optional WASM/EMNAPI packages as extraneous in the existing installation;
  no blanket prune was performed. A clean-checkout CI run remains required.
- Remaining moderate findings trace to
  [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr)
  through Expo Router/query-string and
  [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq) through native Xcode
  tooling. This is not a waiver or a zero-advisory claim. Assess/fix them before
  enabling the affected mobile/deep-link or native-build exposure.

Image edits are **candidates, not verified production images**:

- API/web/worker and Temporal OpenSSL pins move to `3.5.8-r0`; Temporal's
  PostgreSQL client moves to `17.11-r0`, the available revisions identified in
  failed CI logs. The static image contract also recognizes the existing media
  scanner matrix entry.
- Lambda Node 22 ARM64 is pinned to the registry-verified
  `sha256:29e0788a2c1b8d4ac714e1b02ac3c49c495b27295758930a056e4ee3d8abda13`.
  Its remote scan removes the earlier OS/OpenSSL and axios findings. Remaining
  high/critical findings are under the npm directory that this Dockerfile
  already removes; the assembled image must still be built and scanned.
- Keycloak moves to [26.7.4](https://www.keycloak.org/2026/09/keycloak-2674-released)
  at verified index digest
  `sha256:82a77884f3af238beab1e7afd63b5f530e1b5c0590bd7aa60b40a40463e29b2c`.
  Its own Jackson 2.21.5 and PGJDBC 42.7.13 supersede the old Jackson replacement
  and vulnerable JDBC version. The runtime assertion and MSSQL removal path
  follow the new distribution. Java 21 is pinned to remotely scanned Temurin
  digest `sha256:1a29e1fe337eb28b5bec30f0ee8ed29f0ff80ab6f75dcf9313efe82911065a52`,
  with zero high/critical findings in that base scan.
- **Keycloak still has known high findings** in active Netty 4.1.136.Final
  (`CVE-2026-75595`) and Bouncy Castle 1.84 (`CVE-2026-8763`,
  `CVE-2026-13506`). Resolve these through a supported upstream update or a
  justified, compatible, checksum-pinned dependency repair, then test the
  assembled identity runtime. No suppression was added. Merely updating the
  base does not close the image gate.

Public registry inspection and remote scans did not start Docker or contact
private AWS resources. Local Trivy was 0.72.0; current GitHub workflow pins
0.70.0, so local scans do not replace the workflow's exact-candidate scan.

## Verification

Node **22.22.2** and npm **10.9.7** were explicitly selected for the final gates.
The OS sandbox denied reads/writes under Desktop ClinicOS and outbound traffic
except loopback. Dependency installation used a separate Desktop-denied profile
with public registry access and package scripts disabled.

| Check | Result |
| --- | --- |
| Workspace check, complete typecheck, lint | PASS |
| Full workspace tests | **1,001 passed; zero failures; zero skips** |
| All workspace builds | PASS, including Expo web export and Next 15.5.25 |
| Final web rebuild after the CSS-only readability correction | PASS, including Next lint/type validation |
| Final rendered browser regressions | **7/7 PASS, zero skips**; includes duplicate choice, search retention/race, unavailable patient context, roles, payment-intent honesty, mobile overflow |
| Standalone app with no API, without response interception | PASS at 1440px and 390px: honest unavailable state, Retry sends another `/v1/me` request, expected 404, no browser exceptions/overflow |
| OpenAPI/client drift and route inventory | PASS, **136 routes** |
| Dependency high/critical gate and source Trivy scan | PASS; moderate advisories remain as described above |
| Secret scan, diff whitespace, static image contract | PASS |
| Expo dependency check | Exits successfully using local metadata, but explicitly warns that offline dependency validation is unreliable; not a current SDK certification |
| Rebuilt web portability | PASS: **3,338 files** scanned, no Desktop references; **4,346 traces** resolve within Spectra; no broken/external trace or symlink |
| Research preservation | PASS: **3,750 per-file hash checks**, all **1,875 images and hardlink pairs** unchanged; active source locators remain repository-relative |
| Real Postgres migration/repository/concurrency tests | **NOT RUN on the repaired candidate** |
| Guarded real-stack browser import | **NOT RUN**; the seven passing browser cases use synthetic intercepted API responses |
| Actual identity login/refresh/logout and session registration | **NOT RUN / incomplete application wiring** |
| Container builds, runtime smoke and final assembled-image scans | **NOT RUN**; remote base scans are limited evidence |
| Clean checkout install/CI, fresh CodeQL, physical device, provider, clinic trial, cloud, backup restore | **NOT RUN** |

An initial lint run found two JSX apostrophe escaping errors; both were fixed and
lint rerun successfully. The scratch standalone smoke initially had an incorrect
module path; after fixing the harness it passed. Neither failure was hidden by
skipping tests or weakening a product contract. The final browser layout was
visually inspected after its spacing correction.

## Commit and promotion boundary

The new changes remain reviewable in the working tree because durable repository
and image gates are still open. No blanket staging was performed. The earlier
Spectra relocation commit is preserved. Once the required verification is
available, use explicit path lists for these coherent commits:

1. **Host/programme guidance:** `AGENTS.md`,
   `docs/orchestration/MVP_EXECUTION_PLAN.md`, and
   `docs/orchestration/MERGE_INTEGRATION_RUNBOOK.md`.
2. **Import, patient, and contract correctness:** the changed API operations and
   fixture/test; Postgres implementation and repository probe; web import/helper,
   shell, CP13 components, CSS, regression tests and Vitest config; API schema,
   generator, generated client/OpenAPI and contract tests; the two changed E2E
   specs. Keep the repository implementation and its fixture/contract behavior
   together. The generated payment customer nullability change belongs to the
   same generator fix.
3. **Dependency repair:** root `package.json`, `package-lock.json`, and
   `apps/web/package.json`, with the exact lock reviewed as one unit.
4. **Image security:** the six changed Dockerfiles, Keycloak runtime smoke, and
   static image contract, only after remaining CVEs and runtime checks are closed.
5. This dated report accompanies the verified handoff and must be updated when
   the remaining gates change.

Do not include the untracked research corpus, vision document, research scripts,
or scratch audit in those commits without a separately scoped preservation
decision. They are valuable local work, not disposable files.

## Minimum remaining work

### Docker and durable acceptance

The final read-only Docker query still failed because
`/Users/abhinavgupta/.docker/run/docker.sock` is absent. Container bind sources and
named-volume contents therefore remain unknown.

1. Obtain approval to launch Docker Desktop. Launching may resume containers with
   restart policies. Inspect ClinicOS container state, bind sources, Compose
   working-directory labels and named volumes read-only before choosing an action.
2. After inventory, obtain approval for a **separate disposable synthetic test
   stack** with unique names/volumes/network and alternate loopback ports. Do not
   run the default `db:bootstrap`, reset scripts, or readiness fault injector
   against the existing stack. The readiness script's fixed default ports and
   stop/start actions must be isolated explicitly.
3. Provision only that isolated database; run all 23 migrations, validation,
   synthetic seed/verification, repository/RLS/concurrency/rollback probes and
   worker persistence. Then run the guarded import browser test without response
   interception against its real local API/Postgres backend. A synthetic dev
   identity in that test is not evidence of successful real OIDC authentication.
4. Build and scan every changed ARM64 image; run Keycloak and Temporal runtime
   smokes. Close remaining Keycloak CVEs. Repeat required checks in CI on the
   exact committed candidate before considering the PR's intended base merge.

### Pilot product work, separate from relocation

- The intake already records Healthy Roots Family Dental Studio and Practo
  Ray/Profile. Confirm that it is still the intended pilot and obtain an
  authorized de-identified export plus field/ID/timezone/cancellation semantics.
  Do not guess Practo's format or implement scraping.
- The web client exposes `registerClinicOsAccessTokenProvider`, but no production
  caller is registered in the application. Finish and test the intended browser
  identity/session flow with the API's actual authentication contract before
  calling normal authenticated clinic work ready. Do not substitute a fake token.
- Implement the verified source adapter, then prove representative import,
  replay, changed/cancelled/missing records, recovery and two reconciliation
  cycles. Repeatable sync and source freshness remain MVP2 work; generic manual
  import does not establish them.
- Production cloud/DR, broad provider coverage, physical-device distribution and
  the deferred release evidence programme remain separate from Spectra migration.

### Desktop retirement

**Everyday engineering on Spectra: GO** for editing, local Git, the verified
checks/builds, research browsing and synthetic browser work. **Live clinic use:
NO-GO** until identity, data-backed acceptance and pilot-source gates close.

**Deleting Desktop: NO-GO.** Before deletion, independently back up the full local
Git history and working tree, hidden/untracked research/docs/scripts, and any
unique ignored configuration or credentials using encrypted storage. Include the
durable database/identity/media data identified by the Docker inventory with a
consistent, approved backup method. A second folder on Spectra, a GitHub PR
without untracked assets, or the old `.next` cache is not an independent backup.

Restore that backup onto a different physical device or an independently
recoverable environment. Check Git integrity/history and per-file hashes,
including all 1,875 images; verify required secret material is recoverable without
printing it. Restore database/identity data into separately approved isolated
volumes/ports with providers disabled, validate schema/data integrity, and run
the authorized synthetic workflow. Real patient/payment data must not be used
for this test without separate authorization. Only after that restore succeeds,
the runtime has no Desktop binds, and Spectra works with Desktop inaccessible can
destructive retirement be reconsidered.

## Evidence

Spectra-only scratch: `.audit-spectra-retirement-20260920/pr1-quality/`.
It contains final gate logs, browser results/screenshots, source and remote-base
scans, installed audit, registry digests, Docker failure, research hash checks,
generated-asset tracing, the candidate diff, and tested source-file hashes.
Those hashes describe the working-tree candidate; old GitHub checks describe the
original PR head. Preserve the earlier relocation audit and repair report as
dated evidence.
