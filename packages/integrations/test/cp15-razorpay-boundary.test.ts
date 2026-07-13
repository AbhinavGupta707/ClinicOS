import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  RazorpayApiClient,
  RazorpayBoundaryError,
  buildRazorpayHealth,
  verifyAndNormalizeRazorpayWebhook,
  type RawRazorpayWebhookRequest,
  type RazorpayWebhookRouteBinding
} from "../dist/cp15/razorpay/index.js";

const currentSecret = "test-current-secret";
const previousSecret = "test-previous-secret";
const binding: RazorpayWebhookRouteBinding = {
  tenantId: "tenant-1",
  clinicId: "clinic-1",
  externalAccountId: "external-1",
  razorpayAccountId: "acc_test",
  mode: "test",
  activationState: "sandbox_verified",
  secrets: [
    { version: "v2", secret: currentSecret, role: "current" },
    {
      version: "v1",
      secret: previousSecret,
      role: "previous",
      acceptUntil: "2026-07-14T00:00:00.000Z"
    }
  ]
};

test("raw-body signature is checked before JSON parsing", () => {
  const rawBody = Buffer.from("not-json");
  assert.throws(
    () => verifyAndNormalizeRazorpayWebhook(raw(rawBody, "0".repeat(64)), binding),
    (error: unknown) => error instanceof RazorpayBoundaryError && error.code === "INVALID_SIGNATURE"
  );
  assert.throws(
    () => verifyAndNormalizeRazorpayWebhook(raw(rawBody, sign(rawBody, currentSecret)), binding),
    (error: unknown) => error instanceof RazorpayBoundaryError && error.code === "INVALID_JSON"
  );
});

test("bounded body, event identity and account binding fail closed", () => {
  const body = paymentPayload();
  assert.throws(
    () =>
      verifyAndNormalizeRazorpayWebhook(raw(body, sign(body, currentSecret)), binding, {
        maxBodyBytes: 10
      }),
    (error: unknown) => error instanceof RazorpayBoundaryError && error.code === "BODY_TOO_LARGE"
  );
  assert.throws(
    () => verifyAndNormalizeRazorpayWebhook(raw(body, sign(body, currentSecret), false), binding),
    (error: unknown) => error instanceof RazorpayBoundaryError && error.code === "MISSING_EVENT_ID"
  );
  const wrongAccount = paymentPayload({ account_id: "acc_other" });
  assert.throws(
    () =>
      verifyAndNormalizeRazorpayWebhook(
        raw(wrongAccount, sign(wrongAccount, currentSecret)),
        binding
      ),
    (error: unknown) => error instanceof RazorpayBoundaryError && error.code === "ACCOUNT_MISMATCH"
  );
});

test("current and bounded previous rotation secrets verify without exposing secret material", () => {
  const body = paymentPayload();
  const current = verifyAndNormalizeRazorpayWebhook(raw(body, sign(body, currentSecret)), binding);
  assert.equal(current.usedPreviousSecret, false);
  assert.equal(current.event.verifiedSecretVersion, "v2");
  const previous = verifyAndNormalizeRazorpayWebhook(
    raw(body, sign(body, previousSecret)),
    binding
  );
  assert.equal(previous.usedPreviousSecret, true);
  assert.equal(previous.event.verifiedSecretVersion, "v1");
  assert.equal(JSON.stringify(previous).includes(previousSecret), false);
  const expired = {
    ...binding,
    secrets: [{ ...binding.secrets[1]!, acceptUntil: "2026-07-12T00:00:00.000Z" }]
  };
  assert.throws(
    () => verifyAndNormalizeRazorpayWebhook(raw(body, sign(body, previousSecret)), expired),
    (error: unknown) => error instanceof RazorpayBoundaryError && error.code === "NOT_CONFIGURED"
  );
});

