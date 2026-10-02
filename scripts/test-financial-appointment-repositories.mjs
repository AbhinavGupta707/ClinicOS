#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import { canonicalAppointmentObservations } from "@clinic-os/domain";
import {
  executeFinancialCommand,
  refreshInvoiceFinancialState,
  getFinancialAccount,
  getFinancialDay
} from "../packages/db/src/financial-operations.ts";
import {
  createAppointmentImport,
  stageAppointmentObservations,
  sealAppointmentImport,
  lockAppointmentObservation,
  decideAppointmentObservation,
  getAppointmentImport
} from "../packages/db/src/appointment-observations.ts";
assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
assert.match(process.env.CLINICOS_MVP_DATABASE_TOKEN ?? "", /^[a-f0-9]{32}$/);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "clinic_os_runtime");
assert.equal(url.pathname, "/clinic_os");
const pool = new Pool({ connectionString: url.href, max: 2 });
const scope = {
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  clinicId: CHECKPOINT1_SEED_IDS.clinicId,
  actorUserId: CHECKPOINT1_SEED_IDS.users.owner
};
const s = [scope.tenantId, scope.clinicId, scope.actorUserId];
const checks = [];
async function transaction(client, work) {
  await client.query("begin");
  try {
    await client.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
      s
    );
    await work(client);
  } finally {
    await client.query("rollback");
  }
}
async function rejected(c, work, expected) {
  await c.query("savepoint rejected_case");
  try {
    await assert.rejects(work, expected);
  } finally {
    await c.query("rollback to savepoint rejected_case");
    await c.query("release savepoint rejected_case");
  }
}
async function fixtureInvoice(c) {
  const patient = (
    await c.query(
      "select id from patients where tenant_id=$1 and clinic_id=$2 order by id limit 1",
      s.slice(0, 2)
    )
  ).rows[0].id;
  const id = randomUUID();
  await c.query(
    "insert into invoices(id,tenant_id,clinic_id,patient_id,invoice_number,subtotal_minor,total_minor,balance_minor,created_by_user_id) values($1,$2,$3,$4,$5,10000,10000,10000,$6)",
    [id, ...s.slice(0, 2), patient, `SYNTHETIC-${id}`, s[2]]
  );
  return { id, patient };
}
async function capturedAndRefunds(c, invoice, annotated) {
  const payment = "synthetic_" + randomUUID();
  const rows = [
    {
      amount: 10000,
      method: "upi",
      status: "refunded",
      providerId: payment,
      meta: { captured_amount_minor: 12000, unallocated_amount_minor: 2000 }
    },
    {
      amount: 2000,
      method: "refund",
      status: "refunded",
      meta: {
        provider_payment_id: payment,
        ...(annotated ? { invoice_refund_amount_minor: 0 } : {})
      }
    },
    {
      amount: 10000,
      method: "refund",
      status: "refunded",
      meta: {
        provider_payment_id: payment,
        ...(annotated ? { invoice_refund_amount_minor: 10000 } : {})
      }
    }
  ];
  for (const [n, row] of rows.entries()) {
    await c.query(
      "insert into payment_transactions(tenant_id,clinic_id,invoice_id,patient_id,provider,provider_payment_id,amount_minor,method,status,verification_status,reconciliation_status,idempotency_key,received_at,metadata) values($1,$2,$3,$4,'razorpay',$5,$6,$7,$8,'verified','matched',$9,$10,$11::jsonb)",
      [
        ...s.slice(0, 2),
        invoice.id,
        invoice.patient,
        row.providerId ?? null,
        row.amount,
        row.method,
        row.status,
        randomUUID(),
        new Date(1783936800000 + n * 1000),
        JSON.stringify(row.meta)
      ]
    );
    if (annotated) {
      const value = await refreshInvoiceFinancialState(c, scope, invoice.id);
      assert.equal(value.paidMinor, 10000);
      assert.equal(value.refundedMinor, n === 2 ? 10000 : 0);
      assert.equal(value.balanceMinor, n === 2 ? 10000 : 0);
    }
  }
}
try {
  const marker = await pool.query(
    "select shobj_description(oid,'pg_database') as marker from pg_database where datname=current_database()"
  );
  assert.equal(
    marker.rows[0].marker,
    `ClinicOS disposable MVP acceptance ${process.env.CLINICOS_MVP_DATABASE_TOKEN}`
  );
  const client = await pool.connect();
  try {
    await transaction(client, async (c) => {
      const invoice = await fixtureInvoice(c);
      const now = new Date("2026-09-26T18:30:00Z");
      const execute = (kind, fields = {}) =>
        executeFinancialCommand(
          c,
          scope,
          {
            kind,
            ...(["advance_returned", "payment_refund"].includes(kind)
              ? { method: "bank_transfer" }
              : {}),
            reason: "Synthetic safety verification",
            reference: randomUUID(),
            ...fields
          },
          now
        );
      const advance = await execute("advance_received", {
        patientId: invoice.patient,
        amountMinor: 5000,
        method: "cash"
      });
      const allocation = await execute("advance_allocated", {
        patientId: invoice.patient,
        invoiceId: invoice.id,
        targetEntryId: advance.id,
        amountMinor: 3000,
        expectedVersion: 1
      });
      await rejected(
        c,
        () =>
          execute("advance_allocated", {
            patientId: invoice.patient,
            invoiceId: invoice.id,
            targetEntryId: advance.id,
            amountMinor: 1,
            expectedVersion: 1
          }),
        /Invoice changed/
      );
      await rejected(
        c,
        () =>
          execute("advance_returned", {
            patientId: invoice.patient,
            targetEntryId: advance.id,
            amountMinor: 2001
          }),
        /exceeds/
      );
      await execute("allocation_reversed", {
        patientId: invoice.patient,
        invoiceId: invoice.id,
        targetEntryId: allocation.id,
        amountMinor: 1000,
        expectedVersion: 2
      });
      await execute("advance_returned", {
        patientId: invoice.patient,
        targetEntryId: advance.id,
        amountMinor: 3000
      });
      await rejected(
        c,
        () =>
          execute("advance_returned", {
            patientId: invoice.patient,
            targetEntryId: advance.id,
            amountMinor: 1
          }),
        /exceeds/
      );
      await rejected(
        c,
        () =>
          executeFinancialCommand(
            c,
            scope,
            {
              kind: "advance_received",
              patientId: invoice.patient,
              amountMinor: 5000,
              method: "cash",
              reference: advance.reference,
              reason: "Synthetic duplicate"
            },
            now
          ),
        { code: "23505" }
      );
      const other = (
        await c.query(
          "insert into patients(tenant_id,clinic_id,full_name) values($1,$2,'Synthetic other account') returning id",
          s.slice(0, 2)
        )
      ).rows[0];
      assert.ok(other, "Synthetic seed requires a second patient");
      await rejected(
        c,
        () =>
          execute("advance_returned", {
            patientId: other.id,
            targetEntryId: advance.id,
            amountMinor: 1
          }),
        /does not belong/
      );
      await rejected(
        c,
        () => c.query("update financial_entries set amount_minor=1 where id=$1", [advance.id]),
        /immutable|cannot|append|mutation/i
      );
      const account = await getFinancialAccount(c, scope, invoice.patient);
      assert.equal(account.advances.find((a) => a.id === advance.id).availableMinor, 0);
      const day = await getFinancialDay(c, scope, "2026-09-27");
      assert.ok(day.entries.some((e) => e.id === advance.id));
      assert.ok(
        !(await getFinancialDay(c, scope, "2026-09-26")).entries.some((e) => e.id === advance.id)
      );
      const foreign = { ...scope, clinicId: "20000000-0000-4000-8000-000000000101" };
      await rejected(c, () => getFinancialAccount(c, foreign, invoice.patient), /not found/);
      await c.query("select set_config('app.clinic_id',$1,true)", [foreign.clinicId]);
      assert.equal(
        (await c.query("select id from financial_entries where id=$1", [advance.id])).rows.length,
        0
      );
      await c.query("select set_config('app.clinic_id',$1,true)", [scope.clinicId]);
      checks.push(
        "advance allocation/reversal/return limits, stale version, duplicate reference, wrong patient, immutability, forced RLS and Asia/Kolkata midnight"
      );
      for (let index = 0; index < 101; index++)
        await execute("advance_received", {
          patientId: invoice.patient,
          amountMinor: 1,
          method: "cash"
        });
      const first = await getFinancialAccount(c, scope, invoice.patient);
      assert.equal(first.entries.length, 100);
      assert.equal(first.advances.length, 100);
      assert.ok(first.nextCursor);
      assert.ok(first.nextAdvanceCursor);
      const second = await getFinancialAccount(
        c,
        scope,
        invoice.patient,
        first.nextCursor,
        first.nextAdvanceCursor
      );
      assert.equal(new Set([...first.entries, ...second.entries].map((e) => e.id)).size, 105);
      assert.equal(new Set([...first.advances, ...second.advances].map((e) => e.id)).size, 102);
      checks.push(
        "financial history and advances cross the 100-row page boundary without loss or duplication"
      );
      const providerInvoice = await fixtureInvoice(c);
      await capturedAndRefunds(c, providerInvoice, true);
      checks.push("provider excess-only and full refund projections do not double-count captures");
      const rows = Array.from({ length: 101 }, (_, n) => ({
        date: "2026-10-01 10:30:00",
        patientNumber: `Synthetic-${n}`,
        patientName: "Synthetic Source",
        doctorName: "Synthetic Doctor",
        status: "Scheduled"
      }));
      const digest = createHash("sha256")
        .update(canonicalAppointmentObservations(rows))
        .digest("hex");
      const run = await createAppointmentImport(c, scope, {
        sourceSystem: randomUUID(),
        digest,
        rowCount: 101
      });
      await stageAppointmentObservations(c, scope, run.id, { offset: 0, rows: rows.slice(0, 100) });
      await rejected(
        c,
        () => sealAppointmentImport(c, scope, run.id, now),
        /incomplete|missing|count/i
      );
      let details = await getAppointmentImport(c, scope, run.id, 0);
      await rejected(
        c,
        () => lockAppointmentObservation(c, scope, run.id, details.rows[0].id),
        /sealed|complete/i
      );
      await stageAppointmentObservations(c, scope, run.id, { offset: 100, rows: rows.slice(100) });
      await sealAppointmentImport(c, scope, run.id, now);
      await stageAppointmentObservations(c, scope, run.id, { offset: 0, rows: rows.slice(0, 100) });
      await rejected(
        c,
        () =>
          stageAppointmentObservations(c, scope, run.id, {
            offset: 0,
            rows: [{ ...rows[0], patientName: "Changed" }, ...rows.slice(1, 100)]
          }),
        /differs/
      );
      details = await getAppointmentImport(c, scope, run.id, 0);
      assert.equal(details.rows.length, 50);
      assert.equal(details.nextOffset, 50);
      await lockAppointmentObservation(c, scope, run.id, details.rows[0].id);
      await decideAppointmentObservation(
        c,
        scope,
        run.id,
        details.rows[0].id,
        {
          decision: "history",
          reason: "Synthetic evidence"
        },
        now
      );
      await rejected(
        c,
        () => lockAppointmentObservation(c, scope, run.id, details.rows[0].id),
        /review|pending|decided/i
      );
      await rejected(
        c,
        () =>
          c.query("update appointment_source_observations set source_data='{}' where id=$1", [
            details.rows[0].id
          ]),
        /immutable/
      );
      checks.push(
        "101-row source completeness/seal, incomplete review denial, exact replay, changed evidence rejection, pagination and permanent decision"
      );
    });
  } finally {
    client.release();
  }
  // Historical data backfill runs as the migration owner in a transaction that always rolls back.
  const migrationUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  assert.equal(migrationUrl.hostname, url.hostname);
  assert.equal(migrationUrl.port, url.port);
  assert.equal(migrationUrl.pathname, url.pathname);
  assert.equal(migrationUrl.username, "clinic_os_migrator");
  const migrator = new Pool({ connectionString: migrationUrl.href, max: 1 });
  const m = await migrator.connect();
  try {
    await transaction(m, async (c) => {
      const inv = await fixtureInvoice(c);
      await capturedAndRefunds(c, inv, false);
      const migration = await readFile(
        new URL("../packages/db/migrations/0030_financial_operations.sql", import.meta.url),
        "utf8"
      );
      await c.query(migration.slice(migration.indexOf("-- Reconcile historical provider refunds")));
      const row = (
        await c.query(
          "select paid_minor,refunded_minor,balance_minor,payment_status from invoices where id=$1",
          [inv.id]
        )
      ).rows[0];
      assert.deepEqual(row, {
        paid_minor: "10000",
        refunded_minor: "10000",
        balance_minor: "10000",
        payment_status: "refunded"
      });
      const rls = await c.query(
        "select bool_and(relforcerowsecurity) as forced from pg_class where relname in ('invoices','payment_transactions','payment_requests')"
      );
      assert.equal(rls.rows[0].forced, true);
      checks.push(
        "historical refund backfill corrects original double-counting and restores forced RLS"
      );
    });
  } finally {
    m.release();
    await migrator.end();
  }
  console.log(JSON.stringify({ passed: checks, committedTestChanges: false }, null, 2));
} finally {
  await pool.end();
}
