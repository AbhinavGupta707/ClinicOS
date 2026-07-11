# CP14 Observability Operations

## Purpose and evidence boundary

This runbook wires the CP14 OpenTelemetry contracts into a production-equivalent ClinicOS runtime.
The code and deterministic tests are E1/E2. E4/E5 requires an applied staging/pilot-production
collector, successful trace and metric export, deployed dashboards, real alert delivery, and a
reviewed retention/access policy. No local pass is paging or deployed-backend evidence.

Diagnostic telemetry is not the product audit log. Audit/outbox/clinical evidence remains durable,
authorized, and separately retained.

## Required runtime configuration

Use the standard OTLP/HTTP variables below. Inject values through the master-owned environment
schema and Secrets Manager/ECS task definition; never commit exporter headers.

| Variable                              | Requirement                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | Exact `/v1/traces` endpoint, or derive it from `OTEL_EXPORTER_OTLP_ENDPOINT`.              |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Exact `/v1/metrics` endpoint, or derive it from `OTEL_EXPORTER_OTLP_ENDPOINT`.             |
| `OTEL_EXPORTER_OTLP_HEADERS`          | Optional encoded exporter authorization headers; never log or expose them.                 |
| `OTEL_TRACES_SAMPLER_ARG`             | Root trace sample ratio from `0.001` to `1`; default `0.05`. Parent sampling is respected. |
| `OTEL_METRIC_EXPORT_INTERVAL`         | `5000`-`300000` milliseconds; default `30000`.                                             |
| `OTEL_METRIC_EXPORT_TIMEOUT`          | `1000`-`30000` milliseconds; default `10000`.                                              |
| `CLINIC_OS_OTEL_CARDINALITY_LIMIT`    | Per-instrument series limit `25`-`500`; default `200`.                                     |
| `CLINIC_OS_OTEL_STARTUP_TIMEOUT_MS`   | Startup probe/flush timeout `1000`-`30000`; default `10000`.                               |

`staging`, `pilot-prod`, and `prod` fail startup if telemetry is disabled, either endpoint is absent,
or either startup export fails. Plain HTTP is accepted in those environments only to a loopback ADOT
sidecar; remote collectors require HTTPS.

Required resource attributes are `service.name`, `service.version`, `service.instance.id`,
`service.namespace=clinic_os`, `deployment.environment.name`, `cloud.provider=aws`, and
`cloud.region`. Do not add tenant, clinic, patient, provider-account, bucket, or object identifiers.

## Collector/backend prerequisites

The master must supply and verify an ADOT collector sidecar or private collector endpoint that:

1. accepts OTLP/HTTP traces and metrics from only the API/worker task security group or loopback;
2. authenticates downstream with task-role credentials rather than static application keys;
3. exports traces to the approved X-Ray/trace backend and metrics to the approved CloudWatch/AMP
   backend with the `clinic_os.*` namespace preserved;
4. has bounded memory, batch, retry, and sending-queue processors; collector pressure must not create
   unbounded application memory;
5. sends its own health/export failures to CloudWatch without request bodies or exporter headers;
6. uses KMS-encrypted log groups with approved retention and least-privilege viewer roles;
7. disables attribute processors that could copy HTTP headers, URLs, SQL, or resource identifiers.

Terraform currently creates an encrypted alarm topic and CloudWatch dashboard foundations. The
master must map CP14 custom metrics/alarms into the Terraform module and verify the applied outputs.
An SNS topic without a confirmed external recipient is `paging_target_unavailable`, not paging.

## Exact master wiring

### Process bootstrap and shutdown

1. Import observability bootstrap before importing `http`, `pg`, Redis, Undici, API bootstrap, or
   worker composition so official instrumentations can patch supported modules.
2. Build `ObservabilityConfiguration` with the exact service version/revision, ECS task instance ID,
   environment, and region. Do not derive resource identity from a request.
3. Await `runtime.start()` before exposing readiness. Readiness requires runtime state `ready` in a
   production-like environment; `disabled` is allowed only for local/test.
4. Replace `createConsoleMetricRecorder()` in `apps/worker/src/main.ts` with `runtime.metrics`.
5. On SIGINT/SIGTERM, stop admitting work, drain bounded in-flight work, then call
   `runtime.shutdown()`. Report only its bounded error codes and still close DB/Temporal/HTTP
   resources if flush fails.

### API HTTP boundary

- Wrap each parsed/authorized CP12 route through `InstrumentationHooks.run` after route matching.
- Pass only a bounded `routeFamily` (`health`, `identity`, `clinic_day`, `media`, `operations`,
  `provider_callback`, or `other`), operation, outcome, and HTTP status band.
