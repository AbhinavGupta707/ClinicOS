#!/usr/bin/env node
import { Client } from "pg";
import {
  CLINIC_ROLE_SLUGS,
  DEFAULT_ROLE_PERMISSION_GRANTS,
  PERMISSIONS,
  isClinicalPermission
} from "@clinic-os/domain";
import {
  CHECKPOINT1_SEED_IDS,
  CHECKPOINT1_SEED_USERS,
  LATEST_DATABASE_SCHEMA_VERSION
} from "@clinic-os/db";

const command = process.argv[2];
const ADMIN_URL =
  process.env.CLINIC_OS_LOCAL_DB_ADMIN_URL ??
  "postgresql://clinic_os:clinic_os@127.0.0.1:5432/postgres";
const MIGRATOR_URL =
  process.env.MIGRATION_DATABASE_URL ??
  "postgresql://clinic_os_migrator:clinic_os_migrator@127.0.0.1:5432/clinic_os";
const RUNTIME_URL =
  process.env.DATABASE_URL ??
  "postgresql://clinic_os_runtime:clinic_os_runtime@127.0.0.1:5432/clinic_os";
const WORKER_URL =
  process.env.WORKER_DATABASE_URL ??
  "postgresql://clinic_os_worker:clinic_os_worker@127.0.0.1:5432/clinic_os";

const TENANT_B = {
  tenantId: "20000000-0000-4000-8000-000000000001",
  clinicId: "20000000-0000-4000-8000-000000000101",
  ownerUserId: "20000000-0000-4000-8000-000000001001",
  patientId: "20000000-0000-4000-8000-000000002001"
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function main() {
  assertLocalDatabaseUrl(ADMIN_URL, "postgres");
  assertLocalDatabaseUrl(MIGRATOR_URL, "clinic_os");
  assertLocalDatabaseUrl(RUNTIME_URL, "clinic_os");
  assertLocalDatabaseUrl(WORKER_URL, "clinic_os");

  switch (command) {
    case "provision":
      await provision(false);
      break;
    case "reset-local":
      assertDestructiveLocalResetAllowed();
      await provision(true);
      break;
    case "grant-runtime":
      await grantRuntimePrivileges();
      break;
    case "seed-local":
      assertSyntheticLocalMode();
      await seedLocal();
      break;
    case "verify":
      await verifyDatabase();
      break;
    default:
      throw new Error(
        "Usage: node scripts/db-local-lifecycle.mjs <provision|reset-local|grant-runtime|seed-local|verify>"
      );
  }
}

function assertLocalDatabaseUrl(connectionString, expectedDatabase) {
  const parsed = new URL(connectionString);
  const localHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("CP11 database lifecycle accepts only PostgreSQL URLs.");
  }
  if (!localHosts.has(parsed.hostname)) {
    throw new Error(`Refusing non-local database host ${parsed.hostname}.`);
  }
  if (parsed.pathname !== `/${expectedDatabase}`) {
    throw new Error(`Refusing database ${parsed.pathname}; expected /${expectedDatabase}.`);
  }
}

function assertSyntheticLocalMode() {
  const environment = process.env.CLINIC_OS_ENV ?? "local";
  const syntheticOnly = (process.env.PILOT_SYNTHETIC_DATA_ONLY ?? "true").toLowerCase();
  if (!new Set(["local", "test"]).has(environment) || syntheticOnly !== "true") {
    throw new Error(
      "Synthetic seed is restricted to local/test with PILOT_SYNTHETIC_DATA_ONLY=true."
    );
  }
}

function assertDestructiveLocalResetAllowed() {
  assertSyntheticLocalMode();
  if (process.env.CLINIC_OS_ALLOW_LOCAL_DB_RESET !== "true") {
    throw new Error("Set CLINIC_OS_ALLOW_LOCAL_DB_RESET=true for the guarded local reset command.");
  }
}

