# Backup And Restore Drill Runbook

Checkpoint 9 establishes restore evidence before any real pilot data is used. The default drill is synthetic and non-mutating. Live cloud restore, Terraform apply, and production backup changes require explicit human approval outside this lane.

## Scope

- Primary region: `ap-south-1`.
- DR / backup region: `ap-south-2`.
- Pilot-prod RPO target: 60 minutes.
- Pilot-prod RTO target: 240 minutes.
- Data source for CP9 evidence: `fixtures/synthetic/**` only.
- Destructive local restore smoke: optional, local/dev only, isolated database only.

## Required Controls

- `PILOT_SYNTHETIC_DATA_ONLY=true`.
- No production PHI in local/dev/staging fixtures, screenshots, or restore evidence.
- Backups must be encrypted and access-limited.
- Restore targets must be isolated from real clinic data.
- Any destructive restore operation requires an explicit opt-in and a target database name containing `restore_drill`.
- Do not print database URLs, provider credentials, AWS credentials, raw storage paths, or patient-identifying secrets.

## Dry-Run Evidence

Run from the repository root:

```sh
npm --workspace @clinic-os/config run build
node scripts/cp9-restore-drill.mjs --dry-run --evidence-out /tmp/clinicos-cp9-restore-drill.json
```

Expected result:

- the script validates `.env.example` through `@clinic-os/config`;
- the synthetic patient, appointment, and pricebook CSV files are present;
- appointment patient references resolve to synthetic patients;
- appointment time windows are valid;
- pricebook amounts are non-negative;
- template and media directories are present;
- no AWS call is made;
- no database connection is opened;
- evidence is written to `/tmp/clinicos-cp9-restore-drill.json`.

The current fixture media directory contains no binary X-ray/photo sample. The dry-run validates the directory contract and records that as a warning rather than pretending a binary restore was tested.

## Optional Local Restore Smoke

This path mutates only an isolated local restore-drill database. It is not required for the CP9 minimum gate when local Postgres or `psql` is unavailable.

Prerequisites:

- local Postgres is running;
- `psql` is installed;
- target database exists and is disposable;
- target database name contains `restore_drill`;
- target host is `localhost`, `127.0.0.1`, or `::1`.

Example:

```sh
createdb clinic_os_restore_drill
npm --workspace @clinic-os/config run build
BACKUP_RESTORE_DRILL_MODE=local_execute \
BACKUP_RESTORE_ALLOW_DESTRUCTIVE=true \
BACKUP_RESTORE_TARGET_DATABASE_URL=postgresql://clinic_os:clinic_os@localhost:5432/clinic_os_restore_drill \
PILOT_SYNTHETIC_DATA_ONLY=true \
node scripts/cp9-restore-drill.mjs --local-execute --env-file .env.example --evidence-out /tmp/clinicos-cp9-local-restore-smoke.json
```

The script drops and recreates only schema `cp9_restore_drill` inside the restore-drill database. It does not touch the main `clinic_os` database.

## Pilot-Prod Restore Drill Preconditions

Before any real pilot-prod restore drill:

- AWS identity is confirmed through approved SSO/OIDC;
- Terraform backend bucket and lock table exist and are encrypted;
- KMS alias is configured for database, object storage, and backup artifacts;
- RDS/Aurora automated backups and PITR are enabled;
- object storage backup or replication posture is enabled toward `ap-south-2`;
- alert destination is configured and tested;
- a clinic owner or approved operator signs off on the drill window;
- the drill target is isolated from production traffic.

## Evidence Checklist

Record:

- command run and timestamp;
- fixture paths and hashes from the script evidence;
- row counts for patients, appointments, and pricebook;
- RPO/RTO targets used;
- whether any destructive operation executed;
- local `psql` or Terraform/tooling blocker if present;
- restore target name if local execute was used, never a full URL with credentials;
- reviewer and follow-up issues.

## Failure Handling

- If dry-run validation fails, do not proceed to local execute.
- If local execute fails, keep the evidence file and SQL path, then inspect local Postgres logs.
- If production backup evidence is missing, raise `backup_failure` through the alerting runbook before any pilot go-live decision.
- If fixture contracts diverge from product import/export contracts, resolve the canonical production contract before claiming restore readiness.
