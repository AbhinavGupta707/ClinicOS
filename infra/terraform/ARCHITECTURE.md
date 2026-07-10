# AWS platform architecture

```text
Internet (only after DNS/TLS activation)
  -> WAF managed rules + IP rate limit
  -> deletion-protected public ALB (TLS 1.2/1.3)
  -> private ECS/Fargate: web, API, worker, Keycloak, Temporal services
       -> private Multi-AZ RDS PostgreSQL (application + Keycloak + Temporal schemas/users)
       -> private encrypted Redis OSS (abuse budgets and short jobs only)
       -> private S3/KMS media quarantine and immutable audit export
       -> CloudWatch/X-Ray/SNS, with diagnostic-no-PHI tags and redaction contracts

Mumbai protected data
  -> encrypted AWS Backup copies to Hyderabad vault
  -> versioned KMS S3 replication to Hyderabad Object Lock buckets
  -> signed images published to environment ECR repositories in both regions
  -> dormant Hyderabad VPC/subnets for authorized restore/failover activation
```

## Account and state ownership

`bootstrap/` is the sole owner of the dedicated KMS-encrypted backend and begins with local state because a backend cannot create itself. `account-baseline/` has its own remote state key and is the sole owner of the standalone-account multi-region CloudTrail, regional Config/GuardDuty/Security Hub controls, and mandatory CI permissions boundary. Staging and pilot-prod never instantiate account singletons and do not require AWS Organizations.

The prior SSE-S3 state is a migration source only. Exact state-key IAM, a rotating CMK, versioning, public-access block, TLS/KMS bucket denies, KMS-encrypted/PITR DynamoDB locking, and master-authorized state migration protect generated cache credentials resident in state.

## Network boundaries

Public subnets contain only ALB and phase-gated NAT gateways. ECS uses private application subnets without public IPs. RDS and ElastiCache use isolated data subnets with no default internet route. A restricted S3 gateway endpoint and seven interface endpoints (ECR API/DKR, KMS, Logs, Secrets Manager, CloudWatch Metrics, X-Ray) are created only from `data-plane` onward. Every endpoint has an enumerated policy; interface TLS ingress references only the workload security group, not a VPC CIDR. VPC flow logs are KMS-encrypted.

Private tasks retain a narrowly scoped outbound TCP/443 rule because official provider APIs use changing public IP ranges. They have no public addresses, cross controlled NAT, and are covered by flow logs; application adapters must enforce exact HTTPS host allowlists. Replacing this exception with a managed FQDN egress proxy or AWS Network Firewall is a separately costed hardening decision, not a reason to enable unrestricted ports or direct public tasks.

## Data protection

All primary data services use customer-managed keys with rotation and a 30-day scheduled-deletion window; Terraform lifecycle prevents their destruction. RDS uses AWS-managed master-password storage, PITR, final snapshots, Multi-AZ, performance insights, 60-second Enhanced Monitoring through an RDSOSMetrics-only role, SSL enforcement, and deletion protection. Media and audit buckets block public access, require KMS headers, version every object, and use Object Lock. Pilot audit export defaults to reversible governance retention; irreversible COMPLIANCE requires both an explicit opt-in and a named authority.

The generated cache credential necessarily exists in encrypted Terraform state as well as Secrets Manager because ElastiCache requires the token in its resource configuration. Rotation is a controlled two-token rollout, not an automatic destructive replacement.

## Artifact and service activation

ECR tags are immutable and scan on push, but ECS definitions reject tag-only images and require `@sha256:` digests. Runtime services are not created until every image and its image-owned numeric non-root UID are supplied. Every Fargate container is explicitly unprivileged, uses a read-only root filesystem, drops all Linux capabilities, and runs with ECS Exec disabled. Fargate does not expose Docker's `no-new-privileges` flag; this supported control set is the enforced equivalent and is tested. Secrets Manager containers are created without application/provider values; an authorized deployment workflow must populate and validate them before the `runtime` phase.

The Temporal schema task is defined but never runs from Terraform. The deployment pipeline must execute it once with the migrator credential, verify both schema histories, then start the four Temporal service roles. Application, Keycloak, and Temporal runtime identities use separate database users.

Keycloak uses JDBC-ping/Infinispan database-backed cluster discovery for ECS task replacement/HA, with ports 7800 and 57800 allowed only as workload-security-group self ingress. Pilot-prod enforces at least three replicas across the declared three-AZ network; staging retains a smaller synthetic capacity. `KC_HOSTNAME` and `KC_HOSTNAME_ADMIN` must be distinct and strict; runtime creates a deletion-protected internal ALB and a record in a pre-existing private Route53 zone, restricted to reviewed private/VPN/JIT operator CIDRs. The public auth listener is created only in `edge` and never routes the admin hostname. Bootstrap administration is isolated in a one-shot signed-image task; the long-lived Keycloak service receives only its database credential and never receives the bootstrap-admin secret. Realm promotion, MFA/session policy, and removal/rotation of bootstrap material remain deployment gates owned by the identity integration lane.

## CI control plane

GitHub roles do not attach `ReadOnlyAccess`. Plan/apply discovery enumerates required control-plane actions, scopes bucket configuration and IAM metadata to ClinicOS resources, and excludes S3 object bodies and Secrets Manager values. State object access is a separate exact-key statement. AWS requires `Resource="*"` for some metadata APIs (for example EC2 describes/KMS alias listing); these permissions expose control-plane metadata but not object bodies, log events, database rows, or secret values. Full metadata isolation requires the future per-environment account split because AWS IAM cannot resource-scope those APIs. Mutations use ClinicOS ARN/name patterns, strict environment request/resource-tag denies, and exact hosted-zone/state/bucket resources. Unscopable create APIs are limited to an enumerated set with required request tags and the mandatory account-baseline permissions boundary. The public repository and environment subjects are target contracts only until the master creates/protects the currently absent GitHub deployment environments.

## Recovery posture

DR is restore-based, not an unproved warm standby. This avoids continuous idle compute/NAT cost while preserving network address space, keys, replicas, registries, and backup vaults. E4/E5 requires an authorized restore into Hyderabad, integrity/application reconciliation, timed RPO/RTO, traffic-switch/failback evidence, and alert delivery; none is inferred from these definitions.
