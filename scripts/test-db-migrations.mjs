#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { Client } from "pg";

const root = resolve(import.meta.dirname, "..");
const canonicalMigrations = join(root, "packages/db/migrations");
const adminUrl =
  process.env.CLINIC_OS_LOCAL_DB_ADMIN_URL ??
  "postgresql://clinic_os:clinic_os@127.0.0.1:5432/postgres";
const testDatabase = "clinic_os_migration_test";
const testDatabaseUrl = databaseUrl(adminUrl, testDatabase);
const internalJdbcUrl = `jdbc:postgresql://postgres:5432/${testDatabase}`;
const localJdbcUrl = `jdbc:postgresql://${new URL(adminUrl).host}/${testDatabase}`;
const localFlywayBinary = process.env.CLINIC_OS_FLYWAY_BIN?.trim() || null;
const localFlywayMigrationOptions = [
  "-sqlMigrationPrefix=0",
  "-sqlMigrationSeparator=_",
  "-sqlMigrationSuffixes=.sql",
  "-validateMigrationNaming=true",
  "-table=flyway_schema_history",
  "-connectRetries=30",
  "-lockRetryCount=30",
  "-cleanDisabled=true",
  "-outOfOrder=false",
  "-validateOnMigrate=true"
];

assertLocalAdminUrl(adminUrl);
if (localFlywayBinary && !isAbsolute(localFlywayBinary)) {
  throw new Error("CLINIC_OS_FLYWAY_BIN must be an absolute path to the approved Flyway CLI.");
}

const temporaryMigrations = await mkdtemp(join(tmpdir(), "clinic-os-migrations-"));
const admin = new Client({ connectionString: adminUrl });

try {
  await admin.connect();
  await dropTestDatabase(admin);
  await admin.query(`create database ${testDatabase} owner clinic_os_migrator`);
  await cp(canonicalMigrations, temporaryMigrations, { recursive: true });

  const canonicalVersions = (await readdir(canonicalMigrations))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .map((name) => Number.parseInt(name.slice(0, 4), 10));
  const canonicalCount = canonicalVersions.length;
  const lockProbeVersion = Math.max(...canonicalVersions) + 1;
  const failureProbeVersion = lockProbeVersion + 1;

  await writeFile(
    join(
      temporaryMigrations,
      `${String(lockProbeVersion).padStart(4, "0")}_concurrent_lock_probe.sql`
    ),
    `select pg_sleep(3);\ncreate table cp11_migration_lock_probe (id integer primary key);\n`,
    "utf8"
  );

  const runners = await Promise.all([runFlyway("migrate"), runFlyway("migrate")]);
  for (const runner of runners) {
    if (runner.code !== 0) {
      throw new Error(
        `Concurrent migration runner failed safely test:\n${sanitize(runner.output)}`
      );
    }
  }

  const testClient = new Client({ connectionString: testDatabaseUrl });
  await testClient.connect();
  try {
    const history = await testClient.query(
      "select version, success from flyway_schema_history where type = 'SQL' order by installed_rank"
    );
    const lockProbe = await testClient.query(
      "select to_regclass('public.cp11_migration_lock_probe') as name"
    );
    if (
      history.rowCount !== canonicalCount + 1 ||
      history.rows.some((row) => !row.success) ||
      lockProbe.rows[0]?.name !== "cp11_migration_lock_probe"
    ) {
      throw new Error(
        "Concurrent runners did not produce one complete, checksum-tracked schema history."
      );
    }
  } finally {
    await testClient.end();
  }

  await testCp16AiDurability();

  const firstMigrationPath = join(temporaryMigrations, "0001_identity_auth_audit_phi.sql");
  const firstMigration = await readFile(firstMigrationPath, "utf8");
  await writeFile(
    firstMigrationPath,
    `${firstMigration}\n-- intentional checksum drift probe\n`,
    "utf8"
  );
  const drift = await runFlyway("validate");
  if (drift.code === 0 || !/checksum/i.test(drift.output)) {
    throw new Error(
      `Flyway did not reject released-migration checksum drift:\n${sanitize(drift.output)}`
    );
  }
  await writeFile(firstMigrationPath, firstMigration, "utf8");

  await writeFile(
    join(
      temporaryMigrations,
      `${String(failureProbeVersion).padStart(4, "0")}_transactional_failure_probe.sql`
    ),
    `create table cp11_failed_migration_probe (id integer primary key);\nselect cp11_missing_function();\n`,
    "utf8"
  );
  const failedMigration = await runFlyway("migrate");
  if (failedMigration.code === 0) {
    throw new Error("Flyway unexpectedly accepted an invalid migration.");
  }

  const failureClient = new Client({ connectionString: testDatabaseUrl });
  await failureClient.connect();
  try {
    const failedObject = await failureClient.query(
      "select to_regclass('public.cp11_failed_migration_probe') as name"
    );
    const currentVersion = await failureClient.query(
      "select max(version::integer)::integer as version from flyway_schema_history where success"
    );
    if (
      failedObject.rows[0]?.name !== null ||
      currentVersion.rows[0]?.version !== lockProbeVersion
    ) {
      throw new Error(
        `Failed migration was not rolled back transactionally at schema version ${lockProbeVersion}.`
      );
    }
  } finally {
    await failureClient.end();
  }

  console.log(
    JSON.stringify(
      {
        concurrentRunners: "pass",
        checksumDriftRejected: "pass",
        failedMigrationRolledBack: "pass",
        cp16AiDurability: "pass",
        canonicalMigrationsUntouched: true
      },
      null,
      2
    )
  );
} finally {
  if (admin._connected) {
    await dropTestDatabase(admin);
    await admin.end();
  }
  await rm(temporaryMigrations, { recursive: true, force: true });
}

