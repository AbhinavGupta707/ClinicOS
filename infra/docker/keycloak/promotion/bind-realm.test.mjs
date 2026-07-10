import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bindRealm } from "./bind-realm.mjs";

const promotionDirectory = dirname(fileURLToPath(import.meta.url));
const templatePath = resolve(promotionDirectory, "../production/clinic-os-realm.template.json");
const exampleBindingPath = resolve(promotionDirectory, "runtime-binding.example.json");

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
  assert.deepEqual(
    realm.clients
      .filter((client) => client.standardFlowEnabled)
      .map((client) => client.attributes["pkce.code.challenge.method"]),
    ["S256", "S256"]
  );
});

test("realm promotion rejects wildcard redirects, missing bindings, and secret injection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clinicos-keycloak-negative-"));
  const binding = JSON.parse(await readFile(exampleBindingPath, "utf8"));
  binding.CLINIC_OS_WEB_CALLBACK_URI = "https://app.example.invalid/*";
  const wildcardBinding = join(directory, "wildcard.json");
  await writeFile(wildcardBinding, JSON.stringify(binding));
  await assert.rejects(
    bindRealm({
      templatePath,
      bindingPath: wildcardBinding,
      outputPath: join(directory, "wildcard-realm.json")
    }),
    /exact redirect/
  );

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
});
