#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  CHECKPOINT1_SEED_IDS,
  PostgresClinicUnitOfWork,
  runWithClinicModuleTransactionContext
} from "@clinic-os/db";
import { FixedClock } from "@clinic-os/domain";
import { PostgresAtomicMutationCoordinator } from "../apps/api/src/framework/postgres-mutation-coordinator.ts";
import { handlePatientDocuments } from "../apps/api/src/features/patient-documents.ts";
import {
  preparePatientDocument,
  issuePatientDocument,
  getPatientDocument,
  listPatientDocuments,
  renderSavedPatientDocument
} from "../packages/db/src/patient-documents.ts";
assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "clinic_os_runtime");
assert.equal(url.pathname, "/clinic_os");
assert.equal(process.argv.length, 2);
const pool = new Pool({ connectionString: url.href, max: 3 });
const scope = {
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  clinicId: CHECKPOINT1_SEED_IDS.clinicId,
  actorUserId: CHECKPOINT1_SEED_IDS.users.owner
};
const s = [scope.tenantId, scope.clinicId, scope.actorUserId];
async function begin(c) {
  await c.query("begin");
  await c.query(
    "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
    s
  );
}
async function rejected(c, work, match) {
  await c.query("savepoint rejected");
  try {
    await assert.rejects(work, match);
  } finally {
    await c.query("rollback to savepoint rejected");
    await c.query("release savepoint rejected");
  }
}
try {
  const marker = await pool.query(
    "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
  );
  assert.equal(
    marker.rows[0].marker,
    `ClinicOS disposable MVP acceptance ${process.env.CLINICOS_MVP_DATABASE_TOKEN}`
  );
  const c = await pool.connect();
  let rolledBackId;
  try {
    await begin(c);
    const all = (await c.query("select * from patient_documents order by generated_at,id")).rows;
    assert.deepEqual([...new Set(all.map((r) => r.kind))].sort(), [
      "estimate",
      "instruction",
      "invoice",
      "lab_slip",
      "prescription",
      "receipt"
    ]);
    assert.ok(
      all.every((r) => r.snapshot.patientName.startsWith("Synthetic")),
      "Only the synthetic daily-workflow database is accepted."
    );
    for (const row of all) {
      const record = await getPatientDocument(
        c,
        scope,
        row.patient_id,
        row.kind,
        row.source_id,
        row.id
      );
      renderSavedPatientDocument(record);
      const evidence = (
        await c.query(
          "select (select count(*)::int from audit_events where resource_id=$1::text and action='patient.document.generated') audits,(select count(*)::int from outbox_events where aggregate_id=$1::uuid and event_type='patient.document.generated') events",
          [row.id]
        )
      ).rows[0];
      assert.deepEqual(evidence, { audits: 1, events: 1 });
      assert.equal(
        await getPatientDocument(c, scope, randomUUID(), row.kind, row.source_id, row.id),
        null
      );
      assert.equal(
        await getPatientDocument(c, scope, row.patient_id, row.kind, randomUUID(), row.id),
        null
      );
    }
    const row = all.find((r) => r.kind === "instruction");
    const original = await getPatientDocument(
      c,
      scope,
      row.patient_id,
      row.kind,
      row.source_id,
      row.id
    );
    const bytes = renderSavedPatientDocument(original);
    await rejected(
      c,
      () => c.query("update patient_documents set revision=revision+1 where id=$1", [row.id]),
      /immutable|append.only|not.*mutat|cannot|prohibit/i
    );
    await rejected(
      c,
      () => c.query("delete from patient_documents where id=$1", [row.id]),
      /immutable|append.only|not.*mutat|cannot|prohibit/i
    );
    const preview = await preparePatientDocument(c, scope, row.patient_id, row.kind, row.source_id);
    await c.query(
      "update patients set full_name=full_name||' renamed',row_version=row_version+1 where id=$1",
      [row.patient_id]
    );
    await c.query(
      "update clinics set display_name=display_name||' renamed',row_version=row_version+1 where id=$1",
      [scope.clinicId]
    );
    await rejected(
      c,
      () =>
        issuePatientDocument(
          c,
          scope,
          row.patient_id,
          row.kind,
          row.source_id,
          preview.sourceDigest,
          new Date("2026-10-02T10:00:00Z")
        ),
      /changed/
    );
    assert.equal(
      renderSavedPatientDocument(
        await getPatientDocument(c, scope, row.patient_id, row.kind, row.source_id, row.id)
      ),
      bytes
    );
    const refreshed = await preparePatientDocument(
      c,
      scope,
      row.patient_id,
      row.kind,
      row.source_id
    );
    const issued = await issuePatientDocument(
      c,
      scope,
      row.patient_id,
      row.kind,
      row.source_id,
      refreshed.sourceDigest,
      new Date("2026-10-02T10:00:00Z")
    );
    rolledBackId = issued.document.id;
    assert.equal(issued.created, true);
    assert.equal(issued.document.previousDocumentId, row.id);
    const replay = await issuePatientDocument(
      c,
      scope,
      row.patient_id,
      row.kind,
      row.source_id,
      refreshed.sourceDigest,
      new Date("2026-10-02T11:00:00Z")
    );
    assert.equal(replay.created, false);
    assert.equal(replay.document.id, rolledBackId);
    assert.equal(
      renderSavedPatientDocument(replay.document),
      renderSavedPatientDocument(issued.document)
    );
    await rejected(
      c,
      () =>
        listPatientDocuments(
          c,
          scope,
          row.patient_id,
          row.kind,
          row.source_id,
          all.find((r) => r.kind === "invoice").id
        ),
      /cursor/
    );
    // Page a history larger than one response without rewriting any earlier copy.
    for (let revision = 0; revision < 22; revision++) {
      await c.query("update patients set row_version=row_version+1 where id=$1", [row.patient_id]);
      const current = await preparePatientDocument(
        c,
        scope,
        row.patient_id,
        row.kind,
        row.source_id
      );
      await issuePatientDocument(
        c,
        scope,
        row.patient_id,
        row.kind,
        row.source_id,
        current.sourceDigest,
        new Date("2026-10-02T11:00:00Z")
      );
    }
    const firstPage = await listPatientDocuments(c, scope, row.patient_id, row.kind, row.source_id);
    assert.equal(firstPage.documents.length, 20);
    assert.ok(firstPage.nextCursor);
    const secondPage = await listPatientDocuments(
      c,
      scope,
      row.patient_id,
      row.kind,
      row.source_id,
      firstPage.nextCursor
    );
    assert.equal(secondPage.nextCursor, null);
    assert.equal(
      new Set([...firstPage.documents, ...secondPage.documents].map((d) => d.id)).size,
      24
    );
    const receipt = all.find((r) => r.kind === "receipt");
    await c.query(
      "update receipts set status='void',voided_by_user_id=$2,voided_at=$3,void_reason='Synthetic correction' where id=$1",
      [receipt.source_id, scope.actorUserId, new Date("2026-10-02T10:00:00Z")]
    );
    assert.match(
      (await preparePatientDocument(c, scope, receipt.patient_id, receipt.kind, receipt.source_id))
        .unavailableReason,
      /void/
    );
    renderSavedPatientDocument(
      await getPatientDocument(
        c,
        scope,
        receipt.patient_id,
        receipt.kind,
        receipt.source_id,
        receipt.id
      )
    );
    await c.query("savepoint unsupported_source");
    await c.query(
      "update clinics set address=jsonb_build_object('line1',repeat('x',600000)) where id=$1",
      [scope.clinicId]
    );
    const unsupported = await preparePatientDocument(
      c,
      scope,
      row.patient_id,
      row.kind,
      row.source_id
    );
    assert.equal(unsupported.snapshot, null);
    assert.match(unsupported.unavailableReason, /size/);
    assert.equal(
      renderSavedPatientDocument(
        await getPatientDocument(c, scope, row.patient_id, row.kind, row.source_id, row.id)
      ),
      bytes
    );
    await c.query("rollback to savepoint unsupported_source");
    await c.query("release savepoint unsupported_source");
    await c.query("rollback");
    await begin(c);
    assert.equal(
      (await c.query("select count(*)::int n from patient_documents where id=$1", [rolledBackId]))
        .rows[0].n,
      0,
      "Failed transaction must not retain issued output."
    );
    const foreign = { ...scope, tenantId: randomUUID(), clinicId: randomUUID() };
    assert.equal(
      await getPatientDocument(c, foreign, row.patient_id, row.kind, row.source_id, row.id),
      null
    );
    await c.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true)",
      [foreign.tenantId, foreign.clinicId]
    );
    assert.equal((await c.query("select count(*)::int n from patient_documents")).rows[0].n, 0);
    await c.query("rollback");
    // Actual coordinator + scoped handler + PostgreSQL: fail AFTER each evidence write.
    const clock = new FixedClock("2026-10-02T12:00:00Z");
    const coordinator = new PostgresAtomicMutationCoordinator({
      unitOfWork: new PostgresClinicUnitOfWork(pool, { clock }),
      readinessProbe: async () => {}
    });
    for (const failure of ["audit", "outbox"]) {
      const key = `synthetic-document-${failure}-${randomUUID()}`;
      const request = {
        identity: scope,
        idempotency: { operationId: "issuePatientDocument", key, requestDigest: "a".repeat(64) },
        concurrency: null,
        versionAdvances: [],
        requestId: key,
        now: clock.now()
      };
      let fail = true,
        attemptedId;
      const effect = async (transaction) => {
        await transaction.sqlClient.query(
          "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
          s
        );
        await transaction.sqlClient.query(
          "update patients set row_version=row_version+1 where id=$1",
          [row.patient_id]
        );
        const prepared = await transaction.repository.preparePatientDocument(
          scope,
          row.patient_id,
          row.kind,
          row.source_id
        );
        return runWithClinicModuleTransactionContext({ ...transaction, scope }, async (context) => {
          const evidence = {
            ...context.evidence,
            appendAuditEvent: async (event) => {
              await context.evidence.appendAuditEvent(event);
              if (event.action === "patient.document.generated") {
                attemptedId = event.resourceId;
                if (fail && failure === "audit") throw new Error("synthetic late audit failure");
              }
            },
            appendOutboxEvent: async (event) => {
              await context.evidence.appendOutboxEvent(event);
              if (fail && failure === "outbox") throw new Error("synthetic late outbox failure");
            }
          };
          return handlePatientDocuments(
            {
              operationId: "issuePatientDocument",
              access: {
                clinicId: scope.clinicId,
                context: {
                  tenant: { id: scope.tenantId },
                  user: { id: scope.actorUserId },
                  roleAssignments: [
                    {
                      tenantId: scope.tenantId,
                      clinicId: scope.clinicId,
                      userId: scope.actorUserId,
                      roleSlug: "owner_admin"
                    }
                  ]
                }
              },
              parsed: {
                path: { patientId: row.patient_id, kind: row.kind, sourceId: row.source_id },
                body: { expectedSourceDigest: prepared.sourceDigest },
                headers: { "idempotency-key": key }
              },
              metadata: {
                requestId: key,
                receivedAt: clock.now(),
                ipAddress: null,
                userAgent: null
              }
            },
            { ...context, evidence, clock }
          );
        });
      };
      await assert.rejects(
        () => coordinator.execute(request, effect),
        new RegExp(`late ${failure} failure`)
      );
      assert.ok(attemptedId);
      await begin(c);
      for (const [table, column, value] of [
        ["patient_documents", "id", attemptedId],
        ["audit_events", "resource_id", attemptedId],
        ["outbox_events", "aggregate_id", attemptedId],
        ["api_idempotency_records", "idempotency_key", key]
      ])
        assert.equal(
          (await c.query(`select count(*)::int n from ${table} where ${column}=$1`, [value]))
            .rows[0].n,
          0,
          `${failure} failure must roll back ${table}`
        );
      await c.query("rollback");
      fail = false;
      const success = await coordinator.execute(request, effect);
      assert.equal(success.response.status, 201);
      const replay = await coordinator.execute(request, async () => {
        throw new Error("replay must not execute");
      });
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.response, success.response);
    }
    console.log(
      JSON.stringify({
        documents: all.length,
        kinds: 6,
        immutable: true,
        exactReprint: true,
        staleSourceRejected: true,
        replay: true,
        scopeIsolation: true,
        transactionRollback: true,
        lateAuditAndOutboxFailureRollback: true,
        failedKeyRetryAndExactReplay: true,
        oneAuditAndOutboxPerCopy: true
      })
    );
  } finally {
    await c.query("rollback");
    c.release();
  }
} finally {
  await pool.end();
}
