# Observability Package

Shared worker/API observability primitives:

- structured JSON logging with PHI-oriented redaction hooks,
- metric recorder contracts for counters, gauges, and timings,
- health/readiness aggregation with named checks.

The package intentionally exposes small contracts first. Concrete exporters for OpenTelemetry,
Prometheus, or Sentry-style error reporting can plug in without changing worker code.
