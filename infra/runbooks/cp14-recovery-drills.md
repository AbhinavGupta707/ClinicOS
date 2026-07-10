# CP14 Recovery Drills

## Evidence boundary and authority

The repository recovery harness produces only deterministic plans/simulations against
`synthetic-fixture` and `isolated-local`. It cannot call AWS, change DNS, restore a live database,
rotate a deployed key, fail over a region, or delete/replace infrastructure. Its results are E1/E2.

Real E4/E5 restore, failover, failback, signing-key rotation, media recovery, and immutable-audit
verification require explicit master authority, an approved window, current backups, named stop and
rollback owners, and synthetic data. No worker runs live AWS/provider actions.

## Plan/simulation harness

Supported scenarios are `postgres_restore`, `region_failover`, `signing_key_rotation`,
`media_restore`, and `audit_export_verification`.

```sh
node scripts/cp14-recovery-drill.mjs \
  --environment=synthetic \
  --synthetic-only \
  --stop-file=/tmp/clinicos-cp14-recovery.stop \
  --rollback-plan=discard_isolated_restore \
  --scenario=postgres_restore \
  --restore-source=synthetic-fixture \
  --target=isolated-local \
  --mode=simulate
```

`--mode=plan` performs no phases. `--mode=simulate` records synthetic phase completion. Any live or
remote target is rejected. Required phases are preflight, isolation, source verification, exercise,
reconciliation, rollback, and review; database restore additionally records RPO/RTO measurement,
media restore revalidates quarantine, and region failover includes a failback plan.

## Real database/PITR restore procedure

1. Confirm exact source environment, backup/PITR timestamp, KMS accessibility, immutable copy,
   synthetic data classification, RPO/RTO objectives, approvers, budget, and stop/rollback owner.
2. Restore into a new isolated network/database identifier. Never restore over the source.
3. Apply no schema mutation until Flyway info/checksums and application revision compatibility are
   verified. Use separate migration/runtime/worker roles.
4. Run schema history, constraints, 100/100 RLS inventory, no-context denial, cross-tenant denial,
   runtime/worker grant, and migration drift checks.
5. Run exact-revision API/worker reconciliation for domain/audit/outbox/Temporal/read models and
   media references. No fixture fallback or hidden skip is allowed.
6. Measure latest source evidence versus restore point (RPO) and time from authorization to verified
   application readiness (RTO). Record timestamps from approved synchronized sources.
7. Discard the isolated restore or retain it under the approved evidence policy. Remove temporary
   credentials/network paths and confirm cleanup without touching the source.

## Cross-region failover/failback procedure

1. Verify Hyderabad resources/replicas/copies actually exist and are healthy; enabled region state
   alone is not DR.
2. Freeze deploys and nonessential writes. Record queue/outbox/Temporal/provider state and last
   confirmed backup/replication point.
3. Obtain the exact-action approval for traffic/DNS/secret/role changes. Test with synthetic traffic
   only and an explicit TTL/rollback plan.
4. Promote/restore isolated recovery dependencies, rotate region-scoped secrets where required,
   start exact signed artifacts, and wait for telemetry/readiness before any traffic.
5. Reconcile database, audit/outbox, workflows, media, provider state, and synthetic clinic journey.
6. Measure RPO/RTO, test alert delivery, and exercise the documented manual downtime path.
7. Fail back only through an approved plan that prevents split brain and accounts for writes made in
   the recovery region. Reconcile again and review all privileged actions.

## Media recovery and quarantine

- Restore/copy object versions only through tenant-scoped internal authority; never expose bucket or
  object keys in evidence.
- Recovered objects return to quarantine unless the durable inspection evidence is still valid for
  the exact version/digest and policy explicitly permits reuse.
- Recheck legal hold, retention, deletion markers, replicas, KMS key access, signed-access expiry,
  tenant denial, and audit provenance.
- A recoverable object is not client-accessible until scanner state is clean and the API authorization
  path issues a new short-lived capability.

## Identity/signing-key and audit recovery

- Keycloak database/realm restore must preserve issuer/client bindings, MFA policy, JML state,
  revocation/session behavior, admin audit, and backup encryption. Test old/new signing-key overlap,
  JWKS refresh, rejected retired keys, session revocation, and rollback.
- Immutable audit export verification checks object lock/retention, signature/hash-chain integrity,
  batch completeness, privileged-access logs, clock provenance, and reconciliation to sampled domain
  and outbox events. Diagnostic logs are not accepted as audit reconstruction.

## Stop conditions

Stop and execute the approved rollback when any of these occurs: wrong account/region/source,
non-synthetic data, missing backup/KMS access, unexpected replacement/deletion, RLS/grant failure,
schema drift, unreconciled clinical/financial/audit/outbox state, split-brain risk, missing telemetry,
unconfigured paging, breached cost/window, or loss of the named stop authority.

CP14 recovery remains open until real environment backups are restored and failover/failback meet
approved RPO/RTO with signed review. A plan or simulation cannot close PRR-015 or PRR-024.