async function provision(recreateDatabase) {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await ensureLoginRole(admin, "clinic_os_migrator", "clinic_os_migrator");
    await ensureLoginRole(admin, "clinic_os_runtime", "clinic_os_runtime");
    await ensureLoginRole(admin, "clinic_os_worker", "clinic_os_worker");
    if (recreateDatabase) {
      await admin.query(
        "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'clinic_os' and pid <> pg_backend_pid()"
      );
      await admin.query("drop database if exists clinic_os");
      await admin.query("create database clinic_os owner clinic_os_migrator");
    } else {
      await admin.query("alter database clinic_os owner to clinic_os_migrator");
    }
    await admin.query("grant connect on database clinic_os to clinic_os_runtime");
    await admin.query("grant connect on database clinic_os to clinic_os_worker");
  } finally {
    await admin.end();
  }

  const targetAdmin = new Client({ connectionString: databaseUrl(ADMIN_URL, "clinic_os") });
  await targetAdmin.connect();
  try {
    await targetAdmin.query("revoke create on schema public from public");
    await targetAdmin.query("alter schema public owner to clinic_os_migrator");
    await targetAdmin.query(
      `do $$
       begin
         if exists (select 1 from pg_namespace where nspname = 'clinic_os') then
           alter schema clinic_os owner to clinic_os_migrator;
         end if;
       end
       $$`
    );
  } finally {
    await targetAdmin.end();
  }
  console.log(
    recreateDatabase ? "Local clinic_os database recreated." : "Local database roles provisioned."
  );
}

async function ensureLoginRole(client, role, password) {
  const result = await client.query("select 1 from pg_roles where rolname = $1", [role]);
  if (result.rowCount === 0) {
    await client.query(
      `create role ${role} login password '${password}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls`
    );
  } else {
    await client.query(
      `alter role ${role} with login password '${password}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls`
    );
  }
}

async function grantRuntimePrivileges() {
  const client = new Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    await client.query("revoke create on schema public from public");
    await client.query("revoke create on schema public from clinic_os_runtime");
    await client.query("revoke create on schema public from clinic_os_worker");
    await client.query("grant usage on schema public, clinic_os to clinic_os_runtime");
    await client.query("grant usage on schema public to clinic_os_worker");
    await client.query(
      "grant select, insert, update, delete on all tables in schema public to clinic_os_runtime"
    );
    await client.query(
      "grant usage, select on all sequences in schema public to clinic_os_runtime"
    );
    await client.query("grant execute on all functions in schema clinic_os to clinic_os_runtime");
    await client.query(
      "alter default privileges for role clinic_os_migrator in schema public grant select, insert, update, delete on tables to clinic_os_runtime"
    );
    await client.query(
      "alter default privileges for role clinic_os_migrator in schema public grant usage, select on sequences to clinic_os_runtime"
    );
    await client.query(
      "revoke update, delete, truncate on table audit_events from clinic_os_runtime"
    );
    await client.query(
      "revoke delete, truncate on table api_idempotency_records from clinic_os_runtime"
    );
    await client.query(
      "revoke delete, truncate on table private_media_records from clinic_os_runtime"
    );
    await client.query(
      "revoke update, delete, truncate on table private_media_scan_evidence, private_media_operations from clinic_os_runtime"
    );
    await client.query("revoke all on table outbox_trace_contexts from clinic_os_runtime");
    await client.query("revoke all on table flyway_schema_history from clinic_os_runtime");
    await client.query("grant select on table flyway_schema_history to clinic_os_runtime");
    await client.query("revoke all on all tables in schema public from clinic_os_worker");
    await client.query(
      `grant select on table
         external_accounts, external_systems, invoices, payment_transactions, payment_requests,
         payment_provider_request_intents, outbox_events, outbox_trace_contexts,
         pricebook_procedures, procedure_performed_records,
         recall_rules, recalls, tasks, sop_schedules, sop_templates, sop_template_items,
         sop_runs, sop_run_items
       to clinic_os_worker`
    );
    await client.query(
      `grant insert on table
         audit_events, outbox_events, payment_requests, recalls, tasks, sop_runs, sop_run_items
       to clinic_os_worker`
    );
    await client.query(
      `grant update on table
         invoices, outbox_events, payment_provider_request_intents, recalls, sop_runs
       to clinic_os_worker`
    );
    await client.query(
      "grant select, insert, update on table outbox_attempts, dead_letter_events to clinic_os_worker"
    );
    await client.query(
      "revoke all on table outbox_attempts, dead_letter_events from clinic_os_runtime"
    );
    await client.query(
      "revoke all on table private_media_records, private_media_scan_evidence, private_media_operations from clinic_os_worker"
    );
    await client.query(
      "revoke update, delete, truncate on table outbox_events from clinic_os_runtime"
    );
  } finally {
    await client.end();
  }
  console.log(
    "Runtime and worker least-privilege grants applied; schema, migration history, audit mutation, and cross-surface worker access remain denied."
  );
}

