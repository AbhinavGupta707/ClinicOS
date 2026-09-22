# PR #1 pre-merge repair review — 22 September 2026

**Reviewed source candidate: GO for the scoped development merge. No merge or
deployment has occurred.**
This report supersedes the pending-gate status in the
[20 September repair review](PR1_MAC_REPAIR_REVIEW_2026-09-20.md), while preserving
that dated evidence. It concerns [PR #1](https://github.com/AbhinavGupta707/ClinicOS/pull/1)
and continued development; Desktop retirement is outside this decision.

The PR targets **`mac-latest-20260829`**, not `main`. The repair branch is
`codex/pr1-quality-repairs`, pushed to the existing PR branch
`codex/integration/mvp-0`. The verified source candidate is
`51595122e7f864581ebc6b368b282f4ddb9e8d62` (before the final documentation-only update). Its
[quality run](https://github.com/AbhinavGupta707/ClinicOS/actions/runs/35733062570)
and [security run](https://github.com/AbhinavGupta707/ClinicOS/actions/runs/35733062609)
both passed; the push-event checks also passed and GitHub reported `CLEAN`.
Any later PR head, including the documentation commit containing this report,
must retain green checks before merge. This report records source-candidate
evidence; it does not waive that final head check.

## Product outcome and architectural fit

The PR delivers the source-independent ClinicOS import loop: bounded canonical
CSV batches of patients, practitioner links and appointments; validation and
human conflict review; durable commit, replay and guarded rollback; then Today
and patient search/profile navigation. It extends the canonical domain,
PostgreSQL repositories, provider boundaries and generated API contracts. It
supports the integration-first [MVP execution plan](../orchestration/MVP_EXECUTION_PLAN.md)
and the blue-sky architecture without inventing a Practo schema or a second datastore.

It does **not** deliver a Practo connector, scheduled sync, source freshness,
source-system writeback, complete application OIDC sessions or a production
clinic deployment. Synthetic acceptance cannot close clinic or production
readiness gates. Rollback remains deliberately guarded and best-effort.

## Reviewed repairs

- **Import authority and rollback:** protect stable external identities and
  linked patients while appointments depend on them; require a reviewed
  duplicate candidate; preserve transaction/advisory/row locks and concurrency
  guards. PostgreSQL now returns the authoritative saved rollback block reason
  immediately rather than a stale pre-update link. Durable regressions cover
  dependencies, reaffirmation and retry.
- **Web/API correctness:** reject stale patient-search responses, isolate
  profile handoff by tenant/clinic/user, preserve honest unavailable/timezone
  states, and consume the actual `/v1/me` clinic membership/role contract.
  Never infer authority from token roles when canonical membership is unusable.
  Multiple memberships explicitly require an unavailable selection workflow.
- **Generated contracts:** repair invoice union/nullable generation and keep
  generated clients, schemas and consumers coherent.
- **Reproducible acceptance:** the real-stack runner requires explicit synthetic
  and disposable opt-ins, loopback endpoints, the runtime database role and a
  random matching database provenance marker. It rejects ambient web env files,
  owns only its API/web processes, isolates build output, bounds cleanup and
  rejects failed/skipped/flaky/under-count browser runs. Health artifacts contain
  only validated expected fields. Eleven negative safety checks remain active.
- **Dependencies and worker packaging:** compatible security updates remove npm
  high/critical findings. Temporal SDK packages are aligned at **1.22.0** and
  hoisted consistently; root test tooling declares its direct worker dependency.
  Images preserve workspace-local production dependencies. The native SDK
  requires glibc, so the worker uses a pinned non-root distroless Node 22 runtime
  rather than the incompatible Alpine runtime. Its actual SDK loading and
  ClinicOS workflow bundling are tested inside the final image.
- **Platform images:** refresh available pinned OpenSSL/PostgreSQL packages and
  media-scanner base; rebuild Temporal **1.31.3** from pinned/checksummed upstream
  source using patched Go. Test real verified-TLS PostgreSQL connections, both
  Temporal schemas twice, and SDK workflow/activity/timer execution plus history
  replay against the assembled server and worker images.
- **Keycloak security:** rebuild **26.7.4** from pinned/checksummed source with
  complete Netty **4.1.137.Final** and Bouncy Castle **1.85** BOM alignment. Verify
  effective dependency management, BOM checksums, every distribution library,
  source/patch/distribution hashes and upstream unit results. This is a
  **ClinicOS-maintained rebuild**, not an official supported binary; its
  [maintenance and removal policy](../../infra/images/keycloak/README.md) is
  explicit. No vulnerable JAR was blindly overlaid or suppressed.
- **Real identity defect:** the protocol test exposed missing access-token
  subjects. Both interactive clients now include Keycloak's `basic` scope,
  required for `sub` and `auth_time`; promotion rejects its absence. Runtime
  assertions retain signed subject, issuer, expiry and API-audience checks.
  Realm import explicitly creates the standard scopes even when custom scopes
  are listed; naming a missing scope alone is insufficient. This follows the [upstream scope migration](https://github.com/keycloak/keycloak/blob/main/docs/documentation/upgrading/topics/changes/changes-25_0_0.adoc).
- **Keycloak recovery:** CI diagnostics exposed a root-owned, unwritable data
  directory created around a nested import mount. The image now pre-creates
  data/import and transaction-log directories for UID 1000. The smoke checks
  effective writability, fails on recovery-module initialization warnings, and
  repeats OIDC after restarting only its owned container against the same
  disposable PostgreSQL database. This is restart/re-authentication coverage,
  not an in-flight XA crash or production restore drill.
- **CI isolation:** exercise full workflow recovery before repository probes
  that intentionally leave aged outbox failure fixtures, then reinitialize
  only the disposable CI database before later tests. The production
  backpressure policy is unchanged. Bounded failure logs retain useful worker
  diagnostics. The recovery test now passes in that order.

The final security review separately inspected open CodeQL alerts rather than
inferring that a green analysis job meant no findings. Patient/runtime email
validation and free-text redaction now bound adversarial work; the restore CLI
cannot print arbitrary exception text. Focused regressions and package
typechecks pass. [The complete alert dispositions](PR1_CODEQL_TRIAGE_2026-09-22.md)
record the remaining static-template, bounded configuration and intentional
scanner/test findings without dismissing them or disabling rules.

All repair commits use explicit paths. Untracked
`docs/CLINICOS_CURRENT_STATE_AND_VISION.md`, `research/` and `scripts/research/`
remain outside the commits. Historical Windows/Desktop records and all 1,875
comparison images are preserved. No blanket replacement, blanket staging or
remote branch retargeting was used.

## Verification and evidence boundaries

The approved local synthetic run used fresh native PostgreSQL 16.14, Redis 8.8
and Flyway 12.11 under Spectra. All 23 migrations, repository/RLS/concurrency/
rollback probes, worker persistence and four real API/PostgreSQL browser cases
passed. Those browser cases cover import/rollback, doctor mapping and an
appointment displayed in Today, patient search/profile handoff, and mobile
controls. API authentication there is the explicit synthetic local adapter.

The dated local workspace run, before the four later security regressions,
passed **1,007 tests** (832 TAP and 175 Vitest), check,
typecheck, lint, builds and secrets. Desktop reads and non-loopback outbound
traffic were denied during those workspace/build gates. Web portability checked
3,323 files and 4,346 traces; image preservation checked 3,750 hashes and 1,875
hardlink pairs. These remain dated local evidence, not a substitute for the
remote clean install after the Temporal SDK upgrade. Local installed SDKs have
not been reinstalled; CI installs the final lockfile.

| Verified source-candidate gate                                                | Result               |
| ----------------------------------------------------------------------------- | -------------------- |
| Clean install, workspace check, typecheck, lint, tests, build                 | PASS                 |
| Fresh migrations, RLS/atomicity/concurrency/rollback                          | PASS                 |
| Durable Temporal worker recovery/replay, outbox, readiness recovery           | PASS                 |
| Real API/PostgreSQL browser acceptance                                        | PASS                 |
| CodeQL, SCA, IaC, secrets, SBOM and license policy                            | PASS                 |
| All six assembled ARM64 images and HIGH/CRITICAL scans                        | PASS                 |
| Keycloak realm import, client credentials and interactive OIDC protocol       | PASS                 |
| Temporal verified SQL TLS, schemas, SDK execution/history replay              | PASS                 |
| Focused local realm, image-contract, acceptance-guard and source-build checks | PASS: 6 + 3 + 11 + 4 |

Image evidence retains assembled image IDs and CycloneDX SBOMs; Keycloak also
retains source-build provenance, storage/config diagnostics and synthetic runtime
logs. Image/security artifacts have 30-day CI retention and real-stack browser
artifacts have 14-day retention; final evidence is also downloaded to Spectra.
Its selected upstream server reactor ran
**2,228 tests, 71 skipped, zero failures/errors** in the completed rebuilds.
This is not the entire upstream integration testsuite. The worker runtime base's
published Sigstore identity was independently verified.

The Keycloak protocol smoke uses an ephemeral synthetic user on an internal
Docker network: required S256 PKCE, interactive authorization-code exchange,
JWKS signature/claim checks, code replay rejection, refresh rotation/replay
rejection and logout. It does not establish production HTTPS/MFA or application
BFF/mobile session wiring. Temporal's new SDK test uses a private test network;
it does not establish deployed frontend mTLS/OAuth acceptance.

The remote clean-install workspace run passed **1,011 tests: 836 TAP and 175
Vitest**, with zero failures or skips. Its separate workspace-safety check ran
12 tests. The four browser cases had zero skipped, unexpected or flaky results;
the runner confirmed owned API/web cleanup. These counts include the later
security regressions and the locked Temporal SDK 1.22.0. Historical local counts
above are not being rewritten.

The fixed Keycloak runtime artifact confirms UID 1000 owns both data and
transaction-log directories, zero `ARJUNA048006` initialization warnings across
two starts, recovery-manager initialization on both starts, and an existing realm
preserved at re-import. All six final SBOM inventories match the residual-finding
assessment below. CodeQL still reports exactly the 19 individually classified
open alerts on `51595122`, with no newly introduced alert.

Retained local evidence: `ci-51595122-quality.log`,
`ci-51595122-keycloak.log`, `ci-51595122-pr-checks.json`,
`ci-51595122-codeql-open.json`, and the corresponding quality/security artifact
folders under the Spectra audit directory. PR-event artifact names use GitHub's
synthetic merge commit `78cf6d6b59efcbb4228ec96d0a74b37a5e15cfdf`, while the run
metadata identifies the reviewed PR source head `51595122` above.

The npm audit snapshot is **0 critical, 0 high, 13 moderate**. The high-severity
merge gate remains unchanged. Moderate findings derive from two advisory roots:
Expo's `decode-uri-component` path needs remediation before the affected mobile
input exposure is enabled; inspected Xcode tooling calls `uuid.v4()` without the
output-buffer paths affected by the UUID advisory. This is a bounded call-site
assessment, not a blanket waiver. No forced framework-major upgrade was used.

The image gates use Trivy's selected vendor/advisory severity. Their success
must not be described as vulnerability-free images or zero HIGH ratings in every
advisory source. The retained CycloneDX records also include alternate ratings:

| Component                                           | Residual finding and current exposure                                                                                                                                                                                                                                                                                                                   | Follow-up boundary                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker Debian glibc 2.41-12+deb13u4                 | CVE-2018-20796, CVE-2019-1010022, CVE-2019-1010023 and CVE-2019-9192 have Debian low classifications despite higher NVD ratings. Debian/upstream explicitly disputes the security impact of the mitigation-bypass entry.                                                                                                                                | Track the supported Debian/distroless base and re-scan its replacement; do not arbitrarily replace the worker's required native libc. [Debian assessment](https://security-tracker.debian.org/tracker/CVE-2019-1010022).                                                      |
| Keycloak OpenTelemetry API 1.57.0                   | CVE-2026-45292 is GHSA moderate, with a higher Red Hat rating: oversized baggage can allocate excessive resources. The pinned Keycloak source disables tracing by default at build time, and this repository does not enable it. This is a configuration-based exposure assessment.                                                                     | Upgrade the compatible upstream tracing dependency before enabling the affected propagation path; the upstream fix is 1.62.0. Preserve HTTP header bounds. [Upstream advisory](https://github.com/open-telemetry/opentelemetry-java/security/advisories/GHSA-rcgg-9c38-7xpx). |
| Media scanner Lambda runtime's bundled fflate 0.8.1 | CVE-2026-45820 is GHSA moderate with higher alternate ratings. It concerns malformed ZIP64 handling in unzipSync. The affected package is under `/var/runtime/node_modules/@aws-sdk/`; ClinicOS ships its own locked SDK under `/var/task` and the current handler consumes GuardDuty metadata, not ZIP contents. No application fflate call was found. | Track an AWS base with fflate 0.8.3 or later and re-scan before adding archive parsing. Do not patch a bundled runtime package in place. [Upstream fix](https://github.com/101arrowz/fflate/commit/e6d5e6e1076892f72770ac732d83c81da9f3316e).                                 |

These classifications allow review of the current MVP scope; they are not
suppression rules, live deployment approval, or authorization to enable the
affected deferred surfaces. Temporal's retained SBOM also has moderate/low
findings; the configured HIGH/CRITICAL gate remains enforced for all six images.

No local Docker image pulls/builds or existing service/database changes were
made for this CI pass. Remote image builds and synthetic tests use disposable
GitHub runners under the owner's explicit authorization. Logs, source-inspection
caches and downloaded evidence are kept on Spectra under the ignored
`.audit-spectra-retirement-20260920/pr1-merge-20260922/` directory. Earlier failures
remain preserved; later success does not erase them.

## Remaining work after a verified merge

1. Keep the named pilot: Healthy Roots using Practo Ray/Profile. Obtain an
   authorized, de-identified representative export and its documented field,
   identifier, timezone, update/cancellation and missing-record semantics.
   Confirm entitlement, cadence and expected volume. This is the clinic input
   needed before implementing the vendor mapping; do not guess its columns.
2. Build the verified adapter into the existing canonical import contract, then
   prove first import, replay, changes, cancellation and discrepancy review.
   Complete repeatable reconciliation and truthful source freshness across two
   cycles before calling recurring sync complete.
3. Complete real application identity/session wiring and test login, expiry,
   refresh, logout/revocation and clinic authority against Keycloak. Passing the
   identity-server protocol smoke alone does not complete this workflow.
4. Run the controlled clinic trial and obtain handling approval before any real
   patient data. Production deployment, provider activation, MFA/operations and
   the broader CP14–CP18 external evidence remain separately gated.

The owner authorized PR updates and CI iteration, **not merge or deployment**.
A later merge must recheck the current remote head and all checks, and use the
existing `mac-latest-20260829` target. The baseline branch and `main` have not
been promoted by this task.
