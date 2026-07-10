import assert from "node:assert/strict";
import test from "node:test";
import type { RequiredSecurityAuditIntent } from "@clinic-os/auth";
import type { SqlConnectionFactory, SqlQueryClient, SqlQueryResult } from "@clinic-os/db";
import {
  PostgresIdentitySecurityAuditOutbox,
  PostgresIdentitySecurityAuditOutboxError
} from "../src/features/identity-session-edge/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000002";

test("CP14 required identity audit atomically appends canonical audit and outbox once", async () => {
  const database = new AuditDatabase();
  const outbox = new PostgresIdentitySecurityAuditOutbox(database);
  await outbox.readiness();
  await outbox.persistRequired(intent());
  await outbox.persistRequired(intent());

  assert.equal(database.audit.size, 1);
  assert.equal(database.outbox.size, 1);
  assert.equal(database.releaseCount, 3);
  assert.equal(
    database.statements.filter((statement) => statement.includes("insert into audit_events")).length,
    1
  );
  assert.equal(
    database.statements.filter((statement) => statement.includes("insert into outbox_events")).length,
    1
  );
  const serializedValues = JSON.stringify(database.values);
  assert.doesNotMatch(serializedValues, /token-id-raw-0001/u);
  assert.match(serializedValues, /securityAuditDigestSha256/u);
});

test("CP14 required identity audit rolls back both records on a late failure", async () => {
  const database = new AuditDatabase();
  database.failOutboxInsert = true;
  const outbox = new PostgresIdentitySecurityAuditOutbox(database);
  await assert.rejects(
    outbox.persistRequired(intent()),
    (error: unknown) => error instanceof PostgresIdentitySecurityAuditOutboxError
  );
  assert.equal(database.audit.size, 0);
  assert.equal(database.outbox.size, 0);
  assert.ok(database.statements.includes("rollback"));
});

test("CP14 Postgres security audit rejects unscoped events before database access", async () => {
  const database = new AuditDatabase();
  const outbox = new PostgresIdentitySecurityAuditOutbox(database);
  const { tenantId: _tenant, clinicId: _clinic, ...unscoped } = intent();
  await assert.rejects(
    outbox.persistRequired(unscoped),
    (error: unknown) =>
      error instanceof PostgresIdentitySecurityAuditOutboxError &&
      /missing verified clinic scope/u.test(error.message)
  );
  assert.equal(database.connectCount, 0);
});

test("CP14 required identity audit binds active trace context inside its transaction", async () => {
  const database = new AuditDatabase();
  const outbox = new PostgresIdentitySecurityAuditOutbox(database, {
    traceContextProvider: () =>
      "00-10000000000000000000000000000001-1000000000000001-01"
  });

  await outbox.persistRequired(intent());

  const traceIndex = database.statements.findIndex((statement) =>
    statement.includes("set_config('app.traceparent'")
  );
  const outboxIndex = database.statements.findIndex((statement) =>
    statement.includes("insert into outbox_events")
  );
  assert.ok(traceIndex > 0 && traceIndex < outboxIndex);
});

function intent(): RequiredSecurityAuditIntent {
  return {
    schemaVersion: 1,
    action: "auth.mfa.denied",
    occurredAt: "2026-07-10T12:00:00.000Z",
    deduplicationKey: "token-id-raw-0001",
    subject: "keycloak-subject-0001",
    tenantId,
    clinicId,
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    reasonCode: "privileged_role",
    roleSlugs: ["owner_admin"]
  };
}

class AuditDatabase implements SqlConnectionFactory, SqlQueryClient {
  readonly audit = new Map<string, Record<string, unknown>>();
  readonly outbox = new Map<string, Record<string, unknown>>();
  readonly statements: string[] = [];
  readonly values: unknown[][] = [];
  connectCount = 0;
  releaseCount = 0;
  failOutboxInsert = false;
  #snapshot: { audit: Map<string, Record<string, unknown>>; outbox: Map<string, Record<string, unknown>> } | null = null;

  async connect(): Promise<SqlQueryClient> {
    this.connectCount += 1;
    return this;
  }

  release(): void {
    this.releaseCount += 1;
  }

  async query<Row = Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<Row>> {
    const normalized = sql.replace(/\s+/gu, " ").trim();
    this.statements.push(normalized);
    this.values.push([...values]);
    if (normalized === "begin") {
      this.#snapshot = {
        audit: structuredClone(this.audit),
        outbox: structuredClone(this.outbox)
      };
      return rows<Row>([]);
    }
    if (normalized === "commit") {
      this.#snapshot = null;
      return rows<Row>([]);
    }
    if (normalized === "rollback") {
      if (this.#snapshot) {
        replace(this.audit, this.#snapshot.audit);
        replace(this.outbox, this.#snapshot.outbox);
      }
      this.#snapshot = null;
      return rows<Row>([]);
    }
    if (normalized.startsWith("select tenant_id, clinic_id, action from audit_events")) {
      const value = this.audit.get(String(values[0]));
      return rows<Row>(value ? [value] : []);
    }
    if (normalized.startsWith("select tenant_id, clinic_id, event_type, payload from outbox_events")) {
      const value = this.outbox.get(String(values[0]));
      return rows<Row>(value ? [value] : []);
    }
    if (normalized.startsWith("insert into audit_events")) {
      this.audit.set(String(values[0]), {
        tenant_id: values[1],
        clinic_id: values[2],
        action: values[4]
      });
      return rows<Row>([]);
    }
    if (normalized.startsWith("insert into outbox_events")) {
      if (this.failOutboxInsert) throw new Error("SECRET database endpoint");
      this.outbox.set(String(values[0]), {
        tenant_id: values[1],
        clinic_id: values[2],
        event_type: values[3],
        payload: JSON.parse(String(values[7]))
      });
      return rows<Row>([]);
    }
    return rows<Row>([]);
  }
}

function rows<Row>(values: readonly Record<string, unknown>[]): SqlQueryResult<Row> {
  return { rows: structuredClone(values) as Row[] };
}

function replace(
  target: Map<string, Record<string, unknown>>,
  source: Map<string, Record<string, unknown>>
): void {
  target.clear();
  for (const [key, value] of source) target.set(key, structuredClone(value));
}
