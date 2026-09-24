#!/usr/bin/env node
// This acceptance runner mutates ONLY its marked disposable GitHub Actions stack.
// No ambient credentials, patient data, local service lifecycle, or browser token injection.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { chromium } from "@playwright/test";

assert.equal(process.env.GITHUB_ACTIONS, "true", "Disposable CI only.");
assert.equal(process.env.CLINICOS_STAFF_SIGN_IN_E2E_ENABLED, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
const marker = process.env.CLINICOS_MVP_DATABASE_TOKEN ?? "";
assert.match(marker, /^[a-f0-9]{32}$/);
const root = resolve(import.meta.dirname, "..");
const webRoot = join(root, "apps/web");
for (const file of [".env", ".env.local", ".env.production", ".env.production.local"]) {
  try {
    await access(join(webRoot, file));
    throw new Error("Ambient web environment is forbidden.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const artifacts = join(root, "artifacts/staff-sign-in");
await mkdir(artifacts, { recursive: true });
const inherited = Object.fromEntries(
  ["PATH", "HOME", "LANG", "PLAYWRIGHT_BROWSERS_PATH", "npm_config_cache"]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]])
);
const runId = randomBytes(8).toString("hex");
const realm = `staff-ci-${runId}`;
const issuerBase = "http://localhost:8080";
const issuer = `${issuerBase}/realms/${realm}`;
const ownerId = "10000000-0000-4000-8000-000000001001";
const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const databaseUrl = "postgresql://clinic_os_runtime:clinic_os_runtime@127.0.0.1:5432/clinic_os";
// This job created the DB marker; the fixed local bootstrap account is not a provider credential.
const database = new Client({
  connectionString: "postgresql://clinic_os:clinic_os@127.0.0.1:5432/clinic_os",
  connectionTimeoutMillis: 3000,
  query_timeout: 5000
});
const children = new Set();
let browser;
let app;
let realmCreated = false;
let userId;
let adminToken;
let adminExpiresAt = 0;
let stage = "database provenance";
const passed = [];
// Fixed route labels and status codes only: never retain OAuth query strings or form bodies.
const browserResponses = [];
const mark = (name) => {
  passed.push(name);
  console.log(`PASS ${name}`);
};
try {
  await database.connect();
  assert.equal(
    (
      await database.query(
        "select shobj_description(oid, 'pg_database') as marker from pg_database where datname = current_database()"
      )
    ).rows[0].marker,
    `ClinicOS disposable MVP acceptance ${marker}`
  );
  const webPort = await freePort();
  const workerPort = await freePort();
  const webOrigin = `http://127.0.0.1:${webPort}`;
  stage = "Keycloak registration";
  const tokenResponse = await fetch(`${issuerBase}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: "admin",
      password: "admin"
    }),
    signal: AbortSignal.timeout(5000),
    redirect: "error"
  });
  assert.equal(tokenResponse.status, 200);
  adminToken = (await tokenResponse.json()).access_token;
  await admin("/admin/realms", "POST", {
    realm,
    enabled: true,
    sslRequired: "none",
    registrationAllowed: false,
    resetPasswordAllowed: false,
    rememberMe: false,
    accessTokenLifespan: 60,
    ssoSessionIdleTimeout: 900,
    ssoSessionMaxLifespan: 28800,
    revokeRefreshToken: true,
    refreshTokenMaxReuse: 0,
    otpPolicyType: "totp",
    otpPolicyAlgorithm: "HmacSHA1",
    otpPolicyDigits: 6,
    otpPolicyPeriod: 30
  });
  realmCreated = true;
  const realmPath = `/admin/realms/${realm}`;
  await admin(`${realmPath}/authentication/flows/browser/copy`, "POST", {
    newName: "staff-browser"
  });
  const flows = await admin(`${realmPath}/authentication/flows`);
  const flowId = flows.find((flow) => flow.alias === "staff-browser")?.id;
  assert.ok(flowId);
  const executions = await admin(`${realmPath}/authentication/flows/staff-browser/executions`);
  for (const [providerId, value] of [
    ["auth-username-password-form", "pwd"],
    ["auth-otp-form", "otp"]
  ]) {
    const execution = executions.find((item) => item.providerId === providerId);
    assert.ok(execution, `Authenticator ${providerId} must be registered.`);
    await admin(`${realmPath}/authentication/executions/${execution.id}/config`, "POST", {
      alias: `staff-${value}`,
      config: { "default.reference.value": value, "default.reference.maxAge": "28800" }
    });
  }
  await admin(`${realmPath}/clients`, "POST", {
    clientId: "clinic-os-web-bff",
    enabled: true,
    publicClient: false,
    clientAuthenticatorType: "client-secret",
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    redirectUris: [`${webOrigin}/auth/callback`],
    webOrigins: [webOrigin],
    authenticationFlowBindingOverrides: { browser: flowId },
    attributes: {
      "pkce.code.challenge.method": "S256",
      "client.session.max.lifespan": "28800",
      "client.session.idle.timeout": "900",
      "post.logout.redirect.uris": `${webOrigin}/`
    },
    protocolMappers: [
      {
        name: "api-audience",
        protocol: "openid-connect",
        protocolMapper: "oidc-audience-mapper",
        config: {
          "included.custom.audience": "clinic-os-api",
          "access.token.claim": "true",
          "id.token.claim": "false"
        }
      },
      {
        name: "authentication-methods",
        protocol: "openid-connect",
        protocolMapper: "oidc-amr-mapper",
        config: { "access.token.claim": "true", "id.token.claim": "true" }
      }
    ]
  });
  const clientId = (await admin(`${realmPath}/clients?clientId=clinic-os-web-bff`))[0].id;
  const clientSecret = (await admin(`${realmPath}/clients/${clientId}/client-secret`)).value;
  const password = `Ci-only-${randomBytes(24).toString("base64url")}!9`;
  const username = `synthetic-${runId}`;
  await admin(`${realmPath}/users`, "POST", {
    username,
    enabled: true,
    emailVerified: true,
    email: `${username}@example.test`,
    firstName: "Synthetic",
    lastName: "Staff",
    credentials: [{ type: "password", value: password, temporary: false }]
  });
  userId = (await admin(`${realmPath}/users?username=${username}&exact=true`))[0].id;
  await database.query(
    "insert into user_identities (id,user_id,provider,issuer,subject) values ($1,$2,'keycloak',$3,$4)",
    [randomUUID(), ownerId, issuer, userId]
  );
  await delay(1200); // Keycloak auth_time is whole seconds; it must be after the DB mutation cutoff.
  const common = {
    ...inherited,
    CI: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    CLINIC_OS_ENV: "local",
    NODE_ENV: "test",
    PILOT_SYNTHETIC_DATA_ONLY: "true",
    DATABASE_URL: databaseUrl,
    REDIS_URL: "redis://127.0.0.1:6379",
    KEYCLOAK_BASE_URL: issuerBase,
    KEYCLOAK_REALM: realm,
    KEYCLOAK_CLIENT_ID: "clinic-os-web-bff",
    CLINICOS_STAFF_SIGN_IN_ENABLED: "true",
    CLINICOS_SESSION_KEY: randomBytes(32).toString("base64"),
    CLINICOS_IDENTITY_NAMESPACE: `clinicos:staff:ci:${runId}`,
    CLINICOS_SESSION_IDLE_SECONDS: "300",
    CLINIC_OS_API_USE_DEV_AUTH_FIXTURE: "false",
    CLINIC_OS_API_USE_FIXTURE_REPOSITORY: "false"
  };
  stage = "audit worker registration";
  const worker = launch("worker", ["apps/worker/dist/main.js"], root, {
    ...common,
    WORKER_DATABASE_URL: "postgresql://clinic_os_worker:clinic_os_worker@127.0.0.1:5432/clinic_os",
    WORKER_HEALTH_PORT: String(workerPort)
  });
  await ready(`http://127.0.0.1:${workerPort}/health/ready`, worker);
  stage = "durable API registration";
  const { createRuntimeApiNestApplication } = await import("@clinic-os/api");
  ({ app } = await createRuntimeApiNestApplication({
    ...common,
    TEMPORAL_ADDRESS: "127.0.0.1:1",
    S3_BUCKET: "clinic-os-synthetic-acceptance",
    S3_REGION: "ap-south-1",
    AWS_REGION: "ap-south-1",
    AWS_DR_REGION: "ap-south-2"
  }));
  await app.listen(0, "127.0.0.1");
  const apiOrigin = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  const healthResponse = await fetch(`${apiOrigin}/health/ready`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.repository_mode, "postgres");
  assert.equal(health.auth_mode, "keycloak_jwks");
  stage = "web build and activation";
  const webEnv = {
    ...common,
    NODE_ENV: "production",
    NEXT_PUBLIC_CLINIC_OS_ENV: "local",
    CLINIC_OS_API_INTERNAL_URL: apiOrigin,
    CLINICOS_WEB_ORIGIN: webOrigin,
    PORT: String(webPort),
    CLINICOS_OIDC_CLIENT_SECRET: clientSecret
  };
  const build = launch(
    "web-build",
    [join(root, "node_modules/next/dist/bin/next"), "build"],
    webRoot,
    {
      ...inherited,
      CI: "true",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_CLINIC_OS_ENV: "local"
    },
    true
  );
  assert.equal(await build.closed, 0, "Web build failed.");
  const web = launch("web", ["server/start.mts"], webRoot, webEnv);
  await ready(`${webOrigin}/auth/health`, web);
  mark("real worker, API, and BFF ready");
  stage = "exact public auth-route boundaries";
  for (const path of ["/auth/unknown", "/auth/%63allback", "/auth/login/extra"]) {
    const response = await fetch(`${webOrigin}${path}`, { redirect: "manual" });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  const wrongMethod = await fetch(`${webOrigin}/auth/login`, {
    method: "POST",
    redirect: "manual"
  });
  assert.equal(wrongMethod.status, 400);
  assert.equal(wrongMethod.headers.get("set-cookie"), null);
  mark("unknown, encoded and wrong-method auth routes cannot create sessions");
  browser = await chromium.launch({ headless: true });
  let context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const login = async () => {
    const loginStage = stage;
    stage = `${loginStage}: open provider`;
    await page.goto(`${webOrigin}/auth/login`);
    stage = `${loginStage}: credentials form`;
    assert.equal(new URL(page.url()).origin, issuerBase);
    await page.locator("#password").waitFor();
    if (await page.locator("#username").count()) {
      await page.locator("#username").fill(username);
    } else {
      // Keycloak prompt=login may remember the account but still require its password.
      assert.equal((await page.locator("#kc-attempted-username").textContent()).trim(), username);
    }
    await page.locator("#password").fill(password);
    stage = `${loginStage}: submit credentials`;
    await page.locator("#kc-login").click();
    stage = loginStage;
  };
  const observeResponses = (observedContext) =>
    observedContext.on("response", (response) => {
      const url = new URL(response.url());
      let route;
      if (
        url.origin === webOrigin &&
        ["/auth/login", "/auth/callback", "/auth/session"].includes(url.pathname)
      ) {
        route = url.pathname;
      } else if (url.origin === webOrigin && url.pathname === "/") {
        const outcome = url.searchParams.get("signIn");
        route = ["denied", "unavailable"].includes(outcome) ? `sign-in ${outcome}` : "app root";
      } else if (url.origin === issuerBase && response.request().isNavigationRequest()) {
        route = "provider navigation";
      }
      if (route) {
        browserResponses.push({ route, status: response.status() });
        if (browserResponses.length > 40) browserResponses.shift();
      }
    });
  observeResponses(context);
  stage = "unregistered identity denial";
  const removedIdentity = await database.query(
    "delete from user_identities where issuer=$1 and subject=$2",
    [issuer, userId]
  );
  assert.equal(
    removedIdentity.rowCount,
    1,
    "Unregistered-user trial must remove its exact identity mapping."
  );
  await login();
  await page.waitForURL(`${webOrigin}/?signIn=denied`);
  assert.equal((await context.request.get(`${webOrigin}/auth/session`)).status(), 401);
  mark("unregistered identity denied without a browser session");
  await database.query(
    "insert into user_identities (id,user_id,provider,issuer,subject) values ($1,$2,'keycloak',$3,$4)",
    [randomUUID(), ownerId, issuer, userId]
  );
  await delay(1200);
  stage = "missing MFA denial";
  await login();
  await page.waitForURL(`${webOrigin}/?signIn=denied`);
  assert.equal((await context.request.get(`${webOrigin}/auth/session`)).status(), 401);
  mark("password-only owner denied");
  stage = "real TOTP enrollment";
  await admin(`${realmPath}/users/${userId}/logout`, "POST");
  await admin(`${realmPath}/users/${userId}`, "PUT", { requiredActions: ["CONFIGURE_TOTP"] });
  await login();
  // Keycloak's official enrollment page exposes the manual seed to the user; keep it in memory only.
  await page.locator("#mode-manual").click();
  const otpSecret = (await page.locator("#kc-totp-secret-key").textContent()).replace(/\s/g, "");
  assert.match(otpSecret, /^[A-Z2-7]+$/);
  await page.locator("#totp").fill(totp(otpSecret));
  if (await page.locator("#userLabel").count())
    await page.locator("#userLabel").fill("Synthetic acceptance");
  await page.locator("#saveTOTPBtn").click();
  await page.waitForURL((url) => url.origin === webOrigin);
  // Enrollment is not claimed as a second-factor authentication execution.
  await admin(`${realmPath}/users/${userId}/logout`, "POST");
  await context.close();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  observeResponses(context);
  page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await delay(31_000); // Avoid reusing the enrollment OTP.
  stage = "PKCE password and TOTP sign-in";
  await login();
  await page.locator("#otp").fill(totp(otpSecret));
  await page.locator("#kc-login").click();
  await page.waitForURL(`${webOrigin}/`);
  const session = await (await context.request.get(`${webOrigin}/auth/session`)).json();
  assert.equal(session.authenticated, true);
  assert.equal(session.mfaVerified, true);
  assert.ok(session.authenticationMethods.includes("pwd"));
  assert.ok(session.authenticationMethods.some((m) => ["otp", "totp"].includes(m)));
  assert.ok(!/access_token|refresh_token|id_token/.test(JSON.stringify(session)));
  const cookie = (await context.cookies(webOrigin)).find(
    (value) => value.name === "clinicos_session"
  );
  assert.ok(cookie?.httpOnly);
  assert.equal(cookie.sameSite, "Lax");
  assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
  const me = await context.request.get(`${webOrigin}/bff/v1/me`);
  assert.equal(me.status(), 200);
  await page.getByText("Clinic session active", { exact: true }).waitFor();
  await page.getByTestId("cp13-front-office-day").waitFor();
  await page.screenshot({
    path: join(artifacts, "signed-in-desktop.png"),
    fullPage: true,
    animations: "disabled"
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: "Close navigation", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".clinic-nav").getBoundingClientRect().right <= 0
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Sign out", exact: true }).click({ trial: true });
  await page.screenshot({
    path: join(artifacts, "signed-in-mobile.png"),
    fullPage: true,
    animations: "disabled"
  });
  mark("real PKCE, TOTP, cookie-only API, desktop and mobile");
  stage = "clinic workflows through the cookie BFF";
  await page.goto(`${webOrigin}/surface/patients`);
  await page.getByLabel("Search by name or phone").fill("Rhea Synthetic");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .locator(".cp13-patient-search > ul button")
    .filter({ hasText: "Rhea Synthetic" })
    .click();
  await page.getByTestId("cp13-front-office-patient").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Open full profile" }).click();
  await page.getByTestId("cp13-clinical-runtime").waitFor();
  await page.goto(`${webOrigin}/surface/migration-review`);
  await page.getByTestId("cp7-migration-operations").waitFor();
  await page.getByTestId("migration-source-system").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const otherClinic = (
    await database.query(
      "select id from clinics where slug='isolation-dental-clinic' and tenant_id <> $1",
      [tenantId]
    )
  ).rows[0]?.id;
  assert.ok(otherClinic, "A second synthetic tenant must exist for isolation acceptance.");
  assert.equal(
    (
      await context.request.get(`${webOrigin}/bff/v1/patients?query=Ira`, {
        headers: { "X-Clinic-Id": otherClinic }
      })
    ).status(),
    403
  );
  mark("Today, patient search/profile, import controls and cross-tenant denial");
  stage = "CSRF and authenticated API validation";
  const endpoint = `${webOrigin}/bff/v1/migration-batches`;
  const body = { source_system: "synthetic-sign-in", entity_type: "patients" };
  const rejected = await context.request.post(endpoint, {
    data: body,
    headers: { Origin: webOrigin, "X-Clinic-Id": clinicId }
  });
  assert.equal(rejected.status(), 403);
  // Empty invalid command proves CSRF reaches real API schema validation, without adding patient data.
  const admitted = await context.request.post(endpoint, {
    data: {},
    headers: {
      Origin: webOrigin,
      "X-Clinic-Id": clinicId,
      "X-CSRF-Token": session.csrfToken,
      "Idempotency-Key": randomUUID()
    }
  });
  assert.equal(admitted.status(), 422);
  assert.equal((await admitted.json()).error.code, "VALIDATION_ERROR");
  assert.equal((await context.request.get(`${webOrigin}/v1/me`)).status(), 404);
  mark("CSRF rejection and authenticated API validation");
  stage = "real refresh";
  // Beyond the realm's 60s access lifetime AND the API's 30s clock allowance.
  // Continued access now requires a real refresh, not just reuse of the first token.
  await delay(95_000);
  assert.equal((await context.request.get(`${webOrigin}/bff/v1/me`)).status(), 200);
  mark("Keycloak refresh beyond the original access-token expiry");
  stage = "logout and revoked-cookie rejection";
  const logout = await context.request.post(`${webOrigin}/auth/logout`, {
    data: {},
    headers: { Origin: webOrigin, "X-CSRF-Token": session.csrfToken }
  });
  assert.equal(logout.status(), 204);
  await context.addCookies([cookie]);
  assert.equal((await context.request.get(`${webOrigin}/bff/v1/me`)).status(), 401);
  mark("provider logout and old cookie denied");
  await context.clearCookies();
  stage = "re-login after logout";
  await login();
  await page.locator("#otp").fill(totp(otpSecret));
  await page.locator("#kc-login").click();
  await page.waitForURL(`${webOrigin}/`);
  assert.equal((await context.request.get(`${webOrigin}/bff/v1/me`)).status(), 200);
  mark("new login after logout");
  const beforeRevocation = (await context.cookies(webOrigin)).find(
    (value) => value.name === "clinicos_session"
  );
  assert.ok(beforeRevocation);
  stage = "committed authority revoke and regrant";
  await database.query(
    "update memberships set status='revoked' where tenant_id=$1 and user_id=$2",
    [tenantId, ownerId]
  );
  assert.equal((await context.request.get(`${webOrigin}/bff/v1/me`)).status(), 401);
  await database.query("update memberships set status='active' where tenant_id=$1 and user_id=$2", [
    tenantId,
    ownerId
  ]);
  await context.addCookies([beforeRevocation]);
  assert.equal((await context.request.get(`${webOrigin}/bff/v1/me`)).status(), 401);
  mark("authority revoke/regrant cannot revive browser session");
  stage = "audit delivery";
  for (let i = 0; ; i++) {
    const evidence = (
      await database.query(
        "select action,reason_code from identity_security_audit_events where subject=$1 and issuer=$2",
        [userId, issuer]
      )
    ).rows;
    if (
      evidence.some((event) => event.action === "auth.mfa.denied") &&
      evidence.some((event) => event.action === "auth.session.created") &&
      evidence.some(
        (event) => event.action === "auth.session.revoked" && event.reason_code === "logout"
      ) &&
      evidence.some(
        (event) =>
          event.action === "auth.session.revoked" &&
          ["membership_revoked", "authority_changed"].includes(event.reason_code)
      )
    )
      break;
    assert.ok(i < 40, "Global identity evidence must reach PostgreSQL.");
    await delay(250);
  }
  mark("global audit delivered to PostgreSQL");
  stage = "worker failure and recovery";
  const logoutCount = async () =>
    Number(
      (
        await database.query(
          "select count(*) as count from identity_security_audit_events where subject=$1 and issuer=$2 and action='auth.session.revoked' and reason_code='logout'",
          [userId, issuer]
        )
      ).rows[0].count
    );
  const beforeOutageLogouts = await logoutCount();
  await context.clearCookies();
  await delay(31_000); // Fresh OTP and post-authority-change authentication.
  await login();
  await page.locator("#otp").fill(totp(otpSecret));
  await page.locator("#kc-login").click();
  await page.waitForURL(`${webOrigin}/`);
  // The session badge is intentionally hidden on mobile; require loaded clinic data.
  await page.getByTestId("cp13-front-office-day").waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click({ trial: true });
  stage = "graceful audit worker stop";
  await terminate(worker);
  assert.equal(worker.exitCode, 0, "Audit worker must drain and shut down gracefully.");
  stage = "audit outage blocks clinic requests";
  await delay(11_000);
  assert.equal((await fetch(`${webOrigin}/auth/health`)).status, 503);
  assert.equal((await context.request.get(`${webOrigin}/bff/v1/me`)).status(), 503);
  stage = "UI logout while audit delivery is paused";
  // Real UI sign-out still records revocation and durable audits when delivery is paused.
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByText("Your ClinicOS session is closed.", { exact: true }).waitFor();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  assert.equal(await page.getByText("Clinic session active", { exact: true }).count(), 0);
  assert.equal((await context.request.get(`${webOrigin}/auth/session`)).status(), 401);
  mark("sign-out during audit delivery outage keeps clinic content closed");
  stage = "audit delivery recovery";
  const recoveredWorker = launch("worker-recovery", ["apps/worker/dist/main.js"], root, {
    ...common,
    WORKER_DATABASE_URL: "postgresql://clinic_os_worker:clinic_os_worker@127.0.0.1:5432/clinic_os",
    WORKER_HEALTH_PORT: String(workerPort)
  });
  await ready(`http://127.0.0.1:${workerPort}/health/ready`, recoveredWorker);
  await ready(`${webOrigin}/auth/health`, web);
  for (let i = 0; (await logoutCount()) <= beforeOutageLogouts; i++) {
    assert.ok(i < 40, "Outage logout audit must be delivered after recovery.");
    await delay(250);
  }
  mark("audit worker outage blocks admission and recovers");
  stage = "real idle-session expiry";
  await context.clearCookies();
  await delay(31_000);
  await login();
  await page.locator("#otp").fill(totp(otpSecret));
  await page.locator("#kc-login").click();
  await page.waitForURL(`${webOrigin}/`);
  await page.getByTestId("cp13-front-office-day").waitFor();
  const idleCookie = (await context.cookies(webOrigin)).find(
    (value) => value.name === "clinicos_session"
  );
  assert.ok(idleCookie);
  await page.goto("about:blank"); // No background app activity can extend this idle session.
  await delay(305_000);
  // Re-present the token even if the browser's cookie clock expired it.
  await context.addCookies([{ ...idleCookie, expires: Math.floor(Date.now() / 1000) + 60 }]);
  assert.equal((await context.request.get(`${webOrigin}/bff/v1/me`)).status(), 401);
  mark("real five-minute idle-session expiry");
  stage = "complete";
} catch (error) {
  // Never persist browser traces/HTML, callback URLs, passwords, tokens, or TOTP enrollment screens.
  console.error(`Staff sign-in acceptance failed during: ${stage}; ${error.name}`);
  process.exitCode = 1;
} finally {
  const cleanup = [];
  const attempt = async (name, operation) => {
    try {
      await operation();
      cleanup.push({ name, passed: true });
    } catch {
      cleanup.push({ name, passed: false });
      process.exitCode = 1;
    }
  };
  await attempt("browser", async () => {
    await browser?.close();
  });
  for (const child of children) await attempt("owned process", () => terminate(child));
  await attempt("API", async () => {
    await app?.close();
  });
  if (userId) {
    await attempt("synthetic membership", () =>
      database.query("update memberships set status='active' where tenant_id=$1 and user_id=$2", [
        tenantId,
        ownerId
      ])
    );
    await attempt("synthetic identity", () =>
      database.query("delete from user_identities where issuer=$1 and subject=$2", [issuer, userId])
    );
  }
  if (realmCreated)
    await attempt("synthetic realm", () => admin(`/admin/realms/${realm}`, "DELETE"));
  await attempt("database connection", () => database.end());
  await writeFile(
    join(artifacts, "result.json"),
    JSON.stringify(
      {
        passed: stage === "complete" && cleanup.every((item) => item.passed),
        stage,
        checks: passed,
        browserResponses,
        cleanup,
        data: "synthetic disposable CI only; authority cutoffs intentionally advance; stack discarded with runner",
        productionProxy: "not activated",
        liveClinic: "not tested"
      },
      null,
      2
    )
  );
}

async function admin(path, method = "GET", body) {
  if (Date.now() >= adminExpiresAt) {
    const response = await fetch(`${issuerBase}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: "admin",
        password: "admin"
      }),
      signal: AbortSignal.timeout(5000),
      redirect: "error"
    });
    assert.equal(response.status, 200, "Disposable administrator session unavailable.");
    const token = await response.json();
    adminToken = token.access_token;
    adminExpiresAt = Date.now() + Math.max(1, token.expires_in - 10) * 1000;
  }
  const response = await fetch(`${issuerBase}${path}`, {
    method,
    headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(5000)
  });
  assert.ok(response.ok, `Keycloak Admin operation failed (${method}, ${response.status}).`);
  if (response.status === 204 || response.status === 201) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
function launch(name, args, cwd, env, retainBuildLog = false) {
  const child = spawn(process.execPath, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  // Build diagnostics contain no runtime identity. Runtime logs are not retained in auth artifacts.
  if (retainBuildLog) {
    const log = createWriteStream(join(artifacts, `${name}.log`));
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once("close", () => log.end());
  } else {
    child.stdout.resume();
    const log = createWriteStream(join(artifacts, `${name}-errors.log`));
    child.stderr.on("data", (chunk) => {
      let text = chunk.toString();
      for (const [key, value] of Object.entries(env)) {
        if (/SECRET|TOKEN|KEY$|PASSWORD/.test(key) && value)
          text = text.split(value).join("[redacted]");
      }
      text = text
        .replace(/(?:https?|postgres(?:ql)?|redis):\/\/[^\s"'<>]+/g, "[redacted-url]")
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]");
      log.write(text);
    });
    child.once("close", () => log.end());
  }
  child.closed = new Promise((resolvePromise, reject) => {
    child.once("close", resolvePromise);
    child.once("error", reject);
  });
  children.add(child);
  return child;
}
async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await Promise.race([child.closed, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  await child.closed;
}
async function ready(url, child) {
  let diagnosis = [];
  for (let attempt = 0; attempt < 120; attempt++) {
    assert.equal(child.exitCode, null, "Owned process exited before readiness.");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.status === 200) return;
      const payload = await response.json();
      diagnosis = (payload.checks ?? []).map((check) => ({
        name: /^[a-z_]{1,80}$/.test(check.name) ? check.name : "other",
        status: ["healthy", "degraded", "unhealthy"].includes(check.status)
          ? check.status
          : "unknown"
      }));
    } catch {
      /* bounded poll */
    }
    await delay(250);
  }
  console.error(JSON.stringify({ stage, health: diagnosis }));
  throw new Error("Readiness timed out.");
}
async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const port = server.address().port;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}
function totp(secret) {
  let bits = "";
  for (const char of secret)
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}
