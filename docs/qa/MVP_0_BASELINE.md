# ClinicOS MVP0 Baseline Evidence

Status: technical baseline green; checkpoint exit blocked on explicit inputs
Evidence tier: E3 durable local integration
Executed at: 2026-08-30T18:20:33Z
Authoritative root: `/home/abhinav/code/ClinicOS`
Branch: `codex/integration/mvp-0`
Starting commit: `2a4cd31f57d892810c5dfb692266b3965412aff2`

## Claim

The WSL repository can be installed, compiled, tested, built, migrated, seeded,
and exercised against the local service stack. The clean-checkout check-ordering
defect is repaired, and the web application now uses an exact patched Next.js
version. No clinic integration is claimed: MVP1 still requires an approved source
contract and deidentified representative samples.

## Environment

- WSL distribution: Ubuntu
- Node.js: `v22.22.2`
- npm: `10.9.7`
- lockfile SHA-256:
  `5df03d27bc7cf134143c2ad0dab8f905f790b25d9ea82a574ec1fcc2ad0e4ef9`
- web framework: Next.js `15.5.21`
- local dependencies: PostgreSQL, Redis, Keycloak, Temporal, and Temporal UI
- database migration count: 22 contiguous Flyway migrations

All patient and tenant data used for this evidence is synthetic local fixture
data. No production PHI, provider credential, or live clinic endpoint was used.

## MVP0 changes

- Established the integration-first MVP0/MVP1/MVP2 execution plan and intake
  contract while preserving the blue-sky specifications as long-term direction.
- Made `/home/abhinav/code/ClinicOS` authoritative for this WSL programme.
- Repaired root `npm run check` ordering so shared domain declarations are built
  before the CP11 cross-package fixture is compiled.
- Pinned the web application to the compatible patched Next.js `15.5.21` release
  and reconciled the root lockfile.
- Added this durable verification record. No release, deployment, or external
  publication is implied.

## Verification

| Gate | Result | Evidence summary |
| --- | --- | --- |
| Local dependency stack | PASS | PostgreSQL, Redis, and Keycloak healthy; Temporal services running |
| `npm run db:migrate:validate` | PASS | 22 migrations validated |
| `npm run db:seed:local` | PASS | Idempotent synthetic seed completed |
| `npm run db:verify` | PASS | 123 tenant tables protected by forced RLS; cross-tenant isolation passed |
| `npm run db:test:migrations` | PASS | Concurrency, checksum drift, rollback, and AI durability cases passed |
| `npm run db:test:repositories` | PASS | Tenant isolation, reset, atomicity, idempotency, and cross-tenant FK cases passed |
| `npm run worker:test:persistence` | PASS | Least privilege, lease, retry, processed, and dead-letter cases passed |
| `npm run api:test:readiness` | PASS | Dependency-loss readiness removal and recovery passed |
| `npm run check` | PASS | Workspace graph, migrations, clock, CP11 fixture, environment, and formatting passed |
| `npm run typecheck` | PASS | All workspaces passed |
| `npm run lint` | PASS | All workspaces passed |
| `npm run test` | PASS | Root workspace command exited 0; no failed or skipped test was reported |
| `npm run build` | PASS | Packages, API, worker, Expo export, and Next production build passed |
| Web typecheck/lint/test/build | PASS | 19 test files and 100 tests passed; Next production build passed |
| `npm run security:secrets` | PASS | Repository secret scan passed |

The API readiness test intentionally emits error logs while PostgreSQL, Redis,
and Keycloak are made unavailable. The gate passed only after each dependency
removed readiness/traffic eligibility and recovered correctly.

## Dependency advisory classification

A successful audit immediately after the Next.js update reported 12 high and 10
moderate advisories, with no critical advisory. A later attempt to regenerate the
machine-readable audit was rejected by the execution policy because dependency
inventory disclosure was not explicitly authorized, so this record does not
overstate fresher evidence.

Observed dependency paths were classified as follows:

- Next.js is directly runtime-relevant and was moved to exact version `15.5.21`.
- `postcss` and `sharp` on the Next.js path are constrained by that supported
  release and require upstream-compatible remediation rather than forced changes.
- Expo/Metro `image-size`, Expo/Vite `postcss`, and Expo/ESLint `js-yaml`,
  `nanoid`, and `brace-expansion` are transitive build/tooling paths.
- Temporal worker webpack/AJV `fast-uri` is a transitive build path.

No `npm audit fix --force` or incompatible major upgrade was applied. Remaining
advisories require a separately authorized, compatibility-tested dependency lane;
they do not justify weakening lockfile reproducibility or provider correctness.

## Known limitations and explicit blockers

1. A current-lock clean `npm ci --prefer-offline --no-audit` was not executed
   after the dependency change because the environment correctly required fresh
   user authorization. The earlier baseline clean install passed, and every
   post-change compile, test, and build gate above passed.
2. MVP1 cannot be designed honestly until the owner supplies the target clinic
   system/vendor and version, authorized access method, sample export or webhook
   payloads, timezone and identifiers, update/cancellation semantics, expected
   volume, and desired import cadence.
3. No browser smoke was required because MVP0 changes no rendered workflow.
4. This is local E3 evidence, not deployed-cloud, physical-device, live-provider,
   security-assessment, compliance, or production-release evidence.

## MVP0 decision

The coding baseline is suitable for source-specific MVP1 implementation once the
two blockers above are resolved. MVP0 is not marked complete, MVP1 is not started,
and no claim of live clinic interoperability is made.
