#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ownedUsages = new Map(
  Object.entries({
    "apps/api/src/keycloak-verifier.ts": [
      1,
      "security system-clock boundary; injectable verifier clock due CP12"
    ],
    "apps/api/src/local-fixture.ts": [1, "local/test auth fixture with optional injected now"],
    "apps/api/src/media-storage.ts": [2, "local-only storage simulator; provider clock due CP14"],
    "apps/mobile/src/lib/clock.ts": [
      1,
      "sole mobile system-clock boundary; workflow consumers accept injected clocks due CP16"
    ],
    "apps/worker/src/health/health-server.ts": [
      1,
      "health observation time due CP14 observability clock"
    ],
    "apps/worker/src/health/worker-health.ts": [
      1,
      "health observation time due CP14 observability clock"
    ],
    "apps/worker/src/outbox/processor.ts": [1, "worker system-clock default with injectable now"],
    "packages/auth/src/keycloak.ts": [
      1,
      "token validation accepts explicit now and defaults at auth boundary"
    ],
    "packages/domain/src/clinical.ts": [
      3,
      "pure functions accept explicit evaluatedAt; system defaults retained at boundary"
    ],
    "packages/domain/src/continuity.ts": [
      1,
      "pure function accepts explicit asOf; system default retained at boundary"
    ],
    "packages/domain/src/dental.ts": [1, "pure snapshot builder accepts explicit generatedAt"],
    "packages/domain/src/events.ts": [1, "event builder accepts explicit occurredAt"],
    "packages/domain/src/operations.ts": [
      2,
      "projection builders accept explicit generatedAt/nowIso"
    ],
    "packages/domain/src/privacy.ts": [2, "privacy checks accept explicit now/at"],
    "packages/domain/src/source-attribution.ts": [
      1,
      "attribution builder accepts explicit capturedAt"
    ],
    "packages/domain/src/time.ts": [1, "sole canonical SystemClock implementation"],
    "packages/integrations/src/ai-provider.ts": [
      2,
      "provider adapters expose injected now with system default"
    ],
    "packages/integrations/src/media/aws-private-media-runtime.ts": [
      1,
      "AWS composition boundary exposes injected now and owns the production system-clock default"
    ],
    "packages/integrations/src/media/guardduty-s3-malware-scanner.ts": [
      1,
      "isolated provider attestation boundary exposes injected now and owns the Lambda system-clock default"
    ],
    "packages/integrations/src/media/s3-private-media-provider.ts": [
      1,
      "private media provider exposes an injected now with a system-clock boundary default"
    ],
    "packages/integrations/src/messaging-provider.ts": [
      2,
      "provider adapter default plus unavailable adapter due CP15"
    ],
    "packages/integrations/src/payment-provider.ts": [
      3,
      "provider adapter defaults plus unavailable adapter due CP15"
    ],
    "packages/integrations/src/telephony-provider.ts": [
      3,
      "provider adapters expose injected now with system default"
    ],
    "packages/observability/src/health.ts": [
      2,
      "observability boundary due CP14 clock unification"
    ],
    "packages/observability/src/logger.ts": [1, "structured logger observation timestamp due CP14"],
    "packages/security/src/audit.ts": [
      1,
      "audit builder accepts explicit occurredAt; API always supplies injected clock"
    ]
  })
);

const root = process.cwd();
const sourceFiles = ["apps", "packages"].flatMap((topLevel) =>
  sourceFilesUnder(join(root, topLevel))
);
const observed = new Map();
const currentTimePattern = /new Date\(\)|Date\.now\(\)/gu;

for (const absolutePath of sourceFiles) {
  const contents = readFileSync(absolutePath, "utf8");
  const count = [...contents.matchAll(currentTimePattern)].length;
  if (count > 0) observed.set(relative(root, absolutePath), count);
}

const failures = [];
for (const [path, count] of observed) {
  const ownership = ownedUsages.get(path);
  if (!ownership) failures.push(`${path}: ${count} unowned current-time usage(s)`);
  else if (ownership[0] !== count) {
    failures.push(`${path}: expected ${ownership[0]} owned usage(s), found ${count}`);
  }
}
for (const [path, [expected]] of ownedUsages) {
  if (!observed.has(path))
    failures.push(`${path}: allowlist expected ${expected}, found none; remove stale entry`);
}

if (failures.length > 0) {
  console.error("Current-time ownership guard failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Clock ownership guard passed: ${[...observed.values()].reduce((sum, count) => sum + count, 0)} current-time call sites are explicitly owned; critical API/Postgres operations use injected Clock.`
);

function sourceFilesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "src") files.push(...typescriptFiles(path));
      else files.push(...sourceFilesUnder(path));
    }
  }
  return files;
}

function typescriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...typescriptFiles(path));
    else if (/\.tsx?$/u.test(entry.name)) files.push(path);
  }
  return files;
}