async function testCp16AiDurability() {
  const build = await runCommand("npm", ["run", "build:shared"]);
  if (build.code !== 0) {
    throw new Error(`CP16 shared adapter build failed:\n${sanitize(build.output)}`);
  }
  const [
    { PostgresCp16AiInvocationPersistence },
    { PostgresCp16AiPolicyGate },
    { PostgresFireworksUsageGuard },
    { defaultFireworksModelCatalog }
  ] = await Promise.all([
    import("../apps/api/src/providers/cp16/postgres-ai-invocations.ts"),
    import("../apps/api/src/providers/cp16/postgres-ai-policy.ts"),
    import("../apps/api/src/providers/cp16/postgres-ai-usage.ts"),
    import("@clinic-os/integrations")
  ]);
  const seed = {
    tenantId: "10000000-0000-4000-8000-000000000001",
    clinicId: "10000000-0000-4000-8000-000000000101",
    patientId: "10000000-0000-4000-8000-000000002001",
    actorUserId: "10000000-0000-4000-8000-000000001002",
    encounterId: "10000000-0000-4000-8000-000000009016",
    consentId: "10000000-0000-4000-8000-000000009017"
  };
  const setup = new Client({
    connectionString: roleDatabaseUrl(adminUrl, testDatabase, "clinic_os_migrator")
  });
  await setup.connect();
  try {
    // The migration lifecycle database intentionally runs Flyway without the
    // separate role-provisioning step from db-local-lifecycle. Reproduce the
    // exact minimum pre-existing runtime grants consumed by the CP16 adapters;
    // migration 0022 remains responsible for granting its own new tables.
    await setup.query("grant usage on schema public, clinic_os to clinic_os_runtime");
    await setup.query("grant select on table encounters, consents to clinic_os_runtime");
    await setup.query(
      "grant select, insert on table audit_events, outbox_events to clinic_os_runtime"
    );
    await setTestScope(setup, seed);
    await setup.query(
      `insert into tenants (id, slug, legal_name, display_name)
       values ($1, 'cp16-db-gate', 'CP16 Database Gate', 'CP16 Database Gate')
       on conflict (id) do nothing`,
      [seed.tenantId]
    );
    await setup.query(
      `insert into users (id, display_name, email)
       values ($1, 'CP16 Database Gate Actor', 'cp16-db-gate@example.invalid')
       on conflict (id) do nothing`,
      [seed.actorUserId]
    );
    await setup.query(
      `insert into clinics (id, tenant_id, slug, display_name, timezone)
       values ($1, $2, 'cp16-db-gate', 'CP16 Database Gate', 'Europe/London')
       on conflict (id) do nothing`,
      [seed.clinicId, seed.tenantId]
    );
    await setup.query(
      `insert into patients (
         id, tenant_id, clinic_id, full_name, source, created_by_user_id,
         updated_by_user_id
       ) values ($1,$2,$3,'Synthetic CP16 Database Gate','manual',$4,$4)
       on conflict (id) do nothing`,
      [seed.patientId, seed.tenantId, seed.clinicId, seed.actorUserId]
    );
    await setup.query(
      `insert into encounters (
         id, tenant_id, clinic_id, patient_id, provider_user_id, status, reason,
         created_by_user_id, updated_by_user_id
       ) values ($1,$2,$3,$4,$5,'drafting','CP16 durability gate',$5,$5)
       on conflict (id) do nothing`,
      [seed.encounterId, seed.tenantId, seed.clinicId, seed.patientId, seed.actorUserId]
    );
    await setup.query(
      `insert into consents (
         id, tenant_id, clinic_id, patient_id, purpose, status, template_code,
         template_version, capture_method, evidence, provenance, created_by_user_id
       ) values ($1,$2,$3,$4,'ai_audio_capture','active','cp16-db-gate',1,
         'clinic_staff','{}'::jsonb,'{}'::jsonb,$5)
       on conflict (tenant_id, clinic_id, patient_id, purpose) where status = 'active'
       do nothing`,
      [seed.consentId, seed.tenantId, seed.clinicId, seed.patientId, seed.actorUserId]
    );
  } finally {
    await setup.end();
  }

  const unitOfWork = runtimeUnitOfWork();
  const now = () => new Date("2026-07-14T00:00:00.000Z");
  const policy = new PostgresCp16AiPolicyGate(unitOfWork);
  const policyDecision = await policy.evaluate({
    ...seed,
    task: "clinical_structured_draft",
    stage: "clinical_processing",
    evaluatedAt: now().toISOString()
  });
  if (!policyDecision.allowed || !/^[0-9a-f]{64}$/u.test(policyDecision.snapshotDigest)) {
    throw new Error("CP16 durable policy gate did not resolve active exact-scope consent.");
  }

  const identity = {
    ...seed,
    correlationId: "cp16-db-durability-gate",
    idempotencyKey: "cp16-db-durability-gate",
    task: "clinical_structured_draft",
    processingStage: "clinical_processing",
    workflowIdempotencyDigest: digest("workflow"),
    providerCallIdempotencyDigest: digest("provider-call"),
    requestFingerprint: digest("request")
  };
  const persistence = new PostgresCp16AiInvocationPersistence({
    unitOfWork,
    payloads: deterministicPayloadCodec(),
    now
  });
  const claim = await persistence.claimInvocation(identity);
  if (claim.outcome !== "claimed") throw new Error("CP16 durable invocation was not claimed.");
  const result = {
    kind: "structured",
    value: {
      artifact: {
        task: "clinical_structured_draft",
        promptVersion: "cp16-clinical_structured_draft-prompt-v1",
        schemaVersion: "cp16-review-only-artifact-v1",
        reviewOnly: true,
        summary: "Synthetic durability evidence only.",
        evidence: [
          {
            statement: "Synthetic statement.",
            sourceAnchorIds: ["10000000-0000-4000-8000-000000009018"],
            confidence: 1
          }
        ],
        uncertainty: { level: "low", reasons: [] },
        warnings: [],
        safety: { status: "pass_to_human_review", concerns: [] },
        proposedActions: []
      },
      provenance: provenance(seed, identity)
    }
  };
  await persistence.commitProviderResult({
    identity,
    invocationId: claim.invocationId,
    disposition: "review_only_ready",
    applicationPolicyEvidence: {
      stage: "clinical_processing",
      evaluatedAt: now().toISOString(),
      reasonCode: policyDecision.reasonCode,
      snapshotDigest: policyDecision.snapshotDigest
    },
    result,
    occurredAt: now().toISOString()
  });
  const replay = await persistence.claimInvocation(identity);
  if (
    replay.outcome !== "completed" ||
    replay.disposition !== "review_only_ready" ||
    replay.result.value.artifact.summary !== "Synthetic durability evidence only."
  ) {
    throw new Error("CP16 durable invocation did not replay the protected result exactly.");
  }

  const catalog = defaultFireworksModelCatalog();
  const usage = new PostgresFireworksUsageGuard({
    unitOfWork,
    catalog,
    monthlyBudgetCents: 100_000,
    perClinicDailyBudgetCents: 10_000,
    now
  });
  const reservation = await usage.reserve({
    tenantId: seed.tenantId,
    clinicId: seed.clinicId,
    actorUserId: seed.actorUserId,
    tenantDigest: digest(seed.tenantId),
    correlationDigest: digest(identity.correlationId),
    requestDigest: digest("usage-request"),
    idempotencyDigest: digest("usage-idempotency"),
    task: "clinical_structured_draft",
    estimatedInputTokens: 100,
    maximumOutputTokens: 100,
    audioBytes: 0,
    audioDurationMs: 0,
    maximumAttempts: 2
  });
  const reservationAccounting = new Client({ connectionString: testDatabaseUrl });
  await reservationAccounting.connect();
  try {
    const accounting = await reservationAccounting.query(
      `select r.estimated_cost_microusd,
              array_agg(c.reserved_cost_microusd order by c.scope_kind) as reserved_costs
         from cp16_ai_usage_reservations r
         join cp16_ai_budget_counters c on c.tenant_id = r.tenant_id
          and ((c.scope_kind = 'tenant_month' and c.scope_key = r.tenant_id
                and c.period_start = r.tenant_month_start)
            or (c.scope_kind = 'clinic_day' and c.scope_key = r.clinic_id
                and c.period_start = r.clinic_day_start))
        where r.idempotency_digest = $1
        group by r.estimated_cost_microusd`,
      [digest("usage-idempotency")]
    );
    const estimated = BigInt(accounting.rows[0]?.estimated_cost_microusd ?? 0);
    const reservedCosts = (accounting.rows[0]?.reserved_costs ?? []).map((value) => BigInt(value));
    if (
      estimated <= 0n ||
      reservedCosts.length !== 2 ||
      reservedCosts.some((value) => value !== estimated)
    ) {
      throw new Error("CP16 AI reservation was not reflected in both atomic budget counters.");
    }
  } finally {
    await reservationAccounting.end();
  }
  await reservation.complete({
    inputTokens: 90,
    outputTokens: 50,
    audioBytes: 0,
    audioDurationMs: 0,
    attemptCount: 1
  });

  const verify = new Client({
    connectionString: roleDatabaseUrl(adminUrl, testDatabase, "clinic_os_migrator")
  });
  await verify.connect();
  try {
    await setTestScope(verify, seed);
    const stored = await verify.query(
      `select status, result_ciphertext, result_plaintext_digest
         from cp16_ai_invocations where id = $1`,
      [claim.invocationId]
    );
    const usageRow = await verify.query(
      `select status, settled_cost_microusd, actual_attempt_count
         from cp16_ai_usage_reservations where idempotency_digest = $1`,
      [digest("usage-idempotency")]
    );
    const audit = await verify.query(
      `select count(*)::integer as count from audit_events
        where resource_type = 'cp16_ai_invocation' and resource_id = $1`,
      [claim.invocationId]
    );
    const row = stored.rows[0];
    if (
      row?.status !== "completed" ||
      !Buffer.isBuffer(row.result_ciphertext) ||
      row.result_ciphertext.includes(Buffer.from("Synthetic durability evidence only.", "utf8")) ||
      !/^[0-9a-f]{64}$/u.test(row.result_plaintext_digest) ||
      usageRow.rows[0]?.status !== "settled" ||
      Number(usageRow.rows[0]?.actual_attempt_count) !== 1 ||
      BigInt(usageRow.rows[0]?.settled_cost_microusd ?? 0) <= 0n ||
      Number(audit.rows[0]?.count ?? 0) !== 1
    ) {
      throw new Error("CP16 AI durability evidence is incomplete or internally inconsistent.");
    }
  } finally {
    await verify.end();
  }

  function runtimeUnitOfWork() {
    return {
      async run(callback) {
        const client = new Client({
          connectionString: roleDatabaseUrl(adminUrl, testDatabase, "clinic_os_runtime")
        });
        await client.connect();
        try {
          await client.query("begin");
          const value = await callback({
            sqlClient: {
              query: (text, values = []) => client.query(text, [...values])
            }
          });
          await client.query("commit");
          return value;
        } catch (error) {
          await client.query("rollback").catch(() => undefined);
          throw error;
        } finally {
          await client.end();
        }
      }
    };
  }
}

