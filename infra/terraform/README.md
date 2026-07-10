# ClinicOS AWS Terraform

This tree replaces the CP9 validation-only posture with a version-pinned, deployable AWS platform for synthetic staging and pilot-production use. It defines infrastructure; it does not claim that AWS resources, DNS, alert delivery, restore, or E4/E5 evidence exist.

## Environment isolation

- `staging/` and `pilot-prod/` have separate state keys, VPC CIDRs, buckets, KMS aliases, IAM roles, registries, databases, caches, backups, and tags.
- Each root accepts its own AWS account ID. They can share the current account without AWS Organizations, then move to separate accounts by changing root inputs and backends.
- Mumbai (`ap-south-1`) is primary. Hyderabad (`ap-south-2`) contains a dormant VPC, KMS keys, protected S3 replicas, ECR repositories, and a backup vault. It does not run paid warm compute or NAT by default.

## Modules

| Module | Responsibility |
| --- | --- |
| `kms` | Rotating customer-managed data/log/secrets/backup keys and aliases, protected from Terraform destroy. |
| `network` | Three subnet tiers across three AZs, controlled NAT, VPC endpoints, isolated data routes, and encrypted flow logs. |
| `storage`, `s3-replication` | Private versioned media/audit buckets, Object Lock, lifecycle, ALB logs, and KMS cross-region replication. |
| `database`, `cache` | Private encrypted Multi-AZ RDS PostgreSQL and a justified Redis OSS 7.1 cache for CP12 abuse budgets/short non-authoritative jobs. |
| `ecr`, `compute` | Immutable encrypted ECR and ECS/Fargate task/service definitions that accept only image digests. |
| `edge` | Optional domain-gated ACM/DNS, ALB, WAF managed rules/rate limiting, TLS-only routing, and redacted WAF logs. |
| `secrets` | Recovery-protected Secrets Manager containers; no provider/application secret values are committed. |
| `backup`, `observability` | Cross-region AWS Backup plans/vaults, opt-in Vault Lock, CloudWatch alarms/dashboard, SNS topic, failure events, and X-Ray sampling. |
| `ci-oidc` | Exact GitHub subject trust, separate read/plan, immutable artifact-publish, and environment deploy roles. |

## Runtime and Temporal decision

The current decision is self-hosted Temporal on ECS/Fargate because no managed Temporal residency/legal approval exists. Runtime activation requires a signed, scanned, digest-pinned ClinicOS Temporal image with versioned production configuration. It defines separate frontend, history, matching, and worker services plus a one-shot schema task for the `temporal` and `temporal_visibility` PostgreSQL schemas. `temporalio/auto-setup` is not used.

The cache is not workflow truth. Temporal and PostgreSQL remain authoritative; Redis OSS is limited to atomic abuse budgets and short non-authoritative work already required by CP12.

## Honest activation gates

Safe defaults keep these resources inactive:

- `enable_public_ingress=false` while no domain/hosted zone/certificate exists;
- `enable_runtime=false` while signed image digests and populated runtime secrets do not exist;
- empty alarm integration ARNs while no paging destination has been approved;
- Backup Vault Lock disabled until its irreversible compliance window is approved.

Terraform outputs keep `resources_applied`, `applied_tls_verified`, `delivery_verified`, and `restore_verified` false. Terraform source and plans are E0/E1, never E4.

## Remote state

Both roots contain an empty `backend "s3"` block. Use the already-created encrypted S3 backend and DynamoDB lock table through an uncommitted `backend.hcl` copied from `backend.hcl.example`. The examples also enable native S3 lockfiles for migration away from deprecated DynamoDB locking. Do not create a second backend from these roots.

## Deterministic local verification

The examples use non-secret offline provider credentials and make no AWS calls:

```sh
terraform -chdir=infra/terraform/staging init -backend=false
terraform -chdir=infra/terraform/staging validate
terraform -chdir=infra/terraform/staging test -test-directory=tests

terraform -chdir=infra/terraform/pilot-prod init -backend=false
terraform -chdir=infra/terraform/pilot-prod validate
terraform -chdir=infra/terraform/pilot-prod test -test-directory=tests

trivy config --exit-code 1 --severity HIGH,CRITICAL infra/terraform
```

The test files execute deterministic Terraform `plan` runs with mock providers because the committed S3 backend is intentionally not initialized by `init -backend=false`. `terraform fmt -check -recursive infra/terraform` and `git diff --check` remain mandatory. For an authorized AWS plan, set `offline_validation_mode=false`, initialize the real backend, and verify the exact account/regions first. Workers must not apply.

## CP9 compatibility

The old `scripts/check-cp9-terraform-profile.mjs` intentionally rejects providers, backends, and resources. It must be retired or replaced by a master-owned CP14 check that runs the two roots above and asserts private/deletion-protected controls. Leaving that CP9 script in the root repository test chain will fail for the correct reason; this lane cannot edit it.

See [ARCHITECTURE.md](ARCHITECTURE.md), [COST_INVENTORY.md](COST_INVENTORY.md), and [APPLY_PREREQUISITES.md](APPLY_PREREQUISITES.md).
