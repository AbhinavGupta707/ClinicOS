# Checkpoint 11 E3 Evidence Record

## Evidence metadata

```yaml
evidence_id: CP11-E3-CLOSEOUT-20260709-001
checkpoint: CP11
findings: [PRR-001, PRR-002, PRR-003, PRR-010, PRR-011, PRR-025, PRR-026, PRR-027, PRR-029]
base_revision: 1332d3c4391874e40ba35b76192a9472b3d541bf
branch: main
working_tree: dirty-intentional-uncommitted-cp11-and-preexisting-remediation-docs
tier: E3
environment: local-macos-docker-synthetic
data: synthetic-only-no-real-phi
executed_at_utc: 2026-07-09T21:47:50Z
clinic_timezone: Asia/Kolkata
clinic_local_time: 2026-07-10T03:17:50+0530
operator: Codex primary master session
reviewer: primary master diff-and-evidence self-review; human review pending before commit/promotion
valid_until: superseded-by-code-schema-runner-dependency-or-environment-change
release_decision: NO-GO
skips: 0 within the E3 claims below
```

The user prohibited commit/push. Evidence is therefore tied to the recorded base revision plus the
disclosed dirty working tree, not an immutable result commit. User-owned untracked `research/` and
`scripts/research/` remained untouched and are excluded from release formatting scope.

Environment: Node `22.22.2`, npm `10.9.7`, Docker `29.3.1`, Compose `5.1.1`, local PostgreSQL client
`16.14`, Docker PostgreSQL `16.13`, Flyway OSS `12.10.0` pinned by tag and image digest.

## Baseline reproduced before implementation

| Baseline defect | Reproduction result |
| --- | --- |
| Current tests | Root suite failed in CP6 date-derived lab identifier and CP9 retention because product/test time came from the host clock. |
| PostgreSQL state | `public` contained zero product tables; numbered SQL existed but no lifecycle or history table applied it. |
| CP10 live smoke | Health passed, then the fixture clinic identifier failed live authorization with `clinic_mismatch`. |
| Readiness | API returned ready with the database pointed at unused port `59999`; no dependency was probed. |
| TypeScript | Several production workspaces used `node --check` and could not catch cross-package type errors. |
| Repository check | `npm run check` failed only because untracked user-owned `scripts/research/` entered the formatting glob. |
| Worker durability | The later real restart smoke found the worker expected columns/tables absent from the canonical schema and left its health listener alive after startup failure. |

These are baseline/audit observations, not current results.

## Material E3 evidence

