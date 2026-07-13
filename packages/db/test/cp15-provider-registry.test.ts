import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  PostgresProviderCallbackRegistrationResolver,
  PostgresProviderOperationsRegistry,
  type SqlQueryClient
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000002";
const actorUserId = "10000000-0000-4000-8000-000000000003";
const externalAccountId = "10000000-0000-4000-8000-000000000004";
const registrationId = "10000000-0000-4000-8000-000000000005";

test("CP15 callback resolver hashes an opaque key and accepts only a bounded projection", async () => {
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  const resolver = new PostgresProviderCallbackRegistrationResolver({
    async query(sql, values) {
      queries.push({ sql, values });
      return {
        rows: [
          {
            registration_id: registrationId,
            tenant_id: tenantId,
            clinic_id: clinicId,
            external_account_id: externalAccountId,
            provider_key: "razorpay",
            activation_state: "sandbox_verified",
            provider_mode: "test",
            provider_account_id: "rzp_test_account",
            provider_endpoint_id: null,
            api_version: null,
            api_credential_ref: "clinicos/provider/razorpay/api",
            webhook_secret_ref: "clinicos/provider/razorpay/webhook",
            webhook_secret_version: "v1",
            previous_webhook_secret_ref: null,
            previous_webhook_secret_version: null,
            previous_secret_accept_until: null,
            verification_token_ref: null
          }
        ]
      };
    }
  });
  const key = "registration_key_123456";
  const registration = await resolver.resolve("razorpay", key);
  assert.equal(registration?.activationState, "sandbox_verified");
  assert.equal(registration?.providerAccountId, "rzp_test_account");
  assert.deepEqual(queries[0]?.values, [
    "razorpay",
    createHash("sha256").update(key, "utf8").digest("hex")
  ]);
  assert.equal(await resolver.resolve("razorpay", "too-short"), null);
  assert.equal(queries.length, 1);
});

test("CP15 provider operations registry binds verified RLS scope and returns no secrets", async () => {
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  let released = 0;
  const client: SqlQueryClient = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("from provider_callback_registrations")) {
        return {
          rows: [
            {
              registration_id: registrationId,
              provider_key: "meta_whatsapp_cloud",
              activation_state: "configured",
              provider_mode: "test",
              sandbox_verified_at: null,
              production_verified_at: null,
              last_health_check_at: "2026-07-13 08:00:00+00",
              last_verified_callback_at: null,
              last_reconciled_at: "2026-07-13 08:05:00+00",
              last_failure_code: "provider_timeout",
              created_at: "2026-07-13 07:00:00+00",
              updated_at: "2026-07-13 08:05:00+00"
            }
          ]
        };
      }
      return { rows: [] };
    },
    release() {
      released += 1;
    }
  };
  const registry = new PostgresProviderOperationsRegistry({
    query: client.query.bind(client),
    async connect() {
      return client;
    }
  });
  const records = await registry.list({
    tenantId: tenantId as never,
    clinicId: clinicId as never,
    actorUserId: actorUserId as never
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.activationState, "configured");
  assert.equal(records[0]?.lastFailureCode, "provider_timeout");
  assert.equal(JSON.stringify(records).includes("secret"), false);
  assert.equal(queries[0]?.sql, "begin");
  assert.deepEqual(queries.slice(1, 4).map((query) => query.values?.[0]), [
    tenantId,
    clinicId,
    actorUserId
  ]);
  assert.equal(queries.at(-1)?.sql, "commit");
  assert.equal(released, 1);
});
