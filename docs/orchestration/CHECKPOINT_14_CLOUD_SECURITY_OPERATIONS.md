# Checkpoint 14 — Cloud, Security Operations, Media and Recovery

**Status:** Active; local implementation candidate `3ddf01a2` passes, while E4/E5 apply remains gated on a reviewed costed plan and explicit authority
**Evidence target:** E4 staging and E5 pilot-production synthetic
**Workers:** three initial path-disjoint worktrees; observability/recovery is sequenced after interface freeze
**Primary findings:** PRR-006, 007, 009, 013, 015-020, 024; remaining PRR-001/003/010

## 1. Outcome

Replace the validation-only cloud posture with deployable, policy-checked AWS infrastructure and a production-equivalent ClinicOS environment with identity/session security, private media, telemetry/alerts, supply-chain controls, backup/restore/failover and resilience evidence.

CP14 cannot close from Terraform text, console loggers or dry-run restore scripts. E4/E5 requires applied infrastructure and real environment evidence. The master must obtain explicit apply/DNS/recovery authority before mutations.

## 2. Activation Preflight

Before worker launch, diagnose in order:

1. Terraform registration/install; CP11 recorded it absent.
2. AWS SSO/profile/account/region/backend/KMS state and apply authority.
3. Docker Scout registration/login or approved Trivy/Syft alternative; CP11 recorded Scout unactivated and Trivy/Syft absent.
4. DNS/domain/TLS and CI OIDC authority.
5. production identity/session and Keycloak deployment ownership.
6. paging/escalation target and recovery window.

Workers may implement local definitions while approval is pending, but the checkpoint remains open and CP15 does not launch without the required E4 public edge/secrets/telemetry.

## 3. Lanes

### Lane A — AWS Terraform Platform (`gpt-5.6-sol`, `xhigh`)

**Owns:** `infra/terraform/**` only.

**Goal:** version-pinned modules/environments for account/network/private subnets, ECS/Fargate, ALB/WAF, RDS/Postgres, Redis if required, Temporal deployment decision, S3/KMS, Secrets Manager, ECR, DNS/TLS, remote state, backup vault and cross-region recovery foundations.

**Verification:** fmt/validate/plan, policy/security/cost scan, private/public reachability rules, least IAM, deletion protection and drift strategy. Apply only after explicit authority.

### Lane B — Identity, Session and Edge Security (`gpt-5.6-sol`, `xhigh`)

**Owns:** `packages/auth/**`, `packages/security/**`, `infra/docker/keycloak/**`, namespaced web BFF/session/security paths and their tests.

**Goal:** production Keycloak topology/realm promotion/backup, Authorization Code + PKCE, secure HttpOnly web session, mobile token contract, MFA/rotation/revocation/JML/break-glass, CSP/headers, CORS/origin/CSRF/cache policy and application rate/resource controls.

**Forbidden:** Terraform, root env/manifests, aggregate app composition, memory/log/release docs.

### Lane C — Private Media and Data Protection (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced storage/media provider paths in integrations/API, media security tests and storage runbooks outside Terraform.

**Goal:** private S3/KMS provider, reservation and short signed upload/access, tenant object scope, magic-byte/type/size validation, quarantine/malware scan state, completion verification, lifecycle/deletion/restore and no internal path disclosure.

**Verification:** malicious file, cross-tenant, expired URL, incomplete/quarantine, lifecycle and audit tests. Cloud execution waits for applied Lane A resources.

### Lane D — Observability, Resilience and Recovery (`gpt-5.6-sol`, `xhigh`)

**Launch condition:** instrumentation hooks in API/worker/auth/media are frozen as master-owned integration points. If Lane D would edit Lane B/C implementation files or compete for the same applied environment, sequence it after those lanes instead of launching it concurrently.

**Owns:** `packages/observability/**`, namespaced worker/runtime instrumentation, load/fault/recovery scripts, and operational runbooks outside Terraform.

**Goal:** OpenTelemetry correlation across HTTP/DB/outbox/Temporal/provider, PHI-safe logs, dashboards/SLOs, queue/provider/auth/DB/backup/security alerts, paging, capacity/backpressure, backup/PITR/cross-region restore and failover/failback procedures.

**Forbidden:** Terraform resources owned by Lane A; provide exact integration requirements in handoff.

## 4. Master Integration

- Root `.github`, env schema, manifests/lockfile, Docker composition and deployment pipeline are master-owned.
- Merge Terraform definitions first, then identity/security, media and observability requirements; master wires resource outputs/secrets/telemetry/deploy configuration.
- Build once, create SBOM/provenance, scan/sign and promote the same artifact.
- Apply staging first, run E4, then pilot-prod synthetic E5 only with explicit authority.
- Run destructive restore/failover only in the approved window with backups and named stop authority.

## 5. Exit Gate

- Terraform-applied inventory matches reviewed plans; private data paths, KMS, IAM, WAF/TLS and drift checks pass;
- deployed Keycloak/session/MFA/revocation/key rotation and edge security tests pass;
- production media quarantine/access/lifecycle/tenant tests pass;
- OTel traces/metrics/logs and real paging alert injection pass without PHI;
- load/noisy-tenant/dependency-fault/backpressure and SLO evidence pass;
- real backup restore plus failover/failback meets approved RPO/RTO and reconciles application state;
- SCA/SAST/IaC/container/license/SBOM/signing/provenance gates pass or have authorized, expiring non-P1 exceptions;
- full E4/E5 browser/API/worker evidence and release docs complete;
- integration promoted to `main`; CP15 public callback prerequisites are real.
