# Resource and cost inventory

This is a billable-resource inventory, not a quote. AWS prices, taxes, free-plan coverage, data transfer, logs, backup growth, and regional availability must be checked in the AWS Pricing Calculator immediately before an authorized apply.

| Cost driver | Staging default | Pilot-prod default | Scaling control |
| --- | ---: | ---: | --- |
| NAT gateways in Mumbai | 0 foundation; 1 data-plane+ | 0 foundation; 3 data-plane+ (one/AZ) | `activation_phase`; DR remains 0 pending separately authorized recovery activation. |
| Interface VPC endpoints | 0 foundation; 7 services × 3 AZs data-plane+ | Same | Phase-gated exact endpoint policies. The S3 gateway endpoint has no hourly endpoint charge. |
| RDS PostgreSQL | 0 foundation; Multi-AZ `db.t4g.small`, 50–200 GiB data-plane+ | 0 foundation; Multi-AZ `db.t4g.medium`, 100–1000 GiB data-plane+ | Phase, instance/storage, retention, I/O, insights, and Enhanced Monitoring logs/metrics. |
| ElastiCache Redis OSS | 0 foundation; 2 × `cache.t4g.small` data-plane+ | Same | Phase, node type/count, snapshots. Required for CP12 atomic budgets. |
| ECS/Fargate | Runtime/edge only; one task/service baseline | Runtime/edge only; HA tasks including 3 Keycloak replicas across 3 AZs | Per-service CPU/memory/min/max/desired count. No Spot for critical defaults. |
| ALB and WAF | Off until DNS/TLS activation | Off until DNS/TLS activation | Hours, LCUs, WAF requests/rules, sampled/logged requests. |
| Internal Keycloak admin ALB/private zone | Runtime/edge only | Runtime/edge only | ALB hours/LCUs, private hosted-zone/query charges; required to keep admin off the public auth listener. |
| CloudTrail S3 object data events | Off by default | Off by default | Per-event charges can be high with media traffic. Enable only exact reviewed media/audit bucket object ARNs in the singleton baseline after environment outputs exist. |
| S3 primary + DR | Media, audit, access logs | Same with longer retention | Object/version volume, Object Lock, IA/Glacier transitions, cross-region replication/transfer. |
| AWS Backup | Daily/monthly plus Hyderabad copy | Longer 7-year monthly copy | Protected storage, retention, cold tier, restore transfer. |
| KMS | 4 keys/region | 4 keys/region | Key-month and API request volume. |
| CloudWatch/X-Ray/SNS | Flow/service/WAF logs, alarms, dashboard | Longer log retention and higher traffic | Ingested/stored bytes, custom metrics, traces, alarm evaluations, notification delivery. |
| ECR | 6 repositories/region | 6 repositories/region | Retained image count and duplicated Hyderabad storage. |

The default `foundation` phase excludes the largest fixed costs: NAT, per-AZ interface endpoints, Multi-AZ RDS, and the two-node cache. `data-plane` activates all four together; invalid partial combinations are unavailable. A live saved plan and current monthly Pricing Calculator quote remain master work and are not inferred here.

The singleton `account-baseline` state owns CloudTrail, two regional Config recorders, GuardDuty detectors, and Security Hub subscriptions. All default off and require named authorization. Costs depend on management/config events, explicitly selected S3 object events, findings, standards checks, and retained CloudWatch/S3 bytes; quote them separately and never duplicate them from environment states.
