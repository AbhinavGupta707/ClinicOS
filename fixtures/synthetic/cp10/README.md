# Checkpoint 10 Synthetic Pilot Configuration Fixtures

These fixtures support CP10 release-candidate pilot-readiness checks without real PHI, live provider activation, cloud mutation, GitHub push, ABDM calls, or physical-device flows.

The canonical fixture is `pilot_readiness_configuration.json`. It describes a synthetic local pilot clinic that is ready for configuration review while still blocked or deferred for external go-live evidence such as signed provider webhooks, AWS apply, live restore, remote CI, ABDM, and device smoke.

Use this fixture only for local development, automated tests, and release-candidate documentation evidence.
