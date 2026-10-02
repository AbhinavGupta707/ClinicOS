#!/usr/bin/env node
import assert from "node:assert/strict";
import { createAcceptanceBuildInputGuard } from "./mvp-build-inputs.mjs";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// This runner owns only its API/web processes. Database provisioning is a separate,
// explicit action: use a disposable, migrated and seeded local Postgres plus Redis.
assert.ok(
  process.argv.slice(2).every((arg) => ["--front-desk", "--daily-workflow"].includes(arg)),
  "Unknown acceptance suite."
);
const dailyWorkflow = process.argv.includes("--daily-workflow");
assert.ok(
  !(dailyWorkflow && process.argv.includes("--front-desk")),
  "Choose one acceptance suite."
);
const frontDeskOnly = process.argv.includes("--front-desk");
const root = resolve(import.meta.dirname, "..");
const webRoot = join(root, "apps/web");
assert.equal(
  process.env.CLINICOS_MVP_IMPORT_E2E_ENABLED,
  "true",
  "Explicit real-stack opt-in required."
);
assert.equal(
  process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE,
  "true",
  "Confirm a disposable synthetic database."
);
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true", "Synthetic data only.");
const databaseUrl = requiredLocalUrl("DATABASE_URL", ["postgres:", "postgresql:"]);
assert.equal(databaseUrl.username, "clinic_os_runtime");
assert.equal(databaseUrl.pathname, "/clinic_os");
const redisUrl = requiredLocalUrl("REDIS_URL", ["redis:"]);
const databaseToken = process.env.CLINICOS_MVP_DATABASE_TOKEN ?? "";
assert.match(databaseToken, /^[a-f0-9]{32}$/u, "Disposable database provenance token required.");
for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  await assertAbsent(join(webRoot, file));
}

const artifactParent = resolve(
  process.env.CLINICOS_MVP_ARTIFACTS_DIR ?? join(root, "artifacts/mvp-real-stack")
);
await mkdir(artifactParent, { recursive: true });
const artifacts = await mkdtemp(join(artifactParent, "run-"));
const tmp = join(artifacts, "tmp");
await mkdir(tmp);
const inheritedKeys = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "CI",
  "PLAYWRIGHT_BROWSERS_PATH",
  "npm_config_cache"
];
const childEnv = {
  ...Object.fromEntries(
    inheritedKeys
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]])
  ),
  TMPDIR: tmp,
  TMP: tmp,
  TEMP: tmp,
  NEXT_TELEMETRY_DISABLED: "1",
  CLINICOS_MVP_IMPORT_E2E_ENABLED: "true",
  NEXT_PUBLIC_CLINIC_OS_ENV: "local",
  NEXT_PUBLIC_CLINIC_OS_AUTH_TRANSPORT: "synthetic_bearer",
  NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE: "false",
  NEXT_PUBLIC_CLINIC_OS_USE_CP7_INTEGRATION_OPS_FIXTURE: "false"
};
const apiEnv = {
  NODE_ENV: "test",
  CLINIC_OS_ENV: "local",
  DATABASE_URL: databaseUrl.href,
  REDIS_URL: redisUrl.href,
  // The fixture issues claims only; it performs no OIDC calls. Match the seeded identity exactly.
  KEYCLOAK_BASE_URL: "http://localhost:8080",
  KEYCLOAK_REALM: "clinic-os-local",
  KEYCLOAK_CLIENT_ID: "clinic-os-web",
  TEMPORAL_ADDRESS: "127.0.0.1:1",
  S3_BUCKET: "clinic-os-synthetic-acceptance",
  S3_REGION: "ap-south-1",
  AWS_REGION: "ap-south-1",
  AWS_DR_REGION: "ap-south-2",
  PILOT_SYNTHETIC_DATA_ONLY: "true",
  CLINIC_OS_API_USE_DEV_AUTH_FIXTURE: "true",
  CLINIC_OS_API_USE_FIXTURE_REPOSITORY: "false",
  CLINIC_OS_API_DEV_SUBJECT: frontDeskOnly ? "seed-receptionist" : "seed-owner"
};
const children = new Set();
const ownsProcessGroups = process.platform !== "win32";
let app;
const extraApps = [];
let roleGateway;
let complete = false;
let stopping;
let buildInputGuard;
const stop = () =>
  (stopping ??= (async () => {
    try {
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        await terminate(child);
      }
      if (roleGateway) await new Promise((resolve) => roleGateway.close(resolve));
      for (const roleApp of extraApps) await roleApp.close();
      await app?.close();
    } finally {
      await buildInputGuard?.restore();
    }
  })());
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(1));
  });
}

