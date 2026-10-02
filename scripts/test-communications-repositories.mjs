#!/usr/bin/env node
// Disposable synthetic database only. No provider network transport is constructed.
import assert from "node:assert/strict";
import { randomUUID, createHash, createHmac } from "node:crypto";
import { Pool } from "pg";
import {
  CHECKPOINT1_SEED_IDS as IDs,
  PostgresClinicUnitOfWork,
  createPostgresClinicModuleUnitOfWork,
  PostgresProviderCallbackRegistrationResolver
} from "@clinic-os/db";
import {
  listCommunicationThreads,
  getCommunicationThread,
  communicationConfiguration,
  previewCommunicationAppointment,
  executeCommunicationCommand
} from "../packages/db/src/communications.ts";
import { createCommunicationHandlers as createApiCommunicationHandlers } from "../apps/api/src/features/communications.ts";
import { parseNativeOperationResponse } from "../packages/api-contracts/src/native-http-contracts.ts";
import { createCommunicationHandlers } from "../apps/worker/src/cp15/communication-handlers.ts";
import { PostgresOfficialProviderCallbackRuntime } from "../apps/api/src/providers/cp15/official-provider-callback-runtime.ts";
assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
assert.equal(process.argv.length, 2);
assert.match(process.env.CLINICOS_MVP_DATABASE_TOKEN ?? "", /^[a-f0-9]{32}$/);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "clinic_os_runtime");
assert.equal(url.pathname, "/clinic_os");
assert.equal(url.search, "");
assert.equal(url.hash, "");
const pool = new Pool({ connectionString: url.href, max: 5 });
const scope = { tenantId: IDs.tenantId, clinicId: IDs.clinicId, actorUserId: IDs.users.owner };
const a = [scope.tenantId, scope.clinicId];
let clock = new Date();
const now = () => new Date(clock),
  checks = [];
const hash = (v) => createHash("sha256").update(v).digest("hex");
const account = randomUUID(),
  system = randomUUID(),
  patient = randomUUID(),
  template = randomUUID(),
  registration = randomUUID(),
  key = randomUUID() + randomUUID(),
  secret = "synthetic-communication-secret-do-not-use",
  hmac = Buffer.from("synthetic-endpoint-hmac-secret-00000000000000000001");
const refs = {
  api: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:communications/api-AbCd12",
  app: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:communications/app-AbCd12",
  verify: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:communications/verify-AbCd12"
};
const secrets = {
  async resolveSecret(ref) {
    assert.ok(Object.values(refs).includes(ref));
    return secret;
  }
};
async function run(work, s = scope) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
      [s.tenantId, s.clinicId, s.actorUserId]
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
const featureHandlers = createApiCommunicationHandlers(true);
const featureUnit = createPostgresClinicModuleUnitOfWork({ client: pool, resolveScope: (s) => s });
async function feature(operationId, body) {
  const response = await featureUnit.run(scope, (context) =>
    featureHandlers[operationId](
      {
        operationId,
        access: {
          context: { tenant: { id: scope.tenantId }, user: { id: scope.actorUserId } },
          clinicId: scope.clinicId
        },
        parsed: { path: {}, query: {}, headers: {}, body },
        metadata: {
          requestId: randomUUID(),
          receivedAt: now(),
          ipAddress: null,
          userAgent: "synthetic-native-proof"
        }
      },
      { ...context, clock: { now } }
    )
  );
  const result = parseNativeOperationResponse(operationId, response.status, response.body);
  assert.equal(result.success, true, JSON.stringify(result));
  return response.body;
}
const command = (b) => run((c) => executeCommunicationCommand(c, scope, b, now()));
const thread = async () => run((c) => getCommunicationThread(c, scope, threadId, now()));
let threadId;
const definition = {
  id: "300000000000001",
  name: "clinic_appointment",
  language: "en",
  status: "APPROVED",
  category: "UTILITY",
  components: [{ type: "BODY", text: "Hello. {{1}} Please contact the clinic for changes." }]
};
let providerResult = "accepted_by_provider",
  calls = 0,
  readerFailure = false;
let readerOverride = null,
  constructionFailure = false;
