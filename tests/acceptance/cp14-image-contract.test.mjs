import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const services = [
  { name: "api", command: 'CMD ["node", "apps/api/src/main.ts"]', port: 4100 },
  { name: "web", command: 'CMD ["node", "apps/web/server.js"]', port: 3000 },
  { name: "worker", command: 'CMD ["node", "apps/worker/dist/main.js"]', port: 3001 }
];

test("CP14 application images pin their base, build ARM64-compatible output, and run non-root", async () => {
  for (const service of services) {
    const dockerfile = await readFile(`infra/images/${service.name}/Dockerfile`, "utf8");
    assert.match(
      dockerfile,
      /node:22\.22\.2-alpine@sha256:[a-f0-9]{64}/u,
      `${service.name} must pin the multi-architecture Node base by digest`
    );
    assert.match(dockerfile, /USER 10001:10001/u);
    assert.match(dockerfile, /libcrypto3=3\.5\.7-r0 libssl3=3\.5\.7-r0/u);
    assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/u);
    assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/corepack \/opt\/yarn-/u);
    assert.match(dockerfile, new RegExp(`EXPOSE ${service.port}`, "u"));
    assert.ok(dockerfile.includes(service.command));
    assert.match(dockerfile, /org\.opencontainers\.image\.revision="\$\{SOURCE_REVISION\}"/u);
    assert.doesNotMatch(dockerfile, /(?:FROM|image:)\s+[^\n]*:latest\b/iu);
  }
});

test("CP14 CI builds and scans every application image on an ARM64 runner", async () => {
  const workflow = await readFile(".github/workflows/security.yml", "utf8");
  assert.match(workflow, /runs-on: ubuntu-24\.04-arm/u);
  assert.match(workflow, /service: \[api, web, worker\]/u);
  assert.match(workflow, /--platform linux\/arm64/u);
  assert.match(workflow, /scan-type: image/u);
  assert.match(workflow, /severity: HIGH,CRITICAL/u);
});

test("CP14 Next production build emits a standalone server", async () => {
  const nextConfig = await readFile("apps/web/next.config.mjs", "utf8");
  assert.match(nextConfig, /output: "standalone"/u);
});