test("partial payment, refund and dispute payloads normalize to safe financial fields", () => {
  const partialBody = paymentPayload({ event: "payment_link.partially_paid" });
  const partial = verifyAndNormalizeRazorpayWebhook(
    raw(partialBody, sign(partialBody, currentSecret)),
    binding
  ).event;
  assert.equal(partial.amountMinor, 4_000);
  assert.equal(partial.providerRequestId, "plink_1");
  assert.equal(partial.invoiceId, "invoice-1");
  assert.equal(partial.paymentCaptured, true);

  const refundBody = Buffer.from(
    JSON.stringify({
      entity: "event",
      account_id: "acc_test",
      event: "refund.processed",
      created_at: 1783936800,
      payload: {
        refund: {
          entity: {
            id: "rfnd_1",
            payment_id: "pay_1",
            amount: 1_500,
            currency: "INR",
            status: "processed"
          }
        },
        payment: {
          entity: {
            id: "pay_1",
            captured: true,
            status: "captured",
            notes: { clinic_os_invoice_id: "invoice-1" }
          }
        }
      }
    })
  );
  const refund = verifyAndNormalizeRazorpayWebhook(
    raw(refundBody, sign(refundBody, currentSecret)),
    binding
  ).event;
  assert.equal(refund.providerRefundId, "rfnd_1");
  assert.equal(refund.amountMinor, 1_500);

  const disputeBody = Buffer.from(
    JSON.stringify({
      entity: "event",
      account_id: "acc_test",
      event: "payment.dispute.created",
      created_at: 1783936800,
      payload: {
        dispute: {
          entity: {
            id: "disp_1",
            payment_id: "pay_1",
            amount: 4_000,
            currency: "INR",
            status: "open"
          }
        },
        payment: {
          entity: {
            id: "pay_1",
            captured: true,
            status: "captured",
            notes: { clinic_os_invoice_id: "invoice-1" }
          }
        }
      }
    })
  );
  const dispute = verifyAndNormalizeRazorpayWebhook(
    raw(disputeBody, sign(disputeBody, currentSecret)),
    binding
  ).event;
  assert.equal(dispute.providerDisputeId, "disp_1");
  assert.equal(dispute.resourceKind, "dispute");
});

test("GET reconciliation retries bounded outages but POST creation never retries unknown outcomes", async () => {
  let gets = 0;
  const sleeps: number[] = [];
  const client = new RazorpayApiClient({
    keyId: "rzp_test_key",
    keySecret: "test-secret",
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    transport: async (request) => {
      if (request.method === "GET") {
        gets += 1;
        if (gets < 3) return { status: 503, headers: {}, body: "unavailable" };
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: "pay_1",
            amount: 10_000,
            amount_refunded: 0,
            currency: "INR",
            status: "captured",
            captured: true
          })
        };
      }
      return { status: 503, headers: {}, body: "unavailable" };
    }
  });
  const snapshot = await client.fetchPayment("pay_1");
  assert.equal(snapshot.captured, true);
  assert.equal(gets, 3);
  assert.deepEqual(sleeps, [100, 200]);
  await assert.rejects(
    client.createCollection({
      kind: "payment_link",
      invoiceId: "invoice-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      amountMinor: 10_000,
      currency: "INR",
      acceptPartial: true
    }),
    (error: unknown) =>
      error instanceof RazorpayBoundaryError && error.outcomeUnknown && error.retryable
  );
});

test("Payment Link and single-use fixed QR creation send only bounded reconciliation identifiers", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = new RazorpayApiClient({
    keyId: "rzp_test_key",
    keySecret: "test-secret",
    transport: async (request) => {
      const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
      requests.push({ url: request.url, body });
      if (request.url.endsWith("/payment_links")) {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: "plink_1",
            status: "created",
            amount: 10_000,
            currency: "INR",
            short_url: "https://rzp.io/i/test"
          })
        };
      }
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          id: "qr_1",
          status: "active",
          image_url: "https://rzp.io/qr/test",
          qr_string: "upi://pay?token=opaque"
        })
      };
    }
  });
  await client.createCollection({
    kind: "payment_link",
    invoiceId: "invoice-1",
    tenantId: "tenant-1",
    clinicId: "clinic-1",
    amountMinor: 10_000,
    currency: "INR",
    acceptPartial: true,
    minimumPartialAmountMinor: 1_000
  });
  await client.createCollection({
    kind: "invoice_qr",
    invoiceId: "invoice-1",
    tenantId: "tenant-1",
    clinicId: "clinic-1",
    amountMinor: 10_000,
    currency: "INR",
    acceptPartial: false
  });
  assert.equal(requests[0]?.url.endsWith("/payment_links"), true);
  assert.equal(requests[0]?.body.accept_partial, true);
  assert.equal(requests[0]?.body.first_min_partial_amount, 1_000);
  assert.deepEqual(requests[0]?.body.notify, { sms: false, email: false });
  assert.equal(JSON.stringify(requests[0]?.body).includes("patient"), false);
  assert.equal(requests[1]?.url.endsWith("/payments/qr_codes"), true);
  assert.equal(requests[1]?.body.fixed_amount, true);
  assert.equal(requests[1]?.body.usage, "single_use");
  await assert.rejects(
    client.createCollection({
      kind: "invoice_qr",
      invoiceId: "invoice-1",
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      amountMinor: 10_000,
      currency: "INR",
      acceptPartial: true
    }),
    /cannot accept partial payment/u
  );
});

