import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bindRealm, validateRealm } from "./bind-realm.mjs";

const promotionDirectory = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(promotionDirectory, "../production/clinic-os-realm.template.json");
const exampleBindingPath = resolve(promotionDirectory, "runtime-binding.example.json");
const privilegedMfaBoundaryPath = resolve(
  promotionDirectory,
  "../operations/privileged-mfa-boundary.json"
);
const topologyPath = resolve(promotionDirectory, "../topology/production-ha.json");

test("realm promotion is deterministic, exact-bound, and secret-free", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clinicos-keycloak-promotion-"));
  const first = join(directory, "first.json");
  const second = join(directory, "second.json");
  const firstOutput = await bindRealm({
    templatePath,
    bindingPath: exampleBindingPath,
    outputPath: first
  });
  const secondOutput = await bindRealm({
    templatePath,
    bindingPath: exampleBindingPath,
    outputPath: second
  });
  assert.equal(firstOutput, secondOutput);
  assert.equal(firstOutput, await readFile(first, "utf8"));
  assert.equal(firstOutput.includes("${"), false);
  assert.equal(/"secret"\s*:/i.test(firstOutput), false);
  const realm = JSON.parse(firstOutput);
  assert.equal(realm.revokeRefreshToken, true);
  assert.equal(realm.refreshTokenMaxReuse, 0);
  assert.equal(
    realm.clients.find((client) => client.clientId === "clinic-os-web-bff").attributes[
      "post.logout.redirect.uris"
    ],
    "https://app.staging.example.invalid/auth/signed-out"
  );
  assert.deepEqual(
    realm.clients
      .filter((client) => client.standardFlowEnabled)
      .map((client) => client.attributes["pkce.code.challenge.method"]),
    ["S256", "S256"]
  );
});

test("realm promotion accepts only the approved exact mobile custom scheme", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clinicos-keycloak-custom-mobile-"));
  const binding = JSON.parse(await readFile(exampleBindingPath, "utf8"));
  binding.CLINIC_OS_MOBILE_REDIRECT_URI = "clinic-os://auth/callback";
  const bindingPath = join(directory, "binding.json");
  await writeFile(bindingPath, JSON.stringify(binding));
  const realm = JSON.parse(
    await bindRealm({
      templatePath,
      bindingPath,
      outputPath: join(directory, "realm.json")
    })
  );
  assert.deepEqual(
    realm.clients.find((client) => client.clientId === "clinic-os-mobile").redirectUris,
    ["clinic-os://auth/callback"]
  );
});

test("realm promotion rejects malformed public realm, web, and mobile bindings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clinicos-keycloak-negative-"));
  const base = JSON.parse(await readFile(exampleBindingPath, "utf8"));
  const cases = [
    ["realm-uppercase", "CLINIC_OS_REALM", "Clinic-OS", /lowercase slug/],
    ["realm-path", "CLINIC_OS_REALM", "clinic/os", /lowercase slug/],
    ["origin-http", "CLINIC_OS_WEB_ORIGIN", "http://app.example.invalid", /HTTPS origin/],
    ["origin-path", "CLINIC_OS_WEB_ORIGIN", "https://app.example.invalid/path", /HTTPS origin/],
    [
      "callback-other-origin",
      "CLINIC_OS_WEB_CALLBACK_URI",
      "https://attacker.example/auth/callback",
      /configured web origin/
    ],
    [
      "callback-query",
      "CLINIC_OS_WEB_CALLBACK_URI",
      "https://app.staging.example.invalid/auth/callback?next=/",
      /userinfo, query, or fragment/
    ],
    [
      "logout-fragment",
      "CLINIC_OS_WEB_POST_LOGOUT_URI",
      "https://app.staging.example.invalid/auth/signed-out#fragment",
      /userinfo, query, or fragment/
    ],
    [
      "mobile-http",
      "CLINIC_OS_MOBILE_REDIRECT_URI",
      "http://mobile.example.invalid/auth/callback",
      /approved claimed HTTPS/
    ],
    [
      "mobile-custom-query",
      "CLINIC_OS_MOBILE_REDIRECT_URI",
      "clinic-os://auth/callback?token=bad",
      /userinfo, query, or fragment/
    ],
    [
      "mobile-wildcard",
      "CLINIC_OS_MOBILE_REDIRECT_URI",
      "https://mobile.example.invalid/*",
      /malformed or unbounded/
    ],
    [
      "mobile-userinfo",
      "CLINIC_OS_MOBILE_REDIRECT_URI",
      "https://user@mobile.example.invalid/auth/callback",
      /userinfo, query, or fragment/
    ]
  ];
  for (const [name, key, value, expected] of cases) {
    const binding = { ...base, [key]: value };
    const bindingPath = join(directory, `${name}.json`);
    await writeFile(bindingPath, JSON.stringify(binding));
    await assert.rejects(
      bindRealm({
        templatePath,
        bindingPath,
        outputPath: join(directory, `${name}-realm.json`)
      }),
      expected
    );
  }
});