try {
  buildInputGuard = createAcceptanceBuildInputGuard(webRoot);
  await buildInputGuard.ready;
  if (stopping) throw new Error("Acceptance interrupted before startup.");
  const { Client } = await import("pg");
  const provenance = new Client({
    connectionString: databaseUrl.href,
    connectionTimeoutMillis: 3000,
    query_timeout: 3000
  });
  try {
    await provenance.connect();
    const marker = await provenance.query(
      "select shobj_description(oid, 'pg_database') as marker from pg_database where datname = current_database()"
    );
    assert.equal(
      marker.rows[0]?.marker,
      `ClinicOS disposable MVP acceptance ${databaseToken}`,
      "Database was not marked by the disposable test provisioner; refusing API startup."
    );
  } finally {
    await provenance.end();
  }
  const { createRuntimeApiNestApplication } = await import("@clinic-os/api");
  ({ app } = await createRuntimeApiNestApplication(apiEnv));
  await app.listen(0, "127.0.0.1");
  const apiPort = app.getHttpServer().address().port;
  let apiBase = `http://127.0.0.1:${apiPort}`;
  if (dailyWorkflow) {
    // Test-only routing chooses among fixed synthetic identities. Each upstream
    // remains the actual Nest API with PostgreSQL authority and permissions.
    const roles = new Map([["owner", apiPort]]);
    for (const role of ["doctor", "assistant", "receptionist", "accountant"]) {
      const runtime = await createRuntimeApiNestApplication({
        ...apiEnv,
        CLINIC_OS_API_DEV_SUBJECT: `seed-${role}`
      });
      extraApps.push(runtime.app);
      await runtime.app.listen(0, "127.0.0.1");
      roles.set(role, runtime.app.getHttpServer().address().port);
    }
    roleGateway = createHttpServer((req, res) => {
      const token = req.headers.authorization;
      const role =
        token === undefined
          ? "owner"
          : /^Bearer local-synthetic-(owner|doctor|assistant|receptionist|accountant)$/.exec(
              token
            )?.[1];
      const port = roles.get(role);
      if (!port) {
        res.writeHead(401);
        res.end();
        return;
      }
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${port}` }
        },
        (reply) => {
          res.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(res);
        }
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
    });
    await new Promise((resolve) => roleGateway.listen(0, "127.0.0.1", resolve));
    apiBase = `http://127.0.0.1:${roleGateway.address().port}`;
  }
  const health = await fetch(`${apiBase}/health/ready`, { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200, "Durable API must be ready before browser acceptance.");
  const healthBody = await health.json();
  const expectedHealth = {
    status: "ready",
    repository_mode: "postgres",
    auth_mode: "local_synthetic_fixture",
    evidence_tier: "E3_durable"
  };
  for (const [field, expected] of Object.entries(expectedHealth)) {
    assert.equal(healthBody[field], expected, `Unexpected API readiness field: ${field}`);
  }
  const me = await fetch(`${apiBase}/v1/me`, { signal: AbortSignal.timeout(5000) });
  assert.equal(me.status, 200, "Synthetic identity must resolve through the real database.");
  await writeFile(
    join(artifacts, "preflight.json"),
    JSON.stringify(
      {
        // Record only the readiness contract proven above, not arbitrary response data.
        health: expectedHealth,
        identity: frontDeskOnly
          ? "database-backed synthetic seed-receptionist"
          : "database-backed synthetic seed-owner",
        authentication: "local development fixture; not real OIDC evidence"
      },
      null,
      2
    )
  );

  const tsconfig = JSON.parse(await readFile(join(webRoot, "tsconfig.json"), "utf8"));
  tsconfig.include = tsconfig.include.map((entry) =>
    entry.replace(".next/types/", ".next-mvp-acceptance/types/")
  );
  tsconfig.exclude = [...tsconfig.exclude, ".next"];
  await writeFile(
    join(webRoot, ".tsconfig.mvp-acceptance.json"),
    JSON.stringify(tsconfig, null, 2)
  );
  const nextCli = join(root, "node_modules/next/dist/bin/next");
  const webEnv = { ...childEnv, NODE_ENV: "production", CLINIC_OS_API_INTERNAL_URL: apiBase };
  await run("web-build", [nextCli, "build"], webRoot, webEnv);
  const webPort = await availablePort();
  const webBase = `http://127.0.0.1:${webPort}`;
  const web = launch(
    "web-server",
    [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(webPort)],
    webRoot,
    webEnv
  );
  for (let attempt = 0; ; attempt++) {
    assert.equal(web.exitCode, null, "Web server exited before readiness.");
    if (attempt >= 120) throw new Error("Web server readiness timed out.");
    try {
      const response = await fetch(`${webBase}/v1/me`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200) break;
    } catch {
      /* bounded startup polling */
    }
    await delay(250);
  }
  const config = join(artifacts, "playwright.config.cjs");
  await writeFile(
    config,
    `module.exports = ${JSON.stringify(
      {
        testDir: join(root, "tests/e2e"),
        testMatch: dailyWorkflow
          ? "daily-workflow-real-stack.spec.ts"
          : frontDeskOnly
            ? "front-desk-real-stack.spec.ts"
            : ["mvp-manual-import-real-stack.spec.ts", "front-desk-real-stack.spec.ts"],
        timeout: dailyWorkflow ? 180000 : 60000,
        workers: 1,
        retries: 0,
        forbidOnly: true,
        outputDir: join(artifacts, "test-results"),
        reporter: [["line"], ["json", { outputFile: join(artifacts, "browser-results.json") }]],
        use: { headless: true, viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" }
      },
      null,
      2
    )};\n`
  );
  await run(
    "browser",
    [join(root, "node_modules/@playwright/test/cli.js"), "test", "--config", config],
    root,
    {
      ...childEnv,
      CLINICOS_WEB_BASE_URL: webBase
    }
  );
  const result = JSON.parse(await readFile(join(artifacts, "browser-results.json"), "utf8"));
  assert.equal(result.stats.unexpected, 0);
  assert.equal(result.stats.skipped, 0, "Acceptance must never pass through a disabled gate.");
  assert.equal(result.stats.flaky, 0);
  assert.equal(
    result.stats.expected,
    dailyWorkflow ? 12 : frontDeskOnly ? 6 : 12,
    "Every real-stack scenario must execute."
  );
  if (dailyWorkflow) await verifyDailyWorkflowEvidence();
  else await verifyFrontDeskEvidence();
  complete = true;
} finally {
  await stop();
  await writeFile(
    join(artifacts, "result.json"),
    JSON.stringify(
      {
        passed: complete,
        ownedApiAndWebStopped: true,
        databaseAndRedisLifecycle: "external disposable test services; not modified by cleanup",
        authentication: "local synthetic identity, not OIDC",
        artifacts
      },
      null,
      2
    )
  );
  console.log(`Real-stack evidence: ${artifacts}`);
}

async function verifyDailyWorkflowEvidence() {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl.href, query_timeout: 5000 });
  try {
    await client.connect();
    await client.query("begin read only");
    await client.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
      [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000101",
        "10000000-0000-4000-8000-000000001001"
      ]
    );
    const {
      rows: [counts]
    } = await client.query(`
      with p as(select id from patients where full_name like 'SyntheticDaily-%'),
      e as(select * from encounters where patient_id in(select id from p))
      select
      (select count(*)::int from p) patients,
      (select count(*)::int from media_assets where patient_id in(select id from p)) patient_files,
      (select count(*)::int from media_assets where patient_id in(select id from p) and media_type='xray') patient_xrays,
      (select count(*)::int from media_assets where patient_id in(select id from p) and scan_status='pending') pending_files,
      (select count(*)::int from media_assets where patient_id in(select id from p) and provenance->'clinicalFile'->>'recordDate'='2015-11-20') dated_historical_files,
      (select count(*)::int from patient_timeline_items where patient_id in(select id from p) and item_type='media_uploaded') file_timeline_events,
      (select count(*)::int from audit_events where patient_id in(select id from p) and action='media.upload_completed') file_audits,
      (select count(*)::int from outbox_events where patient_id in(select id from p) and event_type='media.upload_completed') file_outbox_events,
      (select count(*)::int from e where status='closed') closed_visits,
      (select count(*)::int from appointments where id in(select appointment_id from e) and status='completed') completed_appointments,
      (select count(*)::int from queue_entries where appointment_id in(select appointment_id from e) and status='completed') completed_queue,
      (select count(*)::int from prescriptions where encounter_id in(select id from e) and status='signed') signed_prescriptions,
      (select count(*)::int from invoices where patient_id in(select id from p)) invoices,
      (select coalesce(sum(total_minor),0)::int from invoices where patient_id in(select id from p)) total_minor,
      (select coalesce(sum(paid_minor),0)::int from invoices where patient_id in(select id from p)) paid_minor,
      (select coalesce(sum(balance_minor),0)::int from invoices where patient_id in(select id from p)) balance_minor,
      (select coalesce(sum(credited_minor),0)::int from invoices where patient_id in(select id from p)) credited_minor,
      (select coalesce(sum(refunded_minor),0)::int from invoices where patient_id in(select id from p)) refunded_minor,
      (select count(*)::int from financial_entries where patient_id in(select id from p)) financial_entries,
      (select count(*)::int from audit_events where patient_id in(select id from p) and action='financial.entry.recorded') financial_audits,
      (select count(*)::int from outbox_events where patient_id in(select id from p) and event_type='financial.entry.recorded') financial_events,
      (select count(*)::int from appointment_source_observations o join appointment_imports i on i.id=o.import_id where i.source_system like 'Synthetic Ray %' and o.decision<>'pending') reviewed_observations,
      (select count(*)::int from audit_events where action='migration.observation.recorded' and metadata->>'operation'='createAppointmentImport' and resource_id in(select id::text from appointment_imports where source_system like 'Synthetic Ray %')) source_manifest_audits,
      (select count(*)::int from outbox_events where event_type='appointment.confirmation_requested' and aggregate_id in(select appointment_id from appointment_source_observations where decision='create')) imported_confirmations,
      (select count(*)::int from outbox_events where patient_id in(select id from p) and event_type='appointment.updated' and payload->>'status' in('in_consult','completed')) appointment_events,
      (select count(*)::int from outbox_events where patient_id in(select id from p) and event_type='queue.entry_updated' and payload->>'status' in('in_consult','completed')) queue_events
    `);
    assert.deepEqual(counts, {
      patients: 1,
      patient_files: 53,
      patient_xrays: 1,
      pending_files: 53,
      dated_historical_files: 1,
      file_timeline_events: 53,
      file_audits: 53,
      file_outbox_events: 53,
      closed_visits: 1,
      completed_appointments: 1,
      completed_queue: 1,
      signed_prescriptions: 1,
      invoices: 1,
      total_minor: 100000,
      paid_minor: 50000,
      balance_minor: 0,
      credited_minor: 100000,
      refunded_minor: 10000,
      financial_entries: 9,
      financial_audits: 9,
      financial_events: 9,
      reviewed_observations: 3,
      source_manifest_audits: 1,
      imported_confirmations: 0,
      appointment_events: 2,
      queue_events: 2
    });
    await client.query("commit");
    await writeFile(
      join(artifacts, "daily-database-reconciliation.json"),
      JSON.stringify(counts, null, 2)
    );
  } finally {
    await client.end();
  }
}

