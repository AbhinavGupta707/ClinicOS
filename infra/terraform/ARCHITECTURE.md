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

## Network boundaries

Public subnets contain only ALB and NAT gateways. ECS uses private application subnets without public IPs. RDS and ElastiCache use isolated data subnets with no default internet route. Interface endpoints keep ECR, logs, KMS, Secrets Manager, and SSM traffic on AWS networks. Security groups reference the workload group rather than public CIDRs for database/cache access. VPC flow logs are KMS-encrypted.

Private tasks retain a narrowly scoped outbound TCP/443 rule because official provider APIs use changing public IP ranges. They have no public addresses, cross controlled NAT, and are covered by flow logs; application adapters must enforce exact HTTPS host allowlists. Replacing this exception with a managed FQDN egress proxy or AWS Network Firewall is a separately costed hardening decision, not a reason to enable unrestricted ports or direct public tasks.

## Data protection

All primary data services use customer-managed keys with rotation and a 30-day scheduled-deletion window; Terraform lifecycle prevents their destruction. RDS uses AWS-managed master-password rotation storage, PITR, final snapshots, Multi-AZ, performance insights, SSL enforcement, and deletion protection. Media and audit buckets block public access, require KMS headers, version every object, and use Object Lock. Pilot audit export uses compliance retention; staging uses governance retention.

The generated cache credential necessarily exists in encrypted Terraform state as well as Secrets Manager because ElastiCache requires the token in its resource configuration. Rotation is a controlled two-token rollout, not an automatic destructive replacement.

## Artifact and service activation

ECR tags are immutable and scan on push, but ECS definitions reject tag-only images and require `@sha256:` digests. Runtime services are not created until every image is supplied. Secrets Manager containers are created without application/provider values; an authorized deployment workflow must populate and validate them before setting `enable_runtime=true`.

The Temporal schema task is defined but never runs from Terraform. The deployment pipeline must execute it once with the migrator credential, verify both schema histories, then start the four Temporal service roles. Application, Keycloak, and Temporal runtime identities use separate database users.

Keycloak uses database-backed cluster discovery for ECS task replacement/HA. Bootstrap administration is isolated in a one-shot signed-image task; the long-lived Keycloak service receives only its database credential and never receives the bootstrap-admin secret. Realm promotion, MFA/session policy, and removal/rotation of bootstrap material remain deployment gates owned by the identity integration lane.

## Recovery posture

DR is restore-based, not an unproved warm standby. This avoids continuous idle compute/NAT cost while preserving network address space, keys, replicas, registries, and backup vaults. E4/E5 requires an authorized restore into Hyderabad, integrity/application reconciliation, timed RPO/RTO, traffic-switch/failback evidence, and alert delivery; none is inferred from these definitions.
