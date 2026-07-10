#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRuntimeApiServer } from "@clinic-os/api";

const env = {
  NODE_ENV: "development",
  CLINIC_OS_ENV: "local",
  DATABASE_URL: "postgresql://clinic_os_runtime:clinic_os_runtime@127.0.0.1:5432/clinic_os",
  REDIS_URL: "redis://127.0.0.1:6379",
  TEMPORAL_ADDRESS: "127.0.0.1:7233",
  KEYCLOAK_BASE_URL: "http://127.0.0.1:8080",
  KEYCLOAK_REALM: "clinic-os-local",
  KEYCLOAK_CLIENT_ID: "clinic-os-web",
  S3_REGION: "ap-south-1",
  S3_BUCKET: "clinic-os-local",
  AWS_REGION: "ap-south-1",
  AWS_DR_REGION: "ap-south-2",
  PILOT_SYNTHETIC_DATA_ONLY: "true",
  CLINIC_OS_API_USE_DEV_AUTH_FIXTURE: "true",
  CLINIC_OS_API_USE_FIXTURE_REPOSITORY: "false"
};

const { server } = createRuntimeApiServer(env);
let postgresStopped = false;
let redisStopped = false;

try {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const initial = await health(baseUrl, "/health/startup");
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.status, "ready");
  assert.equal(initial.body.repository_mode, "postgres");
  assert.equal(initial.body.evidence_tier, "E3_durable");
  assert.deepEqual(initial.body.dependencies, [
    { name: "postgres_schema", required: true, status: "ready" },
    { name: "redis_abuse_budget", required: true, status: "ready" },
    { name: "transactional_mutation_coordinator", required: true, status: "ready" }
  ]);

  const identity = await fetch(`${baseUrl}/v1/me`, {
    headers: { "x-clinic-os-dev-subject": "seed-owner" }
  });
  assert.equal(identity.status, 200);

  await runDockerCompose(["stop", "postgres"]);
  postgresStopped = true;

  const unavailable = await pollHealth(baseUrl, 503);
  assert.equal(unavailable.body.status, "unavailable");
  assertDependencyStatus(unavailable.body, "postgres_schema", "unavailable");
  assertDependencyStatus(unavailable.body, "transactional_mutation_coordinator", "unavailable");
  assertDependencyStatus(unavailable.body, "redis_abuse_budget", "ready");
  assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);

  const deniedDuringOutage = await fetch(`${baseUrl}/v1/me`, {
    headers: { "x-clinic-os-dev-subject": "seed-owner" }
  });
  assert.equal(deniedDuringOutage.status, 503);
  assert.equal((await deniedDuringOutage.json()).error.code, "DEPENDENCY_UNAVAILABLE");

  await runDockerCompose(["start", "postgres"]);
  postgresStopped = false;

  const recovered = await pollHealth(baseUrl, 200);
  assert.equal(recovered.body.status, "ready");
  const identityAfterRecovery = await fetch(`${baseUrl}/v1/me`, {
    headers: { "x-clinic-os-dev-subject": "seed-owner" }
  });
  assert.equal(identityAfterRecovery.status, 200);

  await runDockerCompose(["stop", "redis"]);
  redisStopped = true;

  const redisUnavailable = await pollHealth(baseUrl, 503);
  assertDependencyStatus(redisUnavailable.body, "postgres_schema", "ready");
  assertDependencyStatus(redisUnavailable.body, "redis_abuse_budget", "unavailable");
  assertDependencyStatus(redisUnavailable.body, "transactional_mutation_coordinator", "ready");
  assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);
  const deniedDuringRedisOutage = await fetch(`${baseUrl}/v1/me`, {
    headers: { "x-clinic-os-dev-subject": "seed-owner" }
  });
  assert.equal(deniedDuringRedisOutage.status, 503);
  assert.equal((await deniedDuringRedisOutage.json()).error.code, "DEPENDENCY_UNAVAILABLE");

  await runDockerCompose(["start", "redis"]);
  redisStopped = false;
  await pollHealth(baseUrl, 200);
  const identityAfterRedisRecovery = await fetch(`${baseUrl}/v1/me`, {
    headers: { "x-clinic-os-dev-subject": "seed-owner" }
  });
  assert.equal(identityAfterRedisRecovery.status, 200);

  const keycloakEvidence = await verifyKeycloakDependency({
    ...env,
    CLINIC_OS_API_USE_DEV_AUTH_FIXTURE: "false"
  });

  console.log(
    JSON.stringify(
      {
        livenessDuringDatabaseOutage: "pass",
        startupSchemaGate: "pass",
        readinessDependencyLoss: "pass",
        trafficDeniedDuringDependencyLoss: "pass",
        readinessRecovery: "pass",
        redisReadinessDependencyLoss: "pass",
        redisTrafficDeniedDuringLoss: "pass",
        redisReadinessRecovery: "pass",
        durableRepositoryMode: "pass",
        ...keycloakEvidence
      },
      null,
      2
    )
  );
} finally {
  if (postgresStopped) await runDockerCompose(["start", "postgres"]);
  if (redisStopped) await runDockerCompose(["start", "redis"]);
  if (server.listening) {
    await new Promise((resolvePromise, rejectPromise) => {
      server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
    });
  }
}