async function seedLocal() {
  const client = new Client({ connectionString: MIGRATOR_URL });
  await client.connect();
  try {
    await client.query("begin");
    await seedTenant(client, {
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      slug: "clinicos-synthetic-tenant",
      clinicSlug: "synthetic-dental-clinic",
      displayName: "ClinicOS Synthetic Tenant",
      clinicName: "Synthetic Dental Clinic"
    });
    await seedTenant(client, {
      tenantId: TENANT_B.tenantId,
      clinicId: TENANT_B.clinicId,
      slug: "clinicos-isolation-tenant",
      clinicSlug: "isolation-dental-clinic",
      displayName: "ClinicOS Isolation Tenant",
      clinicName: "Isolation Dental Clinic"
    });
    await seedPermissions(client);
    await seedTenantRoles(client, CHECKPOINT1_SEED_IDS.tenantId);
    await seedTenantRoles(client, TENANT_B.tenantId);
    for (const user of CHECKPOINT1_SEED_USERS) {
      await seedUser(client, {
        tenantId: CHECKPOINT1_SEED_IDS.tenantId,
        clinicId: CHECKPOINT1_SEED_IDS.clinicId,
        userId: CHECKPOINT1_SEED_IDS.users[user.key],
        displayName: user.displayName,
        email: user.email,
        keycloakSubject: user.keycloakSubject,
        roleSlug: user.roleSlug
      });
    }
    await seedUser(client, {
      tenantId: TENANT_B.tenantId,
      clinicId: TENANT_B.clinicId,
      userId: TENANT_B.ownerUserId,
      displayName: "Uma Isolation Owner",
      email: "owner@isolation.clinicos.local",
      keycloakSubject: "seed-isolation-owner",
      roleSlug: "owner_admin"
    });
    await seedClinicData(client, {
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      actorUserId: CHECKPOINT1_SEED_IDS.users.owner,
      doctorUserId: CHECKPOINT1_SEED_IDS.users.doctor,
      patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      patientName: "Rhea Synthetic",
      patientPhone: "+919876543210"
    });
    await seedClinicData(client, {
      tenantId: TENANT_B.tenantId,
      clinicId: TENANT_B.clinicId,
      actorUserId: TENANT_B.ownerUserId,
      doctorUserId: TENANT_B.ownerUserId,
      patientId: TENANT_B.patientId,
      patientName: "Ira Isolation Synthetic",
      patientPhone: "+919000000002"
    });
    await seedPaymentSimulatorAccount(client, {
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      systemId: CHECKPOINT1_SEED_IDS.integrations.paymentSimulatorSystem,
      accountId: CHECKPOINT1_SEED_IDS.integrations.paymentSimulatorAccount,
      qrCapabilityId: CHECKPOINT1_SEED_IDS.integrations.paymentSimulatorQrCapability,
      linkCapabilityId: CHECKPOINT1_SEED_IDS.integrations.paymentSimulatorLinkCapability,
      webhookCapabilityId: CHECKPOINT1_SEED_IDS.integrations.paymentSimulatorWebhookCapability
    });
    await seedPaymentSimulatorAccount(client, {
      tenantId: TENANT_B.tenantId,
      clinicId: TENANT_B.clinicId,
      systemId: "20000000-0000-4000-8000-000000006001",
      accountId: "20000000-0000-4000-8000-000000006002",
      qrCapabilityId: "20000000-0000-4000-8000-000000006003",
      linkCapabilityId: "20000000-0000-4000-8000-000000006004",
      webhookCapabilityId: "20000000-0000-4000-8000-000000006005"
    });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
  console.log("Idempotent local synthetic tenants, roles, identities, and clinic data seeded.");
}

async function seedTenant(client, input) {
  await client.query(
    `insert into tenants (id, slug, legal_name, display_name, status)
     values ($1, $2, $3, $4, 'active')
     on conflict (id) do update set display_name = excluded.display_name, status = 'active'`,
    [input.tenantId, input.slug, `${input.displayName} Private Limited`, input.displayName]
  );
  await setSeedContext(client, input.tenantId, input.clinicId);
  await client.query(
    `insert into clinics (id, tenant_id, slug, display_name, timezone, status)
     values ($1, $2, $3, $4, 'Asia/Kolkata', 'active')
     on conflict (id) do update set display_name = excluded.display_name, timezone = excluded.timezone, status = 'active'`,
    [input.clinicId, input.tenantId, input.clinicSlug, input.clinicName]
  );
}

async function seedPermissions(client) {
  for (const permission of PERMISSIONS) {
    await client.query(
      `insert into permissions (key, display_name, category, description, phi_involved)
       values ($1, $2, $3, $4, $5)
       on conflict (key) do update set display_name = excluded.display_name,
         category = excluded.category, description = excluded.description,
         phi_involved = excluded.phi_involved`,
      [
        permission,
        permission.replaceAll(".", " "),
        permission.split(".")[0],
        `ClinicOS permission ${permission}`,
        isClinicalPermission(permission)
      ]
    );
  }
}

async function seedTenantRoles(client, tenantId) {
  await setSeedContext(client, tenantId, null);
  for (const [index, roleSlug] of CLINIC_ROLE_SLUGS.entries()) {
    const roleId = roleIdFor(tenantId, index + 1);
    await client.query(
      `insert into roles (id, tenant_id, slug, display_name, is_system_role)
       values ($1, $2, $3, $4, true)
       on conflict (tenant_id, slug) do update set display_name = excluded.display_name,
         is_system_role = true`,
      [roleId, tenantId, roleSlug, roleSlug.replaceAll("_", " ")]
    );
    for (const permission of DEFAULT_ROLE_PERMISSION_GRANTS[roleSlug]) {
      await client.query(
        `insert into role_permissions (role_id, permission_key)
         values ($1, $2) on conflict do nothing`,
        [roleId, permission]
      );
    }
  }
}

async function seedUser(client, input) {
  await setSeedContext(client, input.tenantId, input.clinicId);
  await client.query(
    `insert into users (id, display_name, email, status)
     values ($1, $2, $3, 'active')
     on conflict (id) do update set display_name = excluded.display_name,
       email = excluded.email, status = 'active'`,
    [input.userId, input.displayName, input.email]
  );
  await client.query(
    `insert into user_identities (user_id, provider, issuer, subject, email_at_provider)
     values ($1, 'keycloak', 'http://localhost:8080/realms/clinic-os-local', $2, $3)
     on conflict (provider, issuer, subject) do update set user_id = excluded.user_id,
       email_at_provider = excluded.email_at_provider`,
    [input.userId, input.keycloakSubject, input.email]
  );
  await client.query(
    `insert into memberships (tenant_id, user_id, status)
     values ($1, $2, 'active') on conflict (tenant_id, user_id) do update set status = 'active'`,
    [input.tenantId, input.userId]
  );
  await client.query(
    `insert into clinic_user_assignments (tenant_id, clinic_id, user_id, status)
     values ($1, $2, $3, 'active')
     on conflict (tenant_id, clinic_id, user_id) do update set status = 'active'`,
    [input.tenantId, input.clinicId, input.userId]
  );
  const roleIndex = CLINIC_ROLE_SLUGS.indexOf(input.roleSlug);
  await client.query(
    `insert into user_role_assignments
       (tenant_id, clinic_id, user_id, role_id, assigned_by_user_id)
     values ($1, $2, $3, $4, $3)
     on conflict (tenant_id, clinic_id, user_id, role_id) do update set revoked_at = null`,
    [input.tenantId, input.clinicId, input.userId, roleIdFor(input.tenantId, roleIndex + 1)]
  );
}

async function seedClinicData(client, input) {
  await setSeedContext(client, input.tenantId, input.clinicId);
  await client.query("select set_config('app.user_id', $1, true)", [input.actorUserId]);
  await client.query(
    `insert into patients
       (id, tenant_id, clinic_id, full_name, phone, gender, source, created_by_user_id)
     values ($1, $2, $3, $4, $5, 'female', 'manual', $6)
     on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone`,
    [
      input.patientId,
      input.tenantId,
      input.clinicId,
      input.patientName,
      input.patientPhone,
      input.actorUserId
    ]
  );
  const appointmentTypeId =
    input.tenantId === CHECKPOINT1_SEED_IDS.tenantId
      ? CHECKPOINT1_SEED_IDS.appointmentTypes.consultation
      : "20000000-0000-4000-8000-000000003001";
  const chairId =
    input.tenantId === CHECKPOINT1_SEED_IDS.tenantId
      ? CHECKPOINT1_SEED_IDS.chairs.operatoryOne
      : "20000000-0000-4000-8000-000000004001";
  const scheduleIdPrefix =
    input.tenantId === CHECKPOINT1_SEED_IDS.tenantId ? "10000000" : "20000000";
  const pricebookProcedureId =
    input.tenantId === CHECKPOINT1_SEED_IDS.tenantId
      ? CHECKPOINT1_SEED_IDS.pricebookProcedures.consultation
      : "20000000-0000-4000-8000-000000007001";
  await client.query(
    `insert into appointment_types
       (id, tenant_id, clinic_id, code, display_name, default_duration_minutes, color, active)
     values ($1, $2, $3, 'consultation', 'Consultation', 30, '#2563eb', true)
     on conflict (id) do update set active = true`,
    [appointmentTypeId, input.tenantId, input.clinicId]
  );
  await client.query(
    `insert into chairs_or_rooms (id, tenant_id, clinic_id, code, display_name, active)
     values ($1, $2, $3, 'op-1', 'Operatory 1', true)
     on conflict (id) do update set active = true`,
    [chairId, input.tenantId, input.clinicId]
  );
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek += 1) {
    const scheduleId = `${scheduleIdPrefix}-0000-4000-8000-${String(5000 + dayOfWeek).padStart(12, "0")}`;
    await client.query(
      `insert into provider_schedules
         (id, tenant_id, clinic_id, provider_user_id, day_of_week, starts_at, ends_at, effective_from, active)
       values ($1, $2, $3, $4, $5, '09:00', '17:00', '2026-01-01', true)
       on conflict (id) do update
         set provider_user_id = excluded.provider_user_id,
             day_of_week = excluded.day_of_week,
             starts_at = excluded.starts_at,
             ends_at = excluded.ends_at,
             effective_from = excluded.effective_from,
             effective_until = null,
             active = true`,
      [scheduleId, input.tenantId, input.clinicId, input.doctorUserId, dayOfWeek]
    );
  }
  await client.query(
    `insert into pricebook_procedures
       (id, tenant_id, clinic_id, code, display_name, category, description,
        default_unit_price_minor, currency, tax_rate_basis_points, status,
        created_by_user_id, updated_by_user_id)
     values ($1, $2, $3, 'cp13-synthetic-consultation', 'Synthetic consultation',
       'consultation', 'Synthetic-only local durable verification item', 12500, 'INR',
       0, 'active', $4, $4)
     on conflict (id) do update
       set display_name = excluded.display_name,
           description = excluded.description,
           default_unit_price_minor = excluded.default_unit_price_minor,
           status = 'active',
           updated_by_user_id = excluded.updated_by_user_id`,
    [pricebookProcedureId, input.tenantId, input.clinicId, input.actorUserId]
  );
}