| Evidence ID | Command or procedure | Result | Skips / limitations |
| --- | --- | --- | --- |
| CP11-E3-DB-BOOTSTRAP-001 | `npm run db:bootstrap` twice; final `npm run db:verify` | PASS: 14 checksum-tracked migrations, 96/96 tenant-owned tables forced-RLS, two synthetic tenants, three non-super/non-bypass roles, runtime no-context rows 0, worker product-table read denied, cross-tenant isolation pass | Local clean database only; staging/restore remain E4/E5 |
| CP11-E3-MIGRATION-002 | `npm run db:migrate:validate`; `npm run db:migrate`; `npm run db:migrate:info` | PASS: version 014 validated; repeat migrate no-op | Applied canonical files must remain immutable |
| CP11-E3-MIGRATION-003 | `npm run db:test:migrations` | PASS: concurrent runners serialized, checksum drift rejected, failed migration rolled back, canonical files unchanged | Isolated local databases |
| CP11-E3-REPOSITORY-004 | `npm run db:test:repositories` twice consecutively | PASS: identity bootstrap, pooled-context reset, tenant isolation, domain/audit/timeline/outbox atomic commit, forced rollback, idempotent outbox, cross-tenant FK | Synthetic rows; final bootstrap restores canonical seed state |
| CP11-E3-WORKER-005 | `npm run worker:test:persistence` | PASS: least-privilege worker, claim/lease, durable retry/second attempt, processed state, reviewable dead letter | Temporal workflow execution/replay remains CP13 |
| CP11-E3-WORKER-006 | Start worker with `clinic_os_worker`, Postgres and Temporal; call `/health/ready`; clean SIGINT; repeat with a second worker ID | PASS twice: outbox repository, registered handler and Temporal healthy; shutdown exit 0; process restart healthy | Local services only; console metric backend is not production telemetry |
| CP11-E3-READINESS-007 | `npm run api:test:readiness` | PASS: Postgres loss kept liveness 200, readiness/traffic 503, recovered; real-auth Keycloak JWKS loss did the same and recovered; durable repository reported E3 | Redis/Temporal are not synchronous API dependencies at CP11; worker probes Temporal separately |
| CP11-E3-LIVE-008 | Durable API with `CLINIC_OS_API_USE_FIXTURE_REPOSITORY=false`; run `npm run cp11:smoke:api -- --base-url http://127.0.0.1:4100 --auth-mode local-dev-subject` twice | PASS twice: runtime identity/IDs, validation failure, lead→patient→appointment→queue, duplicate idempotency, consent→encounter→signed note, denied roles, audit/outbox, blocked readiness, cross-tenant denial; fixture fallback detector passed | Local synthetic auth fixture supplies identity claims only; repository is PostgreSQL |
| CP11-E3-TIME-009 | `npm run check:clock`; domain/API/database tests | PASS: injected clock at critical API/Postgres boundaries; clinic-local midnight, leap day, DST and fixed-clock scenarios; 37 remaining current-time boundary sites explicitly owned | Allowlist is reviewed inventory, not proof those later checkpoint surfaces are complete |
| CP11-E3-TYPES-010 | `npm run typecheck`; negative cross-package fixture in `npm run check` | PASS: all 14 production TypeScript workspaces invoke `tsc`; invalid branded identifier makes gate fail | Some legacy projects temporarily relax selected strict options; listed for incremental tightening |
| CP11-E3-REPO-011 | `npm run check`; `git diff --check`; `npm run lint`; `npm run test`; `npm run build`; `npm run security:secrets` | PASS; root tests had zero skips; secret scan covered tracked and untracked release-scope files; user research was excluded and unmodified | Final rerun required after any later edit |
| CP11-E3-SCA-012 | Approved `npm run security:audit` network path | PASS at `--audit-level=high`; 21 moderate transitive advisories reported in Next/PostCSS, Temporal/protobufjs and Expo/xcode/uuid chains | Moderate advisories remain tracked; no force downgrade applied |
| CP11-E3-SBOM-013 | `npm sbom --sbom-format=cyclonedx --omit=dev \| jq ...` | PASS: CycloneDX 1.5, root `ClinicOS`, 684 production components | Generated/validated in-session; no signed artifact provenance at E3 |
| CP11-E2-BROWSER-014 | In-app Browser rendered assistant workflow/denial and owner pilot readiness; DOM, focus/control reachability, console and 1280/390 widths inspected | PASS: no horizontal overflow, empty console error/warn set, explicit synthetic/non-PHI disclosure, owner remained blocked, assistant denial rendered no clinic data | E2 fixture UI smoke supplements E3 API helper/live contract; it is not a durable loader or provider/device claim |
| CP11-E2-PLAYWRIGHT-015 | Owner server: `CLINICOS_CP11_E2E_ENABLED=true NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner npx playwright test apps/web/tests/checkpoint-11-readiness.spec.ts --reporter=line`; repeat with role `assistant` | PASS: two owner tests and one assistant-denial test across the two role runs; role-inapplicable tests explicitly skipped in each separate run | Combined applicable cases all ran; fixture-only UI |
| CP11-E3-PERF-016 | `npm run cp11:baseline:api -- --base-url http://127.0.0.1:4100 --subject seed-owner --iterations 25` | PASS: health p50/p95 2.23/5.92 ms; identity 12.75/20.14 ms; patient list 13.94/21.26 ms | Sequential developer-machine baseline, first request included; not a load/capacity/SLO claim |

