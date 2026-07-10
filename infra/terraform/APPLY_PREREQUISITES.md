# Exact apply prerequisites

No worker apply is authorized. The master may request the smallest approval only after all of the following are true:

1. Verify Terraform `1.15.8`, AWS provider `6.53.0`, random provider `3.7.2`, both lock files, and zero blocking IaC findings.
2. Verify `aws sts get-caller-identity --profile clinicos-human` is the approved account. Set `offline_validation_mode=false`; never use the legacy profile.
3. Copy `backend.hcl.example` to an ignored file, insert the existing backend bucket/lock table only, initialize, and confirm the environment state key is new or intentionally migrated from documented state.
4. Confirm Mumbai/Hyderabad AZ names and pinned RDS/ElastiCache engine/node availability with read-only AWS APIs. A plan cannot prove regional capacity.
5. Review a saved `terraform plan` with account/region, resource count, monthly-cost estimate, public-access/IAM/KMS policy checks, replacements, and deletion/retention consequences.
6. Decide GitHub OIDC ownership: create the singleton provider once in a shared account, or create one per separated account. Verify the official thumbprint/activation flow and exact GitHub environment subject claims.
7. Assign one account-baseline state/owner for account-wide CloudTrail, AWS Config, GuardDuty, and Security Hub decisions. Do not let both environment roots create duplicate trails/recorders/detectors in the current shared account. Review Free Plan and ongoing service/log charges; repeat the baseline per account after separation.
8. Populate none of the runtime/provider secrets through Terraform source or tfvars. Use an authorized secret workflow, separate DB roles, and verify rotations/access policies.
9. Build ARM64, scan, sign, and push all six images to both regional ECR sets. Supply immutable digest URIs. Run the Temporal schema task, the one-shot Keycloak bootstrap/realm-promotion task, and application/Flyway migrations before enabling services. The long-lived Keycloak task must never retain bootstrap-admin credentials.
10. Keep ingress disabled until a clinic-owned domain/hosted zone and three hostnames exist. Choose either an existing ACM ARN or Terraform DNS validation, review WAF/logging, then verify deployed TLS/headers/health. Do not enable HSTS before canonical HTTPS is stable.
11. Provide and confirm a real paging destination before treating alarms as operational. Inject an alarm and verify delivery/escalation without PHI.
12. Decide whether to enable Backup Vault Lock and S3 compliance retention. Record the irreversible retention/cost impact and named authority.
13. Apply staging first with synthetic data, run E4 migration/readiness/network/media/identity/load/fault/alert/restore tests, then separately authorize pilot-prod. Never combine environments in one apply.
14. Run the first real restore/failover only in an approved window with stop authority, reconciliation procedure, and failback plan. Terraform resources alone do not meet RPO/RTO.

After apply, export the Terraform resource inventory, compare it with AWS Config/read-only inventory, run `terraform plan -refresh-only -detailed-exitcode` on a schedule, alert on exit code 2, and prohibit console changes except documented break-glass actions that are imported/reconciled immediately.
