import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  validateRestoreManifest,
  normalizeSchemaDump,
  assertRestoreInventory,
  runSyntheticDatabaseRestore
} from "./synthetic-database-restore.mjs";
const base = "/Volumes/Spectra/Projects/ClinicOS/.audit-spectra-retirement-20260920/test-owned";
const manifest = () => ({
  version: 1,
  syntheticOnly: true,
  token: "a".repeat(32),
  pgBin: "/opt/postgres/bin",
  source: { port: 32001, pid: 10001, dataDirectory: base + "/source" },
  target: { port: 32002, pid: 10002, dataDirectory: base + "/target" }
});
test("restore rejects shared targets, escaped directories and absent synthetic provenance", () => {
  assert.doesNotThrow(() => validateRestoreManifest(manifest(), base));
  for (const change of [
    (m) => {
      m.target.port = m.source.port;
    },
    (m) => {
      m.target.pid = m.source.pid;
    },
    (m) => {
      m.target.dataDirectory = base + "/../other";
    },
    (m) => {
      m.syntheticOnly = false;
    },
    (m) => {
      m.token = "";
    },
    (m) => {
      m.pgBin = "pg";
    }
  ]) {
    const m = manifest();
    change(m);
    assert.throws(() => validateRestoreManifest(m, base));
  }
});
test("schema comparison removes only outer protection tokens and retains security DDL", () => {
  assert.equal(
    normalizeSchemaDump(
      "-- version\n\\restrict Ab12\nALTER TABLE p FORCE ROW LEVEL SECURITY;\n\\unrestrict Ab12"
    ),
    "-- version\nALTER TABLE p FORCE ROW LEVEL SECURITY;"
  );
  assert.notEqual(
    normalizeSchemaDump("ALTER TABLE p FORCE ROW LEVEL SECURITY;"),
    normalizeSchemaDump("ALTER TABLE p DISABLE ROW LEVEL SECURITY;")
  );
});
test("restore evidence fails on altered rows, missing tables, schema, sequence and document changes", () => {
  const source = {
    tables: [{ name: "patients", count: 5000, digest: "a" }],
    schemaDigest: "s",
    sequences: [{ name: "versions", last_value: "5001", is_called: true }],
    documents: [{ id: "one", digest: "h" }]
  };
  assert.doesNotThrow(() => assertRestoreInventory(source, structuredClone(source)));
  for (const change of [
    (m) => {
      m.tables[0].digest = "b";
    },
    (m) => {
      m.tables = [];
    },
    (m) => {
      m.schemaDigest = "changed";
    },
    (m) => {
      m.sequences[0].last_value = "1";
    },
    (m) => {
      m.documents[0].digest = "changed";
    }
  ]) {
    const target = structuredClone(source);
    change(target);
    assert.throws(() => assertRestoreInventory(source, target));
  }
});

test("schema digest preserves multiline SQL data even when it resembles comments", () => {
  const sql = (v) =>
    `CREATE FUNCTION x() RETURNS text AS $$\nBEGIN RETURN '\n-- ${v}\n'; END;\n$$ LANGUAGE plpgsql;`;
  assert.notEqual(normalizeSchemaDump(sql("first")), normalizeSchemaDump(sql("second")));
});

test("rejected restore preflight replaces earlier success with explicit failure", async () => {
  const parent = resolve(import.meta.dirname, "../.audit-spectra-retirement-20260920");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "restore-preflight-test-"));
  const keys = ["PILOT_SYNTHETIC_DATA_ONLY", "CLINICOS_MVP_TEST_DATABASE_DISPOSABLE"];
  const previous = keys.map((key) => process.env[key]);
  keys.forEach((key) => {
    process.env[key] = "true";
  });
  try {
    const evidence = join(directory, "database-restore-evidence.json");
    const path = join(directory, "manifest.json");
    for (const contents of ["not JSON", JSON.stringify({ ...manifest(), syntheticOnly: false })]) {
      await writeFile(evidence, JSON.stringify({ status: "passed" }));
      await writeFile(path, contents);
      await assert.rejects(() => runSyntheticDatabaseRestore(path));
      assert.equal(JSON.parse(await readFile(evidence, "utf8")).status, "failed");
    }
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
    await rm(directory, { recursive: true, force: true });
  }
});