## Sanitized rendered artifacts

- `/private/tmp/clinicos-cp11-home-desktop.png`
- `/private/tmp/clinicos-cp11-home-mobile-390-top.png`
- `/private/tmp/clinicos-cp11-pilot-readiness-denied-assistant.png`
- `/private/tmp/clinicos-cp11-pilot-readiness-owner-blocked-viewport.png`
- `/private/tmp/clinicos-cp11-pilot-readiness-owner-mobile-390.png`

All show synthetic ClinicOS fixture data only. No real clinic, patient, provider credential, private
storage reference, access token, payment or provider success is present.

## Route and evidence classification

| Surface | Current CP11 classification |
| --- | --- |
| `/health/live` | Process liveness only; never dependency readiness |
| `/health/startup` | Sticky startup after schema and required-auth dependency success |
| `/health/ready` | Current bounded required dependency status; E2 fixture or E3 durable mode stated |
| `/v1/me`, patient/lead/appointment/queue, consent/encounter/note routes used by CP11 smoke | E3 local PostgreSQL through runtime-discovered tenant/clinic/user/resource IDs |
| `/v1/pilot-readiness` | Durable read with external go-live gates still blocked |
| CP10 dry-run route inventory | E1 contract inventory; it is not promoted to live evidence merely because it prints `live=yes` |
| CP10/CP11 web fixture surfaces | E2 rendered regression only; live API helper contract is proven separately |
| Messaging/payment/telephony/AI/ABDM/AWS/device/provider success | Disabled, deferred or unavailable; no E3+ activation claim |

## CP12 handoff gaps by route family

- The HTTP server/router and application operations remain concentrated in `server.ts` and
  `operations.ts`; CP12 must create modular NestJS boundaries without weakening the durable unit of
  work.
- Runtime validation is handwritten and uneven across CP2-CP10 route families. CP12 owns centralized
  schemas, unknown-field rejection, size/pagination budgets and mass-assignment tests.
- OpenAPI/client definitions are handwritten notes rather than generated from the runtime contract.
- Local synthetic subject auth is correctly local-only, but production cookie/session/refresh/MFA
  lifecycle remains CP14.
- Idempotency is covered for the CP11 chain and outbox uniqueness; route-complete concurrent/stale
  version coverage remains CP12/CP13.
- Readiness has Postgres/Keycloak probes. Redis and Temporal must be registered only where an owning
  runtime makes them required; the worker already reports Postgres/Temporal and handler state.
- PRR-026 capability activation remains partial until the CP15 provider registry and signed callback
  lifecycle exist. PRR-027 remains partial until CP13 proves Temporal crash/replay/reconciliation.

## Tooling blockers and open evidence

- `terraform version`, `terraform fmt -check`, and `terraform validate` could not run because the
  Terraform CLI is not installed/registered on this machine. CP11 did not modify Terraform, and the
  known validation-only/no-resource pilot-prod definition remains a CP14 hard gate.
- Docker Scout is installed (`v1.20.4`) but container CVE scanning stopped at official activation:
  Docker Scout requires a Docker ID login. No Docker credentials were requested or fabricated.
  Container vulnerability evidence therefore remains open.
- `trivy` and `syft` are not installed. The npm CycloneDX SBOM succeeded, but signed SBOM/provenance
  and container/IaC scans remain CP14 release gates.
- No physical-device, official-provider sandbox, deployed-cloud, live restore, failover, alert
  delivery, real-clinic, real PHI or production callback test was performed or claimed.

## CP11 decision

The CP11 E3 durable-local exit criteria are satisfied at this recorded working-tree state after the
final full gate rerun and diff review. This closes the checkpoint boundary only. ClinicOS remains
**NO-GO** for pilot/production because higher-tier P1 findings and required external evidence remain
open. CP12 may begin only from this durable foundation; any material CP11 code/schema change
invalidates this record and requires rerun.
