# Infrastructure

Terraform, Docker, environment templates, and operational runbooks live here.

Checkpoint 1 adds local infrastructure for Postgres, Redis, Temporal, and Keycloak. Later checkpoints add AWS India infrastructure and pilot-prod readiness.

Start local dependencies from the repository root:

```sh
npm run local:up
```

See `infra/runbooks/local-development.md` for ports, credentials, and reset guidance.
