# Checkpoint 14 Evidence — Active Candidate

**Status:** Active; local and CI controls are partial E1/E3 evidence only. E4 staging and E5
pilot-production do not exist.

**Candidate branch:** `codex/integration/checkpoint-14`

**Implementation candidate before evidence-only closeout:**
`eae79c0d09c0170f28c3b27493705ad67abe499e`

**Platform-runtime hardening candidate:**
`3ddf01a2`

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
| Keycloak production image                      | Pass: ARM64 UID `1000:0`; Keycloak 26.7.0; exact realm import/readiness/OIDC/client-credentials smoke; zero high/critical image findings      | Local E3 image; not signed, pushed or deployed    |
| Temporal production image                      | Pass: ARM64 UID `1000:1000`; Temporal 1.31.2 server/schema tools; config/task-network startup smoke; zero high/critical image findings        | Local E3 image; not signed, pushed or deployed    |
| Platform database trust                        | Pass: both images contain the digest-pinned official AWS RDS global CA bundle; Keycloak/Temporal require verified hostname TLS                | Static/runtime contract; no live RDS handshake    |
| Keycloak realm/Temporal worker auth            | Pass: exact four-client realm; worker token has canonical issuer/client, `clinic-os-temporal` audience and worker/write permissions           | Clean local Keycloak/PostgreSQL only              |
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
- Built hardened Keycloak and Temporal images from digest/source-pinned inputs. Keycloak imports the
  exact secret-free realm and fails closed around one-shot bootstrap. Temporal uses a versioned
  schema task, authenticated JWT audience/permission mapping, mTLS, a distinct internal frontend,
  verified SQL TLS, routable ECS task identity and non-loopback cluster metadata.
- Corrected Temporal OAuth/JWKS traffic to use the canonical authentication hostname rather than
  granting workloads access to the operator-only Keycloak admin plane.
- Added repeatable CI runtime gates for both platform images and pinned the official AWS RDS CA
  bundle by SHA-256 in both builds.

## Exit gates still open

1. Read-only inventory confirms the existing Terraform bucket is SSE-S3, versioned and public-
   blocked but contains no current objects, historical versions or delete markers; its lock table
   has PITR disabled. There is no state payload to migrate, but creating the dedicated CMK/PITR
   backend and retiring or retaining the empty legacy resources still requires a reviewed plan and
   exact authorization.
2. No staging or pilot-prod Terraform apply has occurred. There is no deployed VPC, ECR, RDS,
   cache, ECS, Keycloak, Temporal, ALB/WAF, telemetry backend, backup or recovery target.
3. The Keycloak and Temporal image contracts now pass local build, runtime and scan gates, but no
   exact-commit images have been signed, attested, pushed to dual-region ECR or exercised against
   live RDS, ECS, ACM and Keycloak/Temporal secrets.
4. The clinic-owned `alventis.co.uk` domain exists and the isolated `clinicos.alventis.co.uk`
   namespace was confirmed unused without changing the existing apex/`www` site. No Route53 public
   hosted zone/nameservers, Porkbun NS delegation, ACM certificates, private admin zone, final
   hostnames or reviewed private/VPN/JIT administrator CIDRs exist yet.
5. No real paging destination exists, so alarm delivery/escalation cannot be verified.
6. No approved production malware scanner transport exists. Media remains fail-closed and cannot
   receive E4 clean/quarantine evidence.
7. Images are not signed, attested or pushed to both regional ECR repositories because foundation
   infrastructure and GitHub deployment environments do not exist.
8. No real cloud load/fault, alert injection, backup restore, Hyderabad failover/failback, deployed
   browser/API/worker, or synthetic pilot evidence exists.

CP14 remains **NO-GO** and must not be promoted to `main` or followed by CP15 under the checkpoint
exit contract until these hard gates are satisfied with exact-revision E4/E5 evidence.
