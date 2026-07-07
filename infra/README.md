# Infrastructure

Terraform, Docker, environment templates, and operational runbooks live here.

Checkpoint 1 adds local infrastructure for Postgres, Redis, Temporal, and Keycloak. Checkpoint 9 adds plan-only pilot-prod hardening artifacts, synthetic restore drills, provider-health alert runbooks, and DR notes for AWS India.

Start local dependencies from the repository root:

```sh
npm run local:up
```

See `infra/runbooks/local-development.md` for ports, credentials, and reset guidance.

CP9 operations references:

- `infra/terraform/pilot-prod` - validation-only Terraform hardening profile. No resources are declared or applied.
- `infra/runbooks/backup-restore-drill.md` - synthetic restore dry-run and guarded local restore smoke.
- `infra/runbooks/provider-health-alerting.md` - provider-health alerting and triage.
- `infra/runbooks/disaster-recovery.md` - Mumbai primary and Hyderabad DR posture.
