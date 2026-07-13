import assert from "node:assert/strict";
import test from "node:test";
import {
  RazorpayPaymentProvider,
  SimulatorPaymentProvider,
  signRazorpayWebhook,
  type PaymentProviderFetch
} from "../dist/index.js";

const webhookSecret = "test_webhook_secret";

test("Razorpay webhook verification uses the raw body HMAC signature", async () => {
  const provider = new RazorpayPaymentProvider({
    keyId: "rzp_test_key",
    keySecret: "rzp_test_secret",
    webhookSecret,
    webhookUrl:
      "https://api.example.test/v1/provider-callbacks/razorpay/registration_key_123456"
  });
  const rawBody = JSON.stringify(razorpayCapturedPayload({ amount: 5_000 }));
  const signature = signRazorpayWebhook(rawBody, webhookSecret);

  const verified = await provider.verifyWebhook({
    providerKey: "razorpay",
    rawBody,
    receivedAt: "2026-07-07T10:00:00.000Z",
    headers: {
      "x-razorpay-event-id": "evt_paid_1",
      "x-razorpay-signature": signature
    }
  });
  assert.equal(verified.status, "verified");

  const tampered = await provider.verifyWebhook({
    providerKey: "razorpay",
    rawBody: rawBody.replace("5000", "7000"),
    receivedAt: "2026-07-07T10:00:00.000Z",
    headers: {
      "x-razorpay-event-id": "evt_paid_1",
      "x-razorpay-signature": signature
    }
  });
  assert.equal(tampered.status, "invalid_signature");
});

test("Razorpay parser normalizes provider payment events without trusting unsigned data", async () => {
  const provider = new RazorpayPaymentProvider({
    keyId: "rzp_test_key",
    keySecret: "rzp_test_secret",
    webhookSecret
  });
  const rawBody = JSON.stringify(razorpayCapturedPayload({ amount: 5_000 }));
  const event = await provider.parseWebhook({
    providerKey: "razorpay",
    rawBody,
    receivedAt: "2026-07-07T10:00:00.000Z",
    headers: { "x-razorpay-event-id": "evt_paid_1" }
  });

  assert.equal(event.providerEventId, "evt_paid_1");
  assert.equal(event.eventKind, "payment_succeeded");
  assert.equal(event.invoiceId, "40000000-0000-4000-8000-000000000001");
  assert.equal(event.tenantId, "10000000-0000-4000-8000-000000000001");
  assert.equal(event.amountPaise, 5_000);
  assert.equal(event.providerPaymentId, "pay_test_1");
  assert.equal(event.rawBodySha256.length, 64);
});

test("Razorpay health is degraded, not silently registered, when webhook URL is absent", async () => {
  const provider = new RazorpayPaymentProvider({
    keyId: "rzp_test_key",
    keySecret: "rzp_test_secret",
    webhookSecret
  });

  const health = await provider.healthCheck();
  assert.equal(health.status, "degraded");
  assert.match(health.message ?? "", /webhook/i);
  assert.equal(health.capabilities.includes("RECEIVE_WEBHOOKS"), false);
  assert.equal(health.capabilities.includes("CREATE_PAYMENT_LINKS"), true);
});

test("Razorpay payment link creation is contract-tested with injectable fetch", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetch: PaymentProviderFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body ?? "{}") });
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          id: "plink_test_1",
          short_url: "https://rzp.io/i/test",
          status: "created"
        };
      },
      async text() {
        return "";
      }
    };
  };
  const provider = new RazorpayPaymentProvider({
    keyId: "rzp_test_key",
    keySecret: "rzp_test_secret",
    webhookSecret,
    fetch
  });

  const result = await provider.createPaymentLink({
    tenantId: "10000000-0000-4000-8000-000000000001",
    clinicId: "10000000-0000-4000-8000-000000000101",
    patientId: "10000000-0000-4000-8000-000000000301",
    invoiceId: "40000000-0000-4000-8000-000000000001",
    amountPaise: 12_000,
    currency: "INR",
    idempotencyKey: "request-1"
  });

  assert.equal(result.providerRequestId, "plink_test_1");
  assert.equal(result.paymentUrl, "https://rzp.io/i/test");
  assert.equal(calls[0].url, "https://api.razorpay.com/v1/payment_links");
  assert.equal(calls[0].body.amount, 12_000);
  assert.equal(calls[0].body.reference_id, "40000000-0000-4000-8000-000000000001");
  assert.deepEqual((calls[0].body.notes as Record<string, string>).clinic_os_invoice_id, "40000000-0000-4000-8000-000000000001");
});

test("simulator requires a signed event before it emits a successful provider payment", async () => {
  const provider = new SimulatorPaymentProvider({ webhookSecret: "sim-secret" });
  const request = await provider.createInvoiceQr({
    tenantId: "10000000-0000-4000-8000-000000000001",
    clinicId: "10000000-0000-4000-8000-000000000101",
    patientId: "10000000-0000-4000-8000-000000000301",
    invoiceId: "40000000-0000-4000-8000-000000000001",
    amountPaise: 5_000,
    currency: "INR"
  });
  assert.equal(request.status, "created");

  const raw = provider.buildSignedWebhook({
    tenantId: "10000000-0000-4000-8000-000000000001",
    clinicId: "10000000-0000-4000-8000-000000000101",
    patientId: "10000000-0000-4000-8000-000000000301",
    invoiceId: "40000000-0000-4000-8000-000000000001",
    providerPaymentRequestId: request.providerRequestId,
    amountPaise: 5_000
  });

  const verification = await provider.verifyWebhook(raw);
  const event = await provider.parseWebhook(raw);
  assert.equal(verification.status, "verified");
  assert.equal(event.eventKind, "payment_succeeded");
  assert.equal(event.providerPaymentRequestId, request.providerRequestId);
});

function razorpayCapturedPayload(input: { amount: number }) {
  return {
    event: "payment.captured",
    created_at: 1_783_425_600,
    payload: {
      payment: {
        entity: {
          id: "pay_test_1",
          amount: input.amount,
          currency: "INR",
          status: "captured",
          captured: true,
          method: "upi",
          notes: {
            clinic_os_tenant_id: "10000000-0000-4000-8000-000000000001",
            clinic_os_clinic_id: "10000000-0000-4000-8000-000000000101",
            clinic_os_patient_id: "10000000-0000-4000-8000-000000000301",
            clinic_os_invoice_id: "40000000-0000-4000-8000-000000000001"
          }
        }
      }
    }
  };
}