async function verifyFrontDeskEvidence() {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: databaseUrl.href, query_timeout: 5000 });
  try {
    await client.connect();
    await client.query("begin read only");
    await client.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.user_id', $3, true)",
      [
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000101",
        frontDeskOnly
          ? "10000000-0000-4000-8000-000000001004"
          : "10000000-0000-4000-8000-000000001001"
      ]
    );
    // Independent aggregate proof catches accepted commands that lost secondary
    // events. Read only the synthetic namespace through the ordinary RLS role.
    const {
      rows: [counts]
    } = await client.query(`
      with desk_patients as (select id from patients where full_name like 'SyntheticDesk%'),
      desk_appointments as (select id from appointments where patient_id in (select id from desk_patients))
      select
        (select count(*)::int from desk_patients) as patients,
        (select count(*)::int from desk_appointments) as appointments,
        (select count(*)::int from audit_events where resource_id in (select id::text from desk_appointments)
          and action = 'appointment.updated' and metadata->>'change' = 'rescheduled') as reschedules,
        (select count(*)::int from outbox_events where aggregate_id in (select id from desk_appointments)
          and event_type = 'appointment.confirmation_requested') as confirmation_requests,
        (select count(*)::int from queue_entries where appointment_id in (select id from desk_appointments)) as queue_entries
    `);
    assert.deepEqual(
      counts,
      { patients: 5, appointments: 5, reschedules: 2, confirmation_requests: 7, queue_entries: 1 },
      "Front-desk records, replay outcomes, audits and confirmation facts must reconcile."
    );
    await client.query("commit");
    await writeFile(
      join(artifacts, "front-desk-reconciliation.json"),
      JSON.stringify(counts, null, 2)
    );
  } finally {
    await client.end();
  }
}

