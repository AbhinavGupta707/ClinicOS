# Pilot production

This root supersedes the CP9 validation-only profile with deployable resources for an isolated pilot-production state. Its initial use remains synthetic-only. A different `aws_account_id` can be supplied when production receives its own account; the current Free Plan does not require or create AWS Organizations.

The safe defaults are deliberately inactive where external prerequisites do not exist:

- no public ALB/WAF/DNS/TLS without explicit hostnames and a certificate path;
- no ECS services without signed digest-pinned images and populated secrets;
- no claim of paging merely because an SNS topic exists;
- no Backup Vault Lock without a separately reviewed irreversible-lock decision.

Safe local verification:

```sh
terraform init -backend=false
terraform validate
terraform test -test-directory=tests
```

For an authorized remote plan, copy `backend.hcl.example` outside version control, fill only the existing backend identifiers, initialize with `-backend-config=backend.hcl`, and set `offline_validation_mode=false`. Apply, DNS mutation, recovery actions, and Vault Lock remain master-only.
