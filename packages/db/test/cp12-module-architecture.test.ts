import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  ALL_CLINIC_MODULE_OPERATIONS,
  CLINIC_MODULE_OPERATION_OWNERS
} from "../src/modules/index.ts";

const packageRoot = resolve(import.meta.dirname, "..");
const modulesRoot = resolve(packageRoot, "src/modules");

test("CP12 module operation ownership is complete, exclusive, and parity-locked", () => {
  const legacyRepositorySource = readFileSync(resolve(packageRoot, "src/repositories.ts"), "utf8");
  const interfaceStart = legacyRepositorySource.indexOf(
    "export interface ClinicOperationsRepository"
  );
  assert.notEqual(interfaceStart, -1);
  const interfaceEnd = legacyRepositorySource.indexOf("\n}", interfaceStart);
  assert.notEqual(interfaceEnd, -1);
  const interfaceSource = legacyRepositorySource.slice(interfaceStart, interfaceEnd);
  const legacyOperations = [...interfaceSource.matchAll(/^  ([a-z][A-Za-z0-9]+)\(/gmu)].map(
    (match) => match[1]
  );

  const ownedOperations = Object.values(CLINIC_MODULE_OPERATION_OWNERS).flat();
  assert.equal(legacyOperations.length, 140, "legacy repository inventory changed unexpectedly");
  assert.deepEqual(
    [...new Set(ownedOperations)].sort(),
    [...ownedOperations].sort(),
    "an operation cannot belong to more than one domain"
  );
  assert.deepEqual(
    [...ownedOperations].sort(),
    [...legacyOperations].sort(),
    "every legacy repository operation must have exactly one module owner"
  );
  assert.deepEqual([...ALL_CLINIC_MODULE_OPERATIONS].sort(), [...legacyOperations].sort());
});

test("CP12 domain modules cannot import sibling domains or persistence implementation details", () => {
  const domainDirectories = [
    "ai-scribe",
    "billing",
    "clinic-operations",
    "clinical-care",
    "clinical-media",
    "continuity",
    "data-integrations",
    "dental-treatment",
    "patient-administration",
    "privacy-security",
    "scheduling"
  ];

  for (const domainDirectory of domainDirectories) {
    const directory = resolve(modulesRoot, domainDirectory);
    for (const fileName of readdirSync(directory).filter((candidate) =>
      candidate.endsWith(".ts")
    )) {
      const source = readFileSync(resolve(directory, fileName), "utf8");
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);

      for (const importedPath of imports) {
        const siblingImport =
          importedPath.startsWith("../") && !importedPath.startsWith("../../")
            ? /^\.\.\/([^/]+)/u.exec(importedPath)?.[1]
            : undefined;
        if (siblingImport && siblingImport !== "core") {
          assert.fail(`${domainDirectory}/${fileName} imports sibling module ${importedPath}`);
        }
      }

      assert.doesNotMatch(source, /postgres\.ts|rls\.ts|schema\.ts|migrations\//u);
      assert.doesNotMatch(
        source,
        /\b(select|insert|update|delete)\s+(from|into|[a-z_]+\s+set)\b/iu
      );
    }
  }
});

test("CP12 public module surface does not expose direct scope-binding adapters", () => {
  const publicModuleSource = readFileSync(resolve(modulesRoot, "index.ts"), "utf8");
  assert.doesNotMatch(publicModuleSource, /bind[A-Z][A-Za-z]+Repository/u);
  assert.match(publicModuleSource, /ClinicModuleUnitOfWork/u);
  assert.match(publicModuleSource, /createPostgresClinicModuleUnitOfWork/u);
});
