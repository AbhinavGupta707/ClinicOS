# Pilot production

This root supersedes the CP9 validation-only profile with deployable resources for an isolated pilot-production state. Its initial use remains synthetic-only. A different `aws_account_id` can be supplied when production receives its own account; the current Free Plan does not require or create AWS Organizations.

The safe defaults are deliberately inactive where external prerequisites do not exist:

- `foundation` has no NAT, endpoints, RDS, cache, backup plan, ECS, or load balancers;
- no public ALB/WAF/DNS/TLS before the explicit `edge` phase;
- no ECS services without signed digest-pinned images, numeric non-root users, populated secrets, and a separate internal Keycloak admin hostname/private-zone/TLS/operator-CIDR path;
- no claim of paging merely because an SNS topic exists;
- no Backup Vault Lock or COMPLIANCE Object Lock without a separately reviewed named irreversible-lock decision.

Safe local verification:

```sh
terraform init -backend=false
terraform validate
terraform test -test-directory=tests
```

For an authorized remote plan, copy `backend.hcl.example` outside version control, fill the migrated dedicated backend identifiers and CMK ARN, initialize with `-backend-config=backend.hcl`, and set `offline_validation_mode=false`. Apply, DNS mutation, recovery actions, and lock activation remain master-only.
