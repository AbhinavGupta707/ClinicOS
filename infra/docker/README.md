# Docker

Local development containers for Postgres, Redis, Temporal, Keycloak, and supporting services.

The root `docker-compose.yml` defines:

| Service     | Port | Purpose                                                       |
| ----------- | ---: | ------------------------------------------------------------- |
| Postgres    | 5432 | ClinicOS local database plus Keycloak and Temporal databases. |
| Redis       | 6379 | Cache and short-job dependency surface.                       |
| Temporal    | 7233 | Durable workflow runtime for platform lanes.                  |
| Temporal UI | 8088 | Local workflow inspection.                                    |
| Keycloak    | 8080 | Local OIDC/OAuth2 identity provider.                          |

All checked-in credentials are local-only and synthetic.
