import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAcceptanceBuildInputGuard } from "../../scripts/mvp-build-inputs.mjs";

const root = resolve(import.meta.dirname, "../..");
const approvedSyntheticConfig = {
  CLINICOS_MVP_IMPORT_E2E_ENABLED: "true",
  CLINICOS_MVP_TEST_DATABASE_DISPOSABLE: "true",
  PILOT_SYNTHETIC_DATA_ONLY: "true",
  CLINICOS_MVP_DATABASE_TOKEN: "0123456789abcdef0123456789abcdef",
  DATABASE_URL: "postgresql://clinic_os_runtime:synthetic@127.0.0.1:55439/clinic_os",
  REDIS_URL: "redis://127.0.0.1:56389"
};

for (const [name, overrides, expected] of [
  [
    "disabled acceptance",
    { CLINICOS_MVP_IMPORT_E2E_ENABLED: "false" },
    /Explicit real-stack opt-in required/u
  ],
  [
    "unapproved database",
    { CLINICOS_MVP_TEST_DATABASE_DISPOSABLE: "false" },
    /Confirm a disposable synthetic database/u
  ],
  ["non-synthetic data", { PILOT_SYNTHETIC_DATA_ONLY: "false" }, /Synthetic data only/u],
  ["missing database URL", { DATABASE_URL: "" }, /DATABASE_URL must be explicit/u],
  [
    "remote database",
    { DATABASE_URL: "postgresql://clinic_os_runtime:synthetic@database.example.test/clinic_os" },
    /DATABASE_URL must use IPv4 loopback/u
  ],
  [
    "privileged database role",
    { DATABASE_URL: "postgresql://postgres:synthetic@127.0.0.1:55439/clinic_os" },
    /clinic_os_runtime/u
  ],
  [
    "unexpected database",
    { DATABASE_URL: "postgresql://clinic_os_runtime:synthetic@127.0.0.1:55439/valuable_data" },
    /clinic_os/u
  ],
  [
    "remote Redis",
    { REDIS_URL: "redis://cache.example.test:6379" },
    /REDIS_URL must use IPv4 loopback/u
  ],
  [
    "database connection override",
    { DATABASE_URL: `${approvedSyntheticConfig.DATABASE_URL}?host=database.example.test` },
    /DATABASE_URL must not contain connection query overrides/u
  ],
  [
    "Redis connection override",
    { REDIS_URL: `${approvedSyntheticConfig.REDIS_URL}?host=cache.example.test` },
    /REDIS_URL must not contain connection query overrides/u
  ],
  [
    "missing database provenance",
    { CLINICOS_MVP_DATABASE_TOKEN: "" },
    /Disposable database provenance token required/u
  ]
]) {
  test(`real-stack acceptance rejects ${name} before starting services`, () => {
    const result = spawnSync(process.execPath, ["scripts/test-mvp-real-stack.mjs"], {
      cwd: root,
      env: { ...approvedSyntheticConfig, ...overrides },
      encoding: "utf8",
      timeout: 10000
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stdout, /Running web-build|Real-stack evidence/u);
  });
}

for (const failedBuild of [false, true]) {
  test(`acceptance restores original generated inputs after ${failedBuild ? "failed" : "successful"} build`, async () => {
    const web = await mkdtemp(join(tmpdir(), "clinicos-build-inputs-"));
    try {
      await writeFile(join(web, "next-env.d.ts"), "original customized declaration\n");
      const { ready, restore } = createAcceptanceBuildInputGuard(web);
      await ready;
      await assert.rejects(createAcceptanceBuildInputGuard(web).ready, /already owns/);
      try {
        await writeFile(join(web, "next-env.d.ts"), "temporary acceptance path\n");
        await writeFile(join(web, ".tsconfig.mvp-acceptance.json"), "temporary config");
        if (failedBuild) throw new Error("simulated build failure");
      } catch (error) {
        assert.equal(error.message, "simulated build failure");
      } finally {
        await restore();
      }
      assert.equal(
        await readFile(join(web, "next-env.d.ts"), "utf8"),
        "original customized declaration\n"
      );
      await assert.rejects(() => access(join(web, ".tsconfig.mvp-acceptance.json")), {
        code: "ENOENT"
      });
      await restore(); // cleanup is safe to call again
      const next = createAcceptanceBuildInputGuard(web);
      await next.ready;
      await next.restore();
    } finally {
      await rm(web, { recursive: true });
    }
  });
}
test("acceptance restores an originally absent declaration and existing acceptance config", async () => {
  const web = await mkdtemp(join(tmpdir(), "clinicos-build-inputs-"));
  try {
    await writeFile(join(web, ".tsconfig.mvp-acceptance.json"), "previous config");
    const { ready, restore } = createAcceptanceBuildInputGuard(web);
    await ready;
    await writeFile(join(web, "next-env.d.ts"), "generated declaration");
    await writeFile(join(web, ".tsconfig.mvp-acceptance.json"), "replacement");
    await restore();
    await assert.rejects(() => access(join(web, "next-env.d.ts")), { code: "ENOENT" });
    assert.equal(
      await readFile(join(web, ".tsconfig.mvp-acceptance.json"), "utf8"),
      "previous config"
    );
  } finally {
    await rm(web, { recursive: true });
  }
});

test("early shutdown waits for preservation and concurrent cleanup releases the lock once", async () => {
  const web = await mkdtemp(join(tmpdir(), "clinicos-build-inputs-"));
  try {
    await writeFile(join(web, "next-env.d.ts"), "original declaration\n");
    const guard = createAcceptanceBuildInputGuard(web);
    // Deliberately do not await ready: this is the graceful-signal acquisition window.
    await Promise.all([guard.restore(), guard.restore(), guard.ready]);
    assert.equal(await readFile(join(web, "next-env.d.ts"), "utf8"), "original declaration\n");
    await assert.rejects(() => access(join(web, ".cache/mvp-acceptance-inputs.lock")), {
      code: "ENOENT"
    });
    const next = createAcceptanceBuildInputGuard(web);
    await next.ready;
    await next.restore();
  } finally {
    await rm(web, { recursive: true });
  }
});
