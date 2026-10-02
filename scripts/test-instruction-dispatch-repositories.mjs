#!/usr/bin/env node
// Guarded, disposable synthetic PostgreSQL only; transports never contact Meta.
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { buildAccessContext } from "@clinic-os/auth";
import {
  CHECKPOINT1_SEED_IDS as IDs,
  hasCurrentCommunicationAuthority,
  createPostgresClinicModuleUnitOfWork,
  PostgresClinicUnitOfWork,
  PostgresProviderCallbackRegistrationResolver
} from "@clinic-os/db";
import { Cp13PatientInstructionSendRequestedHandler } from "../apps/worker/dist/outbox/handlers/cp13-patient-instruction-send-requested.js";
import { createTreatmentBillingHandlerMap } from "../apps/api/src/features/treatment-billing/handlers.ts";
import { parseNativeOperationResponse } from "../packages/api-contracts/src/native-http-contracts.ts";
import {
  createScopedMetaInstructionSender,
  MetaInstructionRetryableError
} from "../apps/worker/src/cp15/scoped-meta-instruction-sender.ts";
import { PostgresOfficialProviderCallbackRuntime } from "../apps/api/src/providers/cp15/official-provider-callback-runtime.ts";
assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
assert.match(process.env.CLINICOS_MVP_DATABASE_TOKEN ?? "", /^[a-f0-9]{32}$/);
assert.equal(process.argv.length, 2);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "clinic_os_runtime");
assert.equal(url.pathname, "/clinic_os");
assert.equal(url.search + url.hash, "");
const pool = new Pool({ connectionString: url.href, max: 8 });
const workerUrl = new URL(url);
workerUrl.username = "clinic_os_worker";
workerUrl.password = "clinic_os_worker";
const workerPool = new Pool({ connectionString: workerUrl.href, max: 8 });
const scope = { tenantId: randomUUID(), clinicId: randomUUID(), actorUserId: randomUUID() },
  a = [scope.tenantId, scope.clinicId];
const otherPatient = randomUUID();
const account = randomUUID(),
  system = randomUUID(),
  registration = randomUUID(),
  key = randomUUID() + randomUUID();
const secret = "synthetic-instruction-secret-no-real-provider",
  hmac = Buffer.from("synthetic-instruction-endpoint-key-000000000001");
const refs = {
  api: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:instruction/api-AbCd12",
  app: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:instruction/app-AbCd12",
  verify: "arn:aws:secretsmanager:ap-south-1:123456789012:secret:instruction/verify-AbCd12"
};
const baseline = new Date(),
  now = () => new Date(clock);
let clock = baseline,
  seq = 0,
  sends = 0,
  resultKind = "accepted_by_provider",
  secretHook = null,
  factoryHook = null,
  sendHook = null;
const checks = [];
async function run(fn, s = scope) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
      [s.tenantId, s.clinicId, s.actorUserId]
    );
    const v = await fn(c);
    await c.query("commit");
    return v;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
