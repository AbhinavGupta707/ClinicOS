# Observability Package

Shared worker/API observability primitives:

- structured JSON logging with PHI-oriented redaction hooks,
- metric recorder contracts for counters, gauges, and timings,
- health/readiness aggregation with named checks,
- CP9 operational alert rule metadata and provider-health classification helpers.

The package intentionally exposes small contracts first. Concrete exporters for OpenTelemetry,
Prometheus, or Sentry-style error reporting can plug in without changing worker code.

Provider-health classification is intentionally conservative:

- local/dev `not_configured` states are informational and should not page;
- production-like expected live providers page when unavailable, degraded, or not configured;
- unconfigured providers that are not expected live should keep the product in an honest unavailable or manual state rather than claiming readiness.
