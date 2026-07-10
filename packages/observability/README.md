# Observability Package

Production observability primitives for API and worker composition:

- OpenTelemetry Node SDK with OTLP/HTTP trace and metric export compatible with ADOT collectors,
- W3C Trace Context propagation without baggage,
- parent-based bounded trace sampling and per-instrument cardinality limits,
- PHI-safe structured logging with an explicit diagnostic field allowlist and trace correlation,
- catalog-only metric recorder contracts for counters, synchronous gauges, and histograms,
- health/readiness aggregation with named checks,
- typed instrumentation hooks for HTTP, Postgres, Redis, outbox, Temporal, identity, media,
  providers, and worker execution,
- SLO/error-budget definitions, readiness/backpressure policy, and deterministic alert evaluation.

Production-like environments (`staging`, `pilot-prod`, and `prod`) cannot disable telemetry or start
without both trace and metric OTLP endpoints. Startup emits sampled trace and metric probes and
waits for both exports to flush. An unreachable or rejected exporter fails startup and therefore
readiness. Shutdown attempts flush and SDK shutdown independently and returns bounded error codes.

Local/test environments may explicitly disable telemetry. `createConsoleMetricRecorder` remains a
local/test compatibility helper only; it is not a production success path. Master composition must
replace the worker's current console recorder with `createObservabilityRuntime(...).metrics`.

Diagnostic telemetry never substitutes for authoritative product audit. Log messages are converted
to stable event codes; free text and unknown/nested fields are dropped. Tokens, headers, bodies,
signed URLs, SQL/query values, filenames, object keys, patient fields, and tenant/clinic identifiers
are forbidden. Metrics accept only cataloged names, attribute keys, and finite values; unknown values
are bucketed to `other` and policy violations are surfaced without leaking the original value.

Provider-health classification is intentionally conservative:

- local/dev `not_configured` states are informational and should not page;
- production-like expected live providers page when unavailable, degraded, or not configured;
- unconfigured providers that are not expected live should keep the product in an honest unavailable or manual state rather than claiming readiness.

Integration and operational procedures are in:

- `infra/runbooks/cp14-observability-operations.md`;
- `infra/runbooks/cp14-resilience-load-fault.md`;
- `infra/runbooks/cp14-recovery-drills.md`.