const secrets = {
  async resolveSecret(ref) {
    assert.ok(Object.values(refs).includes(ref));
    return secret;
  }
};
const sender = createScopedMetaInstructionSender({
  // Production uses the scoped runtime activity pool; the outbox role stays restricted.
  pool,
  endpointHmacSecret: hmac,
  now,
  secrets: {
    async resolveSecret(ref) {
      assert.equal(ref, refs.api);
      if (secretHook) await secretHook();
      return secret;
    }
  },
  clientFactory() {
    if (factoryHook) factoryHook();
    return {
      async sendApprovedTemplate(i) {
        sends++;
        assert.match(i.recipientPhoneE164, /^\+9197/);
        assert.equal(i.template.name, "care_instruction_v1");
        assert.equal(i.policy.purpose, "care_instruction");
        if (sendHook) await sendHook();
        return {
          outcome: resultKind,
          providerMessageId:
            resultKind === "accepted_by_provider"
              ? `wamid.instruction.${i.messageRequestId}`
              : null,
          messageRequestId: i.messageRequestId,
          idempotencyKey: i.idempotencyKey,
          correlationId: i.correlationId,
          deliveryState: null,
          reconciliationRequired: resultKind === "dispatch_ambiguous",
          retryAutomatically: resultKind === "not_dispatched",
          providerHttpStatus: 400
        };
      }
    };
  }
});
const unit = createPostgresClinicModuleUnitOfWork({
  client: pool,
  resolveScope: (s) => s,
  clock: { now }
});
const handlers = createTreatmentBillingHandlerMap({ paymentProvider: {} });
const access = buildAccessContext({
  principal: {
    subject: "seed-owner",
    issuer: "https://identity.synthetic.invalid",
    email: null,
    displayName: "Synthetic Owner",
    username: "seed-owner",
    keycloakRoles: ["owner_admin"]
  },
  tenant: {
    id: scope.tenantId,
    slug: "synthetic",
    legalName: "Synthetic",
    displayName: "Synthetic",
    status: "active"
  },
  user: {
    id: scope.actorUserId,
    displayName: "Synthetic Owner",
    email: null,
    phone: null,
    status: "active"
  },
  memberships: [{ tenantId: scope.tenantId, userId: scope.actorUserId, status: "active" }],
  clinicAssignments: [{ ...scope, userId: scope.actorUserId, status: "active" }],
  roleAssignments: [
    {
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      userId: scope.actorUserId,
      roleSlug: "owner_admin"
    }
  ]
});
async function fresh({ phone, channel = "whatsapp" } = {}) {
  const patient = randomUUID();
  seq++;
  await run(async (c) => {
    await c.query(
      "insert into patients(id,tenant_id,clinic_id,full_name,phone) values($1,$2,$3,$4,$5)",
      [
        patient,
        ...a,
        `Provider Safety Contact ${seq}`,
        phone ?? `+919770${String(seq).padStart(6, "0")}`
      ]
    );
    await c.query(
      "insert into consents(tenant_id,clinic_id,patient_id,purpose,template_code,template_version,capture_method,created_by_user_id) values($1,$2,$3,'whatsapp_communication','synthetic',1,'clinic_staff',$4)",
      [...a, patient, scope.actorUserId]
    );
  });
  const requestId = randomUUID();
  const response = await unit.run(scope, (c) =>
    handlers.createPatientInstruction(
      {
        operationId: "createPatientInstruction",
        access: { context: access, clinicId: scope.clinicId },
        parsed: {
          path: { patientId: patient },
          query: {},
          headers: { "idempotency-key": randomUUID() },
          body: {
            channel,
            templateId: "care_instruction_v1",
            title: "Synthetic instruction",
            body: "Synthetic aftercare content for engineering tests only."
          }
        },
        metadata: {
          requestId,
          receivedAt: now(),
          ipAddress: null,
          userAgent: "instruction-synthetic-proof"
        }
      },
      { ...c, clock: { now } }
    )
  );
  assert.equal(response.status, channel === "whatsapp" ? 202 : 201);
  assert.equal(
    parseNativeOperationResponse("createPatientInstruction", response.status, response.body)
      .success,
    true
  );
  assert.equal(response.body.instruction.providerConfirmationReceived, false);
  const id = response.body.instruction.id;
  if (channel === "print") return { id, patient };
  const event = await run(
    async (c) =>
      (
        await c.query(
          "select e.* from outbox_events e join patient_instruction_requests i on i.tenant_id=e.tenant_id and i.clinic_id=e.clinic_id and i.outbox_event_id=e.id where i.id=$1",
          [id]
        )
      ).rows[0]
  );
  assert.ok(event, "actual API must atomically link its durable action");
  let captured;
  const handler = new Cp13PatientInstructionSendRequestedHandler({
    temporalClient: {
      workflow: {
        async start(_workflow, options) {
          captured = options.args[0];
          assert.equal(options.workflowIdReusePolicy, "REJECT_DUPLICATE");
        }
      }
    }
  });
  await handler.handle(
    {
      eventId: event.id,
      eventType: event.event_type,
      schemaVersion: event.schema_version,
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      aggregateType: event.aggregate_type,
      aggregateId: event.aggregate_id,
      actor: { type: event.actor_type, id: event.actor_id },
      correlationId: event.correlation_id,
      idempotencyKey: event.idempotency_key,
      payload: event.payload,
      occurredAt: event.occurred_at.toISOString()
    },
    { tenantId: scope.tenantId, clinicId: scope.clinicId, correlationId: event.correlation_id }
  );
  assert.equal(captured.instructionId, id);
  assert.equal(captured.patientId, patient);
  return captured;
}
async function outbound(r) {
  return run(
    async (c) =>
      (
        await c.query("select * from meta_whatsapp_outbound_messages where message_request_id=$1", [
          r.instructionId
        ])
      ).rows[0]
  );
}
async function reconciliation(r) {
  return run(
    async (c) =>
      (
        await c.query(
          "select j.* from meta_whatsapp_reconciliation_jobs j join meta_whatsapp_outbound_messages o on o.id=j.outbound_message_id where o.message_request_id=$1",
          [r.instructionId]
        )
      ).rows
  );
}
function gate() {
  let release, entered;
  const waiting = new Promise((r) => (release = r)),
    entry = new Promise((r) => (entered = r));
  return {
    entry,
    release,
    hook: async () => {
      entered();
      await waiting;
    }
  };
}
try {
  const marker = await pool.query(
    "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
  );
  assert.equal(
    marker.rows[0].marker,
    `ClinicOS disposable MVP acceptance ${process.env.CLINICOS_MVP_DATABASE_TOKEN}`
  );
  // Own an independent tenant so this probe cannot contaminate subsequent clinic
  // acceptance, inbox counts, provider registration or source reconciliation.
  await run(async (c) => {
    await c.query(
      "insert into tenants(id,slug,legal_name,display_name) values($1,$2,'Synthetic instruction safety','Synthetic instruction safety')",
      [scope.tenantId, `instruction-${scope.tenantId}`]
    );
    await c.query(
      "insert into clinics(id,tenant_id,slug,display_name) values($1,$2,'instruction-proof','Synthetic instruction proof')",
      [scope.clinicId, scope.tenantId]
    );
    await c.query("insert into users(id,display_name) values($1,'Synthetic instruction owner')", [
      scope.actorUserId
    ]);
    await c.query("insert into memberships(tenant_id,user_id) values($1,$2)", [
      scope.tenantId,
      scope.actorUserId
    ]);
    await c.query(
      "insert into clinic_user_assignments(tenant_id,clinic_id,user_id) values($1,$2,$3)",
      [...a, scope.actorUserId]
    );
    const role = (
      await c.query(
        "insert into roles(tenant_id,slug,display_name) values($1,'owner_admin','Synthetic instruction owner') returning id",
        [scope.tenantId]
      )
    ).rows[0].id;
    await c.query(
      "insert into role_permissions(role_id,permission_key) values($1,'patient.read'),($1,'patient_instruction.write')",
      [role]
    );
    await c.query(
      "insert into user_role_assignments(tenant_id,clinic_id,user_id,role_id,assigned_by_user_id) values($1,$2,$3,$4,$3)",
      [...a, scope.actorUserId, role]
    );
    await c.query(
      "insert into patients(id,tenant_id,clinic_id,full_name) values($1,$2,$3,'Synthetic unrelated patient')",
      [otherPatient, ...a]
    );
    await c.query(
      "insert into external_systems(id,tenant_id,provider_key,display_name,status) values($1,$2,'meta_whatsapp_cloud','Synthetic instruction proof','available')",
      [system, scope.tenantId]
    );
    await c.query(
      "insert into external_accounts(id,tenant_id,clinic_id,external_system_id,account_type,status) values($1,$2,$3,$4,'Synthetic instruction proof','available')",
      [account, ...a, system]
    );
    await c.query(
      `insert into provider_callback_registrations(id,tenant_id,clinic_id,external_account_id,provider_key,callback_key_digest,activation_state,provider_mode,provider_account_id,provider_endpoint_id,api_version,api_credential_ref,webhook_secret_ref,webhook_secret_version,verification_token_ref,callback_origin,sandbox_verified_at) values($1,$2,$3,$4,'meta_whatsapp_cloud',$5,'sandbox_verified','test','100000000000021','200000000000021','v23.0',$6,$7,'synthetic-v1',$8,'https://synthetic.invalid',$9)`,
      [
        registration,
        ...a,
        account,
        createHash("sha256").update(key).digest("hex"),
        refs.api,
        refs.app,
        refs.verify,
        now()
      ]
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
  async function webhook(changes) {
    const rawBody = Buffer.from(
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: "100000000000021", changes }]
      })
    );
    return runtime.receiveMetaWebhook({
      registrationKey: key,
      rawBody,
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`
      },
      receivedAt: now().toISOString(),
      correlationId: "synthetic-instruction-webhook"
    });
  }
  await webhook([
    {
      field: "message_template_status_update",
      value: {
        event: "APPROVED",
        message_template_id: "300000000000021",
        message_template_name: "care_instruction_v1",
        message_template_language: "en"
      }
    }
  ]);
  await assert.rejects(
    workerPool.query("select id from patient_instruction_requests"),
    (e) => e.code === "42501"
  );
  const first = await fresh();
  const original = await run(
    async (c) =>
      (
        await c.query("select * from patient_instruction_requests where id=$1", [
          first.instructionId
        ])
      ).rows[0]
  );
  assert.match(original.dispatch_recipient_phone, /^\+9197/);
  for (const field of ["body", "template_id", "dispatch_recipient_phone"])
    await assert.rejects(
      run((c) =>
        c.query(`update patient_instruction_requests set ${field}=$2 where id=$1`, [
          first.instructionId,
          "changed"
        ])
      ),
      /immutable/
    );
  await assert.rejects(
    run((c) =>
      c.query("update patient_instruction_requests set outbox_event_id=null where id=$1", [
        first.instructionId
      ])
    ),
    /immutable/
  );
  for (const conflict of [false, true]) {
    const key = conflict ? first.idempotencyKey : randomUUID();
    await assert.rejects(
      unit.run(scope, (c) =>
        c.evidence.appendOutboxEvent({
          eventType: "instruction.send_requested",
          aggregateType: "patient_instruction",
          aggregateId: first.instructionId,
          patientId: otherPatient,
          idempotencyKey: key,
          correlationId: randomUUID(),
          payload: {},
          occurredAt: now().toISOString()
        })
      ),
      /could not be linked atomically/
    );
    assert.equal(
      await run(
        async (c) =>
          (
            await c.query("select count(*)::int n from outbox_events where idempotency_key=$1", [
              key
            ])
          ).rows[0].n
      ),
      conflict ? 1 : 0
    );
  }
  checks.push(
    "invalid action linkage rolls back newly inserted events and refuses conflicting replay"
  );
  const accepted = await sender.send(first);
  assert.equal(accepted.outcome, "requested");
  assert.equal((await sender.send(first)).outcome, "requested");
  assert.equal(sends, 1);
  assert.equal((await outbound(first)).outbox_event_id, first.eventId);
  assert.equal(
    (await pool.query("select count(*)::int n from patient_instruction_requests")).rows[0].n,
    0
  );
  checks.push(
    "real instruction API action linkage, immutable intent, activity RLS, acceptance/replay"
  );
  for (const changed of [
    { actorUserId: IDs.users.accountant },
    { patientId: otherPatient },
    { eventId: randomUUID() },
    { idempotencyKey: "changed" },
    { correlationId: "changed" },
    { clinicId: randomUUID() },
    { tenantId: randomUUID() },
    { requestedAt: new Date(baseline.getTime() - 1).toISOString() }
  ]) {
    const before = sends;
    try {
      assert.equal((await sender.send({ ...first, ...changed })).outcome, "permanent_failure");
    } catch (error) {
      assert.ok(["23503", "42501"].includes(error.code), `Unexpected denial: ${error.code}`);
    }
    assert.equal(sends, before);
  }
  checks.push("forged patient/actor/event/scope identities never dispatch");
  let r = await fresh();
  let g = gate();
  secretHook = g.hook;
  const concurrentBefore = sends;
  const pending = sender.send(r);
  await g.entry;
  await assert.rejects(sender.send(r), MetaInstructionRetryableError);
  g.release();
  assert.equal((await pending).outcome, "requested");
  assert.equal(sends - concurrentBefore, 1);
  assert.equal(
    (
      await run((c) =>
        c.query(
          "select count(*)::int n from meta_whatsapp_outbound_messages where message_request_id=$1",
          [r.instructionId]
        )
      )
    ).rows[0].n,
    1
  );
  secretHook = null;
  checks.push("concurrent duplicate claim sends once");
  r = await fresh();
  resultKind = "not_dispatched";
  let before = sends;
  for (let i = 0; i < 2; i++) await assert.rejects(sender.send(r), MetaInstructionRetryableError);
  assert.equal((await sender.send(r)).outcome, "permanent_failure");
  assert.equal((await sender.send(r)).outcome, "permanent_failure");
  assert.equal(sends - before, 3);
  assert.equal((await outbound(r)).dispatch_attempt_count, 3);
  assert.equal((await outbound(r)).automatic_retry_allowed, false);
  resultKind = "accepted_by_provider";
  checks.push("three proven no-dispatch attempts and bounded terminal replay");
  r = await fresh();
  sendHook = async () => {
    throw Error("synthetic-transport-unknown");
  };
  before = sends;
  assert.equal((await sender.send(r)).failureCode, "INSTRUCTION_DISPATCH_AMBIGUOUS");
  sendHook = null;
  await sender.send(r);
  assert.equal(sends - before, 1);
  assert.equal((await reconciliation(r)).length, 1);
  checks.push("thrown send remains uncertain with one actual reconciliation job and no resend");
  for (const where of ["secret", "constructor"]) {
    r = await fresh();
    before = sends;
    const fail = () => {
      throw Error("synthetic-before-transport");
    };
    if (where === "secret") secretHook = fail;
    else factoryHook = fail;
    for (let i = 0; i < 2; i++) await assert.rejects(sender.send(r), MetaInstructionRetryableError);
    assert.equal((await sender.send(r)).outcome, "permanent_failure");
    assert.equal(sends, before);
    secretHook = null;
    factoryHook = null;
  }
  checks.push("secret and constructor failures are bounded proven no-dispatch");
  for (const change of [
    "phone",
    "consent",
    "template",
    "registration",
    "authority",
    "tenant",
    "clinic"
  ]) {
    r = await fresh();
    g = gate();
    secretHook = g.hook;
    before = sends;
    const inflight = sender.send(r);
    await g.entry;
    await run(async (c) => {
      if (change === "phone")
        await c.query("update patients set phone='+919770999999' where id=$1", [r.patientId]);
      if (change === "consent")
        await c.query(
          "update consents set status='revoked',revoked_at=$2,revoked_by_user_id=$3 where patient_id=$1 and purpose='whatsapp_communication'",
          [r.patientId, now(), scope.actorUserId]
        );
      if (change === "template")
        await c.query(
          "update meta_whatsapp_template_snapshots set lifecycle_state='paused',row_version=row_version+1 where external_account_id=$1",
          [account]
        );
      if (change === "registration")
        await c.query(
          "update provider_callback_registrations set activation_state='disabled',sandbox_verified_at=null,production_verified_at=null where id=$1",
          [registration]
        );
      if (change === "tenant")
        await c.query("update tenants set status='suspended' where id=$1", [scope.tenantId]);
      if (change === "clinic")
        await c.query("update clinics set status='inactive' where id=$1", [scope.clinicId]);
      if (change === "authority")
        await c.query(
          "update clinic_user_assignments set status='suspended' where tenant_id=$1 and clinic_id=$2 and user_id=$3",
          [...a, scope.actorUserId]
        );
    });
    g.release();
    assert.equal((await inflight).outcome, "permanent_failure");
    assert.equal(sends, before);
    secretHook = null;
    await run(async (c) => {
      if (change === "template")
        await c.query(
          "update meta_whatsapp_template_snapshots set lifecycle_state='approved',row_version=row_version+1 where external_account_id=$1",
          [account]
        );
      if (change === "registration")
        await c.query(
          "update provider_callback_registrations set activation_state='sandbox_verified',sandbox_verified_at=now() where id=$1",
          [registration]
        );
      if (change === "tenant")
        await c.query("update tenants set status='active' where id=$1", [scope.tenantId]);
      if (change === "clinic")
        await c.query("update clinics set status='active' where id=$1", [scope.clinicId]);
      if (change === "authority")
        await c.query(
          "update clinic_user_assignments set status='active' where tenant_id=$1 and clinic_id=$2 and user_id=$3",
          [...a, scope.actorUserId]
        );
    });
  }
  checks.push(
    "phone, consent, template, provider, tenant, clinic and staff changes during lookup block send"
  );
  r = await fresh();
  clock = new Date(baseline.getTime() + 16 * 60_000);
  before = sends;
  assert.equal((await sender.send(r)).failureCode, "INSTRUCTION_REVIEW_REQUIRED");
  assert.equal(sends, before);
  clock = baseline;
  checks.push("expired request requires new explicit review");
  r = await fresh();
  g = gate();
  secretHook = g.hook;
  const delayed = sender.send(r);
  await g.entry;
  clock = new Date(baseline.getTime() + 121_000);
  assert.equal((await sender.send(r)).failureCode, "INSTRUCTION_DISPATCH_AMBIGUOUS");
  before = sends;
  g.release();
  assert.equal((await delayed).failureCode, "INSTRUCTION_DISPATCH_AMBIGUOUS");
  assert.equal(sends, before);
  assert.equal((await reconciliation(r)).length, 1);
  clock = baseline;
  secretHook = null;
  checks.push("expired lease fences delayed worker without duplicate send");
  r = await fresh();
  resultKind = "not_dispatched";
  await assert.rejects(sender.send(r), MetaInstructionRetryableError);
  resultKind = "accepted_by_provider";
  await run((c) =>
    c.query(
      "update meta_whatsapp_template_snapshots set row_version=row_version+1 where external_account_id=$1",
      [account]
    )
  );
  before = sends;
  assert.equal((await sender.send(r)).failureCode, "INSTRUCTION_REVIEW_REQUIRED");
  assert.equal(sends, before);
  checks.push("retry cannot silently bind changed source evidence");
  assert.equal((await outbound(r)).automatic_retry_allowed, false);
  r = await fresh();
  resultKind = "not_dispatched";
  await assert.rejects(sender.send(r), MetaInstructionRetryableError);
  resultKind = "accepted_by_provider";
  await run((c) =>
    c.query(
      "update clinic_user_assignments set status='suspended' where tenant_id=$1 and clinic_id=$2 and user_id=$3",
      [...a, scope.actorUserId]
    )
  );
  before = sends;
  assert.equal((await sender.send(r)).outcome, "permanent_failure");
  assert.equal((await outbound(r)).automatic_retry_allowed, false);
  await run((c) =>
    c.query(
      "update clinic_user_assignments set status='active' where tenant_id=$1 and clinic_id=$2 and user_id=$3",
      [...a, scope.actorUserId]
    )
  );
  assert.equal((await sender.send(r)).outcome, "permanent_failure");
  assert.equal(sends, before);
  checks.push("permanent retry refusal cannot revive when authority returns");
  for (const outcome of ["rejected_by_provider", "dispatch_ambiguous"]) {
    r = await fresh();
    resultKind = outcome;
    before = sends;
    assert.equal((await sender.send(r)).outcome, "permanent_failure");
    assert.equal((await sender.send(r)).outcome, "permanent_failure");
    assert.equal(sends - before, 1);
    assert.equal((await outbound(r)).automatic_retry_allowed, false);
    assert.equal((await reconciliation(r)).length, outcome === "dispatch_ambiguous" ? 1 : 0);
  }
  resultKind = "accepted_by_provider";
  checks.push("explicit provider rejection and ambiguity are terminal without resend");
  r = await fresh();
  const tenantGrant = randomUUID();
  await run(async (c) => {
    await c.query(
      "update clinic_user_assignments set status='suspended' where tenant_id=$1 and clinic_id=$2 and user_id=$3",
      [...a, scope.actorUserId]
    );
    await c.query(
      "insert into user_role_assignments(id,tenant_id,clinic_id,user_id,role_id,assigned_by_user_id) select $1,$2,null,$3,id,$3 from roles where tenant_id=$2 and slug='owner_admin'",
      [tenantGrant, scope.tenantId, scope.actorUserId]
    );
  });
  assert.equal((await sender.send(r)).outcome, "requested");
  await run(async (c) => {
    await c.query("update user_role_assignments set revoked_at=now() where id=$1", [tenantGrant]);
    await c.query(
      "update clinic_user_assignments set status='active' where tenant_id=$1 and clinic_id=$2 and user_id=$3",
      [...a, scope.actorUserId]
    );
  });
  checks.push("tenant-wide authorized owner works without an active clinic assignment");
  r = await fresh();
  const role = (
    await run((c) =>
      c.query("select id from roles where tenant_id=$1 and slug='owner_admin'", [scope.tenantId])
    )
  ).rows[0].id;
  sendHook = async () => {
    await assert.rejects(
      run(async (c) => {
        await c.query("set local lock_timeout='150ms'");
        const removed = await c.query(
          "delete from role_permissions where role_id=$1 and permission_key='patient_instruction.write' returning permission_key",
          [role]
        );
        assert.equal(removed.rows.length, 1);
      }),
      (e) => e.code === "55P03"
    );
  };
  assert.equal((await sender.send(r)).outcome, "requested");
  sendHook = null;
  r = await fresh();
  g = gate();
  secretHook = g.hook;
  const revoking = sender.send(r);
  await g.entry;
  await run((c) =>
    c.query(
      "delete from role_permissions where role_id=$1 and permission_key='patient_instruction.write'",
      [role]
    )
  );
  before = sends;
  g.release();
  assert.equal((await revoking).failureCode, "INSTRUCTION_AUTHORITY_REVOKED");
  assert.equal(sends, before);
  secretHook = null;
  await run((c) =>
    c.query(
      "insert into role_permissions(role_id,permission_key) values($1,'patient_instruction.write')",
      [role]
    )
  );
  checks.push(
    "permission revocation before dispatch blocks it; revocation cannot commit during dispatch"
  );
  r = await fresh();
  const weakRole = randomUUID(),
    weakGrant = randomUUID();
  await run(async (c) => {
    await c.query(
      "insert into roles(id,tenant_id,slug,display_name) values($1,$2,'accountant','Synthetic weak tenant role')",
      [weakRole, scope.tenantId]
    );
    await c.query(
      "insert into role_permissions(role_id,permission_key) values($1,'billing.read')",
      [weakRole]
    );
    await c.query(
      "insert into user_role_assignments(id,tenant_id,clinic_id,user_id,role_id,assigned_by_user_id) values($1,$2,null,$3,$4,$3)",
      [weakGrant, scope.tenantId, scope.actorUserId, weakRole]
    );
    await c.query(
      "update clinic_user_assignments set status='suspended' where tenant_id=$1 and clinic_id=$2 and user_id=$3",
      [...a, scope.actorUserId]
    );
  });
  before = sends;
  assert.equal((await sender.send(r)).failureCode, "INSTRUCTION_AUTHORITY_REVOKED");
  assert.equal(sends, before);
  await run(async (c) => {
    await c.query("update user_role_assignments set revoked_at=now() where id=$1", [weakGrant]);
    await c.query(
      "update clinic_user_assignments set status='active' where tenant_id=$1 and clinic_id=$2 and user_id=$3",
      [...a, scope.actorUserId]
    );
  });
  checks.push("weaker tenant role never revives a suspended clinic role's permissions");
  const revoker = await pool.connect();
  let pendingRevocation;
  try {
    await revoker.query("begin");
    await revoker.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
      [...a, scope.actorUserId]
    );
    await revoker.query("set local lock_timeout='5s'");
    const pid = (await revoker.query("select pg_backend_pid() pid")).rows[0].pid;
    await run(async (c) => {
      const wrapped = {
        async query(text, values) {
          const result = await c.query(text, values);
          if (text.startsWith("select id from tenants")) {
            pendingRevocation = revoker
              .query(
                "delete from role_permissions where role_id=$1 and permission_key='patient_instruction.write' returning permission_key",
                [role]
              )
              .then(
                (result) => ({ result }),
                (error) => ({ error })
              );
            let blocked = false;
            for (let i = 0; i < 100; i++) {
              blocked = (await c.query("select cardinality(pg_blocking_pids($1))>0 blocked", [pid]))
                .rows[0].blocked;
              if (blocked) break;
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
            assert.equal(blocked, true, "Revoker must be waiting on the held tenant authority row");
          }
          return result;
        }
      };
      assert.equal(
        await hasCurrentCommunicationAuthority(wrapped, scope, [
          "patient.read",
          "patient_instruction.write"
        ]),
        true
      );
    });
    const completed = await pendingRevocation;
    assert.equal(completed.error, undefined);
    assert.equal(completed.result.rowCount, 1);
    await revoker.query("commit");
  } finally {
    await revoker.query("rollback");
    revoker.release();
  }
  await run((c) =>
    c.query(
      "insert into role_permissions(role_id,permission_key) values($1,'patient_instruction.write')",
      [role]
    )
  );
  checks.push("mid-authority permission revocation serializes without a reverse-lock deadlock");
  const sharedPhone = "+919770888888";
  r = await fresh({ phone: sharedPhone });
  await webhook([
    {
      field: "messages",
      value: {
        metadata: { phone_number_id: "200000000000021" },
        messages: [
          {
            from: sharedPhone.slice(1),
            id: `wamid.stop.${randomUUID()}`,
            timestamp: String(Math.floor(now().getTime() / 1000)),
            type: "text",
            text: { body: "STOP" }
          }
        ]
      }
    }
  ]);
  const family = await fresh({ phone: sharedPhone });
  before = sends;
  assert.equal((await sender.send(family)).outcome, "permanent_failure");
  assert.equal(sends, before);
  checks.push("signed shared-contact STOP blocks another patient's new consent");
  const printed = await fresh({ channel: "print" });
  assert.equal(
    (
      await run(
        async (c) =>
          (
            await c.query(
              "select dispatch_recipient_phone from patient_instruction_requests where id=$1",
              [printed.id]
            )
          ).rows[0]
      )
    ).dispatch_recipient_phone,
    null
  );
  checks.push("existing print workflow preserves request-only semantics");
  await webhook([
    {
      field: "messages",
      value: {
        metadata: { phone_number_id: "200000000000021" },
        statuses: [
          {
            id: accepted.providerSubmissionId,
            status: "delivered",
            timestamp: String(Math.floor(now().getTime() / 1000)),
            recipient_id: original.dispatch_recipient_phone.slice(1)
          }
        ]
      }
    }
  ]);
  assert.equal((await outbound(first)).state, "delivered");
  checks.push("signed provider delivery remains separate from instruction request state");
  console.log(
    JSON.stringify(
      { passed: checks.length, checks, providerCalls: "typed synthetic only", data: "synthetic" },
      null,
      2
    )
  );
} finally {
  // This registration belongs solely to this disposable probe. Leave it disabled
  // so subsequent independent probes can register their own account unambiguously.
  await run((c) =>
    c.query(
      "update provider_callback_registrations set activation_state='disabled',sandbox_verified_at=null,production_verified_at=null where id=$1",
      [registration]
    )
  ).catch(() => {});
  await Promise.all([pool.end(), workerPool.end()]);
}