async function setTestScope(client, seed) {
  await client.query(
    `select set_config('app.tenant_id', $1, false),
            set_config('app.clinic_id', $2, false),
            set_config('app.user_id', $3, false)`,
    [seed.tenantId, seed.clinicId, seed.actorUserId]
  );
}

function deterministicPayloadCodec() {
  const values = new Map();
  return {
    async protectJson(value) {
      const plaintext = Buffer.from(JSON.stringify(value), "utf8");
      const ciphertext = Buffer.concat([
        Buffer.from("CP16-TEST-ENVELOPE\0", "utf8"),
        digestBytes(plaintext)
      ]);
      values.set(ciphertext.toString("hex"), structuredClone(value));
      return {
        algorithm: "AES-256-GCM",
        ciphertext,
        keyReference: `test-only-key-reference:${digest(ciphertext).slice(0, 32)}`,
        plaintextDigest: digest(plaintext)
      };
    },
    async revealJson(payload) {
      const value = values.get(Buffer.from(payload.ciphertext).toString("hex"));
      if (value === undefined) throw new Error("Test protected payload is unavailable.");
      return structuredClone(value);
    }
  };
}

function provenance(seed, identity) {
  return {
    provider: "fireworks",
    task: identity.task,
    modelId: "accounts/fireworks/models/deepseek-v4-pro",
    promptVersion: "cp16-clinical_structured_draft-prompt-v1",
    schemaVersion: "cp16-review-only-artifact-v1",
    serviceAccountDigest: digest("service-account"),
    actorDigest: digest(seed.actorUserId),
    tenantDigest: digest(seed.tenantId),
    correlationDigest: digest(identity.correlationId),
    consentSnapshotDigest: digest("consent"),
    requestDigest: digest("provider-request"),
    responseDigest: digest("provider-response"),
    providerRequestIdDigest: digest("provider-request-id"),
    inputTokens: 90,
    outputTokens: 50,
    audioBytes: 0,
    audioDurationMs: 0,
    latencyMs: 25,
    attemptCount: 1,
    status: "review_only"
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function digestBytes(value) {
  return createHash("sha256").update(value).digest();
}

function runFlyway(command) {
  if (localFlywayBinary) {
    return runCommand(localFlywayBinary, [
      `-url=${localJdbcUrl}`,
      "-user=clinic_os_migrator",
      "-password=clinic_os_migrator",
      `-locations=filesystem:${temporaryMigrations}`,
      ...localFlywayMigrationOptions,
      command
    ]);
  }
  const args = [
    "compose",
    "--profile",
    "tools",
    "run",
    "--rm",
    "--volume",
    `${temporaryMigrations}:/flyway/sql:ro`,
    "flyway",
    `-url=${internalJdbcUrl}`,
    command
  ];
  return runCommand("docker", args);
}

function runCommand(executable, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { cwd: root, env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, output }));
  });
}

async function dropTestDatabase(client) {
  await client.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
    [testDatabase]
  );
  await client.query(`drop database if exists ${testDatabase}`);
}

function assertLocalAdminUrl(connectionString) {
  const parsed = new URL(connectionString);
  if (
    !new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(parsed.hostname) ||
    parsed.pathname !== "/postgres"
  ) {
    throw new Error(
      "Migration lifecycle tests are restricted to the local PostgreSQL admin database."
    );
  }
}

function databaseUrl(connectionString, database) {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function roleDatabaseUrl(connectionString, database, role) {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${database}`;
  parsed.username = role;
  parsed.password = role;
  return parsed.toString();
}

function sanitize(value) {
  return value.replaceAll(/postgres(?:ql)?:\/\/[^\s]+/giu, "postgresql://[redacted]").slice(-4000);
}
