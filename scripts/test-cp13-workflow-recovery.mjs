#!/usr/bin/env node
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { Worker } from "@temporalio/worker";
import {
  CHECKPOINT1_SEED_IDS,
  PostgresClinicUnitOfWork,
  buildPaymentRequestIntentDigest
} from "@clinic-os/db";
import {
  buildCp13PaymentRequestRecoveryWorkflowId,
  createTemporalClient
} from "@clinic-os/workflow";

const runtimeUrl = requiredLocalUrl(process.env.DATABASE_URL, "DATABASE_URL", "clinic_os_runtime");
const workerUrl = requiredLocalUrl(
  process.env.WORKER_DATABASE_URL,
  "WORKER_DATABASE_URL",
  "clinic_os_worker"
);
const migratorUrl = requiredLocalUrl(
  process.env.MIGRATION_DATABASE_URL,
  "MIGRATION_DATABASE_URL",
  "clinic_os_migrator"
);
const temporalAddress = process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233";
assert.match(temporalAddress, /^(?:127\.0\.0\.1|localhost):\d+$/u);
const dueGenerationCursorSecret = requiredSecret(
  process.env.CLINIC_OS_ABUSE_BUDGET_KEY_SECRET,
  "CLINIC_OS_ABUSE_BUDGET_KEY_SECRET"
);

const runtimePool = new Pool({ connectionString: runtimeUrl, max: 4 });
const migratorPool = new Pool({ connectionString: migratorUrl, max: 1 });
const unitOfWork = new PostgresClinicUnitOfWork(runtimePool, {
  dueGenerationCursorSecret
});
const scope = {
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  clinicId: CHECKPOINT1_SEED_IDS.clinicId,
  actorUserId: CHECKPOINT1_SEED_IDS.users.accountant
};
const invoiceId = randomUUID();
const correlationId = randomUUID();
const operationKey = `cp13-e3:${randomUUID()}`;
const requestedAt = new Date().toISOString();
let workerProcess;

try {
  await insertSyntheticIssuedInvoice(invoiceId);
  const { intentId, requestDigest } = await commitIntentAndActionEvent(operationKey);
  const workflowId = buildCp13PaymentRequestRecoveryWorkflowId({
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    actorUserId: scope.actorUserId,
    durableIntentId: intentId
  });

  // Crash-after-commit evidence: the durable intent and action outbox row exist before a worker.
  const beforeWorker = await readScopedState(intentId, operationKey);
  assert.equal(beforeWorker.intentStatus, "claimed");
  assert.equal(beforeWorker.actionEventStatus, "pending");
  assert.equal(beforeWorker.paymentRequestCount, 0);

  workerProcess = startWorker("cp13-e3-first");
  const completed = await waitForState(
    () => readScopedState(intentId, operationKey),
    (state) => state.intentStatus === "completed" && state.actionEventStatus === "processed",
    "initial payment request recovery"
  );
  assert.equal(completed.paymentRequestCount, 1);
  assert.equal(completed.intentResultStatus, "requested");
  assert.equal(completed.observationalEventStatus, "pending");
  await stopWorker(workerProcess);
  workerProcess = undefined;

  // Duplicate-delivery evidence: a second action event maps to the same stable workflow ID.
  const duplicateKey = `${operationKey}:duplicate`;
  await appendRecoveryEvent(intentId, requestDigest, duplicateKey);
  workerProcess = startWorker("cp13-e3-restart");
  const replayed = await waitForState(
    () => readScopedState(intentId, duplicateKey),
    (state) => state.actionEventStatus === "processed",
    "duplicate delivery after worker restart"
  );
  assert.equal(replayed.intentStatus, "completed");
  assert.equal(replayed.paymentRequestCount, 1);
  await stopWorker(workerProcess);
  workerProcess = undefined;

  const temporalClient = await createTemporalClient({ address: temporalAddress });
  const history = await temporalClient.workflow.getHandle(workflowId).fetchHistory();
  await Worker.runReplayHistory(
    {
      workflowsPath: resolve("packages/workflow/dist/workflows/index.js")
    },
    history,
    workflowId
  );

  console.log(
    JSON.stringify({
      evidence: "CP13-E3-TEMPORAL-PAYMENT-RECOVERY",
      result: "pass",
      intentId,
      workflowId,
      crashAfterCommit: true,
      staleLeaseRecovered: true,
      duplicateDeliveryProcessed: true,
      workerRestarted: true,
      replayHistoryPassed: true,
      paymentRequestCount: 1,
      observationalEventsRemainUnclaimed: true
    })
  );
} finally {
  if (workerProcess) await stopWorker(workerProcess);
  await Promise.all([runtimePool.end(), migratorPool.end()]);
}

