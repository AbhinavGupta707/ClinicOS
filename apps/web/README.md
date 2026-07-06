# Web App

Owner: platform and clinic product workstreams.

Checkpoint 1 installs the production Next.js shell, auth session boundary, role-aware navigation, and honest unavailable states for later clinic workflow slices.

Reserved root command: `npm run dev:web`.

## Local development

```sh
npm run dev --workspace apps/web
```

By default the shell calls `GET /v1/me` on the same origin. Set `NEXT_PUBLIC_CLINIC_OS_API_BASE_URL` when the API runs elsewhere.

For local UI verification before the API lane has merged, use the synthetic non-PHI identity fixture:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant \
npm run dev --workspace apps/web
```

Supported `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE` values are `owner`, `doctor`, `assistant`, `receptionist`, `accountant`, and `platform_admin`.

The fixture is intentionally limited to user, tenant, clinic, role, and permission context. It does not include synthetic patients, queues, clinical records, payments, or analytics.

Checkpoint 2 adds a separate local-only workflow fixture for browser smoke before the backend/API
lane is merged:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP2_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant \
npm run dev --workspace apps/web
```

The CP2 fixture uses explicitly synthetic, non-PHI leads, patients, appointments, and queue rows. In
live mode the workflow calls the CP2 API boundary:

- `GET /v1/appointments?date=`
- `GET /v1/queue?date=`
- `GET /v1/leads?status=`
- `GET /v1/patients?query=&phone=&source=`
- `POST /v1/leads`
- `POST /v1/patients`
- `POST /v1/leads/{id}/match-patient`
- `POST /v1/leads/{id}/convert-to-appointment`
- `POST /v1/appointments/{appointmentId}/confirm`
- `POST /v1/appointments/{appointmentId}/check-in`

## `/me` contract expectation

Until `packages/api-contracts` owns generated types, the web shell keeps a local mirror in `apps/web/lib/me.ts`. The expected shape is:

```json
{
  "user": { "id": "user_...", "displayName": "Name", "email": "name@example.test" },
  "tenant": { "id": "tenant_...", "name": "Clinic group" },
  "clinic": { "id": "clinic_...", "name": "Clinic name", "timezone": "Asia/Kolkata" },
  "roles": ["assistant"],
  "permissions": ["shell.read"],
  "featureFlags": {}
}
```

`401` and `403` are treated as authentication/activation states. `404` is treated as `/v1/me` not registered, so registration and API startup should be checked before debugging role permissions.
