import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { createClient } from "redis";
import {
  PostgresSecurityAuditSink,
  RedisWebSessionStore,
  SecurityAuditDispatcher,
  SecurityAuditSinkError,
  type RequiredSecurityAuditIntent
} from "../src/index.ts";

assert.equal(
  process.env.GITHUB_ACTIONS,
  "true",
  "This committing probe runs only on the disposable CI runner."
);
assert.equal(process.env.CLINICOS_SECURITY_AUDIT_TEST_ENABLED, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
const workerUrl = "postgresql://clinic_os_worker:clinic_os_worker@127.0.0.1:5432/clinic_os";
const redisUrl = "redis://127.0.0.1:6379";

test(
  "real Redis/Postgres: required global audits survive replay, conflict and process restart",
  { timeout: 30_000 },
  async () => {
    const pool = new Pool({
      connectionString: workerUrl,
      max: 4,
      connectionTimeoutMillis: 3000,
      query_timeout: 5000
    });
    const runtimePool = new Pool({
      connectionString: "postgresql://clinic_os_runtime:clinic_os_runtime@127.0.0.1:5432/clinic_os",
      max: 1,
      connectionTimeoutMillis: 3000
    });
    const prefix = `clinicos:audit:test:${randomBytes(12).toString("hex")}`;
    const store = new RedisWebSessionStore({
      redisUrl,
      keyPrefix: prefix,
      keyHmacSecret: randomBytes(32),
      now: () => new Date()
    });
    const sink = new PostgresSecurityAuditSink(pool);
    const inspector = createClient({
      url: redisUrl,
      socket: { connectTimeout: 3000, reconnectStrategy: false }
    });
    inspector.on("error", () => {});
    const value: RequiredSecurityAuditIntent = {
      schemaVersion: 1,
      action: "auth.mfa.denied",
      occurredAt: new Date().toISOString(),
      deduplicationKey: `synthetic-audit:${randomBytes(16).toString("hex")}`,
      subject: "synthetic-unaffiliated-user",
      issuer: "https://synthetic.example/realms/clinic-os",
      authorizedParty: "clinic-os-web-bff",
      reasonCode: "privileged_role",
      roleSlugs: ["owner_admin"]
    };
    const key = createHash("sha256")
      .update(`clinicos:identity-security-audit:v1\0${value.deduplicationKey}`)
      .digest("hex");
    try {
      await inspector.connect();
      await store.readiness();
      await sink.readiness();
      await assert.rejects(new PostgresSecurityAuditSink(runtimePool).readiness());
      await store.requiredAuditOutbox().persistRequired(value);
      const scanned = (await store.scanPendingAudits()).items[0]!;
      await Promise.all(Array.from({ length: 8 }, () => sink.append(value)));
      // Crash after the sink commit: no acknowledgement. A fresh dispatcher must finish safely.
      const dispatcher = new SecurityAuditDispatcher({
        source: store,
        sink,
        now: () => new Date()
      });
      assert.equal((await dispatcher.runOnce()).delivered, 1);
      await dispatcher.readiness();
      assert.equal((await store.scanPendingAudits()).items.length, 0);
      const client = await pool.connect();
      try {
        assert.equal(
          (
            await client.query(
              "select count(*)::integer as count from identity_security_audit_events"
            )
          ).rows[0].count,
          0,
          "unscoped global enumeration is denied"
        );
        await client.query("begin");
        await client.query("select set_config('app.security_audit_key', $1, true)", [key]);
        const rows = (
          await client.query(
            "select canonical_payload, tenant_id, clinic_id from identity_security_audit_events where deduplication_key = $1",
            [key]
          )
        ).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].tenant_id, null);
        assert.equal(rows[0].clinic_id, null);
        assert.equal(JSON.stringify(rows[0]).includes(value.deduplicationKey), false);
        for (const command of [
          "update identity_security_audit_events set payload_digest = payload_digest",
          "delete from identity_security_audit_events",
          "truncate identity_security_audit_events"
        ]) {
          await client.query("savepoint mutation_denied");
          await assert.rejects(client.query(command), { code: "42501" });
          await client.query("rollback to savepoint mutation_denied");
        }
        await client.query("rollback");
      } finally {
        client.release();
      }
      const replacement = { ...value, reasonCode: "keycloak_admin" as const };
      await store.requiredAuditOutbox().persistRequired(replacement);
      assert.equal(
        await store.acknowledgePendingAudit(scanned),
        "changed",
        "a stale ack cannot delete replacement evidence"
      );
      assert.equal((await dispatcher.runOnce()).conflicts, 1);
      await assert.rejects(dispatcher.readiness());
      assert.equal((await store.scanPendingAudits()).items.length, 1);
      await assert.rejects(
        sink.append(replacement),
        (error: unknown) =>
          error instanceof SecurityAuditSinkError && error.code === "conflicting_evidence"
      );
      console.log(
        JSON.stringify({
          globalSecurityAudit: "pass",
          workerPrivileges: "append_only",
          replay: "pass",
          conflictRetention: "pass"
        })
      );
    } finally {
      // Remove only this test's random Redis namespace. Immutable DB evidence remains in the disposable CI database.
      if (inspector.isReady) await inspector.del(store.stateAndAuditHashKey);
      await store.close();
      if (inspector.isOpen) await inspector.quit();
      await pool.end();
      await runtimePool.end();
    }
  }
);
