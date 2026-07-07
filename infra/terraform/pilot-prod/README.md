# Pilot-Prod Terraform Posture Profile

This directory is a CP9 validation artifact for the pilot-prod infrastructure posture. It intentionally declares no Terraform providers and no live resources, so it is safe for `terraform fmt`, `terraform init -backend=false`, `terraform validate`, and plan-only review. Do not use this lane to apply infrastructure.

Scope:

- primary AWS region: `ap-south-1` Mumbai;
- DR / warm-standby region: `ap-south-2` Hyderabad;
- encrypted private database posture with PITR and backup retention;
- encrypted private object storage posture with cross-region backup readiness;
- managed secrets, WAF, centralized logs, provider-health alerts, and backup failure alerts;
- RPO/RTO defaults of 60 / 240 minutes for pilot-prod review.

Safe validation:

```sh
cd infra/terraform/pilot-prod
terraform fmt -check
terraform init -backend=false
terraform validate
terraform plan -refresh=false -var-file=terraform.tfvars.example
```

The example variable file uses non-secret placeholder names. Real backend bucket, lock table, account id, and KMS alias values must come from `.secrets/orchestration.env` or CI/OIDC runtime and must not be committed.

This profile is not a substitute for the future AWS resource modules. It is the hardening contract those modules must satisfy before a production apply is approved.