async function seedPaymentSimulatorAccount(client, input) {
  await setSeedContext(client, input.tenantId, input.clinicId);
  await client.query(
    `insert into external_systems
       (id, tenant_id, provider_key, display_name, status)
     values ($1, $2, 'simulator', 'ClinicOS local payment simulator', 'available')
     on conflict (tenant_id, provider_key) do update
       set display_name = excluded.display_name, status = 'available'`,
    [input.systemId, input.tenantId]
  );
  await client.query(
    `insert into external_accounts
       (id, tenant_id, clinic_id, external_system_id, account_type, status, capability_keys, configuration)
     values ($1, $2, $3, $4, 'payment', 'available', $5::text[], '{"synthetic":true}'::jsonb)
     on conflict (id) do update
       set status = 'available', capability_keys = excluded.capability_keys,
           configuration = excluded.configuration`,
    [
      input.accountId,
      input.tenantId,
      input.clinicId,
      input.systemId,
      ["CREATE_PAYMENT_QR", "CREATE_PAYMENT_LINKS", "VERIFY_WEBHOOKS"]
    ]
  );
  for (const [capabilityId, capabilityKey] of [
    [input.qrCapabilityId, "CREATE_PAYMENT_QR"],
    [input.linkCapabilityId, "CREATE_PAYMENT_LINKS"],
    [input.webhookCapabilityId, "VERIFY_WEBHOOKS"]
  ]) {
    await client.query(
      `insert into external_provider_capabilities
         (id, tenant_id, clinic_id, external_account_id, capability_key, status, evidence, checked_at)
       values ($1, $2, $3, $4, $5, 'available', '{"source":"local_synthetic_seed"}'::jsonb, now())
       on conflict (tenant_id, external_account_id, capability_key) do update
         set status = 'available', evidence = excluded.evidence, checked_at = excluded.checked_at`,
      [capabilityId, input.tenantId, input.clinicId, input.accountId, capabilityKey]
    );
  }
}

