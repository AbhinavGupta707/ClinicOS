#!/usr/bin/env node
// The native harness provisions a token-marked disposable database at schema 036.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { CHECKPOINT1_SEED_IDS as IDs } from "@clinic-os/db";
import { createScopedMetaInstructionSender } from "../apps/worker/src/cp15/scoped-meta-instruction-sender.ts";
const phase = process.argv[2];
assert.equal(process.argv.length, 3);
assert.ok(["seed", "verify"].includes(phase));
assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
assert.match(process.env.CLINICOS_MVP_DATABASE_TOKEN ?? "", /^[a-f0-9]{32}$/);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "clinic_os_runtime");
assert.equal(url.pathname, "/clinic_os");
assert.equal(url.search + url.hash, "");
const pool = new Pool({ connectionString: url.href, max: 3 });
const scope = [IDs.tenantId, IDs.clinicId, IDs.users.owner];
async function run(work) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
      scope
    );
    const result = await work(c);
    await c.query("commit");
    return result;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
try {
  assert.equal(
    (
      await pool.query(
        "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
      )
    ).rows[0].marker,
    `ClinicOS disposable MVP acceptance ${process.env.CLINICOS_MVP_DATABASE_TOKEN}`
  );
  if (phase === "seed") {
    assert.equal(
      (
        await pool.query(
          "select count(*)::int n from information_schema.columns where table_name='patient_instruction_requests' and column_name='dispatch_recipient_phone'"
        )
      ).rows[0].n,
      0
    );
    await run(async (c) => {
      const id = randomUUID(),
        event = randomUUID();
      await c.query(
        `insert into outbox_events(id,tenant_id,clinic_id,event_type,schema_version,actor_type,actor_id,aggregate_type,aggregate_id,patient_id,idempotency_key,correlation_id,payload,occurred_at) values($1,$2,$3,'instruction.send_requested','1.0','user',$4,'patient_instruction',$5,$6,$7,'instruction-upgrade','{}',now())`,
        [event, ...scope, id, IDs.patients.rheaSynthetic, randomUUID()]
      );
      await c.query(
        `insert into patient_instruction_requests(id,tenant_id,clinic_id,created_by_user_id,patient_id,channel,template_id,title,body,status,rendered_at,outbox_event_id) values($1,$2,$3,$4,$5,'whatsapp','synthetic_care','Synthetic pre-037 instruction','Historical synthetic instruction','send_requested',now(),$6)`,
        [id, ...scope, IDs.patients.rheaSynthetic, event]
      );
      const exhausted = randomUUID(),
        action = randomUUID(),
        system = randomUUID(),
        account = randomUUID(),
        audit = randomUUID();
      await c.query(
        "insert into external_systems(id,tenant_id,provider_key,display_name,status) values($1,$2,'meta_whatsapp_cloud','Synthetic upgrade','available')",
        [system, scope[0]]
      );
      await c.query(
        "insert into external_accounts(id,tenant_id,clinic_id,external_system_id,account_type,status) values($1,$2,$3,$4,'Synthetic upgrade','available')",
        [account, ...scope.slice(0, 2), system]
      );
      let consent = (
        await c.query(
          "select id from consents where tenant_id=$1 and patient_id=$2 and purpose='whatsapp_communication' and status='active' limit 1",
          [scope[0], IDs.patients.rheaSynthetic]
        )
      ).rows[0]?.id;
      if (!consent)
        consent = (
          await c.query(
            "insert into consents(tenant_id,clinic_id,patient_id,purpose,template_code,template_version,capture_method,created_by_user_id) values($1,$2,$3,'whatsapp_communication','synthetic',1,'clinic_staff',$4) returning id",
            [...scope.slice(0, 2), IDs.patients.rheaSynthetic, scope[2]]
          )
        ).rows[0].id;
      await c.query(
        "insert into audit_events(id,tenant_id,clinic_id,actor_type,actor_id,action,category,risk_level,phi_involved,occurred_at) values($1,$2,$3,'user',$4,'instruction.send_failed','integration','high',true,now())",
        [audit, ...scope]
      );
      await c.query(
        `insert into outbox_events(id,tenant_id,clinic_id,event_type,schema_version,actor_type,actor_id,aggregate_type,aggregate_id,patient_id,idempotency_key,correlation_id,payload,occurred_at) values($1,$2,$3,'instruction.send_requested','1.0','user',$4,'patient_instruction',$5,$6,$7,'instruction-upgrade','{}',now())`,
        [action, ...scope, exhausted, IDs.patients.rheaSynthetic, randomUUID()]
      );
      await c.query(
        `insert into patient_instruction_requests(id,tenant_id,clinic_id,created_by_user_id,patient_id,channel,template_id,title,body,status,rendered_at,outbox_event_id) values($1,$2,$3,$4,$5,'whatsapp','synthetic_care','Synthetic pre-037 exhausted','Historical synthetic instruction','send_requested',now(),$6)`,
        [exhausted, ...scope, IDs.patients.rheaSynthetic, action]
      );
      await c.query(
        `insert into meta_whatsapp_outbound_messages(tenant_id,clinic_id,external_account_id,message_request_id,patient_id,recipient_endpoint_hmac,purpose,template_name,template_language,consent_evidence_id,consent_template_version,state,dispatch_outcome,dispatch_attempt_count,automatic_retry_allowed,audit_event_id,outbox_event_id) values($1,$2,$3,$4,$5,$6,'care_instruction','synthetic_care','en',$7,1,'send_requested','not_dispatched',3,true,$8,$9)`,
        [
          ...scope.slice(0, 2),
          account,
          exhausted,
          IDs.patients.rheaSynthetic,
          "1".repeat(64),
          consent,
          audit,
          action
        ]
      );
    });
  } else {
    const flags = await run(
      async (c) =>
        (
          await c.query(
            "select o.automatic_retry_allowed,o.dispatch_attempt_count from meta_whatsapp_outbound_messages o join patient_instruction_requests i on i.id=o.message_request_id where i.title='Synthetic pre-037 exhausted'"
          )
        ).rows
    );
    assert.equal(flags.length, 1);
    assert.equal(flags[0].automatic_retry_allowed, false);
    assert.equal(flags[0].dispatch_attempt_count, 3);
    assert.equal(
      (
        await pool.query(
          "select relforcerowsecurity from pg_class where relname='meta_whatsapp_outbound_messages'"
        )
      ).rows[0].relforcerowsecurity,
      true
    );
    const rows = await run(
      async (c) =>
        (
          await c.query(
            `select i.*,e.occurred_at,e.idempotency_key,e.correlation_id from patient_instruction_requests i join outbox_events e on e.id=i.outbox_event_id where i.title='Synthetic pre-037 instruction'`
          )
        ).rows
    );
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.dispatch_recipient_phone, null);
    const sender = createScopedMetaInstructionSender({
      pool,
      endpointHmacSecret: Buffer.alloc(32, 1),
      secrets: {
        async resolveSecret() {
          throw new assert.AssertionError({
            message: "Historical request must never resolve a secret"
          });
        }
      },
      clientFactory() {
        throw new assert.AssertionError({
          message: "Historical request must never construct transport"
        });
      }
    });
    const result = await sender.send({
      tenantId: scope[0],
      clinicId: scope[1],
      actorUserId: scope[2],
      patientId: row.patient_id,
      instructionId: row.id,
      eventId: row.outbox_event_id,
      requestedAt: row.occurred_at.toISOString(),
      idempotencyKey: row.idempotency_key,
      correlationId: row.correlation_id
    });
    assert.equal(result.outcome, "permanent_failure");
    assert.equal(result.failureCode, "INSTRUCTION_REVIEW_REQUIRED");
    await assert.rejects(
      run((c) =>
        c.query(
          "update patient_instruction_requests set dispatch_recipient_phone='+919999999999' where id=$1",
          [row.id]
        )
      ),
      /immutable/
    );
    assert.equal(
      await run(
        async (c) =>
          (
            await c.query(
              "select count(*)::int n from meta_whatsapp_outbound_messages where message_request_id=$1",
              [row.id]
            )
          ).rows[0].n
      ),
      0
    );
    assert.equal((await pool.query("select id from patient_instruction_requests")).rows.length, 0);
  }
  console.log(JSON.stringify({ phase, passed: true, historicalAuthorizationInvented: false }));
} finally {
  await pool.end();
}
