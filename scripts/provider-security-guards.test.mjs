import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  writeFile,
  readFile,
  symlink,
  unlink,
  stat,
  rm,
  chmod,
  mkdir,
  rename,
  access
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { once } from "node:events";
import { ClinicOsApiClient } from "../packages/api-client-generated/src/index.ts";
import { spawnSync } from "node:child_process";
import { fetchFixture, fixtureRequestUrl } from "./fixture-http.mjs";
import { containsSlackWebhook } from "./secret-patterns.mjs";
import { createAcceptanceBuildInputGuard } from "./mvp-build-inputs.mjs";
import { loadCp4Scenario, validateCp4Scenario } from "./validate-cp4-fixtures.mjs";
import { buildRestoreDrillEvidence } from "./cp9-restore-drill.mjs";

test("fixture content cannot change origin or cause credential-bearing redirects", async () => {
  let calls = 0;
  const transport = async (url, init) => {
    calls++;
    assert.equal(url.origin, "http://127.0.0.1:4000");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    return new Response("ok");
  };
  for (const route of [
    "https://attacker.invalid/v1/a",
    "//attacker.invalid/v1/a",
    "/\\attacker.invalid/a",
    "/v1/a\n",
    "/v1/a#fragment",
    "relative"
  ]) {
    assert.throws(() =>
      fetchFixture(
        "http://127.0.0.1:4000",
        route,
        { headers: { authorization: "synthetic" } },
        transport
      )
    );
  }
  for (const base of [
    "file:///tmp/",
    "http://user:password@127.0.0.1:4000",
    "http://127.0.0.1:4000?token=synthetic"
  ])
    assert.throws(() => fixtureRequestUrl(base, "/v1/a"));
  assert.equal(calls, 0);
  await fetchFixture(
    "http://127.0.0.1:4000",
    "/v1/patients?query=Synthetic",
    { redirect: "follow", headers: { authorization: "synthetic" } },
    transport
  );
  assert.equal(calls, 1);
});

test("secret detection still finds embedded webhooks without emitting their values", () => {
  const prefix = ["https:", "", "hooks.slack.com", "services", ""].join("/");
  assert.equal(containsSlackWebhook(`config = '${prefix}T123/B456/Synthetic'`), true);
  assert.equal(containsSlackWebhook(`${prefix} invalid; next=${prefix}T123`), true);
  assert.equal(containsSlackWebhook(prefix), false);
  assert.equal(containsSlackWebhook(`${prefix}?!`), false);
  assert.equal(
    containsSlackWebhook(prefix.replace("hooks.slack.com", "other.invalid") + "T123"),
    false
  );
});

test("fixture storage detectors reject embedded provider hosts anywhere in JSON", async () => {
  const scenario = await loadCp4Scenario();
  for (const host of ["storage.googleapis.com", "amazonaws.com", "blob.core.windows.net"]) {
    const changed = structuredClone(scenario);
    changed.securityProbe = `prefix HTTPS://${host.toUpperCase()}/synthetic suffix`;
    assert.throws(() => validateCp4Scenario(changed), /storage provider host/);
  }
});

test("build snapshots reject symlinks and restore without following a replaced entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "clinicos-security-inputs-"));
  try {
    const target = join(root, "outside"),
      input = join(root, "next-env.d.ts");
    await writeFile(target, "untouched");
    await symlink(target, input);
    await assert.rejects(createAcceptanceBuildInputGuard(root).ready);
    await unlink(input);
    await writeFile(input, "original");
    await chmod(input, 0o640);
    const guard = createAcceptanceBuildInputGuard(root);
    await guard.ready;
    await unlink(input);
    await symlink(target, input);
    await guard.restore();
    assert.equal(await readFile(target, "utf8"), "untouched");
    assert.equal(await readFile(input, "utf8"), "original");
    assert.equal((await stat(input)).mode & 0o777, 0o640);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("restore evidence cannot include arbitrary region environment values", () => {
  const env = {
    PILOT_SYNTHETIC_DATA_ONLY: "true",
    PILOT_PATIENT_EXPORT_PATH: "fixtures/synthetic/patients.csv",
    PILOT_APPOINTMENT_EXPORT_PATH: "fixtures/synthetic/appointments.csv",
    PILOT_PRICEBOOK_PATH: "fixtures/synthetic/pricebook.csv",
    PILOT_TEMPLATES_DIR: "fixtures/synthetic/templates",
    PILOT_XRAY_SAMPLE_DIR: "fixtures/synthetic/media",
    AWS_REGION: "ap-south-1"
  };
  for (const key of ["AWS_REGION", "AWS_DR_REGION"]) {
    const marker = "synthetic-sensitive-marker";
    assert.throws(
      () => buildRestoreDrillEvidence({ cwd: resolve("."), env: { ...env, [key]: marker } }),
      (error) => !error.message.includes(marker) && /region/.test(error.message)
    );
  }
});

test("adversarial route braces and storage slashes complete in a bounded subprocess", () => {
  const code = `import assert from 'node:assert/strict';
    import {normalizedRouteKey} from './packages/api-contracts/src/native-http-contracts.ts';
    import {S3MetaEncryptedRawBodyStore} from '@clinic-os/integrations';
    const braces='{'.repeat(200000)+'tail';
    assert.equal(normalizedRouteKey('GET',braces),'GET '+braces);
    assert.equal(normalizedRouteKey('GET','/v1/{patientId}/{recordId}'),'GET /v1/{}/{}');
    const common={client:{send(){throw Error('no network')}},bucket:'synthetic-bucket',kmsKeyId:'synthetic-key'};
    assert.throws(()=>new S3MetaEncryptedRawBodyStore({...common,prefix:'/'.repeat(200000)+'x'+'/'.repeat(200000)+'!'}));
    assert.doesNotThrow(()=>new S3MetaEncryptedRawBodyStore({...common,prefix:'/'.repeat(200000)+'safe'+'/'.repeat(200000)}));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: resolve("."),
    encoding: "utf8",
    timeout: 5000
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
});

test("actual HTTP redirects never forward fixture content or credentials", async () => {
  let leaked = 0;
  const destination = createServer((_req, res) => {
    leaked++;
    res.end("unexpected");
  });
  const source = createServer((_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${destination.address().port}/leak` });
    res.end();
  });
  try {
    destination.listen(0, "127.0.0.1");
    await once(destination, "listening");
    source.listen(0, "127.0.0.1");
    await once(source, "listening");
    await assert.rejects(
      fetchFixture(`http://127.0.0.1:${source.address().port}`, "/fixture", {
        method: "POST",
        headers: { authorization: "synthetic-only" },
        body: "synthetic-only"
      })
    );
    assert.equal(leaked, 0);
  } finally {
    await Promise.all(
      [source, destination].map(
        (s) =>
          new Promise((resolve) => {
            s.close(resolve);
            s.closeAllConnections();
          })
      )
    );
  }
});

