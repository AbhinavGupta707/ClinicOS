#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Pool, Client } from "pg";
import {
  PostgresClinicUnitOfWork,
  PostgresProviderCallbackRegistrationResolver
} from "@clinic-os/db";
import { PostgresOfficialProviderCallbackRuntime } from "../apps/api/src/providers/cp15/official-provider-callback-runtime.ts";
import { ProviderReconciliationProcessor } from "../apps/worker/src/cp15/provider-reconciliation-processor.ts";
import { PostgresProviderReconciliationScopeSource } from "../apps/worker/src/cp15/postgres-provider-reconciliation-scope-source.ts";

const root = resolve(import.meta.dirname, "..");
const adminUrl =
  process.env.CLINIC_OS_LOCAL_DB_ADMIN_URL ??
  "postgresql://clinic_os:clinic_os@127.0.0.1:5432/postgres";
const testDatabase = "clinic_os_cp15_provider_test";
const testDatabaseUrl = databaseUrl(adminUrl, testDatabase);
const runtimeDatabaseUrl = runtimeUrl(adminUrl, testDatabase);
const internalJdbcUrl = `jdbc:postgresql://postgres:5432/${testDatabase}`;

const IDS = Object.freeze({
  tenantId: "15000000-0000-4000-8000-000000000001",
  clinicId: "15000000-0000-4000-8000-000000000101",
  actorUserId: "15000000-0000-4000-8000-000000001001",
  metaSystemId: "15000000-0000-4000-8000-000000002001",
  metaAccountId: "15000000-0000-4000-8000-000000002101",
  razorpaySystemId: "15000000-0000-4000-8000-000000003001",
  razorpayAccountId: "15000000-0000-4000-8000-000000003101",
  reconciliationJobId: "15000000-0000-4000-8000-000000004001"
});
const META_APP_SECRET = "cp15-meta-synthetic-app-secret-000000000001";
const META_VERIFY_TOKEN = "cp15-meta-synthetic-verify-token-000000001";
const RAZORPAY_WEBHOOK_SECRET = "cp15-razorpay-synthetic-webhook-secret-0001";
const RECEIVED_AT = "2026-07-13T10:00:00.000Z";
const NOW = "2026-07-13T10:00:01.000Z";
const SECRET_REFS = Object.freeze({
  metaApi: secretArn("cp15/meta/api-credential-AbCd12"),
  metaApp: secretArn("cp15/meta/app-secret-AbCd12"),
  metaVerify: secretArn("cp15/meta/verify-token-AbCd12"),
  razorpayApi: secretArn("cp15/razorpay/api-credential-AbCd12"),
  razorpayWebhook: secretArn("cp15/razorpay/webhook-secret-AbCd12")
});

assertLocalAdminUrl(adminUrl);
const metaRegistrationKey = randomBytes(32).toString("base64url");
const razorpayRegistrationKey = randomBytes(32).toString("base64url");
const admin = new Client({ connectionString: adminUrl });
let adminConnected = false;
let runtimePool;
let workerPool;

