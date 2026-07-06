# Integrations Package

Provider-neutral contracts for external systems. The worker uses these contracts for provider health
surfaces and for future outbox handlers without coupling domain code to a specific vendor.

The package currently defines:

- adapter capabilities,
- source-of-truth modes for dual-run/import flows,
- provider health status contracts,
- raw webhook and normalized external event envelopes,
- approved external action/result contracts.
