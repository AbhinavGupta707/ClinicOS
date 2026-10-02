#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "pg";
import { renderSavedPatientDocument } from "@clinic-os/db";

const root = resolve(import.meta.dirname, "..");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const ident = (value) => '"' + value.replaceAll('"', '""') + '"';
export function validateRestoreManifest(manifest, evidenceRoot) {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.syntheticOnly, true);
  assert.match(manifest.token, /^[a-f0-9]{32}$/u);
  assert.ok(isAbsolute(evidenceRoot));
  assert.ok(isAbsolute(manifest.pgBin));
  for (const name of ["source", "target"]) {
    const entry = manifest[name];
    assert.ok(Number.isInteger(entry.port) && entry.port > 1024 && entry.port < 65536);
    assert.ok(Number.isInteger(entry.pid) && entry.pid > 1);
    const within = relative(evidenceRoot, entry.dataDirectory);
    assert.ok(within && !within.startsWith(`..${sep}`) && within !== ".." && !isAbsolute(within));
  }
  assert.notEqual(manifest.source.port, manifest.target.port);
  assert.notEqual(manifest.source.pid, manifest.target.pid);
  assert.notEqual(manifest.source.dataDirectory, manifest.target.dataDirectory);
  return manifest;
}
export function normalizeSchemaDump(text) {
  // Only remove pg_dump's randomized outer psql protection markers. Preserve
  // comments and quoted function bodies: comment-looking lines can be SQL data.
  const lines = text.split("\n");
  const first = lines.findIndex((line) => /^\\restrict [A-Za-z0-9]+$/u.test(line));
  const last = lines.findLastIndex((line) => /^\\unrestrict [A-Za-z0-9]+$/u.test(line));
  if (
    first >= 0 &&
    last > first &&
    lines.slice(0, first).every((line) => !line.trim() || line.startsWith("--")) &&
    lines.slice(last + 1).every((line) => !line.trim() || line.startsWith("--"))
  ) {
    const token = lines[first].slice("\\restrict ".length);
    assert.equal(lines[last], "\\unrestrict " + token, "Dump protection tokens disagree.");
    lines.splice(last, 1);
    lines.splice(first, 1);
  }
  return lines.join("\n").trim();
}
export function assertRestoreInventory(source, target) {
  assert.deepEqual(
    target,
    source,
    "Restored content, schema, sequences or document renderings differ."
  );
}
async function fileDigest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function command(binary, args, env) {
  await new Promise((accept, reject) => {
    const process = spawn(binary, args, { env, stdio: ["ignore", "ignore", "pipe"] });
    // Database diagnostics can contain row values. Keep only a bounded exit code.
    process.stderr.resume();
    const timer = setTimeout(() => {
      process.kill("SIGTERM");
    }, 180_000);
    const killTimer = setTimeout(() => {
      process.kill("SIGKILL");
    }, 185_000);
    process.on("error", reject);
    process.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (code === 0) accept();
      else reject(new Error(`${binary.split(sep).at(-1)} failed (${code}).`));
    });
  });
}
async function verifyOwnedCluster(client, entry, token) {
  const metadata = (
    await client.query(`select current_database() name,current_user actor,
    current_setting('data_directory') directory,current_setting('port')::int port,
    shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()`)
  ).rows[0];
  assert.equal(metadata.name, "clinic_os");
  assert.equal(metadata.actor, "clinic_os");
  assert.equal(metadata.marker, `ClinicOS disposable MVP acceptance ${token}`);
  assert.equal(metadata.port, entry.port);
  assert.equal(await realpath(metadata.directory), await realpath(entry.dataDirectory));
  const pidFile = (await readFile(join(entry.dataDirectory, "postmaster.pid"), "utf8")).split("\n");
  assert.equal(Number(pidFile[0]), entry.pid);
  assert.equal(Number(pidFile[3]), entry.port);
  assert.equal(
    (
      await client.query(`select count(*)::int n from pg_stat_activity
    where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid()`)
    ).rows[0].n,
    0,
    "Stop app/test writers before snapshot or restore."
  );
}
async function relations(client, kind) {
  return (
    await client.query(
      `select n.nspname schema,c.relname name from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
    and c.relkind::text=any($1::text[]) order by n.nspname collate "C",c.relname collate "C"`,
      [kind]
    )
  ).rows;
}
async function inventory(client) {
  const tables = [],
    sequences = [],
    documents = [];
  for (const { schema, name } of await relations(client, ["r"])) {
    const hash = createHash("sha256");
    let count = 0;
    await client.query(`declare restore_rows no scroll cursor for select to_jsonb(t)::text value
      from ${ident(schema)}.${ident(name)} t order by to_jsonb(t)::text collate "C"`);
    try {
      for (;;) {
        const page = (await client.query("fetch forward 250 from restore_rows")).rows;
        if (!page.length) break;
        for (const row of page) {
          hash.update(row.value).update("\n");
          count += 1;
        }
      }
    } finally {
      await client.query("close restore_rows");
    }
    tables.push({ schema, name, count, digest: hash.digest("hex") });
  }
  for (const { schema, name } of await relations(client, ["S"])) {
    const value = (
      await client.query(`select last_value::text,is_called from ${ident(schema)}.${ident(name)}`)
    ).rows[0];
    sequences.push({ schema, name, ...value });
  }
  // Re-render every archived copy as well as comparing its persisted bytes.
  const copies = (await client.query("select * from patient_documents order by id")).rows;
  for (const r of copies) {
    const html = renderSavedPatientDocument({
      id: r.id,
      tenantId: r.tenant_id,
      clinicId: r.clinic_id,
      patientId: r.patient_id,
      kind: r.kind,
      sourceId: r.source_id,
      sourceDigest: r.source_digest,
      revision: r.revision,
      rendererVersion: r.renderer_version,
      snapshot: r.snapshot,
      htmlDigest: r.html_digest,
      generatedAt: r.generated_at.toISOString(),
      generatedByUserId: r.generated_by_user_id,
      generatedBy: r.generated_by_display_name,
      previousDocumentId: r.previous_document_id
    });
    documents.push({ id: r.id, digest: digest(html) });
  }
  return { tables, sequences, documents };
}

