import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  renderGeneratedClient,
  renderNativeOpenApi,
  renderNativeRouteInventory
} from "../packages/api-contracts/src/generation.ts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputs = [
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

for (const output of outputs) {
  await mkdir(dirname(output.path), { recursive: true });
  await writeFile(output.path, output.content, "utf8");
  process.stdout.write(`${output.path}\n`);
}
