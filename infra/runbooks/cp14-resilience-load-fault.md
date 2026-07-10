# CP14 Resilience, Load, and Fault Exercises

## Safety boundary

Repository harnesses are synthetic/local by construction. They require all of:

- `--environment=local` or `--environment=synthetic`;
- `--synthetic-only` explicit authorization;
- an absolute stop file under the operating-system temporary directory;
- a named rollback plan;
- bounded duration/concurrency/request counts.

They reject staging, pilot-production, production, remote URLs, live fault execution, AWS/provider
mutation, request bodies, and destructive actions. These passes are E1/E2. The master separately
coordinates E4/E5 deployed exercises only with the required authority and stop owner.

Writing exactly `STOP` to the configured stop file stops between bounded batches/phases. The
operator must create the stop file before the exercise window if they intend an immediate stop.

## Deterministic observability policy check

Prepare a normalized synthetic JSON artifact containing only `schemaVersion: 1`,
`dataClassification: synthetic-only`, and non-empty `metrics`, `spans`, and `logs` arrays. The
verifier enforces the checked-in metric catalog and finite attributes, bounded span names and
attributes, and finite log event/field vocabularies. Unknown containers, fields, names, or values
fail rather than being treated as redaction evidence. Then run:

```sh
node scripts/cp14-observability-verify.mjs \
  --environment=local \
  --synthetic-only \
  --stop-file=/tmp/clinicos-cp14-observability.stop \
  --rollback-plan=restart_local_target \
  --input=/tmp/clinicos-cp14-synthetic-telemetry.json \
  --maximum-series-per-metric=200
```

The verifier reports only bounded violation codes, never field values. It fails on PHI/secret field
names or excess per-metric series count.

## Local load harness

Dry-run is the default. Only loopback `GET /health/live` and `GET /health/ready` are accepted.

```sh
node scripts/cp14-load-harness.mjs \
  --environment=local \
  --synthetic-only \
  --stop-file=/tmp/clinicos-cp14-load.stop \
  --rollback-plan=stop_load_and_drain \
  --target=http://127.0.0.1:4100/health/ready \
  --requests=100 \
  --concurrency=5 \
  --maximum-duration-ms=60000 \
  --dry-run
```

Add `--execute` only for a locally owned synthetic process after confirming the stop file and
rollback control. The harness does not send mutations or PHI. For real E4/E5 load, the master must
use an approved load environment/data generator, capacity/cost guardrails, noisy-tenant isolation,
autoscaling observation, and named stop authority.

## Fault simulations

Supported deterministic scenarios are:

- `database_latency`;
- `cache_connection_failure`;
- `temporal_unavailable`;
- `provider_timeout`;
- `media_scanner_failure`;
- `exporter_failure`.

Example:

```sh
node scripts/cp14-fault-harness.mjs \
  --environment=synthetic \
  --synthetic-only \
  --stop-file=/tmp/clinicos-cp14-fault.stop \
  --rollback-plan=remove_fault_injection \
  --scenario=exporter_failure \
  --duration-ms=30000
```

`--execute` is intentionally rejected. The simulation asserts bounded timeouts, safe error codes,
alert evaluation, recovery signals, and scenario-specific behavior such as fail-closed production
telemetry startup or keeping media quarantined.

## Deployed exercise pass criteria

For each E4/E5 exercise, capture revision, environment/account/region, synthetic classification,
exact command/procedure, start/stop owner, skips, before/after dashboards, alarms, rollback, and
reconciliation. Required behavior includes:

- liveness remains accurate; readiness removes unhealthy required dependencies;
- bounded retries/circuit breaking prevent retry storms;
- outbox/Temporal work is idempotent and recovers without duplicate effects;
- backpressure progresses through constrained/shedding/not-ready states as designed;
- optional providers degrade honestly and required providers remove the applicable capability;
- telemetry exporter loss cannot produce a production-like false-ready startup;
- alerts reach the configured human escalation target without PHI;
- recovery returns metrics/queues/domain/audit/outbox to zero unexplained drift.

Do not call a simulation, dry-run, console record, or unacknowledged SNS publication a deployed
resilience or paging pass.
