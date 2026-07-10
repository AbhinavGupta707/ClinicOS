# Resource and cost inventory

This is a billable-resource inventory, not a quote. AWS prices, taxes, free-plan coverage, data transfer, logs, backup growth, and regional availability must be checked in the AWS Pricing Calculator immediately before an authorized apply.

| Cost driver | Staging default | Pilot-prod default | Scaling control |
| --- | ---: | ---: | --- |
| NAT gateways in Mumbai | 1 | 3 (one/AZ) | `nat_gateway_count`; DR is 0 until recovery activation. |
| Interface VPC endpoints | 7 services × 3 AZs | 7 services × 3 AZs | Disable only with reviewed NAT/private-access replacement. Dormant DR disables them. |
| RDS PostgreSQL | Multi-AZ `db.t4g.small`, 50–200 GiB | Multi-AZ `db.t4g.medium`, 100–1000 GiB | Instance class, storage/autoscaling, retention, I/O, performance-insights retention. |
| ElastiCache Redis OSS | 2 × `cache.t4g.small` | 2 × `cache.t4g.small` | Node type/count, snapshots. Required for CP12 atomic budgets. |
| ECS/Fargate | Off until image activation; one task/service baseline | Off until activation; HA tasks for public/critical services | Per-service CPU/memory/min/max/desired count. No Spot for critical defaults. |
| ALB and WAF | Off until DNS/TLS activation | Off until DNS/TLS activation | Hours, LCUs, WAF requests/rules, sampled/logged requests. |
| S3 primary + DR | Media, audit, access logs | Same with longer retention | Object/version volume, Object Lock, IA/Glacier transitions, cross-region replication/transfer. |
| AWS Backup | Daily/monthly plus Hyderabad copy | Longer 7-year monthly copy | Protected storage, retention, cold tier, restore transfer. |
| KMS | 4 keys/region | 4 keys/region | Key-month and API request volume. |
| CloudWatch/X-Ray/SNS | Flow/service/WAF logs, alarms, dashboard | Longer log retention and higher traffic | Ingested/stored bytes, custom metrics, traces, alarm evaluations, notification delivery. |
| ECR | 6 repositories/region | 6 repositories/region | Retained image count and duplicated Hyderabad storage. |

Largest fixed costs before runtime are NAT, per-AZ interface endpoints, Multi-AZ RDS, and the two-node cache. The staging topology preserves production network/data behavior; reduce spend by scheduling a wholly inactive environment or changing an explicit capacity input, never by making DB/cache public, disabling encryption/backups, or sharing state/data paths.

Account-wide CloudTrail, AWS Config, GuardDuty, and Security Hub costs are intentionally excluded because a single shared-account baseline owner must be chosen before apply; duplicating them from both environment states would double-count events and weaken ownership.
