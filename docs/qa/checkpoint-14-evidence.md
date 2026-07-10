# Checkpoint 14 Evidence — Active Candidate

**Status:** Active; local and CI controls are partial E1/E3 evidence only. E4 staging and E5
pilot-production do not exist.

**Candidate branch:** `codex/integration/checkpoint-14`

**Implementation candidate before evidence-only closeout:**
`eae79c0d09c0170f28c3b27493705ad67abe499e`

## Implemented and verified

| Evidence                                       | Result                                                                                                                                        | Boundary                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Root check, typecheck, lint, test and build    | Pass on the integrated CP14 candidate                                                                                                         | Local E1/E3; no deployed claim                    |
| Canonical database migration gate              | Pass: 19 migrations, concurrent runner, checksum drift rejection and rollback                                                                 | Local PostgreSQL only                             |
| API package                                    | Pass: 158 tests with socket execution and zero skips                                                                                          | Local E3                                          |
| Database package                               | Pass: 104 tests                                                                                                                               | Local E3                                          |
| Integrations / worker / workflow               | Pass: 101 / 26 / 12 tests, zero skips                                                                                                         | Local E1/E3                                       |
| CP14 telemetry and synthetic resilience suites | Pass, including deterministic dependency faults and synthetic recovery harnesses                                                              | Simulation only; not restore/failover evidence    |
| Terraform verifier                             | Pass: all four roots validate/mock-test; staging 3/3, pilot 5/5; policy assertions pass                                                       | No plan/apply                                     |
| Trivy IaC                                      | Pass: zero high/critical findings                                                                                                             | Static source scan                                |
| Repository SCA                                 | Pass: zero high/critical; 12 moderate advisories remain in governed transitive paths                                                          | No force fix or risk acceptance                   |
| CycloneDX production SBOM                      | Pass: 824 components; license gate passes with three pinned metadata exceptions                                                               | Unsigned local artifact                           |
| GitHub quality workflow                        | Pass in run `29125220038` at `eae79c0d`: clean-runner workspace checks, tests and builds                                                      | CI E3; no deployed claim                          |
| GitHub security workflow                       | Pass in run `29125220024` at `eae79c0d`: CodeQL, repository Trivy, Terraform scan, Syft/npm SBOM, license gate and all three ARM64 image jobs | CI artifact evidence; not ECR promotion           |
| API / web / worker images                      | Pass: ARM64, numeric UID/GID `10001`, digest-pinned Node base, zero Trivy high/critical findings or embedded secrets                          | Local/CI images only; not signed or pushed to ECR |
| Web image runtime                              | Pass under read-only root filesystem with localhost HTTP smoke                                                                                | Local container only                              |
| AWS identity/region preflight                  | Approved IAM user resolves in account `222634407676`; Mumbai primary and Hyderabad enabled                                                    | Read-only inventory                               |

## Security corrections found during integration

- Removed two unowned wall-clock reads and pinned Temporal SDK packages to `1.20.2`.
- Added pre-import API/worker OpenTelemetry bootstraps, bounded telemetry, durable outbox trace
  correlation, readiness/backpressure controls and AWS dashboard/alarm definitions.
- Corrected ECS environment truth, API/worker database and signing-key secret mappings, API port
  `4100`, and worker health port `3001`.
- Added immutable GitHub action pins, CodeQL, Trivy, Syft/npm SBOM, license policy and weekly
  dependency/action updates.
- Removed vulnerable runtime npm/corepack/yarn surfaces and pinned patched Alpine OpenSSL packages;
  final application image scans are clean at high/critical severity.
- Corrected clean-runner CI ordering so branded cross-package type tests build their shared package
  outputs before execution.

## Exit gates still open

1. The existing SSE-S3 Terraform state bucket and lock table are not yet adopted into the dedicated
   CMK bootstrap state. Import/migration changes state and requires a reviewed saved plan and exact
   authorization.
2. No staging or pilot-prod Terraform apply has occurred. There is no deployed VPC, ECR, RDS,
   cache, ECS, Keycloak, Temporal, ALB/WAF, telemetry backend, backup or recovery target.
3. The Keycloak and Temporal production images remain incomplete. Temporal still requires a
   versioned schema task, dynamic configuration and an authenticated/mTLS service boundary; the
   current Terraform command/env shape alone is not runtime evidence.
4. No clinic-owned domain, hosted zone, auth/admin hostnames, ACM certificate, private-zone ID or
   reviewed private/VPN/JIT administrator CIDRs exist.
5. No real paging destination exists, so alarm delivery/escalation cannot be verified.
6. No approved production malware scanner transport exists. Media remains fail-closed and cannot
   receive E4 clean/quarantine evidence.
7. Images are not signed, attested or pushed to both regional ECR repositories because foundation
   infrastructure and GitHub deployment environments do not exist.
8. No real cloud load/fault, alert injection, backup restore, Hyderabad failover/failback, deployed
   browser/API/worker, or synthetic pilot evidence exists.

CP14 remains **NO-GO** and must not be promoted to `main` or followed by CP15 until these hard gates
are satisfied with exact-revision E4/E5 evidence.
