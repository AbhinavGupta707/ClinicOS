# Local Development Runbook

This runbook covers the Checkpoint 1 local dependency surface. It does not replace app-specific runbooks once the API, worker, web, and mobile lanes register their runtimes.

## Prerequisites

- Node.js `22.22.2`
- npm `10.9.7`
- Docker with Compose v2

## Install

```sh
npm ci
```

## Start Local Services

```sh
npm run local:up
npm run local:ps
```

Services:

| Service     | URL / address                                               | Local credential          |
| ----------- | ----------------------------------------------------------- | ------------------------- |
| Postgres    | `postgresql://clinic_os:clinic_os@localhost:5432/clinic_os` | `clinic_os` / `clinic_os` |
| Redis       | `redis://localhost:6379`                                    | none                      |
| Temporal    | `localhost:7233`                                            | none                      |
| Temporal UI | `http://localhost:8088`                                     | none                      |
| Keycloak    | `http://localhost:8080`                                     | admin `admin` / `admin`   |

The Keycloak realm is `clinic-os-local`. Synthetic local users use the password `local-only-password`:

| Username             | Realm role   |
| -------------------- | ------------ |
| `owner.local`        | owner        |
| `doctor.local`       | doctor       |
| `assistant.local`    | assistant    |
| `receptionist.local` | receptionist |

## Environment

Copy the template for app runtime work:

```sh
cp .env.example .env.local
```

Keep `simulator` providers only for local/dev contract tests. For `staging`, `pilot-prod`, and `prod`, the typed config package requires official providers or `unconfigured` unavailable states.

## App Commands

Root commands are reserved now and become live when each owning lane installs the runtime:

```sh
npm run dev:web
npm run dev:api
npm run dev:worker
npm run dev:mobile
```

Until then they fail with the official activation flow for that app instead of starting a fake service.

## Stop Or Reset

```sh
npm run local:down
```

To remove local service data after confirming no useful synthetic state is needed:

```sh
docker compose down --volumes --remove-orphans
```

Do not place real patient data, production PHI, or live provider secrets in local Docker volumes or `.env.local`.
