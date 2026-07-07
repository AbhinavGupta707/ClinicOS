# Disaster Recovery Runbook

ClinicOS pilot-prod targets AWS India with `ap-south-1` Mumbai as primary and `ap-south-2` Hyderabad as DR / warm-standby region. CP9 records the posture and dry-run evidence only. This runbook does not authorize Terraform apply, production failover, or live cloud mutation.

## Current CP9 Posture

- Terraform hardening profile: `infra/terraform/pilot-prod`.
- Profile type: validation and plan review only, no resource blocks.
- Restore evidence: synthetic dry-run through `scripts/cp9-restore-drill.mjs`.
- Live cloud actions: deferred until explicit approval.
- ABDM/live provider activation: deferred unless separately approved and configured.

## Targets

| Target                  | Pilot-prod value                        |
| ----------------------- | --------------------------------------- |
| Primary region          | `ap-south-1`                            |
| DR region               | `ap-south-2`                            |
| RPO                     | 60 minutes                              |
| RTO                     | 240 minutes                             |
| Backup encryption       | KMS-backed encryption required          |
| Database exposure       | Private only                            |
| Object storage exposure | Block public access, signed access only |
| Provider credentials    | Managed secrets only                    |

## Validation Commands

Run from the repository root:

```sh
cd infra/terraform/pilot-prod
terraform fmt -check
terraform init -backend=false
terraform validate
```

Optional plan review with placeholders:

```sh
terraform plan -refresh=false -var-file=terraform.tfvars.example
```

The example plan must not be treated as cloud readiness. Real backend, account, and KMS values must come from ignored secrets or CI/OIDC runtime.

## DR Readiness Checklist

Before pilot-prod can be called DR-ready:

- AWS identity uses SSO or CI/OIDC role assumption, not committed long-lived keys.
- Terraform state bucket is encrypted, versioned, and access-limited.
- Terraform lock table exists and is access-limited.
- KMS alias exists for application data, object storage, and backups.
- Primary database is private, encrypted, Multi-AZ, and has PITR enabled.
- Automated database backups meet the RPO window.
- Object storage has encryption, public access block, lifecycle, and cross-region backup/replication posture.
- Secrets Manager or equivalent is used for provider credentials.
- Alerting destination is configured and tested.
- Backup failure and provider outage alerts route to the pilot operator.
- Synthetic restore drill has passed and evidence is retained.
- At least one isolated restore target has been tested before real pilot data.

## Incident Levels

| Level              | Meaning                                                          | Action                                                                                                          |
| ------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Degraded primary   | Primary service is slow or partially impaired.                   | Keep traffic in `ap-south-1`, reduce load, inspect alerts, and avoid failover unless data safety is at risk.    |
| DR standby review  | Primary recovery may exceed RTO.                                 | Freeze risky deploys, verify latest backups, prepare restore target in `ap-south-2`, and notify pilot operator. |
| Failover candidate | Primary region is unavailable or data safety requires isolation. | Human incident lead approves failover plan. Execute only approved runbook steps with timestamped evidence.      |

## Failover Principles

- Preserve audit logs and backup evidence before destructive action.
- Prefer restore from verified backup over ad hoc database copying.
- Do not point production traffic at an unverified restore target.
- Do not reuse local/dev synthetic credentials in pilot-prod.
- Do not mark queued provider events complete during DR. Resume or replay only after idempotency and provider state are reviewed.
- Keep ClinicOS as source of truth for records already owned by ClinicOS; imported/external data remains source-attributed.

## Recovery Evidence

Record:

- incident level and decision maker;
- start/end timestamps;
- primary and DR regions involved;
- backup snapshot or export identifier, redacted if needed;
- restore target identifier, without credentials;
- RPO/RTO achieved;
- application smoke results;
- provider-health and dead-letter state after recovery;
- unresolved risks and patient/clinic communication notes.

## Known CP9 Gaps

- No live Terraform apply has been run from this lane.
- No live AWS resources were created or modified.
- No real pilot PHI restore has been attempted.
- Cross-region replication is a required posture in the Terraform profile, not yet live evidence.