test("realm promotion rejects missing, extra, secret, and post-logout drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clinicos-keycloak-shape-negative-"));
  const binding = JSON.parse(await readFile(exampleBindingPath, "utf8"));

  delete binding.CLINIC_OS_MOBILE_REDIRECT_URI;
  const missingBinding = join(directory, "missing.json");
  await writeFile(missingBinding, JSON.stringify(binding));
  await assert.rejects(
    bindRealm({
      templatePath,
      bindingPath: missingBinding,
      outputPath: join(directory, "missing-realm.json")
    }),
    /missing=/
  );

  binding.CLINIC_OS_MOBILE_REDIRECT_URI = "clinic-os://auth/callback";
  binding.KEYCLOAK_CLIENT_SECRET = "must-not-enter-realm-promotion";
  const secretBinding = join(directory, "secret.json");
  await writeFile(secretBinding, JSON.stringify(binding));
  await assert.rejects(
    bindRealm({
      templatePath,
      bindingPath: secretBinding,
      outputPath: join(directory, "secret-realm.json")
    }),
    /extra=/
  );

  const validBinding = JSON.parse(await readFile(exampleBindingPath, "utf8"));
  const renderedPath = join(directory, "rendered.json");
  const rendered = JSON.parse(
    await bindRealm({ templatePath, bindingPath: exampleBindingPath, outputPath: renderedPath })
  );
  rendered.clients.find((client) => client.clientId === "clinic-os-web-bff").attributes[
    "post.logout.redirect.uris"
  ] = "https://app.staging.example.invalid/drift";
  assert.throws(() => validateRealm(rendered, validBinding), /web-origin policy/);
});

test("privileged product, administrator, and break-glass MFA boundaries are explicit", async () => {
  const boundary = JSON.parse(await readFile(privilegedMfaBoundaryPath, "utf8"));
  const topology = JSON.parse(await readFile(topologyPath, "utf8"));
  assert.equal(boundary.productWorkforce.realmTemplateEnforcesRoleConditionalMfa, false);
  assert.equal(boundary.productWorkforce.applicationMfaAssurancePolicyRequired, true);
  assert.equal(boundary.productWorkforce.defaultWeakSingleAmrDenied, true);
  assert.equal(
    boundary.productWorkforce.acrAcceptanceRequiresExactAllowlistAndReviewedRealmEvidence,
    true
  );
  assert.equal(boundary.keycloakAdministration.productionRealmTemplateEnforcesAdminMfa, false);
  assert.equal(boundary.keycloakAdministration.managementRealmOrFederatedOperatorMfaRequired, true);
  assert.equal(boundary.keycloakAdministration.failReadinessUntilRuntimeMfaEvidenceExists, true);
  assert.equal(boundary.clinicalBreakGlass.applicationMfaAssurancePolicyRequired, true);
  assert.equal(boundary.clinicalBreakGlass.weakSingleAmrAndUnprovedAcrDenied, true);
  assert.equal(topology.network.adminReadinessRequiresRuntimeMfaEvidence, true);
  assert.equal(topology.network.adminMfaBoundaryPolicy, "operations/privileged-mfa-boundary.json");
});
