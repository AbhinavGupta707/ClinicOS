import assert from "node:assert/strict";
import test from "node:test";
import { PostgresIdentityRepository } from "../src/postgres.ts";
import { buildSetLocalIdentityRlsStatements } from "../src/rls.ts";

const identity = {
  issuer: "https://identity.example/realms/clinic-os",
  subject: "Case-Sensitive-Subject"
};

test("identity bootstrap rejects absent or malformed identity before opening a database transaction", async () => {
  let queries = 0;
  const repository = new PostgresIdentityRepository({
    async query() {
      queries += 1;
      return { rows: [] };
    }
  });
  for (const invalid of [
    undefined,
    null,
    "subject-only",
    {},
    { subject: "valid" },
    { issuer: identity.issuer },
    { ...identity, issuer: "" },
    { ...identity, subject: "" },
    { ...identity, issuer: "https://user:secret@identity.example/realm" },
    { ...identity, issuer: "https://identity.example/realm?secret=value" },
    { ...identity, issuer: "https://identity.example/realm#fragment" },
    { ...identity, issuer: "file:///realm" },
    { ...identity, subject: "x".repeat(256) },
    { ...identity, subject: "bad\u0000subject" },
    { ...identity, issuer: "https://identity.example/\nrealm" }
  ]) {
    await assert.rejects(repository.findAccessByKeycloakIdentity(invalid as never), {
      message: "Identity lookup requires a bounded verified issuer and subject."
    });
  }
  assert.equal(queries, 0);
});

test("identity RLS passes exact identity values as parameters and clears ambient tenant scope", () => {
  const statements = buildSetLocalIdentityRlsStatements(identity);
  assert.deepEqual(
    statements.map((s) => s.values),
    [[""], [""], [""], [identity.issuer], [identity.subject]]
  );
  assert.ok(
    statements.every((s) => !s.sql.includes(identity.subject) && !s.sql.includes(identity.issuer))
  );
  assert.ok(
    statements.every((s) => s.sql.includes(", true)")),
    "all settings are transaction-local"
  );
});

test("repository binds issuer and subject in the lookup and releases after success or failure", async () => {
  for (const fail of [false, true]) {
    const commands: Array<{ sql: string; values?: readonly unknown[] }> = [];
    let released = false;
    const client = {
      async query(sql: string, values?: readonly unknown[]) {
        commands.push({ sql, values });
        if (sql.includes("from user_identities")) {
          assert.deepEqual(values, [identity.subject, identity.issuer]);
          assert.match(sql, /user_identities\.issuer = \$2/);
          if (fail) throw new Error("synthetic dependency fault");
        }
        return { rows: [] };
      },
      release() {
        released = true;
      }
    };
    const repository = new PostgresIdentityRepository({
      ...client,
      async connect() {
        return client;
      }
    });
    if (fail)
      await assert.rejects(
        repository.findAccessByKeycloakIdentity(identity),
        /synthetic dependency fault/
      );
    else assert.equal(await repository.findAccessByKeycloakIdentity(identity), null);
    assert.equal(commands[0].sql, "begin");
    assert.equal(commands.at(-1)?.sql, fail ? "rollback" : "commit");
    if (!fail)
      assert.match(
        commands.at(-2)!.sql,
        /set_config\('app.identity_issuer', '', true\), set_config\('app.identity_subject', '', true\)/
      );
    assert.equal(released, true);
  }
});
