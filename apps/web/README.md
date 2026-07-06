# Web App

Owner: platform and clinic product workstreams.

Checkpoint 1 installs the production Next.js shell, auth session boundary, role-aware navigation, and honest unavailable states for later clinic workflow slices.

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
