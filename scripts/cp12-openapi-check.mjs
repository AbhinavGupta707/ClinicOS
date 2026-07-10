import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderGeneratedClient,
  renderNativeOpenApi,
  renderNativeRouteInventory
} from "../packages/api-contracts/src/generation.ts";
import { assertNativeRouterInventoryCoverage } from "./cp12-openapi-route-inventory.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected = [
  {
    path: resolve(repositoryRoot, "packages/api-contracts/generated/native-openapi.json"),
    content: renderNativeOpenApi()
  },
  {
    path: resolve(repositoryRoot, "packages/api-contracts/generated/native-route-inventory.json"),
    content: renderNativeRouteInventory()
  },
  {
    path: resolve(repositoryRoot, "packages/api-client-generated/src/index.ts"),
    content: renderGeneratedClient()
  }
];

const drift = [];
for (const artifact of expected) {
  let actual;
  try {
    actual = await readFile(artifact.path, "utf8");
  } catch {
    drift.push(`${artifact.path}: missing`);
    continue;
  }
  if (actual !== artifact.content) drift.push(`${artifact.path}: generated content differs`);
}
if (drift.length > 0) {
  throw new Error(
    `CP12 generated contract drift detected. Run node scripts/cp12-openapi-generate.mjs.\n${drift.join("\n")}`
  );
}
const inventory = await assertNativeRouterInventoryCoverage();
process.stdout.write(
  `CP12 OpenAPI/client drift check passed; ${inventory.actual.length} registered routes are covered.\n`
);