export async function runSyntheticDatabaseRestore(manifestPath) {
  assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
  assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
  const evidence = await realpath(dirname(manifestPath));
  const auditRoot = await realpath(join(root, ".audit-spectra-retirement-20260920"));
  assert.ok(evidence.startsWith(auditRoot + sep), "Use a dedicated Spectra audit directory.");
  // A retry must not leave a previous success looking like the current result.
  await writeFile(
    join(evidence, "database-restore-evidence.json"),
    JSON.stringify({ version: 1, status: "in_progress", syntheticOnly: true }),
    { mode: 0o600 }
  );
  const clients = [];
  let verified = false;
  try {
    const manifest = validateRestoreManifest(
      JSON.parse(await readFile(manifestPath, "utf8")),
      evidence
    );
    for (const name of ["source", "target"])
      assert.ok((await realpath(manifest[name].dataDirectory)).startsWith(evidence + sep));
    const env = {
      PATH: process.env.PATH,
      LANG: "C",
      TZ: "UTC",
      PGPASSWORD: "clinic_os",
      PGCONNECT_TIMEOUT: "5",
      PGAPPNAME: "clinicos-synthetic-restore",
      TMPDIR: join(evidence, "tmp")
    };
    const connect = async (entry) => {
      const client = new Client({
        host: "127.0.0.1",
        port: entry.port,
        database: "clinic_os",
        user: "clinic_os",
        password: "clinic_os",
        application_name: env.PGAPPNAME,
        connectionTimeoutMillis: 5000
      });
      clients.push(client);
      await client.connect();
      await verifyOwnedCluster(client, entry, manifest.token);
      return client;
    };
    const args = (entry, database = "clinic_os") => [
      "-h",
      "127.0.0.1",
      "-p",
      String(entry.port),
      "-U",
      "clinic_os",
      "-d",
      database
    ];
    const started = performance.now();
    const source = await connect(manifest.source),
      target = await connect(manifest.target);
    assert.equal(
      (await relations(target, ["r", "p", "S", "v", "m", "f"])).length,
      0,
      "Restore target must be empty; no clean, reset or overwrite is permitted."
    );
    await source.query("begin isolation level repeatable read");
    await source.query("set local lock_timeout='5s'");
    const tables = await relations(source, ["r", "p"]);
    assert.ok(tables.some((t) => t.name === "patient_documents"));
    await source.query(
      `lock table ${tables.map((t) => ident(t.schema) + "." + ident(t.name)).join(",")} in share mode`
    );
    const snapshot = (await source.query("select pg_export_snapshot() snapshot")).rows[0].snapshot;
    const before = await inventory(source);
    assert.ok(
      before.documents.length >= 6,
      "Populate the synthetic clinic-day documents before restore."
    );
    const dumpPath = join(evidence, "synthetic-clinicos.dump");
    await command(
      join(manifest.pgBin, "pg_dump"),
      [...args(manifest.source), "--format=custom", `--snapshot=${snapshot}`, "--file", dumpPath],
      env
    );
    await chmod(dumpPath, 0o600);
    const backupDigest = await fileDigest(dumpPath);
    const sourceSchema = join(evidence, "source-schema.sql");
    await command(
      join(manifest.pgBin, "pg_dump"),
      [...args(manifest.source), "--schema-only", `--snapshot=${snapshot}`, "--file", sourceSchema],
      env
    );
    const rawSourceSchemaDigest = digest(normalizeSchemaDump(await readFile(sourceSchema, "utf8")));
    assertRestoreInventory(before, await inventory(source));
    await source.query("commit");
    // The only destructive-looking tool is constrained to a verified empty owned
    // database. --single-transaction plus --exit-on-error leaves no partial restore.
    assert.equal(await fileDigest(dumpPath), backupDigest);
    await command(
      join(manifest.pgBin, "pg_restore"),
      [...args(manifest.target), "--single-transaction", "--exit-on-error", dumpPath],
      env
    );
    // PostgreSQL reparses CHECK expressions on restore (for example flattening
    // nested ANDs or array casts). Parse the complete source schema independently
    // in a new empty reference database on the owned target cluster. Compare its
    // dump with the actual restored schema; never strip or rewrite security SQL.
    // CREATE fails if the reference already exists. No database is overwritten.
    const referenceDatabase = `clinic_os_schema_${manifest.token}`;
    await target.query(`create database ${ident(referenceDatabase)} template template0`);
    await command(
      join(manifest.pgBin, "psql"),
      [
        ...args(manifest.target, referenceDatabase),
        "--no-psqlrc",
        "--single-transaction",
        "--set=ON_ERROR_STOP=1",
        "--file",
        sourceSchema
      ],
      env
    );
    const canonicalSourceSchema = join(evidence, "canonical-source-schema.sql");
    await command(
      join(manifest.pgBin, "pg_dump"),
      [
        ...args(manifest.target, referenceDatabase),
        "--schema-only",
        "--file",
        canonicalSourceSchema
      ],
      env
    );
    before.schemaDigest = digest(
      normalizeSchemaDump(await readFile(canonicalSourceSchema, "utf8"))
    );
    await target.query("begin isolation level repeatable read read only");
    const restored = await inventory(target);
    await target.query("commit");
    const targetSchema = join(evidence, "restored-schema.sql");
    await command(
      join(manifest.pgBin, "pg_dump"),
      [...args(manifest.target), "--schema-only", "--file", targetSchema],
      env
    );
    restored.schemaDigest = digest(normalizeSchemaDump(await readFile(targetSchema, "utf8")));
    assertRestoreInventory(before, restored);
    const report = {
      version: 1,
      status: "passed",
      syntheticOnly: true,
      backup: { sha256: backupDigest, bytes: (await stat(dumpPath)).size },
      schemaComparison: {
        rawSourceSchemaDigest,
        referenceDatabase,
        method: "PostgreSQL source-schema round trip, exact normalized dump comparison"
      },
      source: before,
      restored,
      elapsedMilliseconds: Math.round(performance.now() - started),
      limits: [
        "Local PostgreSQL only; not an independent backup.",
        "Private object bytes, Keycloak and provider state are not restored.",
        "Elapsed drill duration is not production RTO; no production RPO established."
      ]
    };
    await writeFile(
      join(evidence, "database-restore-evidence.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 }
    );
    verified = true;
    return report;
  } finally {
    await Promise.allSettled(clients.map((c) => c.end()));
    if (!verified)
      await writeFile(
        join(evidence, "database-restore-evidence.json"),
        JSON.stringify({
          status: "failed",
          details: "Verification did not complete; do not treat the backup as proven."
        }),
        { mode: 0o600 }
      );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, "Supply only the owned synthetic restore manifest.");
  const result = await runSyntheticDatabaseRestore(resolve(process.argv[2]));
  console.log(
    JSON.stringify({
      status: result.status,
      tables: result.source.tables.length,
      documents: result.source.documents.length,
      elapsedMilliseconds: result.elapsedMilliseconds
    })
  );
}