function requiredLocalUrl(name, protocols) {
  assert.ok(process.env[name], `${name} must be explicit; no existing-stack defaults.`);
  const url = new URL(process.env[name]);
  assert.ok(protocols.includes(url.protocol));
  assert.equal(url.hostname, "127.0.0.1", `${name} must use IPv4 loopback.`);
  // Client libraries can interpret query parameters as connection overrides.
  assert.equal(url.search, "", `${name} must not contain connection query overrides.`);
  assert.equal(url.hash, "", `${name} must not contain a fragment.`);
  return url;
}

async function assertAbsent(path) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Remove ambient configuration from the acceptance environment: ${path}`);
}

function launch(name, args, cwd, env) {
  const log = createWriteStream(join(artifacts, `${name}.log`));
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: ownsProcessGroups,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.closed = new Promise((resolvePromise) => {
    child.once("close", (code) => {
      log.end();
      resolvePromise(code);
    });
  });
  child.once("error", (error) => {
    console.error(`${name}: ${error.message}`);
  });
  children.add(child);
  return child;
}

async function run(name, args, cwd, env) {
  console.log(`Running ${name} (log: ${join(artifacts, `${name}.log`)})`);
  const child = launch(name, args, cwd, env);
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void terminate(child);
  }, 15 * 60000);
  try {
    const code = await child.closed;
    assert.equal(timedOut, false, `${name} exceeded its time limit.`);
    assert.equal(code, 0, `${name} failed; inspect its log.`);
  } finally {
    clearTimeout(timeout);
  }
}

function signalChild(child, signal) {
  if (child.pid === undefined) return;
  try {
    if (ownsProcessGroups) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function terminate(child) {
  signalChild(child, "SIGTERM");
  await Promise.race([child.closed, delay(10000)]);
  if (child.exitCode === null && child.signalCode === null) signalChild(child, "SIGKILL");
  await child.closed;
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const port = server.address().port;
  await new Promise((resolvePromise, rejectPromise) =>
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()))
  );
  return port;
}
