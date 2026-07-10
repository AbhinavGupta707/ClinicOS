import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import { RazorpayPaymentProvider, SimulatorPaymentProvider } from "@clinic-os/integrations";
import {
  acceptTreatmentPlan,
  createClinicOsApiServer,
  createEncounter,
  createInvoicePaymentRequest,
  createInvoice,
  createEncounterProcedurePerformed,
  createPatientTreatmentPlan,
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
  const invoice = await prepareIssuedInvoice(repository, dependencies);

  const response = await createInvoicePaymentRequest(
    receptionist,
    dependencies,
    invoice.body.invoice.id,
    {
      requestType: "invoice_qr",
      amountMinor: 6_000,
      description: "Synthetic checkout payment"
    }
  );

  assert.equal(response.status, 201);
  assert.equal(response.body.paymentRequest.requestType, "dynamic_qr");
  assert.equal(response.body.invoice.paymentStatus, "payment_requested");
  assert.equal(response.body.invoice.paidMinor, 0);
  assert.match(response.body.paymentRequest.providerQrPayload ?? "", /simulator/);
  assert.ok(auditSink.events.some((event) => event.action === "payment.requested"));
});

test("CP5 manual payment requires audited evidence and supports idempotent replay", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = {
    repository,
    auditSink,
    paymentRepository: repository
  };
  const receptionist = {
    ...(await operationsContext("seed-receptionist")),
    idempotencyKey: "manual-payment-1"
  };
  const invoice = await prepareIssuedInvoice(repository, dependencies);

  const first = await recordInvoiceManualPayment(
    receptionist,
    dependencies,
    invoice.body.invoice.id,
    {
      amountMinor: 4_000,
      currency: "INR",
      method: "cash",
      reason: "Patient paid cash at reception.",
      reference: "CASH-RCPT-1"
    }
  );
  const replay = await recordInvoiceManualPayment(
    receptionist,
    dependencies,
    invoice.body.invoice.id,
    {
      amountMinor: 4_000,
      currency: "INR",
      method: "cash",
      reason: "Patient paid cash at reception.",
      reference: "CASH-RCPT-1"
    }
  );

  assert.equal(first.body.invoice.paidMinor, 4_000);
  assert.equal(first.body.invoice.paymentStatus, "partially_paid");
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.invoice.paidMinor, 4_000);
  assert.equal(repository.paymentTransactions.length, 1);
  assert.ok(auditSink.events.some((event) => event.action === "payment.manually_recorded"));

  await assert.rejects(
    () =>
      recordInvoiceManualPayment(receptionist, dependencies, invoice.body.invoice.id, {
        amountMinor: invoice.body.invoice.totalMinor + 1,
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
  const invoice = await prepareIssuedInvoice(repository, dependencies);
  const rawBody = JSON.stringify(
    razorpayPayload({
      eventId: "evt_partial_1",
      paymentId: "pay_partial_1",
      amount: 5_000,
      invoiceId: invoice.body.invoice.id
    })
  );
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

  assert.equal(first.body.invoice?.paidMinor, 5_000);
  assert.equal(first.body.invoice?.paymentStatus, "partially_paid");
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.invoice?.paidMinor, 5_000);
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
  const invoice = await prepareIssuedInvoice(repository, dependencies);
  const fullAmount = JSON.stringify(
    razorpayPayload({
      eventId: "evt_full_1",
      paymentId: "pay_full_1",
      amount: invoice.body.invoice.totalMinor,
      invoiceId: invoice.body.invoice.id
    })
  );
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

  const overpay = JSON.stringify(
    razorpayPayload({
      eventId: "evt_over_1",
      paymentId: "pay_over_1",
      amount: 3_000,
      invoiceId: invoice.body.invoice.id
    })
  );
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
  assert.equal(result.body.invoice?.paidMinor, invoice.body.invoice.totalMinor);
  assert.equal(result.body.invoice?.balanceMinor, 0);
  assert.equal(result.body.transaction?.amountMinor, 3_000);
  assert.equal(result.body.transaction?.status, "reconciliation_required");
  assert.equal(result.body.reconciliationItem?.reason, "overpayment");
});

test("CP5 local HTTP webhook route uses raw body signature verification", async (t) => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = { repository };
  const invoice = await prepareIssuedInvoice(repository, dependencies);
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository: repository,
    auditSink: new InMemoryAuditSink(),
    paymentProvider: new RazorpayPaymentProvider({
      keyId: "rzp_test_key",
      keySecret: "rzp_test_secret",
      webhookSecret
    }),
    useLocalAuthFixture: true,
    repositoryMode: "fixture"
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip(
        "Socket binding is blocked in this sandbox; run API payment webhook smoke outside it."
      );
      return;
    }
    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const rawBody = JSON.stringify(
      razorpayPayload({
        eventId: "evt_http_1",
        paymentId: "pay_http_1",
        amount: 2_000,
        invoiceId: invoice.body.invoice.id
      })
    );
    const response = await fetch(`${baseUrl}/v1/payment-webhooks/razorpay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-razorpay-event-id": "evt_http_1",
        "x-razorpay-signature": hmac(rawBody, webhookSecret)
      },
      body: rawBody
    });

    const responseBody = await response.json();
    assert.equal(response.status, 200, JSON.stringify(responseBody));
    assert.equal(responseBody.invoice.paidMinor, 2_000);
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

async function prepareIssuedInvoice(
  repository: LocalFixtureClinicOperationsRepository,
  dependencies: OperationsDependencies
) {
  const assistant = await operationsContext("seed-assistant");
  const accountant = await operationsContext("seed-accountant");
  const encounter = await createEncounter(assistant, dependencies, {
    patientId,
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    reason: "CP5 payment provider fixture"
  });
  const procedure = repository.pricebookProcedures.find((item) => item.code === "SCALING");
  assert.ok(procedure);
  const plan = await createPatientTreatmentPlan(assistant, dependencies, patientId, {
    encounterId: encounter.body.encounter.id,
    title: "Periodontal payment fixture plan",
    phases: [
      {
        title: "Initial therapy",
        items: [
          {
            pricebookProcedureId: procedure.id,
            quantity: 1,
            unitPriceMinor: 150000,
            discountMinor: 0,
            taxRateBasisPoints: 0
          }
        ]
      }
    ]
  });
  const accepted = await acceptTreatmentPlan(assistant, dependencies, plan.body.treatmentPlan.id, {
    acceptedByName: "Rhea Synthetic",
    acceptanceEvidence: { channel: "synthetic_test" }
  });
  const estimateItem = accepted.body.treatmentPlan.phases[0].estimateItems[0];
  await createEncounterProcedurePerformed(assistant, dependencies, encounter.body.encounter.id, {
    treatmentPlanId: accepted.body.treatmentPlan.id,
    treatmentPlanEstimateItemId: estimateItem.id,
    outcome: "Synthetic CP5 provider payment fixture complete."
  });

  return createInvoice(accountant, dependencies, {
    treatmentPlanId: accepted.body.treatmentPlan.id
  });
}

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

function razorpayPayload(input: {
  eventId: string;
  paymentId: string;
  amount: number;
  invoiceId: string;
}) {
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
            clinic_os_invoice_id: input.invoiceId
          }
        }
      }
    }
  };
}

function hmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
