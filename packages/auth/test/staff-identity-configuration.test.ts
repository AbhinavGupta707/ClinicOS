import assert from "node:assert/strict";
import test from "node:test";
import { readStaffIdentityConfiguration, loopbackOrigin, staffDatabaseUrl } from "../src/index.ts";

const env = {
  CLINICOS_STAFF_SIGN_IN_ENABLED: "true", CLINIC_OS_ENV: "local", PILOT_SYNTHETIC_DATA_ONLY: "true",
  CLINICOS_SESSION_KEY: Buffer.alloc(32, 7).toString("base64"),
  KEYCLOAK_BASE_URL: "http://localhost:8080", KEYCLOAK_REALM: "synthetic", KEYCLOAK_CLIENT_ID: "clinic-os-web-bff",
  REDIS_URL: "redis://127.0.0.1:6379"
};
test("staff identity is unavailable by default and rejects fixtures or unproved production activation", () => {
  assert.equal(readStaffIdentityConfiguration({}), null);
  for (const changes of [
    { CLINIC_OS_ENV: "prod" }, { PILOT_SYNTHETIC_DATA_ONLY: "false" },
    { CLINIC_OS_API_USE_DEV_AUTH_FIXTURE: "true" }, { CLINIC_OS_API_USE_FIXTURE_REPOSITORY: "true" },
    { NEXT_PUBLIC_CLINIC_OS_AUTH_TRANSPORT: "synthetic_bearer" }, { CLINICOS_STAFF_SIGN_IN_ENABLED: "1" },
    { KEYCLOAK_CLIENT_ID: "clinic-os-web" }, { KEYCLOAK_BASE_URL: "https://identity.example" },
    { REDIS_URL: "redis://remote.example:6379" }, { CLINICOS_SESSION_KEY: "weak" },
    { CLINICOS_SESSION_IDLE_SECONDS: "299" }, { CLINICOS_SESSION_IDLE_SECONDS: "1801" }
  ]) assert.throws(() => readStaffIdentityConfiguration({ ...env, ...changes }));
});
test("every process derives matching, purpose-separated identity keys", () => {
  const first = readStaffIdentityConfiguration(env)!; const second = readStaffIdentityConfiguration({ ...env })!;
  assert.equal(first.issuer, "http://localhost:8080/realms/synthetic");
  assert.deepEqual(first.storeKey, second.storeKey);
  assert.equal(new Set([first.storeKey, first.lookupKey, first.csrfKey, first.oauthKey, first.revocationKey,
    first.encryptionKeys[0].key].map((key) => key.toString("hex"))).size, 6);
  assert.equal(first.idleTtlSeconds, 900);
});
test("server origins and database roles cannot hide alternate destinations", () => {
  assert.equal(loopbackOrigin("http://127.0.0.1:3000"), "http://127.0.0.1:3000");
  for (const url of ["http://localhost:3000/", "http://user@localhost:3000", "http://localhost:3000/?x=1", "http://localhost.evil:3000"])
    assert.throws(() => loopbackOrigin(url));
  assert.ok(staffDatabaseUrl("postgresql://clinic_os_runtime:synthetic@127.0.0.1:5432/clinic_os", "clinic_os_runtime"));
  for (const url of ["postgresql://clinic_os:synthetic@127.0.0.1:5432/clinic_os", "postgresql://clinic_os_runtime:synthetic@127.0.0.1:5432/clinic_os?host=remote"])
    assert.throws(() => staffDatabaseUrl(url, "clinic_os_runtime"));
});