- Never pass raw route paths, URLs, query strings, headers, bodies, IDs, or error messages.
- Extract and propagate only `traceparent`; reject baggage and drop unapproved `tracestate` values.
  A finite vendor `tracestate` policy may be added by master integration only after privacy review.
  Return a W3C `traceparent` response header only if the API boundary policy approves it;
  correlation IDs remain separate bounded identifiers.

### Postgres and Redis

- Enable the package's official `PgInstrumentation` and `RedisInstrumentation` before clients load.
- Postgres spans overwrite `db.statement` and `db.query.text` with `[REDACTED]`; enhanced database
  reporting, SQL commenter propagation, and SQL values remain disabled.
- Redis serialization records only a bounded command verb and never key/value arguments.
- Use manual hooks around transaction/unit-of-work and abuse-budget operations to classify only
  `database`/`cache`, bounded operation, status, and duration.

### Durable outbox and worker

- Add a master-owned nullable `traceparent` (55 characters) diagnostic field to the durable outbox
  envelope or an equally atomic out-of-band trace-context table. Do not put trace context in
  clinical payload JSON. Validate with `sanitizeTraceCarrier`; unapproved `tracestate` and baggage
  are discarded.
- Inject trace context inside the same transaction that writes the domain/audit/outbox event.
- Implement `OutboxTraceContextStore` with `durability: durable` and load by the internal event ID.
- Wrap handlers with `createCp14WorkerObservability(...).wrapOutboxHandler`; it classifies raw event
  names into a finite workflow family and never emits event payloads or tenant/clinic IDs.
- Feed backlog depth, oldest age, dead-letter count, and dependency health to
  `observeBackpressure`. `not_ready` removes worker readiness; `shed_noncritical` admits only the
  explicitly classified critical work chosen by master composition.

### Temporal

- Put W3C context in Temporal headers, not workflow/activity payloads or search attributes.
- Extract before starting workflow/activity spans. Preserve replay determinism: telemetry calls must
  not influence workflow decisions, clocks, IDs, retries, or command order.
- Wrap activities and worker execution through the bounded `temporal`/`worker` hook. Do not record
  workflow IDs, run IDs, patient identifiers, arguments, results, or exception messages.

### Identity/session/security

- Wrap login verification, refresh rotation/replay, revocation lookup, MFA denial, JML completion,
  break-glass, CSRF, and origin rejection through the `identity` hook.
- Emit only operation, bounded outcome/reason code, duration, and trace/correlation IDs. Subject,
  token ID, session ID, issuer URL, role list, tenant ID, cookie, claims, and token bytes stay out.
- Required security audit intents still persist transactionally. Telemetry failure must not silently
  drop required audit; startup/readiness fail when required export is unavailable.

### Media and providers

- Wrap reserve, upload completion, scan, signed access, delete, restore, purge, and legal-hold
  operations through the `media` hook. Emit only operation and finite scanner/state outcome.
- Never pass signed URLs, required headers, object/bucket keys, filenames, digests, media/upload IDs,
  MIME metadata, patient IDs, or scanner free text.
- Wrap provider health/request/callback/reconciliation through `provider`; use a finite provider
  family configured at deployment, never provider account IDs or callback payloads.

## SLOs, alerts, and dashboards

`clinicOsServiceLevelObjectives` defines availability, latency, freshness, and durability objectives.
`evaluateErrorBudget` yields `healthy`, `at_risk`, or `exhausted`; exhausted critical-journey budgets
freeze risky changes until the documented review completes.

`clinicOsProductionAlertDefinitions` covers authentication, outbox lag, provider failures,
database/cache, backup failure/freshness, security anomalies, readiness/backpressure, and media
quarantine/scanner health. Dashboard panels must include:

- API availability/error/latency by finite route family;
- identity outcomes and security-denial anomaly rate;
- Postgres/cache dependency health, latency, saturation, and evictions;
- outbox depth/oldest age/dead letters plus Temporal activity outcomes;
- provider outcomes and callback/reconciliation freshness;
- media quarantine age and scanner outcome;
- readiness/backpressure state;
- backup freshness/failure and last approved restore/failover evidence;
- SLO compliance, burn rate, and remaining error budget.

Every firing alert includes severity, owner, this runbook, and tenant-safe context. Before a paging
recipient is configured and a real injected alert is acknowledged, the state remains
`paging_target_unavailable`.

## E4/E5 verification still required

- deployed trace continuity through API -> Postgres/outbox -> worker/Temporal -> provider adapter;
- deployed metrics visible with bounded series counts and no console-only metric claim;
- sanitized log/trace/metric sampling plus retention and viewer-access review;
- collector loss/recovery removes/restores readiness as configured without losing product audit;
- each critical alert injected and acknowledged by the real escalation target;
- load, noisy-neighbor, backpressure, backup/restore, failover/failback, and security exercises on
  the exact deployed revision with synthetic data.
