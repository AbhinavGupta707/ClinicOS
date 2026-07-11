# ClinicOS AWS Terraform

This tree replaces the CP9 validation-only posture with a version-pinned, deployable AWS platform for synthetic staging and pilot-production use. It defines infrastructure; it does not claim that AWS resources, DNS, alert delivery, restore, or E4/E5 evidence exist.

## Environment isolation

- `bootstrap/` owns the one-time dedicated KMS backend. `account-baseline/` owns singleton account controls. `staging/` and `pilot-prod/` have separate state keys, VPC CIDRs, buckets, KMS aliases, IAM roles, registries, databases, caches, backups, and tags.
- Each root accepts its own AWS account ID. They can share the current account without AWS Organizations, then move to separate accounts by changing root inputs and backends.
- Mumbai (`ap-south-1`) is primary. Hyderabad (`ap-south-2`) contains a dormant VPC, KMS keys, protected S3 replicas, ECR repositories, and a backup vault. It does not run paid warm compute or NAT by default.

## Modules

| Module                                  | Responsibility                                                                                                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kms`                                   | Rotating customer-managed data/log/secrets/backup keys and aliases, protected from Terraform destroy.                                                                              |
| `network`, `vpc-endpoints`              | Three subnet tiers across three AZs, phase-controlled NAT, exact S3/interface endpoint policies, workload-SG-only endpoint ingress, isolated data routes, and encrypted flow logs. |
| `storage`, `s3-replication`             | Private versioned media/audit buckets, Object Lock, lifecycle, ALB logs, and KMS cross-region replication.                                                                         |
| `database`, `cache`                     | Private encrypted Multi-AZ RDS PostgreSQL and a justified Redis OSS 7.1 cache for CP12 abuse budgets/short non-authoritative jobs.                                                 |
| `ecr`, `compute`                        | Immutable encrypted ECR and ECS/Fargate task/service definitions that accept only image digests.                                                                                   |
| `edge`                                  | Optional domain-gated ACM/DNS, ALB, WAF managed rules/rate limiting, TLS-only routing, and redacted WAF logs.                                                                      |
| `secrets`                               | Recovery-protected Secrets Manager containers; no provider/application secret values are committed.                                                                                |
| `backup`, `observability`               | Cross-region AWS Backup plans/vaults, opt-in Vault Lock, CloudWatch alarms/dashboard, SNS topic, failure events, and X-Ray sampling.                                               |
| `ci-oidc`                               | Exact GitHub subject trust, separate read/plan, immutable artifact-publish, and environment deploy roles.                                                                          |
| `state-backend`                         | Dedicated rotating CMK, private/versioned state bucket, encrypted PITR lock table, and exact state-key access policy.                                                              |
| `account-baseline`, `regional-security` | Singleton multi-region CloudTrail plus regional Config, GuardDuty, Security Hub, and the mandatory CI permissions boundary.                                                        |

## Runtime and Temporal decision

The current decision is self-hosted Temporal on ECS/Fargate because no managed Temporal residency/legal approval exists. The ClinicOS image builds exact Temporal 1.31.2 source into pinned server/schema binaries, validates versioned production configuration, derives a routable task address from official ECS metadata, and requires PostgreSQL hostname verification, mTLS and exact JWT authorization. It defines separate frontend, internal-frontend, history, matching, and worker services plus a one-shot schema task for the `temporal` and `temporal_visibility` PostgreSQL schemas. `temporalio/auto-setup` is not used.

Both Keycloak and Temporal images pin the official AWS RDS commercial-region CA bundle by digest.
The long-lived Keycloak task receives no bootstrap credentials; the one-shot realm/bootstrap task is
separate. Local image smokes and scans are E3 evidence only: CI must rebuild/sign the exact commit and
live RDS/ECS/ACM/secrets tests remain mandatory.

The cache is not workflow truth. Temporal and PostgreSQL remain authoritative; Redis OSS is limited to atomic abuse budgets and short non-authoritative work already required by CP12.

## Honest activation gates

`activation_phase` is a closed ordered contract:

- `foundation` (default): VPC/subnets/flow logs, KMS, protected storage/replication, ECR, and CI definitions; no NAT, interface endpoints, RDS, cache, backup plan, ECS services, or edge;
- `data-plane`: explicitly adds NAT, seven interface endpoints plus S3 gateway, Multi-AZ RDS, two-node cache, Secrets Manager, backup, and alarms;
- `runtime`: adds ECS/Fargate and the internal Keycloak admin ALB/record after digest-pinned ARM64 images, image-owned numeric non-root UIDs, distinct auth/admin hostnames, an admin certificate, a pre-existing private-zone ID, and private/VPN/JIT operator CIDRs are supplied;
- `edge`: adds ALB/WAF only after the domain/TLS contract is complete.

Other safe defaults keep these controls inactive:

- empty alarm integration ARNs while no paging destination has been approved;
- Backup Vault Lock disabled until its irreversible compliance window is approved;
- pilot audit Object Lock remains `GOVERNANCE` unless both the COMPLIANCE opt-in and a named authority are supplied;
- all account-baseline services remain opt-in with named authorization because they can incur cost.

CloudTrail management events and S3 object data events are separate baseline switches. Object data events default to an empty selector and cannot be enabled without exact media/audit `bucket-arn/*` values. Environment roots only output candidate ARNs; the master manually reviews and supplies them to the singleton state, avoiding direct remote-state coupling and silent high-volume audit charges.

Terraform outputs keep `resources_applied`, `applied_tls_verified`, `delivery_verified`, and `restore_verified` false. Terraform source and plans are E0/E1, never E4.

## Remote state

The existing SSE-S3 backend is not sufficient for state that includes generated cache credentials. `bootstrap/` defines a dedicated customer-KMS state bucket and KMS-encrypted/PITR DynamoDB table, but defaults to no resources and initially uses local state because a backend cannot create itself. Every remote `backend.hcl.example` requires `kms_key_id`. Inventory, backup, apply, and `terraform init -migrate-state` remain separate master-authorized state mutations; environment roots never manage their own backend.

GitHub repository identity is frozen to public `AbhinavGupta707/ClinicOS`. The `staging` and `pilot-prod` environment subjects are target contracts only: the repository currently has no deployment environments, so those subjects are not currently assumable. The master must create and protect both exact GitHub environments before OIDC activation.

Keycloak public auth routing remains `edge`-only. Runtime itself fails closed until it can create a separate internal ALB and record in a DNS-owner-supplied private Route53 zone for `KC_HOSTNAME_ADMIN`; the environment role cannot create/delete arbitrary hosted zones and the admin listener is never attached to the public auth ALB. Ports 7800 and 57800 are workload-SG self-ingress only for the chosen JDBC-ping/Infinispan image contract.

## Deterministic local verification

The examples use non-secret offline provider credentials and make no AWS calls:

```sh
infra/terraform/scripts/verify.sh
```

The verifier initializes without backends, validates and mock-plans all four roots, runs source-level policy assertions, and runs Trivy. For an authorized AWS plan, set `offline_validation_mode=false`, initialize the real KMS backend, and verify the exact account/regions first. Workers must not apply.

## CP9 compatibility

The old `scripts/check-cp9-terraform-profile.mjs` intentionally rejects providers, backends, and resources. It must be retired or replaced by a master-owned CP14 check that invokes `infra/terraform/scripts/verify.sh`. Leaving the CP9 script in the root test chain will fail for the correct reason; this lane cannot edit it.

See [ARCHITECTURE.md](ARCHITECTURE.md), [COST_INVENTORY.md](COST_INVENTORY.md), and [APPLY_PREREQUISITES.md](APPLY_PREREQUISITES.md).