test("provider responses are bounded before parsing or error projection", async () => {
  const client = new RazorpayApiClient({
    keyId: "rzp_test_key",
    keySecret: "test-secret",
    transport: async () => ({
      status: 200,
      headers: {},
      body: "x".repeat(512 * 1024 + 1)
    })
  });
  await assert.rejects(
    client.fetchPayment("pay_1"),
    (error: unknown) => error instanceof RazorpayBoundaryError && error.code === "PROVIDER_REJECTED"
  );
});

test("health is honest about registration, verification, outage and rotation", () => {
  const unregistered = buildRazorpayHealth({
    activationState: "configured",
    apiCredentialsConfigured: true,
    webhookRouteRegistered: false,
    currentSecretConfigured: true,
    previousSecretAcceptUntil: null,
    apiProbe: "healthy",
    lastWebhookAt: null,
    lastReconciledAt: null,
    checkedAt: "2026-07-13T10:00:00.000Z"
  });
  assert.equal(unregistered.status, "unavailable");
  assert.equal(unregistered.canCreatePaymentRequests, false);
  assert.equal(unregistered.canTrustWebhookSettlement, false);
  const degraded = buildRazorpayHealth({
    activationState: "degraded",
    apiCredentialsConfigured: true,
    webhookRouteRegistered: true,
    currentSecretConfigured: true,
    previousSecretAcceptUntil: "2026-07-14T00:00:00.000Z",
    apiProbe: "failed",
    lastWebhookAt: null,
    lastReconciledAt: null,
    checkedAt: "2026-07-13T10:00:00.000Z"
  });
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.needsReconciliation, true);
  assert.equal(degraded.rotationWindowOpen, true);
  const disabled = buildRazorpayHealth({
    activationState: "disabled",
    apiCredentialsConfigured: true,
    webhookRouteRegistered: true,
    currentSecretConfigured: true,
    previousSecretAcceptUntil: null,
    apiProbe: "healthy",
    lastWebhookAt: null,
    lastReconciledAt: null,
    checkedAt: "2026-07-13T10:00:00.000Z"
  });
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.canCreatePaymentRequests, false);
});

function raw(body: Buffer, signature: string, includeEventId = true): RawRazorpayWebhookRequest {
  return {
    rawBody: body,
    receivedAt: "2026-07-13T10:00:00.000Z",
    headers: {
      "x-razorpay-signature": signature,
      ...(includeEventId ? { "x-razorpay-event-id": "evt_1" } : {})
    }
  };
}

function sign(body: Buffer, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function paymentPayload(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      entity: "event",
      account_id: "acc_test",
      event: "payment.captured",
      created_at: 1783936800,
      payload: {
        payment: {
          entity: {
            id: "pay_1",
            amount: 4_000,
            currency: "INR",
            status: "captured",
            captured: true,
            method: "upi",
            notes: {
              clinic_os_tenant_id: "tenant-1",
              clinic_os_clinic_id: "clinic-1",
              clinic_os_invoice_id: "invoice-1",
              clinic_os_patient_id: "patient-1"
            }
          }
        },
        payment_link: {
          entity: {
            id: "plink_1",
            reference_id: "invoice-1",
            amount: 10_000,
            amount_paid: 4_000,
            currency: "INR"
          }
        }
      },
      ...overrides
    })
  );
}