const handlers = createCommunicationHandlers({
  pool,
  secrets,
  endpointHmacSecret: hmac,
  now,
  templateReader: {
    async read() {
      if (readerOverride) return readerOverride();
      if (readerFailure) throw Error("synthetic unavailable");
      return definition;
    }
  },
  clientFactory: () => {
    if (constructionFailure) throw Error("synthetic bad configuration");
    return {
      async sendApprovedTemplate(input) {
        calls++;
        assert.equal(input.recipientPhoneE164, "+919999888877");
        assert.equal(input.policy.purpose, "appointment");
        if (providerResult === "throw") throw Error("synthetic ambiguous");
        return {
          outcome: providerResult,
          providerMessageId:
            providerResult === "accepted_by_provider" ? `wamid.synthetic.${calls}` : null,
          providerHttpStatus: 400
        };
      }
    };
  }
});
async function event(id) {
  return run(async (c) => {
    const r = (
      await c.query(
        "select * from outbox_events where tenant_id=$1 and clinic_id=$2 and aggregate_id=$3 order by occurred_at desc limit 1",
        [...a, id]
      )
    ).rows[0];
    assert.ok(r);
    return {
      eventId: r.id,
      eventType: r.event_type,
      tenantId: r.tenant_id,
      clinicId: r.clinic_id,
      aggregateId: r.aggregate_id,
      aggregateType: r.aggregate_type,
      actor: { id: r.actor_id, type: r.actor_type },
      payload: r.payload,
      idempotencyKey: r.idempotency_key,
      correlationId: r.correlation_id,
      occurredAt: r.occurred_at.toISOString()
    };
  });
}
async function processEvent(id) {
  const e = await event(id);
  await handlers.find((h) => h.eventType === e.eventType).handle(e, {});
}
let appointmentNumber = 0;
async function appointment() {
  appointmentNumber++;
  return run(async (c) => {
    const id = randomUUID();
    await c.query(
      `insert into appointments(id,tenant_id,clinic_id,patient_id,provider_user_id,appointment_type_id,status,start_at,end_at,source) values($1,$2,$3,$4,$5,$6,'booked',$7,$8,'manual')`,
      [
        id,
        ...a,
        patient,
        IDs.users.doctor,
        IDs.appointmentTypes.consultation,
        new Date(clock.getTime() + 86400000 * appointmentNumber),
        new Date(clock.getTime() + 86400000 * appointmentNumber + 1800000)
      ]
    );
    return id;
  });
}
async function approve(id) {
  const p = await run((c) =>
    previewCommunicationAppointment(
      c,
      scope,
      { threadId, appointmentId: id, templateId: template },
      now()
    )
  );
  return command({
    kind: "approve",
    threadId,
    appointmentId: id,
    templateId: template,
    expectedDigest: p.digest
  });
}
async function requestState(id) {
  return run(
    async (c) =>
      (await c.query("select status,failure_code from communication_requests where id=$1", [id]))
        .rows[0]
  );
}
try {
  const marker = await pool.query(
    "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
  );
  assert.equal(
    marker.rows[0].marker,
    `ClinicOS disposable MVP acceptance ${process.env.CLINICOS_MVP_DATABASE_TOKEN}`
  );
  await run(async (c) => {
    await c.query(
      `insert into external_systems(id,tenant_id,provider_key,display_name,status) values($1,$2,'meta_whatsapp_cloud','Synthetic communications','available')`,
      [system, scope.tenantId]
    );
    await c.query(
      `insert into external_accounts(id,tenant_id,clinic_id,external_system_id,account_type,status) values($1,$2,$3,$4,'Synthetic communications','available')`,
      [account, ...a, system]
    );
    await c.query(
      `insert into provider_callback_registrations(id,tenant_id,clinic_id,external_account_id,provider_key,callback_key_digest,activation_state,provider_mode,provider_account_id,provider_endpoint_id,api_version,api_credential_ref,webhook_secret_ref,webhook_secret_version,verification_token_ref,callback_origin,sandbox_verified_at) values($1,$2,$3,$4,'meta_whatsapp_cloud',$5,'sandbox_verified','test','100000000000001','200000000000001','v23.0',$6,$7,'synthetic-v1',$8,'https://synthetic.invalid',$9)`,
      [registration, ...a, account, hash(key), refs.api, refs.app, refs.verify, now()]
    );
    await c.query(
      `insert into patients(id,tenant_id,clinic_id,full_name,phone) values($1,$2,$3,'Synthetic Communications Contact','+919999888877')`,
      [patient, ...a]
    );
    await c.query(
      `insert into consents(tenant_id,clinic_id,patient_id,purpose,template_code,template_version,capture_method,created_by_user_id) values($1,$2,$3,'whatsapp_communication','synthetic',1,'clinic_staff',$4)`,
      [...a, patient, scope.actorUserId]
    );
  });
  const runtime = new PostgresOfficialProviderCallbackRuntime({
    registrations: new PostgresProviderCallbackRegistrationResolver(pool),
    secrets,
    rawBodyStore: {
      async put(i) {
        return { ciphertextRef: `restricted://synthetic/${i.rawEventId}` };
      },
      async deleteUncommitted() {}
    },
    unitOfWork: new PostgresClinicUnitOfWork(pool, { clock: { now } }),
    endpointHmacSecret: hmac,
    now
  });
  const inbound = (i, text = "Synthetic incoming appointment enquiry", type = "text") => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000001",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "200000000000001" },
              messages: [
                {
                  from: "919999888877",
                  id: `wamid.communication.${i}`,
                  timestamp: String(Math.floor(clock.getTime() / 1000)),
                  type,
                  ...(type === "text"
                    ? { text: { body: text } }
                    : {
                        image: {
                          id: "500000000000001",
                          mime_type: "image/jpeg",
                          sha256: "synthetic"
                        }
                      })
                }
              ]
            }
          }
        ]
      }
    ]
  });
  async function webhook(body, invalid = false) {
    const rawBody = Buffer.from(JSON.stringify(body));
    return runtime.receiveMetaWebhook({
      registrationKey: key,
      rawBody,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${invalid ? "0".repeat(64) : createHmac("sha256", secret).update(rawBody).digest("hex")}`
      },
      receivedAt: now().toISOString(),
      correlationId: "synthetic-communication-probe"
    });
  }
  await assert.rejects(webhook(inbound("invalid"), true));
  assert.equal((await run((c) => listCommunicationThreads(c, scope))).threads.length, 0);
  await webhook(inbound(1));
  await webhook(inbound(1));
  let list = await run((c) => listCommunicationThreads(c, scope));
  assert.equal(list.threads.length, 1);
  threadId = list.threads[0].id;
  assert.equal(list.threads[0].patientId, null);
  assert.equal((await thread()).messages.length, 1);
  checks.push("signed callback, invalid signature, replay and explicit identity");
  for (let i = 2; i <= 52; i++) await webhook(inbound(i));
  await webhook(inbound("media", "", "image"));
  const page = await thread();
  assert.equal(page.messages.length, 50);
  assert.ok(page.messages.some((m) => m.unsupportedContent && m.text === null));
  const older = await run((c) =>
    getCommunicationThread(c, scope, threadId, now(), page.nextBeforeSequence)
  );
  assert.equal(older.messages.length, 3);
  assert.equal(new Set([...page.messages, ...older.messages].map((m) => m.id)).size, 53);
  await command({ kind: "read", threadId, throughSequence: 53 });
  await command({ kind: "read", threadId, throughSequence: 3 });
  assert.equal((await thread()).thread.unread, false);
  const other = { ...scope, clinicId: randomUUID() };
  assert.equal((await run((c) => listCommunicationThreads(c, other), other)).threads.length, 0);
  await assert.rejects(run((c) => getCommunicationThread(c, other, threadId, now()), other));
  checks.push("message paging, unsupported media, read watermark and clinic isolation");
  const t = (await thread()).thread;
  await assert.rejects(
    command({
      kind: "update",
      threadId,
      expectedVersion: t.rowVersion,
      status: "waiting",
      assignedUserId: IDs.users.accountant
    })
  );
  const raced = await Promise.allSettled([
    command({
      kind: "update",
      threadId,
      expectedVersion: t.rowVersion,
      status: "waiting",
      assignedUserId: IDs.users.receptionist
    }),
    command({
      kind: "update",
      threadId,
      expectedVersion: t.rowVersion,
      status: "handled",
      assignedUserId: null
    })
  ]);
  assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
  checks.push("staff eligibility and concurrent version conflict");
  await command({
    kind: "link",
    threadId,
    expectedVersion: (await thread()).thread.rowVersion,
    patientId: patient,
    leadId: null,
    reason: "Synthetic identity verified explicitly"
  });
  await webhook({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000001",
        changes: [
          {
            field: "message_template_status_update",
            value: {
              event: "APPROVED",
              message_template_id: "300000000000001",
              message_template_name: "clinic_appointment",
              message_template_language: "en"
            }
          }
        ]
      }
    ]
  });
  // Use the actual signed lifecycle evidence, then bind the test's stable template ID.
  let savedTemplate = await run(
    async (c) =>
      (
        await c.query(
          "select id from meta_whatsapp_template_snapshots where tenant_id=$1 and clinic_id=$2 and external_account_id=$3",
          [...a, account]
        )
      ).rows[0]
  );
  assert.ok(savedTemplate);
  // The ID remains provider-owned database state; command helper receives that exact id.
  await run((c) =>
    c.query("update meta_whatsapp_template_snapshots set id=$1 where id=$2", [
      template,
      savedTemplate.id
    ])
  );
  const synced = await command({ kind: "sync_template", templateId: template });
  await processEvent(synced.id);
  assert.equal(
    (await run((c) => communicationConfiguration(c, scope, now()))).templates.find(
      (t) => t.id === template
    ).syncStatus,
    "ready"
  );
  checks.push("official template reader via typed synthetic port and fresh worker RLS scope");
  const goodAppointment = await appointment(),
    p = await feature("previewCommunicationAppointment", {
      threadId,
      appointmentId: goodAppointment,
      templateId: template
    });
  assert.match(p.text, /Your appointment at/);
  assert.equal(p.recipient, "+919999888877");
  const approved = await feature("executeCommunicationCommand", {
    kind: "approve",
    threadId,
    appointmentId: goodAppointment,
    templateId: template,
    expectedDigest: p.digest
  });
  await processEvent(approved.id);
  await processEvent(approved.id);
  assert.equal(calls, 1);
  assert.equal((await requestState(approved.id)).status, "accepted");
  await assert.rejects(approve(goodAppointment));
  checks.push("review digest, accepted dispatch replay and duplicate send prevention");
  const changed = await appointment(),
    preview = await run((c) =>
      previewCommunicationAppointment(
        c,
        scope,
        { threadId, appointmentId: changed, templateId: template },
        now()
      )
    );
  await run((c) =>
    c.query(
      "update appointments set start_at=start_at+interval '1 hour',end_at=end_at+interval '1 hour',row_version=row_version+1 where id=$1",
      [changed]
    )
  );
  await assert.rejects(
    command({
      kind: "approve",
      threadId,
      appointmentId: changed,
      templateId: template,
      expectedDigest: preview.digest
    })
  );
  const drift = await approve(changed);
  await run((c) =>
    c.query("update appointments set status='cancelled',row_version=row_version+1 where id=$1", [
      changed
    ])
  );
  await processEvent(drift.id);
  assert.equal((await requestState(drift.id)).status, "blocked");
  assert.equal(calls, 1);
  checks.push("changed preview and cancelled appointment fail closed");
  providerResult = "not_dispatched";
  const retry = await approve(await appointment());
  for (let i = 0; i < 3; i++) await assert.rejects(processEvent(retry.id));
  await processEvent(retry.id);
  assert.equal((await requestState(retry.id)).status, "blocked");
  assert.equal(calls, 4);
  checks.push("three proven no-dispatch attempts and bounded exhaustion");
  providerResult = "dispatch_ambiguous";
  const ambiguous = await approve(await appointment());
  await processEvent(ambiguous.id);
  await processEvent(ambiguous.id);
  assert.equal((await requestState(ambiguous.id)).status, "ambiguous");
  assert.equal(calls, 5);
  assert.equal(
    await run(
      async (c) =>
        (await c.query("select count(*)::int n from meta_whatsapp_reconciliation_jobs")).rows[0].n
    ),
    1
  );
  checks.push("ambiguous outcome schedules reconciliation without replay");
  providerResult = "accepted_by_provider";
  const expires = await approve(await appointment());
  clock = new Date(clock.getTime() + 901000);
  await processEvent(expires.id);
  assert.equal((await requestState(expires.id)).status, "blocked");
  assert.equal(calls, 5);
  checks.push("expired approval never dispatched");
  providerResult = "accepted_by_provider";
  const templateDrift = await approve(await appointment());
  readerOverride = async () => ({
    ...definition,
    components: [{ type: "BODY", text: "Changed. {{1}}" }]
  });
  await processEvent(templateDrift.id);
  assert.equal((await requestState(templateDrift.id)).status, "rejected");
  assert.equal(calls, 5);
  readerOverride = null;
  checks.push("provider template content drift never sends unreviewed text");
  const beforeConstruction = calls,
    configurationBlocked = await approve(await appointment());
  constructionFailure = true;
  await processEvent(configurationBlocked.id);
  assert.equal((await requestState(configurationBlocked.id)).status, "blocked");
  assert.equal(calls, beforeConstruction);
  constructionFailure = false;
  const late = await approve(await appointment());
  let announce, failReader;
  const started = new Promise((resolve) => {
    announce = resolve;
  });
  readerOverride = () =>
    new Promise((_resolve, reject) => {
      failReader = reject;
      announce();
    });
  const firstAttempt = processEvent(late.id);
  const handled = assert.rejects(firstAttempt);
  await started;
  clock = new Date(clock.getTime() + 121000);
  await processEvent(late.id);
  assert.equal((await requestState(late.id)).status, "ambiguous");
  failReader(Error("synthetic late read failure"));
  await handled;
  readerOverride = null;
  assert.equal((await requestState(late.id)).status, "ambiguous");
  assert.equal(calls, beforeConstruction);
  checks.push("expired worker lease and delayed reader failure preserve fenced ambiguous evidence");
  const status = (value, i) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "100000000000001",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "200000000000001" },
              statuses: [
                {
                  id: "wamid.synthetic.1",
                  status: value,
                  timestamp: String(Math.floor(clock.getTime() / 1000) + i),
                  recipient_id: "919999888877"
                }
              ]
            }
          }
        ]
      }
    ]
  });
  await webhook(status("read", 0));
  await webhook(status("delivered", 1));
  await webhook(status("read", 0));
  const delivery = await run(
    async (c) =>
      (
        await c.query(
          "select state from meta_whatsapp_outbound_messages where message_request_id=$1",
          [approved.id]
        )
      ).rows[0]
  );
  assert.equal(delivery.state, "read");
  assert.equal(
    await run(
      async (c) =>
        (await c.query("select status from appointments where id=$1", [goodAppointment])).rows[0]
          .status
    ),
    "booked"
  );
  checks.push("signed reordered delivery receipts are monotonic and never confirm attendance");
  await run(async (c) => {
    await c.query("savepoint page_probe");
    for (let i = 0; i < 53; i++)
      await c.query(
        `insert into communication_threads(tenant_id,clinic_id,external_account_id,contact,created_at) values($1,$2,$3,$4,$5)`,
        [...a, account, `+91999977${String(i).padStart(4, "0")}`, "2026-01-01T00:00:00Z"]
      );
    const first = await listCommunicationThreads(c, scope, { status: "open" });
    assert.equal(first.threads.length, 50);
    await c.query("update communication_threads set status='handled' where id=$1", [
      first.nextCursor
    ]);
    const second = await listCommunicationThreads(c, scope, {
      status: "open",
      cursor: first.nextCursor
    });
    assert.ok(second.threads.length > 0);
    assert.equal(
      new Set([...first.threads, ...second.threads].map((t) => t.id)).size,
      first.threads.length + second.threads.length
    );
    await c.query("rollback to savepoint page_probe");
  });
  checks.push("stable thread pagination survives a concurrent anchor status change");
  // Shared family endpoint: STOP must block even though patient_contacts cannot uniquely identify a patient.
  await webhook(inbound("stop", "STOP"));
  await assert.rejects(approve(await appointment()), /opt-out/);
  checks.push("shared-contact opt-out blocks otherwise active patient consent");
  await command({
    kind: "update",
    threadId,
    expectedVersion: (await thread()).thread.rowVersion,
    status: "open",
    assignedUserId: IDs.users.receptionist
  });
  // Separate eligible contact for real HTTP/browser preview/approval. No worker
  // is started by that harness, and queued messages are cancelled in the test.
  await run(async (c) => {
    const p = randomUUID(),
      appointmentId = randomUUID();
    await c.query(
      "insert into patients(id,tenant_id,clinic_id,full_name,phone) values($1,$2,$3,'Synthetic Message Approval','+919999888899')",
      [p, ...a]
    );
    await c.query(
      "insert into consents(tenant_id,clinic_id,patient_id,purpose,template_code,template_version,capture_method,created_by_user_id) values($1,$2,$3,'whatsapp_communication','synthetic',1,'clinic_staff',$4)",
      [...a, p, scope.actorUserId]
    );
    await c.query(
      "insert into appointments(id,tenant_id,clinic_id,patient_id,provider_user_id,appointment_type_id,status,start_at,end_at,source) values($1,$2,$3,$4,$5,$6,'booked',$7,$8,'manual')",
      [
        appointmentId,
        ...a,
        p,
        IDs.users.doctor,
        IDs.appointmentTypes.consultation,
        new Date(clock.getTime() + 100 * 86400000),
        new Date(clock.getTime() + 100 * 86400000 + 1800000)
      ]
    );
    const opened = await executeCommunicationCommand(
      c,
      scope,
      { kind: "start", accountId: account, patientId: p },
      now()
    );
    await executeCommunicationCommand(
      c,
      scope,
      {
        kind: "link",
        threadId: opened.threadId,
        expectedVersion: 1,
        patientId: p,
        leadId: null,
        reason: "Synthetic browser approval identity"
      },
      now()
    );
  });
  console.log(
    JSON.stringify(
      { syntheticOnly: true, checks, passed: checks.length, liveProviderCalls: 0 },
      null,
      2
    )
  );
} finally {
  await pool.end();
}
