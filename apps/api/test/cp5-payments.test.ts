import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import { RazorpayPaymentProvider, SimulatorPaymentProvider } from "@clinic-os/integrations";
import {
  CP5_PAYMENT_FIXTURE_IDS,
  createClinicOsApiServer,
  createInvoicePaymentRequest,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  processPaymentWebhook,
  recordInvoiceManualPayment,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const invoiceId = CP5_PAYMENT_FIXTURE_IDS.invoiceId;
const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;
const webhookSecret = "razorpay-webhook-secret";

test("CP5 payment request creates provider QR without marking the invoice paid", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const paymentProvider = new SimulatorPaymentProvider();
  const dependencies: OperationsDependencies = {
    repository,
    auditSink,
    paymentProvider,
    paymentRepository: repository
  };
  const receptionist = await operationsContext("seed-receptionist");

  const response = await createInvoicePaymentRequest(receptionist, dependencies, invoiceId, {
    requestType: "invoice_qr",
    amountPaise: 6_000,
    description: "Synthetic checkout payment"
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.paymentRequest.requestType, "invoice_qr");
  assert.equal(response.body.invoice.paymentState, "qr_created");
  assert.equal(response.body.invoice.amountPaidPaise, 0);
  assert.match(response.body.paymentRequest.qrString ?? "", /simulator/);
  assert.ok(auditSink.events.some((event) => event.action === "payment.requested"));
});

test("CP5 manual payment requires audited evidence and supports idempotent replay", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink, paymentRepository: repository };
  const receptionist = {
    ...(await operationsContext("seed-receptionist")),
    idempotencyKey: "manual-payment-1"
  };

  const first = await recordInvoiceManualPayment(receptionist, dependencies, invoiceId, {
    amountPaise: 4_000,
    currency: "INR",
    method: "cash",
    reason: "Patient paid cash at reception.",
    reference: "CASH-RCPT-1"
  });
  const replay = await recordInvoiceManualPayment(receptionist, dependencies, invoiceId, {
    amountPaise: 4_000,
    currency: "INR",
    method: "cash",
    reason: "Patient paid cash at reception.",
    reference: "CASH-RCPT-1"
  });

  assert.equal(first.body.invoice.amountPaidPaise, 4_000);
  assert.equal(first.body.invoice.paymentState, "partially_paid");
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.invoice.amountPaidPaise, 4_000);
  assert.equal(repository.paymentTransactions.length, 1);
  assert.ok(auditSink.events.some((event) => event.action === "payment.manually_recorded"));

  await assert.rejects(
    () =>
      recordInvoiceManualPayment(receptionist, dependencies, invoiceId, {
        amountPaise: 20_000,
        currency: "INR",
        method: "cash",
        reason: "Should not overpay.",
        reference: "CASH-RCPT-OVER"
      }),
    /exceeds the invoice amount due/
  );
});

test("CP5 Razorpay webhook verification applies partial payment once and rejects bad signatures", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const paymentProvider = new RazorpayPaymentProvider({
    keyId: "rzp_test_key",
    keySecret: "rzp_test_secret",
    webhookSecret
  });
  const dependencies: OperationsDependencies = {
    repository,
    auditSink,
    paymentProvider,
    paymentRepository: repository
  };
  const rawBody = JSON.stringify(razorpayPayload({ eventId: "evt_partial_1", paymentId: "pay_partial_1", amount: 5_000 }));
  const headers = {
    "x-razorpay-event-id": "evt_partial_1",
    "x-razorpay-signature": hmac(rawBody, webhookSecret)
  };

  const first = await processPaymentWebhook(dependencies, {
    requestId: "req-webhook-1",
    providerKey: "razorpay",
    rawBody,
    headers,
    receivedAt: "2026-07-07T10:00:00.000Z"
  });
  const replay = await processPaymentWebhook(dependencies, {
    requestId: "req-webhook-2",
    providerKey: "razorpay",
    rawBody,
    headers,
    receivedAt: "2026-07-07T10:00:01.000Z"
  });

  assert.equal(first.body.invoice?.amountPaidPaise, 5_000);
  assert.equal(first.body.invoice?.paymentState, "partially_paid");
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.invoice?.amountPaidPaise, 5_000);
  assert.equal(repository.paymentTransactions.length, 1);
  assert.ok(auditSink.events.some((event) => event.action === "payment.succeeded"));

  await assert.rejects(
    () =>
      processPaymentWebhook(dependencies, {
        requestId: "req-webhook-bad",
        providerKey: "razorpay",
        rawBody,
        headers: { ...headers, "x-razorpay-signature": "bad-signature" },
        receivedAt: "2026-07-07T10:00:02.000Z"
      }),
    (error) => error instanceof Error && "status" in error && error.status === 403
  );
  assert.equal(repository.paymentTransactions.length, 1);
});

