import assert from "node:assert/strict";
import test from "node:test";
import {
  PostgresClinicUnitOfWork,
  type SqlConnectionFactory,
  type SqlQueryClient,
  type SqlQueryResult
} from "../src/postgres.ts";

test("CP14 exposes one caller-transaction SQL client and revokes it before commit returns", async () => {
  const connection = new RecordingConnection();
  const unitOfWork = new PostgresClinicUnitOfWork(connection);
  let leaked: SqlQueryClient | undefined;

  await unitOfWork.run(async ({ sqlClient }) => {
    leaked = sqlClient;
    await sqlClient.query("select $1::text as value", ["inside-lease"]);
  });

  assert.deepEqual(connection.statements, ["begin", "select $1::text as value", "commit"]);
  assert.throws(
    () => leaked!.query("select 'outside-lease'"),
    /used outside its unit-of-work lease/u
  );
  assert.doesNotMatch(connection.statements.join("\n"), /outside-lease/u);
});

test("CP14 revokes the transaction SQL client on rollback as well", async () => {
  const connection = new RecordingConnection();
  const unitOfWork = new PostgresClinicUnitOfWork(connection);
  let leaked: SqlQueryClient | undefined;

  await assert.rejects(
    unitOfWork.run(async ({ sqlClient }) => {
      leaked = sqlClient;
      throw new Error("forced rollback");
    }),
    /forced rollback/u
  );

  assert.deepEqual(connection.statements, ["begin", "rollback"]);
  assert.throws(() => leaked!.query("select 1"), /used outside its unit-of-work lease/u);
});

class RecordingConnection implements SqlConnectionFactory {
  readonly statements: string[] = [];

  async query<T = Record<string, unknown>>(sql: string): Promise<SqlQueryResult<T>> {
    this.statements.push(sql);
    return { rows: [] };
  }
}
