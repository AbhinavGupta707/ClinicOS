import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createScopedRazorpayPaymentProviderResolver } from "../cp15/scoped-razorpay-payment-provider.js";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000002";
const actorUserId = "10000000-0000-4000-8000-000000000003";

test("CP15 worker resolves one RLS-scoped verified Razorpay registration and official credential", async () => {
  const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
  let released = 0;
  let secretRef = "";
  let credential: Readonly<{ keyId: string; keySecret: string }> | undefined;
  let collectionInput: Record<string, unknown> | undefined;
  const client = {
    async query(sql: string, values?: readonly unknown[]) {
      queries.push({ sql, values });
      if (sql.includes("from provider_callback_registrations")) {
        return {
          rows: [
            {
              registration_id: "10000000-0000-4000-8000-000000000005",
              tenant_id: tenantId,
              clinic_id: clinicId,
              external_account_id: "10000000-0000-4000-8000-000000000004",
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
      return { rows: [] };
    },
    release() {
      released += 1;
    }
  };
  const pool = {
    async connect() {
      return client;
    }
  } as unknown as Pool;
  const resolver = createScopedRazorpayPaymentProviderResolver({
    pool,
    secrets: {
      async resolveSecret(reference) {
        secretRef = reference;
        return JSON.stringify({
          keyId: "rzp_test_abcdef123456",
          keySecret: "synthetic-key-secret-0001"
        });
      }
    },
    clientFactory(input) {
      credential = input;
      return {
        async createCollection(input) {
          collectionInput = { ...input };
          return {
            providerRequestId: "plink_123456",
            kind: input.kind,
            status: "created",
            amountMinor: input.amountMinor,
            currency: input.currency,
            hostedUrl: "https://rzp.io/i/synthetic",
            qrPayload: null,
            expiresAt: input.expiresAt ?? null
          };
        },
        async fetchPayment() {
          throw new Error("not used");
        }
      };
    },
    now: () => new Date("2026-07-13T08:00:00.000Z")
  });
  const provider = await resolver.resolve({ tenantId, clinicId, actorUserId });
  const result = await provider.createPaymentLink({
    tenantId,
    clinicId,
    patientId: "10000000-0000-4000-8000-000000000006",
    invoiceId: "10000000-0000-4000-8000-000000000007",
    amountPaise: 25_000,
    currency: "INR",
    idempotencyKey: "cp15-payment-request-0001",
    metadata: { acceptPartial: true }
  });
  assert.equal(secretRef, "clinicos/provider/razorpay/api");
  assert.equal(credential?.keyId, "rzp_test_abcdef123456");
  assert.equal(collectionInput?.amountMinor, 25_000);
  assert.equal(result.providerRequestId, "plink_123456");
  assert.equal(result.paymentUrl, "https://rzp.io/i/synthetic");
  assert.equal(JSON.stringify(result).includes("keySecret"), false);
  assert.deepEqual(queries.slice(1, 4).map((query) => query.values?.[0]), [
    tenantId,
    clinicId,
    actorUserId
  ]);
  assert.equal(released, 1);
});