try {
  await admin.connect();
  adminConnected = true;
  await dropTestDatabase(admin);
  await admin.query(`create database ${testDatabase} owner clinic_os_migrator`);
  await admin.query(`grant connect on database ${testDatabase} to clinic_os_runtime`);
  await admin.query(`grant connect on database ${testDatabase} to clinic_os_worker`);
  await migrateTestDatabase();
  await grantTestRuntimePrivileges();
  await seedProviderRegistry();

  runtimePool = new Pool({ connectionString: runtimeDatabaseUrl, max: 3 });
  workerPool = new Pool({ connectionString: workerUrl(adminUrl, testDatabase), max: 3 });
  const registrations = new PostgresProviderCallbackRegistrationResolver(runtimePool);
  const secretValues = new Map([
    [SECRET_REFS.metaApi, "synthetic-not-used-api-token"],
    [SECRET_REFS.metaApp, META_APP_SECRET],
    [SECRET_REFS.metaVerify, META_VERIFY_TOKEN],
    [
      SECRET_REFS.razorpayApi,
      JSON.stringify({
        keyId: "rzp_test_synthetic0001",
        keySecret: "synthetic-razorpay-api-secret-0000001"
      })
    ],
    [SECRET_REFS.razorpayWebhook, RAZORPAY_WEBHOOK_SECRET]
  ]);
  const runtime = new PostgresOfficialProviderCallbackRuntime({
    registrations,
    secrets: {
      async resolveSecret(reference) {
        const value = secretValues.get(reference);
        if (!value) throw new Error("Synthetic secret reference was not registered.");
        return value;
      }
    },
    rawBodyStore: {
      async put(input) {
        return { ciphertextRef: `restricted://cp15/${input.rawEventId}` };
      },
      async deleteUncommitted() {}
    },
    unitOfWork: new PostgresClinicUnitOfWork(runtimePool, {
      clock: { now: () => new Date(NOW) }
    }),
    endpointHmacSecret: Buffer.from("cp15-endpoint-hmac-synthetic-secret-0000000000000001", "utf8"),
    now: () => new Date(NOW)
  });

  assert.equal(
    await runtime.verifyMetaChallenge({
      registrationKey: metaRegistrationKey,
      mode: "subscribe",
      verifyToken: META_VERIFY_TOKEN,
      challenge: "150015"
    }),
    "150015"
  );
  await assert.rejects(
    runtime.verifyMetaChallenge({
      registrationKey: metaRegistrationKey,
      mode: "subscribe",
      verifyToken: "incorrect-synthetic-token",
      challenge: "150015"
    }),
    /challenge is invalid/u
  );

  const metaBody = Buffer.from(
    JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
    "utf8"
  );
  const metaInput = {
    registrationKey: metaRegistrationKey,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": `sha256=${hmac(META_APP_SECRET, metaBody)}`
    },
    rawBody: metaBody,
    receivedAt: RECEIVED_AT,
    correlationId: "cp15-meta-persistence-0001"
  };
  await runtime.receiveMetaWebhook(metaInput);
  await runtime.receiveMetaWebhook(metaInput);
  await assert.rejects(
    runtime.receiveMetaWebhook({
      ...metaInput,
      headers: {
        ...metaInput.headers,
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`
      }
    }),
    /signature/u
  );

  const razorpayBody = Buffer.from(
    JSON.stringify({
      entity: "event",
      account_id: "acc_test_cp15",
      event: "payment.captured",
      created_at: 1783936800,
      payload: {
        payment: {
          entity: {
            id: "pay_cp15_persistence_0001",
            amount: 4000,
            currency: "INR",
            status: "captured",
            captured: true,
            method: "upi",
            notes: {
              clinic_os_tenant_id: IDS.tenantId,
              clinic_os_clinic_id: IDS.clinicId
            }
          }
        }
      }
    }),
    "utf8"
  );
  const razorpayInput = {
    registrationKey: razorpayRegistrationKey,
    headers: {
      "content-type": "application/json",
      "x-razorpay-event-id": "evt_cp15_persistence_0001",
      "x-razorpay-signature": hmac(RAZORPAY_WEBHOOK_SECRET, razorpayBody)
    },
    rawBody: razorpayBody,
    receivedAt: RECEIVED_AT,
    correlationId: "cp15-razorpay-persistence-0001"
  };
  await runtime.receiveRazorpayWebhook(razorpayInput);
  await runtime.receiveRazorpayWebhook(razorpayInput);
  await assert.rejects(
    runtime.receiveRazorpayWebhook({
      ...razorpayInput,
      headers: { ...razorpayInput.headers, "x-razorpay-signature": "0".repeat(64) }
    }),
    /signature/u
  );

  await assertRouteIndexDenied(runtimePool);
  await seedRazorpayReconciliationJob(runtimePool);
  await assertWorkerJobScopeIsRequired(workerPool);
  const reconciliationEvidence = await processRazorpayReconciliation(workerPool, secretValues);
  assert.deepEqual(reconciliationEvidence, {
    claimedScopes: 1,
    claimedJobs: 1,
    matchedJobs: 1,
    refreshedScope: "removed",
    dueScopesAfterRefresh: 0,
    matchedRows: 1,
    reconciledRegistrations: 1
  });
  const evidence = await scopedEvidence(runtimePool);
  assert.deepEqual(evidence, {
    metaRawEvents: 1,
    metaCommits: 1,
    razorpayRawEvents: 1,
    razorpayReconciliations: 1,
    providerHealthRows: 2,
    providerHealthFailures: 0,
    auditEvents: 2,
    outboxEvents: 2,
    secretValueMatches: 0
  });
  assert.equal(await registrations.resolve("meta_whatsapp_cloud", "unknown_key_0000000001"), null);

  console.log(
    JSON.stringify(
      {
        cleanMigration: "pass",
        registrationResolution: "pass",
        opaqueRouteIndexDirectAccess: "denied",
        metaChallengeAndSignature: "pass",
        metaAtomicCommitAndReplay: "pass",
        razorpaySignatureAndReconciliation: "pass",
        providerScopeQueue: "pass",
        workerRlsReconciliation: "pass",
        providerHealthProjection: "pass",
        invalidSignatureNoWrite: "pass",
        secretValuesAbsentFromDatabase: "pass",
        skips: 0
      },
      null,
      2
    )
  );
} finally {
  await workerPool?.end().catch(() => undefined);
  await runtimePool?.end().catch(() => undefined);
  if (adminConnected) {
    await dropTestDatabase(admin).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
}

async function seedRazorpayReconciliationJob(pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setScope(client);
    const registration = await client.query(
      `update provider_callback_registrations
          set activation_state = 'sandbox_verified', sandbox_verified_at = $3::timestamptz
        where tenant_id = $1 and clinic_id = $2
          and external_account_id = $4 and provider_key = 'razorpay'
      returning id`,
      [IDS.tenantId, IDS.clinicId, NOW, IDS.razorpayAccountId]
    );
    assert.equal(registration.rowCount, 1);
    await client.query(
      `insert into razorpay_reconciliation_jobs (
         id, tenant_id, clinic_id, external_account_id, provider_payment_id,
         reason, status, attempt_count, created_at
       ) values ($1, $2, $3, $4, 'pay_cp15_reconciliation_0001',
                 'provider_outage', 'pending', 0, $5::timestamptz)`,
      [IDS.reconciliationJobId, IDS.tenantId, IDS.clinicId, IDS.razorpayAccountId, RECEIVED_AT]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function assertWorkerJobScopeIsRequired(pool) {
  const hiddenJobs = await pool.query(
    "select count(*)::integer as count from razorpay_reconciliation_jobs"
  );
  assert.equal(hiddenJobs.rows[0]?.count, 0);
  const discoverableScopes = await pool.query(
    "select count(*)::integer as count from provider_reconciliation_scope_queue"
  );
  assert.equal(discoverableScopes.rows[0]?.count, 1);
}

async function processRazorpayReconciliation(pool, secretValues) {
  const source = new PostgresProviderReconciliationScopeSource(pool);
  const leaseUntil = new Date(Date.parse(NOW) + 5 * 60_000).toISOString();
  const scopes = await source.claimDueScopes({
    workerId: "cp15-persistence",
    limit: 1,
    now: NOW,
    leaseUntil
  });
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0]?.tenantId, IDS.tenantId);
  assert.equal(scopes[0]?.clinicId, IDS.clinicId);

  const processor = new ProviderReconciliationProcessor({
    pool,
    workerId: "cp15-persistence",
    razorpaySecrets: {
      async resolveSecret(reference) {
        const value = secretValues.get(reference);
        if (!value) throw new Error("Synthetic secret reference was not registered.");
        return value;
      }
    },
    createRazorpayClient(credential, registration) {
      assert.equal(credential.keyId, "rzp_test_synthetic0001");
      assert.equal(registration.providerMode, "test");
      assert.equal(registration.providerAccountId, "acc_test_cp15");
      return {
        maximumPaymentLookupDurationMs: 19_000,
        maximumCreationLookupDurationMs: 114_000,
        async lookupPayment(providerPaymentId) {
          assert.equal(providerPaymentId, "pay_cp15_reconciliation_0001");
          return {
            outcome: "found",
            payment: {
              providerPaymentId,
              amountMinor: 4_000,
              amountRefundedMinor: 0,
              currency: "INR",
              status: "captured",
              captured: true,
              providerRequestId: null
            }
          };
        },
        async findCollectionByInvoiceReference() {
          throw new Error("Creation lookup is not expected in this persistence proof.");
        }
      };
    },
    batchSize: 1,
    leaseMs: 5 * 60_000,
    now: () => new Date(NOW)
  });
  const result = await processor.pollOnce(scopes[0]);
  const refreshedScope = await source.refreshScope(scopes[0], NOW);
  const dueScopesAfterRefresh = await source.countDue(NOW);
  const durable = await scopedReconciliationEvidence(pool);
  return {
    claimedScopes: scopes.length,
    claimedJobs: result.claimed,
    matchedJobs: result.matched,
    refreshedScope,
    dueScopesAfterRefresh,
    ...durable
  };
}

async function scopedReconciliationEvidence(pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await setScope(client);
    const evidence = await client.query(
      `select
         (select count(*)::integer from razorpay_reconciliation_jobs
           where id = $1 and status = 'matched' and attempt_count = 1
             and provider_snapshot_digest is not null and last_error_code is null) as "matchedRows",
         (select count(*)::integer from provider_callback_registrations
           where external_account_id = $2 and provider_key = 'razorpay'
             and activation_state = 'sandbox_verified'
             and last_reconciled_at = $3::timestamptz
             and last_health_check_at = $3::timestamptz
             and last_failure_code is null) as "reconciledRegistrations"`,
      [IDS.reconciliationJobId, IDS.razorpayAccountId, NOW]
    );
    await client.query("commit");
    return evidence.rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function setScope(client) {
  await client.query("select set_config('app.tenant_id', $1, true)", [IDS.tenantId]);
  await client.query("select set_config('app.clinic_id', $1, true)", [IDS.clinicId]);
  await client.query("select set_config('app.user_id', $1, true)", [IDS.actorUserId]);
}

async function assertRouteIndexDenied(pool) {
  try {
    await pool.query("select count(*) from provider_callback_routes");
    assert.fail("Runtime role unexpectedly read the opaque callback route index.");
  } catch (error) {
    assert.equal(error?.code, "42501");
  }
}

async function seedProviderRegistry() {
  const seed = new Client({ connectionString: testDatabaseUrl });
  await seed.connect();
  try {
    await seed.query("begin");
    await seed.query(
      `insert into tenants (id, slug, legal_name, display_name)
       values ($1, 'cp15-synthetic', 'CP15 Synthetic Clinic Private Limited', 'CP15 Synthetic')`,
      [IDS.tenantId]
    );
    await seed.query(
      `insert into clinics (id, tenant_id, slug, display_name, timezone)
       values ($1, $2, 'cp15-synthetic', 'CP15 Synthetic Clinic', 'Asia/Kolkata')`,
      [IDS.clinicId, IDS.tenantId]
    );
    await seed.query(
      `insert into users (id, display_name, email) values ($1, 'CP15 Synthetic Operator', null)`,
      [IDS.actorUserId]
    );
    await seed.query(
      `insert into external_systems (id, tenant_id, provider_key, display_name, status)
       values
         ($1, $2, 'meta_whatsapp_cloud', 'Meta WhatsApp Cloud', 'available'),
         ($3, $2, 'razorpay', 'Razorpay', 'available')`,
      [IDS.metaSystemId, IDS.tenantId, IDS.razorpaySystemId]
    );
    await seed.query(
      `insert into external_accounts (
         id, tenant_id, clinic_id, external_system_id, account_type, status, capability_keys
       ) values
         ($1, $2, $3, $4, 'meta_whatsapp_business', 'available', array['SEND_MESSAGES','VERIFY_WEBHOOKS']),
         ($5, $2, $3, $6, 'razorpay_merchant', 'available', array['CREATE_PAYMENT_LINKS','FETCH_PAYMENT_STATUS','VERIFY_WEBHOOKS'])`,
      [
        IDS.metaAccountId,
        IDS.tenantId,
        IDS.clinicId,
        IDS.metaSystemId,
        IDS.razorpayAccountId,
        IDS.razorpaySystemId
      ]
    );
    await seed.query(
      `insert into provider_callback_registrations (
         tenant_id, clinic_id, external_account_id, provider_key, callback_key_digest,
         activation_state, provider_mode, provider_account_id, provider_endpoint_id,
         api_version, api_credential_ref, webhook_secret_ref, webhook_secret_version,
         verification_token_ref, callback_origin
       ) values
         ($1,$2,$3,'meta_whatsapp_cloud',$4,'configured','test','100000000000001',
          '200000000000001','v23.0',$5,$6,'meta-app-v1',$7,'https://cp15.synthetic.invalid'),
         ($1,$2,$8,'razorpay',$9,'configured','test','acc_test_cp15',
          null,null,$10,$11,'razorpay-webhook-v1',null,'https://cp15.synthetic.invalid')`,
      [
        IDS.tenantId,
        IDS.clinicId,
        IDS.metaAccountId,
        sha256(metaRegistrationKey),
        SECRET_REFS.metaApi,
        SECRET_REFS.metaApp,
        SECRET_REFS.metaVerify,
        IDS.razorpayAccountId,
        sha256(razorpayRegistrationKey),
        SECRET_REFS.razorpayApi,
        SECRET_REFS.razorpayWebhook
      ]
    );
    await seed.query("commit");
  } catch (error) {
    await seed.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await seed.end();
  }
}

async function grantTestRuntimePrivileges() {
  const migrator = new Client({ connectionString: migratorUrl(adminUrl, testDatabase) });
  await migrator.connect();
  try {
    await migrator.query("revoke create on schema public from public");
    await migrator.query("revoke create on schema public from clinic_os_runtime");
    await migrator.query("grant usage on schema public, clinic_os to clinic_os_runtime");
    await migrator.query(
      "grant select, insert, update, delete on all tables in schema public to clinic_os_runtime"
    );
    await migrator.query(
      "grant usage, select on all sequences in schema public to clinic_os_runtime"
    );
    await migrator.query("grant execute on all functions in schema clinic_os to clinic_os_runtime");
    await migrator.query(
      "revoke execute on function clinic_os.sync_provider_callback_route() from clinic_os_runtime"
    );
    await migrator.query(
      "revoke update, delete, truncate on table audit_events from clinic_os_runtime"
    );
    await migrator.query(
      "revoke update, delete, truncate on table outbox_events from clinic_os_runtime"
    );
    await migrator.query("revoke all on table provider_callback_routes from clinic_os_runtime");
    await migrator.query("revoke all on table flyway_schema_history from clinic_os_runtime");
    await migrator.query("grant select on table flyway_schema_history to clinic_os_runtime");
  } finally {
    await migrator.end();
  }
}

async function scopedEvidence(pool) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [IDS.tenantId]);
    await client.query("select set_config('app.clinic_id', $1, true)", [IDS.clinicId]);
    await client.query("select set_config('app.user_id', $1, true)", [IDS.actorUserId]);
    const result = await client.query(
      `select
         (select count(*)::integer from raw_webhook_events where provider_key = 'meta_whatsapp_cloud') as "metaRawEvents",
         (select count(*)::integer from meta_whatsapp_webhook_commits) as "metaCommits",
         (select count(*)::integer from raw_webhook_events where provider_key = 'razorpay') as "razorpayRawEvents",
         (select count(*)::integer from payment_reconciliation_items where reason = 'missing_invoice_reference') as "razorpayReconciliations",
         (select count(*)::integer from provider_callback_registrations where last_verified_callback_at = $1::timestamptz) as "providerHealthRows",
         (select count(*)::integer from provider_callback_registrations where last_failure_code is not null) as "providerHealthFailures",
         (select count(*)::integer from audit_events where correlation_id like 'cp15-%-persistence-0001') as "auditEvents",
         (select count(*)::integer from outbox_events where correlation_id like 'cp15-%-persistence-0001') as "outboxEvents",
         (select count(*)::integer from provider_callback_registrations
           where row_to_json(provider_callback_registrations)::text like '%' || $2 || '%'
              or row_to_json(provider_callback_registrations)::text like '%' || $3 || '%') as "secretValueMatches"`,
      [RECEIVED_AT, META_APP_SECRET, RAZORPAY_WEBHOOK_SECRET]
    );
    await client.query("commit");
    return result.rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function migrateTestDatabase() {
  const result = await runCommand("docker", [
    "compose",
    "--profile",
    "tools",
    "run",
    "--rm",
    "flyway",
    `-url=${internalJdbcUrl}`,
    "migrate"
  ]);
  if (result.code !== 0) {
    throw new Error(`CP15 clean migration failed:\n${sanitize(result.output)}`);
  }
}

function runCommand(executable, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { cwd: root, env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, output }));
  });
}

async function dropTestDatabase(client) {
  await client.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()",
    [testDatabase]
  );
  await client.query(`drop database if exists ${testDatabase}`);
}

function assertLocalAdminUrl(connectionString) {
  const parsed = new URL(connectionString);
  if (
    !new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(parsed.hostname) ||
    parsed.pathname !== "/postgres"
  ) {
    throw new Error("CP15 provider persistence tests are restricted to local PostgreSQL.");
  }
}

function databaseUrl(connectionString, database) {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function runtimeUrl(connectionString, database) {
  const parsed = new URL(connectionString);
  parsed.username = "clinic_os_runtime";
  parsed.password = "clinic_os_runtime";
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function workerUrl(connectionString, database) {
  const parsed = new URL(connectionString);
  parsed.username = "clinic_os_worker";
  parsed.password = "clinic_os_worker";
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function migratorUrl(connectionString, database) {
  const parsed = new URL(connectionString);
  parsed.username = "clinic_os_migrator";
  parsed.password = "clinic_os_migrator";
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function secretArn(name) {
  return `arn:aws:secretsmanager:ap-south-1:222634407676:secret:${name}`;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(secret, body) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function sanitize(value) {
  return value.replaceAll(/postgres(?:ql)?:\/\/[^\s]+/giu, "postgresql://[redacted]").slice(-4000);
}