test("CP5 provider overpayment is capped and creates reconciliation without inflation", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = {
    repository,
    paymentProvider: new RazorpayPaymentProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      webhookSecret
    }),
    paymentRepository: repository
  };
  const fullAmount = JSON.stringify(razorpayPayload({ eventId: "evt_full_1", paymentId: "pay_full_1", amount: 12_000 }));
  await processPaymentWebhook(dependencies, {
    requestId: "req-full",
    providerKey: "razorpay",
    rawBody: fullAmount,
    headers: {
      "x-razorpay-event-id": "evt_full_1",
      "x-razorpay-signature": hmac(fullAmount, webhookSecret)
    },
    receivedAt: "2026-07-07T10:00:00.000Z"
  });

  const overpay = JSON.stringify(razorpayPayload({ eventId: "evt_over_1", paymentId: "pay_over_1", amount: 3_000 }));
  const result = await processPaymentWebhook(dependencies, {
    requestId: "req-over",
    providerKey: "razorpay",
    rawBody: overpay,
    headers: {
      "x-razorpay-event-id": "evt_over_1",
      "x-razorpay-signature": hmac(overpay, webhookSecret)
    },
    receivedAt: "2026-07-07T10:01:00.000Z"
  });

  assert.equal(result.body.status, "reconciliation_required");
  assert.equal(result.body.invoice?.amountPaidPaise, 12_000);
  assert.equal(result.body.invoice?.amountDuePaise, 0);
  assert.equal(result.body.transaction?.appliedAmountPaise, 0);
  assert.equal(result.body.reconciliationItem?.reason, "overpayment");
});

test("CP5 local HTTP webhook route uses raw body signature verification", async (t) => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository: repository,
    paymentProvider: new RazorpayPaymentProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      webhookSecret
    }),
    useLocalAuthFixture: true
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip("Socket binding is blocked in this sandbox; run API payment webhook smoke outside it.");
      return;
    }
    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const rawBody = JSON.stringify(razorpayPayload({ eventId: "evt_http_1", paymentId: "pay_http_1", amount: 2_000 }));
    const response = await fetch(`${baseUrl}/v1/payment-webhooks/razorpay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-event-id": "evt_http_1",
        "x-razorpay-signature": hmac(rawBody, webhookSecret)
      },
      body: rawBody
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).invoice.amountPaidPaise, 2_000);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

const config = {
  nodeEnv: "development",
  clinicOsEnv: "local",
  isProductionLike: false,
  services: {
    databaseUrl: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
    redisUrl: "redis://localhost:6379",
    temporalAddress: "localhost:7233"
  },
  auth: {
    keycloakBaseUrl: "http://localhost:8080",
    keycloakRealm: "clinic-os-local",
    keycloakClientId: "clinic-os-web"
  },
  storage: {
    region: "ap-south-1",
    bucket: "clinic-os-local"
  },
  providers: {
    whatsapp: { provider: "simulator", appSecretProofRequired: false },
    payment: {
      provider: "razorpay",
      qrMode: "payment_link_qr",
      razorpayKeyId: "rzp_test_key",
      razorpayKeySecret: "rzp_test_secret",
      razorpayWebhookSecret: webhookSecret
    },
    telephony: { provider: "simulator", regionSubdomain: "api.in.exotel.com" },
    ai: { llmProvider: "simulator", transcriptionProvider: "simulator" }
  },
  pilotInputs: {
    syntheticDataOnly: true
  }
};

async function operationsContext(subject: string): Promise<OperationsRequestContext> {
  const identityRepository = new LocalFixtureIdentityRepository();
  const claims = {
    ...createClaims(subject),
    exp: Math.floor(new Date("2026-07-07T08:00:00.000Z").getTime() / 1000) + 300
  };
  const principal = principalFromVerifiedKeycloakClaims(claims, {
    expectedIssuer,
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    now: new Date("2026-07-07T08:00:00.000Z")
  });
  const snapshot = await identityRepository.findAccessByKeycloakSubject(subject);
  assert.ok(snapshot);

  return {
    requestId: `req_${subject}`,
    accessContext: buildAccessContext({
      principal,
      tenant: snapshot.tenant,
      user: snapshot.user,
      memberships: snapshot.memberships,
      clinicAssignments: snapshot.clinicAssignments,
      roleAssignments: snapshot.roleAssignments
    }),
    clinicId: CHECKPOINT1_SEED_IDS.clinicId,
    ipAddress: "127.0.0.1",
    userAgent: "node-test"
  };
}

function createClaims(subject: string) {
  return {
    sub: subject,
    iss: expectedIssuer,
    aud: acceptedAudience,
    azp: acceptedAudience,
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    email_verified: true
  };
}

function razorpayPayload(input: { eventId: string; paymentId: string; amount: number }) {
  return {
    id: input.eventId,
    event: "payment.captured",
    created_at: 1_783_425_600,
    payload: {
      payment: {
        entity: {
          id: input.paymentId,
          amount: input.amount,
          currency: "INR",
          status: "captured",
          captured: true,
          method: "upi",
          notes: {
            clinic_os_tenant_id: CHECKPOINT1_SEED_IDS.tenantId,
            clinic_os_clinic_id: CHECKPOINT1_SEED_IDS.clinicId,
            clinic_os_patient_id: patientId,
            clinic_os_invoice_id: invoiceId
          }
        }
      }
    }
  };
}

function hmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