async function setSeedContext(client, tenantId, clinicId) {
  await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
  await client.query("select set_config('app.clinic_id', $1, true)", [clinicId ?? ""]);
}

async function verifyDatabase() {
  const migrator = new Client({ connectionString: MIGRATOR_URL });
  await migrator.connect();
  let inventory;
  let migrationHistory;
  let roles;
  let seedCounts;
  try {
    inventory = await migrator.query(
      `select c.relname as table_name, c.relrowsecurity as rls_enabled,
              c.relforcerowsecurity as rls_forced
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and exists (
           select 1 from pg_attribute a
           where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
         )
       order by c.relname`
    );
    migrationHistory = await migrator.query(
      `select installed_rank, version, description, checksum, success
       from flyway_schema_history where type = 'SQL' order by installed_rank`
    );
    roles = await migrator.query(
      `select rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
       from pg_roles
       where rolname in ('clinic_os_migrator', 'clinic_os_runtime', 'clinic_os_worker')
       order by rolname`
    );
    const globalSeedCounts = await migrator.query(
      `select
         (select count(*)::integer from tenants where id in ($1, $2)) as tenants,
         (select count(*)::integer from users where id = any($3::uuid[])) as users`,
      [
        CHECKPOINT1_SEED_IDS.tenantId,
        TENANT_B.tenantId,
        [...Object.values(CHECKPOINT1_SEED_IDS.users), TENANT_B.ownerUserId]
      ]
    );
    const clinicCounts = [];
    for (const scopedSeed of [
      { tenantId: CHECKPOINT1_SEED_IDS.tenantId, clinicId: CHECKPOINT1_SEED_IDS.clinicId },
      { tenantId: TENANT_B.tenantId, clinicId: TENANT_B.clinicId }
    ]) {
      await migrator.query("begin");
      try {
        await migrator.query("select set_config('app.tenant_id', $1, true)", [scopedSeed.tenantId]);
        await migrator.query("select set_config('app.clinic_id', $1, true)", [scopedSeed.clinicId]);
        const clinicCount = await migrator.query(
          "select count(*)::integer as count from clinics where id = $1",
          [scopedSeed.clinicId]
        );
        clinicCounts.push(clinicCount.rows[0]?.count ?? 0);
      } finally {
        await migrator.query("rollback");
      }
    }
    seedCounts = {
      tenants: globalSeedCounts.rows[0]?.tenants ?? 0,
      users: globalSeedCounts.rows[0]?.users ?? 0,
      clinics: clinicCounts.reduce((total, count) => total + count, 0)
    };
  } finally {
    await migrator.end();
  }

  const unprotected = inventory.rows.filter((row) => !row.rls_enabled || !row.rls_forced);
  if (
    migrationHistory.rowCount !== Number.parseInt(LATEST_DATABASE_SCHEMA_VERSION, 10) ||
    migrationHistory.rows.some((row) => !row.success || row.checksum === null)
  ) {
    throw new Error(
      `Expected ${LATEST_DATABASE_SCHEMA_VERSION} successful checksum-tracked SQL migrations.`
    );
  }
  if (unprotected.length > 0) {
    throw new Error(
      `Tenant tables without forced RLS: ${unprotected.map((row) => row.table_name).join(", ")}`
    );
  }
  if (
    roles.rowCount !== 3 ||
    roles.rows.some(
      (role) => role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolbypassrls
    )
  ) {
    throw new Error("Migration/runtime roles are missing or over-privileged.");
  }
  if (seedCounts.tenants !== 2 || seedCounts.clinics !== 2 || seedCounts.users !== 8) {
    throw new Error("Synthetic seed inventory is incomplete.");
  }

  const runtime = new Client({ connectionString: RUNTIME_URL });
  await runtime.connect();
  try {
    const noContext = await runtime.query("select count(*)::integer as count from patients");
    if (noContext.rows[0]?.count !== 0)
      throw new Error("Runtime RLS did not fail closed without context.");
    await runtime.query("begin");
    await runtime.query("select set_config('app.tenant_id', $1, true)", [
      CHECKPOINT1_SEED_IDS.tenantId
    ]);
    await runtime.query("select set_config('app.clinic_id', $1, true)", [
      CHECKPOINT1_SEED_IDS.clinicId
    ]);
    await runtime.query("select set_config('app.user_id', $1, true)", [
      CHECKPOINT1_SEED_IDS.users.owner
    ]);
    const tenantA = await runtime.query("select tenant_id, id from patients order by id");
    await runtime.query("rollback");
    await runtime.query("begin");
    await runtime.query("select set_config('app.tenant_id', $1, true)", [TENANT_B.tenantId]);
    await runtime.query("select set_config('app.clinic_id', $1, true)", [TENANT_B.clinicId]);
    await runtime.query("select set_config('app.user_id', $1, true)", [TENANT_B.ownerUserId]);
    const tenantB = await runtime.query("select tenant_id, id from patients order by id");
    await runtime.query("rollback");
    if (
      !tenantA.rows.some((row) => row.id === CHECKPOINT1_SEED_IDS.patients.rheaSynthetic) ||
      tenantA.rows.some((row) => row.tenant_id !== CHECKPOINT1_SEED_IDS.tenantId) ||
      !tenantB.rows.some((row) => row.id === TENANT_B.patientId) ||
      tenantB.rows.some((row) => row.tenant_id !== TENANT_B.tenantId)
    ) {
      throw new Error("Direct runtime RLS tenant isolation failed.");
    }
    const privilege = await runtime.query(
      `select
         has_schema_privilege(current_user, 'public', 'CREATE') as schema_create,
         has_table_privilege(current_user, 'audit_events', 'UPDATE') as audit_update,
         has_table_privilege(current_user, 'audit_events', 'DELETE') as audit_delete,
         has_table_privilege(current_user, 'api_idempotency_records', 'DELETE') as idempotency_delete,
         has_table_privilege(current_user, 'flyway_schema_history', 'INSERT') as history_insert,
         has_table_privilege(current_user, 'flyway_schema_history', 'SELECT') as history_select`
    );
    const row = privilege.rows[0];
    if (
      row?.schema_create ||
      row?.audit_update ||
      row?.audit_delete ||
      row?.idempotency_delete ||
      row?.history_insert ||
      !row?.history_select
    ) {
      throw new Error("Runtime role has forbidden schema, audit, or migration-history privileges.");
    }
  } finally {
    await runtime.end();
  }

  const worker = new Client({ connectionString: WORKER_URL });
  await worker.connect();
  try {
    await worker.query("select count(*)::integer as count from outbox_events");
    const privileges = await worker.query(
      `select
         (has_table_privilege(current_user, 'payment_provider_request_intents', 'SELECT')
          and has_table_privilege(current_user, 'payment_provider_request_intents', 'UPDATE')) as payment_intent_activity,
         (has_table_privilege(current_user, 'recalls', 'SELECT')
          and has_table_privilege(current_user, 'recalls', 'INSERT')
          and has_table_privilege(current_user, 'recalls', 'UPDATE')) as recall_activity,
         (has_table_privilege(current_user, 'sop_runs', 'SELECT')
          and has_table_privilege(current_user, 'sop_runs', 'INSERT')
          and has_table_privilege(current_user, 'sop_runs', 'UPDATE')) as sop_activity,
         has_table_privilege(current_user, 'audit_events', 'INSERT') as audit_append,
         (has_table_privilege(current_user, 'outbox_events', 'SELECT')
          and has_table_privilege(current_user, 'outbox_events', 'INSERT')
          and has_table_privilege(current_user, 'outbox_events', 'UPDATE')) as outbox_activity,
         has_table_privilege(current_user, 'patients', 'SELECT') as patient_read,
         has_table_privilege(current_user, 'api_idempotency_records', 'SELECT') as idempotency_read,
         (has_table_privilege(current_user, 'payment_transactions', 'INSERT')
          or has_table_privilege(current_user, 'payment_transactions', 'UPDATE')
          or has_table_privilege(current_user, 'payment_transactions', 'DELETE')) as payment_mutation`
    );
    const privilege = privileges.rows[0];
    if (
      !privilege?.payment_intent_activity ||
      !privilege?.recall_activity ||
      !privilege?.sop_activity ||
      !privilege?.audit_append ||
      !privilege?.outbox_activity ||
      privilege?.patient_read ||
      privilege?.idempotency_read ||
      privilege?.payment_mutation
    ) {
      throw new Error("Worker role does not match the exact CP13 activity privilege boundary.");
    }
    let productReadDenied = false;
    try {
      await worker.query("select id from patients limit 1");
    } catch (error) {
      productReadDenied = error?.code === "42501";
    }
    if (!productReadDenied) {
      throw new Error("Worker role can read patient records outside its CP13 activity boundary.");
    }
    let idempotencyReadDenied = false;
    try {
      await worker.query("select id from api_idempotency_records limit 1");
    } catch (error) {
      idempotencyReadDenied = error?.code === "42501";
    }
    if (!idempotencyReadDenied) {
      throw new Error("Worker role can read API idempotency records.");
    }
  } finally {
    await worker.end();
  }

  console.log(
    JSON.stringify(
      {
        migrations: migrationHistory.rowCount,
        tenantOwnedTables: inventory.rowCount,
        forcedRlsTables: inventory.rowCount,
        roles: roles.rows.map((role) => role.rolname),
        syntheticTenants: seedCounts.tenants,
        runtimeNoContextRows: 0,
        workerCp13ActivityPrivileges: "least_privilege_pass",
        workerUnauthorizedPatientAccess: "denied",
        workerApiIdempotencyAccess: "denied",
        crossTenantIsolation: "pass"
      },
      null,
      2
    )
  );
}

function roleIdFor(tenantId, index) {
  const prefix = tenantId.startsWith("1") ? "11000000" : "21000000";
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function databaseUrl(connectionString, database) {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}
