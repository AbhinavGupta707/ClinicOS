#!/usr/bin/env node
import { spawn } from "node:child_process";
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

function sanitize(value) {
  return value.replaceAll(/postgres(?:ql)?:\/\/[^\s]+/giu, "postgresql://[redacted]").slice(-4000);
}
