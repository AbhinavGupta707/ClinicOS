# Database Package

Owns schema, migrations, seed data, RLS policies, and database test utilities.

## Checkpoint 1 Scope

- `migrations/0001_identity_auth_audit_phi.sql`
  - `tenants`, `clinics`, `users`, `user_identities`, `memberships`
  - `roles`, `permissions`, `role_permissions`, `user_role_assignments`, `clinic_user_assignments`
  - `break_glass_accesses`, `audit_events`
  - first PHI table: `patients`
  - transaction-local RLS helpers in schema `clinic_os`
  - RLS policies for `patients` and `audit_events`
- `seeds/checkpoint1_identity_auth.sql`
  - synthetic demo tenant, clinic, and owner/doctor/assistant/receptionist/accountant users
  - Keycloak subjects: `seed-owner`, `seed-doctor`, `seed-assistant`, `seed-receptionist`, `seed-accountant`
  - default role permission grants matching `@clinic-os/domain`

Before querying tenant-owned tables, API and worker transactions must set RLS context using `buildSetLocalRlsStatements`:

```ts
for (const statement of buildSetLocalRlsStatements({ tenantId, clinicId, userId })) {
  await tx.query(statement.sql, statement.values);
}
```

The migration forces RLS on the first PHI table so missing `app.tenant_id` fails closed.
