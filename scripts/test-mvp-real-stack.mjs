#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// This runner owns only its API/web processes. Database provisioning is a separate,
// explicit action: use a disposable, migrated and seeded local Postgres plus Redis.
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
  CLINIC_OS_API_DEV_SUBJECT: "seed-owner"
};
const children = new Set();
const ownsProcessGroups = process.platform !== "win32";
let app;
let complete = false;
let stopping;
const stop = () =>
  (stopping ??= (async () => {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      await terminate(child);
    }
    await app?.close();
  })());
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stop().finally(() => process.exit(1));
  });
}

try {
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
  const apiBase = `http://127.0.0.1:${apiPort}`;
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
        identity: "database-backed synthetic seed-owner",
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
        testMatch: "mvp-manual-import-real-stack.spec.ts",
        timeout: 60000,
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
  assert.ok(result.stats.expected >= 4, "Every real-stack scenario must execute.");
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