async function insertSyntheticIssuedInvoice(id) {
  const client = await migratorPool.connect();
  try {
    await client.query("begin");
    await setScope(client);
    await client.query(
      `insert into invoices (
         id, tenant_id, clinic_id, patient_id, invoice_number, status, payment_status,
         currency, subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor,
         refunded_minor, balance_minor, issued_at, created_by_user_id, updated_by_user_id
       ) values (
         $1, $2, $3, $4, $5, 'issued', 'unpaid', 'INR', 12500, 0, 0, 12500,
         0, 0, 12500, $6::timestamptz, $7, $7
       )`,
      [
        id,
        scope.tenantId,
        scope.clinicId,
        CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
        `CP13-E3-${id.slice(0, 8)}`,
        requestedAt,
        scope.actorUserId
      ]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function commitIntentAndActionEvent(idempotencyKey) {
  return unitOfWork.run(async ({ repository, auditSink }) => {
    const account = await repository.findActivePaymentProviderAccount(scope, {
      providerKey: "simulator",
      requiredCapability: "CREATE_PAYMENT_LINKS"
    });
    assert.equal(account.outcome, "resolved");
    const canonicalRequest = {
      requestType: "payment_link",
      amountMinor: 12500,
      currency: "INR",
      description: "CP13 synthetic recovery evidence",
      expiresAt: null,
      customer: null,
      metadata: { evidence: "CP13-E3" }
    };
    const digestInput = {
      externalAccountId: account.account.externalAccountId,
      providerKey: "simulator",
      requiredCapability: "CREATE_PAYMENT_LINKS",
      invoiceId,
      idempotencyKey,
      canonicalRequest
    };
    const requestDigest = buildPaymentRequestIntentDigest(digestInput);
    const claimed = await repository.claimPaymentRequestIntent(scope, {
      ...digestInput,
      requestDigest,
      leaseOwner: `api:${correlationId}`,
      leaseExpiresAt: requestedAt,
      requestedAt
    });
    assert.equal(claimed.outcome, "claimed");
    const intent = claimed.intent;
    await auditSink.appendAuditEvent({
      id: randomUUID(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      actorType: "user",
      actorId: scope.actorUserId,
      action: "payment.request_intent_created",
      category: "billing",
      riskLevel: "medium",
      phiInvolved: true,
      resourceType: "payment_request_intent",
      resourceId: intent.id,
      patientId: intent.patientId,
      metadata: { invoiceId, requestType: canonicalRequest.requestType },
      ipAddress: null,
      userAgent: "cp13-e3-script",
      correlationId,
      occurredAt: requestedAt
    });
    await appendRecoveryEventInTransaction(repository, intent, idempotencyKey);
    return { intentId: intent.id, requestDigest };
  });
}

async function appendRecoveryEvent(intentId, requestDigest, idempotencyKey) {
  await unitOfWork.run(async ({ repository }) => {
    const intent = await repository.findPaymentRequestIntentById(scope, intentId);
    assert.ok(intent);
    assert.equal(intent.requestDigest, requestDigest);
    await appendRecoveryEventInTransaction(repository, intent, idempotencyKey);
  });
}

async function appendRecoveryEventInTransaction(repository, intent, idempotencyKey) {
  await repository.appendOutboxEvent(scope, {
    eventType: "workflow.cp13.payment_request_recovery.requested",
    aggregateType: "payment_request_intent",
    aggregateId: intent.id,
    patientId: intent.patientId,
    idempotencyKey,
    correlationId,
    payload: {
      patientId: intent.patientId,
      invoiceId: intent.invoiceId,
      durableIntentId: intent.id,
      intentDigest: intent.requestDigest,
      intentStatus: "pending_provider_request",
      requestType: intent.canonicalRequest.requestType
    },
    occurredAt: requestedAt
  });
}

async function readScopedState(intentId, eventKey) {
  const client = await runtimePool.connect();
  try {
    await client.query("begin");
    await setScope(client);
    const result = await client.query(
      `select
         intent.status as intent_status,
         intent.result_projection ->> 'status' as intent_result_status,
         action_event.status as action_event_status,
         (select count(*)::integer from payment_requests request
           where request.tenant_id = $1 and request.clinic_id = $2
             and request.invoice_id = intent.invoice_id) as payment_request_count,
         (select min(event.status) from outbox_events event
           where event.tenant_id = $1 and event.clinic_id = $2
             and event.event_type = 'payment.requested'
             and event.aggregate_id = intent.payment_request_id) as observational_event_status
       from payment_provider_request_intents intent
       left join outbox_events action_event
         on action_event.tenant_id = intent.tenant_id
        and action_event.clinic_id = intent.clinic_id
        and action_event.aggregate_id = intent.id
        and action_event.idempotency_key = $4
       where intent.tenant_id = $1 and intent.clinic_id = $2 and intent.id = $3`,
      [scope.tenantId, scope.clinicId, intentId, eventKey]
    );
    assert.equal(result.rowCount, 1);
    return {
      intentStatus: result.rows[0].intent_status,
      intentResultStatus: result.rows[0].intent_result_status,
      actionEventStatus: result.rows[0].action_event_status,
      paymentRequestCount: Number(result.rows[0].payment_request_count),
      observationalEventStatus: result.rows[0].observational_event_status
    };
  } finally {
    await client.query("rollback");
    client.release();
  }
}

function startWorker(workerId) {
  const child = spawn(process.execPath, [resolve("apps/worker/dist/main.js")], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLINIC_OS_ENV: "local",
      DATABASE_URL: runtimeUrl,
      WORKER_DATABASE_URL: workerUrl,
      TEMPORAL_ADDRESS: temporalAddress,
      PAYMENT_PROVIDER: "simulator",
      CLINIC_OS_ABUSE_BUDGET_KEY_SECRET: dueGenerationCursorSecret,
      WORKER_ID: workerId,
      WORKER_HEALTH_PORT: workerId.endsWith("first") ? "18082" : "18083",
      OUTBOX_POLL_INTERVAL_MS: "100"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      if (output.length < 200) output.push(String(chunk));
    });
  }
  child.once("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`CP13 worker exited early (${code}, ${signal ?? "no-signal"}).`);
      console.error(output.join("").slice(-8000));
    }
  });
  return child;
}

async function stopWorker(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(10_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit");
  }
}

async function waitForState(read, accept, label) {
  const deadline = Date.now() + 45_000;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await delay(250);
  }
  throw new Error(`${label} did not reach its durable terminal state: ${JSON.stringify(last)}`);
}

async function setScope(client) {
  await client.query("select set_config('app.tenant_id', $1, true)", [scope.tenantId]);
  await client.query("select set_config('app.clinic_id', $1, true)", [scope.clinicId]);
  await client.query("select set_config('app.user_id', $1, true)", [scope.actorUserId]);
}

function requiredLocalUrl(value, label, expectedUser) {
  assert.ok(value, `${label} is required`);
  const parsed = new URL(value);
  assert.ok(["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname));
  assert.equal(parsed.pathname, "/clinic_os");
  assert.equal(parsed.username, expectedUser);
  return value;
}

function requiredSecret(value, label) {
  assert.ok(value && value.length >= 32, `${label} must contain at least 32 characters`);
  return value;
}
