#!/usr/bin/env node
// Seed through the verified callback boundary at schema 035, then verify 036 backfill.
// The native harness alone provisions this disposable, token-marked synthetic database.
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  CHECKPOINT1_SEED_IDS as IDs,
  PostgresClinicUnitOfWork,
  PostgresProviderCallbackRegistrationResolver
} from "@clinic-os/db";
import { PostgresOfficialProviderCallbackRuntime } from "../apps/api/src/providers/cp15/official-provider-callback-runtime.ts";
assert.equal(process.argv.length, 3);
const phase = process.argv[2];
assert.ok(["seed", "verify"].includes(phase));
assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
assert.match(process.env.CLINICOS_MVP_DATABASE_TOKEN ?? "", /^[a-f0-9]{32}$/u);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "clinic_os_runtime");
assert.equal(url.pathname, "/clinic_os");
assert.equal(url.search, "");
assert.equal(url.hash, "");
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
  } catch (error) {
    await c.query("rollback");
    throw error;
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
      (await pool.query("select to_regclass('communication_threads') table_name")).rows[0]
        .table_name,
      null
    );
    const system = randomUUID(),
      account = randomUUID(),
      key = randomUUID() + randomUUID();
    const secret = "synthetic-upgrade-callback-secret-do-not-use";
    const refs = ["api", "app", "verify"].map(
      (v) =>
        `arn:aws:secretsmanager:ap-south-1:123456789012:secret:communications-upgrade/${v}-AbCd12`
    );
    await run(async (c) => {
      await c.query(
        "insert into external_systems(id,tenant_id,provider_key,display_name,status) values($1,$2,'meta_whatsapp_cloud','Synthetic upgrade backfill','available')",
        [system, scope[0]]
      );
      await c.query(
        "insert into external_accounts(id,tenant_id,clinic_id,external_system_id,account_type,status) values($1,$2,$3,$4,'Synthetic upgrade backfill','available')",
        [account, ...scope.slice(0, 2), system]
      );
      await c.query(
        `insert into provider_callback_registrations(id,tenant_id,clinic_id,external_account_id,provider_key,callback_key_digest,activation_state,provider_mode,provider_account_id,provider_endpoint_id,api_version,api_credential_ref,webhook_secret_ref,webhook_secret_version,verification_token_ref,callback_origin,sandbox_verified_at) values($1,$2,$3,$4,'meta_whatsapp_cloud',$5,'sandbox_verified','test','100000000000002','200000000000002','v23.0',$6,$7,'synthetic-v1',$8,'https://synthetic.invalid',now())`,
        [
          randomUUID(),
          ...scope.slice(0, 2),
          account,
          createHash("sha256").update(key).digest("hex"),
          ...refs
        ]
      );
    });
    const runtime = new PostgresOfficialProviderCallbackRuntime({
      registrations: new PostgresProviderCallbackRegistrationResolver(pool),
      secrets: {
        async resolveSecret(ref) {
          assert.ok(refs.includes(ref));
          return secret;
        }
      },
      rawBodyStore: {
        async put(input) {
          return { ciphertextRef: `restricted://synthetic/${input.rawEventId}` };
        },
        async deleteUncommitted() {}
      },
      unitOfWork: new PostgresClinicUnitOfWork(pool),
      endpointHmacSecret: Buffer.from("synthetic-upgrade-endpoint-secret-0000000000000000001")
    });
    const now = new Date();
    const rawBody = Buffer.from(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [
          {
            id: "100000000000002",
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: "200000000000002" },
                  messages: [1, 2].map((n) => ({
                    from: "919999888866",
                    id: `wamid.upgrade.${n}`,
                    timestamp: String(Math.floor(now.getTime() / 1000) - n),
                    type: "text",
                    text: { body: `Synthetic pre-upgrade message ${n}` }
                  }))
                }
              }
            ]
          }
        ]
      })
    );
    const input = {
      registrationKey: key,
      rawBody,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`
      },
      receivedAt: now.toISOString(),
      correlationId: "synthetic-upgrade"
    };
    await runtime.receiveMetaWebhook(input);
    await runtime.receiveMetaWebhook(input);
    assert.equal(
      await run(async (c) =>
        Number(
          (
            await c.query(
              "select count(*) from meta_whatsapp_event_receipts where application_outcome='applied' and event_kind='inbound_message'"
            )
          ).rows[0].count
        )
      ),
      2
    );
    console.log(JSON.stringify({ phase, passed: true, verifiedHistoricalReceipts: 2 }));
  } else {
    await run(async (c) => {
      const threads = (await c.query("select * from communication_threads")).rows;
      assert.equal(threads.length, 1);
      assert.equal(threads[0].contact, "+919999888866");
      assert.equal(threads[0].patient_id, null);
      assert.equal(Number(threads[0].latest_sequence), 2);
      const messages = (
        await c.query(
          "select m.*,n.normalized_payload->>'text' body from communication_messages m join meta_whatsapp_event_receipts e on e.id=m.receipt_id join normalized_integration_events n on n.id=e.normalized_event_id"
        )
      ).rows;
      assert.equal(messages.length, 2);
      assert.deepEqual(messages.map((m) => m.body).sort(), [
        "Synthetic pre-upgrade message 1",
        "Synthetic pre-upgrade message 2"
      ]);
      assert.equal(new Set(messages.map((m) => Number(m.sequence))).size, 2);
      await c.query(
        "update meta_whatsapp_event_receipts set application_outcome=application_outcome where event_kind='inbound_message'"
      );
      assert.equal(
        Number((await c.query("select count(*) from communication_messages")).rows[0].count),
        2
      );
    });
    const names = [
      "communication_threads",
      "communication_reads",
      "communication_template_definitions",
      "communication_requests",
      "communication_messages",
      "meta_whatsapp_event_receipts",
      "normalized_integration_events"
    ];
    const tables = (
      await pool.query(
        "select relname,relrowsecurity,relforcerowsecurity from pg_class where relname=any($1::text[])",
        [names]
      )
    ).rows;
    assert.equal(tables.length, 7);
    assert.ok(tables.every((t) => t.relrowsecurity && t.relforcerowsecurity));
    assert.equal((await pool.query("select id from communication_threads")).rows.length, 0);
    console.log(
      JSON.stringify({
        phase,
        passed: true,
        backfilledMessages: 2,
        replayDuplicates: 0,
        forcedRlsTables: 7,
        unscopedVisibleThreads: 0
      })
    );
  }
} finally {
  await pool.end();
}