test("failed filesystem restoration retains a recoverable backup and owner manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "clinicos-restore-failure-"));
  try {
    const target = join(root, "next-env.d.ts");
    await writeFile(target, "original");
    await chmod(target, 0o640);
    const guard = createAcceptanceBuildInputGuard(root);
    await guard.ready;
    await unlink(target);
    await mkdir(target);
    await assert.rejects(guard.restore());
    const lock = join(root, ".cache/mvp-acceptance-inputs.lock");
    assert.equal(await readFile(join(lock, "next-env.d.ts"), "utf8"), "original");
    const owner = JSON.parse(await readFile(join(lock, "owner.json"), "utf8"));
    assert.equal(owner.files[0].mode, 0o640);
    // Restore failure is deliberately manual: after confirming the owner stopped,
    // clear only the offending entry, atomically move the saved replacement and
    // verify bytes/mode before removing this runner's lock.
    await rm(target, { recursive: true });
    await rename(join(lock, "restore-next-env.d.ts"), target);
    assert.equal(await readFile(target, "utf8"), "original");
    assert.equal((await stat(target)).mode & 0o777, 0o640);
    await rm(lock, { recursive: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated client encodes parameters, rejects missing values and bounds malformed templates", async () => {
  const urls = [];
  const client = new ClinicOsApiClient({
    baseUrl: "https://synthetic.invalid",
    fetchImpl: async (url) => {
      urls.push(url);
      return Response.json({ ok: true });
    }
  });
  const operation = {
    method: "GET",
    auth: "none",
    contentType: null,
    bodyEncoding: "json",
    successStatuses: [200],
    pathTemplate: "/v1/{id}",
    input: { path: { id: "a/b?#%{}" } }
  };
  await client.execute(operation);
  assert.equal(urls[0], "https://synthetic.invalid/v1/a%2Fb%3F%23%25%7B%7D");
  await assert.rejects(
    client.execute({ ...operation, input: { path: {} } }),
    /Missing generated-client path parameter/
  );
  await client.execute({
    ...operation,
    pathTemplate: "/v1/{{id}",
    input: { path: { id: "synthetic" } }
  });
  assert.equal(urls[1], "https://synthetic.invalid/v1/{synthetic");
  await client.execute({ ...operation, pathTemplate: "/v1/" + "{".repeat(200000) });
  assert.equal(urls.length, 3);
});

test("restore CLI does not emit arbitrary region values or create evidence for invalid regions", async () => {
  const root = await mkdtemp(join(tmpdir(), "clinicos-region-output-"));
  try {
    for (const key of ["AWS_REGION", "AWS_DR_REGION"]) {
      const marker = "synthetic-sensitive-region-marker",
        out = join(root, key + ".json");
      const result = spawnSync(
        process.execPath,
        ["scripts/cp9-restore-drill.mjs", "--dry-run", "--evidence-out", out],
        {
          cwd: resolve("."),
          encoding: "utf8",
          env: { PATH: process.env.PATH, [key]: marker },
          timeout: 10000
        }
      );
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0);
      assert.equal((result.stdout + result.stderr).includes(marker), false);
      await assert.rejects(access(out), (e) => e.code === "ENOENT");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