async function verifyKeycloakDependency(realAuthEnv) {
  const { server: realAuthServer } = createRuntimeApiServer(realAuthEnv);
  let keycloakStopped = false;
  try {
    await new Promise((resolvePromise, rejectPromise) => {
      realAuthServer.once("error", rejectPromise);
      realAuthServer.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = realAuthServer.address();
    assert.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const initial = await pollHealth(baseUrl, 200);
    assert.deepEqual(initial.body.dependencies, [
      { name: "postgres_schema", required: true, status: "ready" },
      { name: "keycloak_jwks", required: true, status: "ready" },
      { name: "identity_session_edge", required: true, status: "ready" },
      { name: "redis_abuse_budget", required: true, status: "ready" },
      { name: "transactional_mutation_coordinator", required: true, status: "ready" }
    ]);

    await runDockerCompose(["stop", "keycloak"]);
    keycloakStopped = true;

    const unavailable = await pollHealth(baseUrl, 503);
    const keycloak = unavailable.body.dependencies.find(
      (dependency) => dependency.name === "keycloak_jwks"
    );
    assert.equal(keycloak?.status, "unavailable");
    assertDependencyStatus(unavailable.body, "identity_session_edge", "ready");
    assert.equal((await fetch(`${baseUrl}/health/live`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/v1/me`)).status, 503);

    await runDockerCompose(["start", "keycloak"]);
    keycloakStopped = false;
    await pollHealth(baseUrl, 200, 60_000);

    return {
      keycloakReadinessDependencyLoss: "pass",
      keycloakTrafficDeniedDuringLoss: "pass",
      keycloakReadinessRecovery: "pass"
    };
  } finally {
    if (keycloakStopped) await runDockerCompose(["start", "keycloak"]);
    if (realAuthServer.listening) {
      await new Promise((resolvePromise, rejectPromise) => {
        realAuthServer.close((error) => (error ? rejectPromise(error) : resolvePromise()));
      });
    }
  }
}

function assertDependencyStatus(body, name, status) {
  const dependency = body.dependencies.find((candidate) => candidate.name === name);
  assert.equal(dependency?.status, status, `${name} dependency status`);
}

async function health(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  return { response, body: await response.json() };
}

async function pollHealth(baseUrl, expectedStatus, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    try {
      latest = await health(baseUrl, "/health/ready");
      if (latest.response.status === expectedStatus) return latest;
    } catch {
      // The API process remains live; retry while the bounded dependency probe settles.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(
    `Readiness did not reach HTTP ${expectedStatus}; latest=${JSON.stringify(latest?.body ?? null)}`
  );
}

function runDockerCompose(args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["compose", ...args], {
      cwd: new URL("..", import.meta.url).pathname,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else
        rejectPromise(new Error(`docker compose failed with code ${code}: ${output.slice(-2000)}`));
    });
  });
}
