import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  verifyAndNormalizeRazorpayWebhook,
  type RazorpayWebhookRouteBinding
} from "../../../packages/integrations/dist/cp15/razorpay/index.js";
import type {
  RazorpayAccountScope,
  RazorpayInvoiceSettlementSnapshot,
  RazorpayPaymentEffectSnapshot,
  RazorpayPaymentRequestBinding
} from "../../../packages/domain/src/cp15/razorpay/index.ts";
import {
  evaluateRazorpayReconciliation,
  nextRazorpayReconciliationAttempt,
  processRawRazorpayWebhook,
  type RazorpayEventClaim,
  type RazorpayTransactionalPort,
  type RazorpayUnitOfWorkPort,
  type RazorpayVerifiedEventEvidence,
  type RazorpayWebhookProcessingResult
} from "../src/features/cp15-razorpay/index.ts";

const SECRET = "test-webhook-secret";
const account: RazorpayAccountScope = {
  tenantId: "tenant-1",
  clinicId: "clinic-1",
  externalAccountId: "external-1",
  razorpayAccountId: "acc_test",
  mode: "test"
};
const binding: RazorpayWebhookRouteBinding = {
  ...account,
  activationState: "sandbox_verified",
  secrets: [{ version: "v2", secret: SECRET, role: "current" }]
};
const invoice: RazorpayInvoiceSettlementSnapshot = {
  invoiceId: "invoice-1",
  patientId: "patient-1",
  status: "issued",
  currency: "INR",
  totalMinor: 10_000,
  paidMinor: 0,
  refundedMinor: 0,
  balanceMinor: 10_000
};
const paymentRequest: RazorpayPaymentRequestBinding = {
  providerRequestId: "plink_1",
  invoiceId: invoice.invoiceId,
  patientId: invoice.patientId,
  amountMinor: 10_000,
  currency: "INR",
  requestKind: "payment_link",
  acceptPartial: true,
  status: "created"
};

test("unsigned or invalid callbacks never enter the durable transaction", async () => {
  const harness = new DurableHarness();
  const body = paymentPayload();
  await assert.rejects(
    processRawRazorpayWebhook({
      raw: raw(body, "0".repeat(64)),
      verifier: verifier(),
      unitOfWork: harness,
      metadata: metadata(),
      now: clock
    })
  );
  assert.equal(harness.transactionCount, 0);
  assert.equal(harness.effects.length, 0);
});

test("partial captured callback commits payment, request state, audit and outbox once", async () => {
  const harness = new DurableHarness();
  const body = paymentPayload({ event: "payment_link.partially_paid" });
  const result = await process(harness, body);
  assert.equal(result.status, "applied");
  assert.equal(harness.effects.filter((effect) => effect.kind === "payment").length, 1);
  assert.equal(harness.effects.find((effect) => effect.kind === "payment")?.amountMinor, 4_000);
  assert.equal(harness.requestStates.at(-1)?.status, "partially_paid");
  assert.equal(harness.audits.at(-1)?.action, "payment.succeeded");
  assert.equal(harness.outbox.length, 1);

  const duplicate = await process(harness, body);
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.replayed, true);
  assert.equal(harness.effects.filter((effect) => effect.kind === "payment").length, 1);
});

test("distinct provider events for one payment share a business key and cannot double-settle", async () => {
  const harness = new DurableHarness();
  const captured = paymentPayload({ event: "payment.captured" });
  await process(harness, captured, "evt_capture");
  const paid = paymentPayload({ event: "payment_link.paid" });
  const duplicateEffect = await process(harness, paid, "evt_link_paid");
  assert.equal(duplicateEffect.status, "ignored");
  assert.equal(duplicateEffect.reason, "duplicate_business_effect");
  assert.equal(harness.effects.filter((effect) => effect.kind === "payment").length, 1);
});

test("overpayment applies only the invoice balance and opens reconciliation", async () => {
  const harness = new DurableHarness({
    invoice: { ...invoice, paidMinor: 8_000, balanceMinor: 2_000 }
  });
  const body = paymentPayload({ payload: paymentPayloadObject(3_000) });
  const result = await process(harness, body);
  assert.equal(result.status, "reconciliation_required");
  assert.equal(result.reason, "overpayment");
  assert.equal(harness.effects.find((effect) => effect.kind === "payment")?.amountMinor, 2_000);
  assert.equal(harness.reconciliations[0]?.amountMinor, 3_000);
  assert.equal(harness.reconciliations[0]?.safeAppliedAmountMinor, 2_000);
});

test("processed refund records a bounded refund while disputes only create review evidence", async () => {
  const existingPayment: RazorpayPaymentEffectSnapshot = {
    providerPaymentId: "pay_1",
    invoiceId: invoice.invoiceId,
    capturedAmountMinor: 10_000,
    refundedAmountMinor: 0,
    lastRank: 30
  };
  const refundHarness = new DurableHarness({ existingPayment });
  const refund = refundPayload(2_000);
  const refundResult = await process(refundHarness, refund, "evt_refund");
  assert.equal(refundResult.status, "applied");
  assert.equal(
    refundHarness.effects.find((effect) => effect.kind === "refund")?.amountMinor,
    2_000
  );
  assert.equal(refundHarness.audits.at(-1)?.action, "payment.refunded");

  const disputeHarness = new DurableHarness({ existingPayment });
  const disputeResult = await process(disputeHarness, disputePayload(), "evt_dispute");
  assert.equal(disputeResult.status, "reconciliation_required");
  assert.equal(disputeResult.reason, "dispute_requires_review");
  assert.equal(disputeHarness.effects.length, 0);
  assert.equal(disputeHarness.reconciliations.length, 1);
});

test("official API reconciliation is variance evidence and never direct settlement", () => {
  const variance = evaluateRazorpayReconciliation(
    {
      providerPaymentId: "pay_1",
      amountMinor: 10_000,
      amountRefundedMinor: 0,
      currency: "INR",
      status: "captured",
      captured: true,
      providerRequestId: "plink_1"
    },
    null
  );
  assert.deepEqual(variance, {
    status: "variance",
    settlementAllowed: false,
    reason: "missing_local_capture",
    providerPaymentId: "pay_1"
  });
  assert.deepEqual(
    nextRazorpayReconciliationAttempt({
      attempt: 1,
      now: "2026-07-13T10:00:00.000Z",
      retryable: true
    }),
    { status: "retry_scheduled", nextAttemptAt: "2026-07-13T10:00:30.000Z" }
  );
  assert.deepEqual(
    nextRazorpayReconciliationAttempt({
      attempt: 8,
      now: "2026-07-13T10:00:00.000Z",
      retryable: true
    }),
    { status: "dead_lettered", nextAttemptAt: null }
  );
});

class DurableHarness implements RazorpayUnitOfWorkPort, RazorpayTransactionalPort {
  transactionCount = 0;
  readonly effects: Array<{ kind: string; amountMinor: number }> = [];
  readonly requestStates: Array<{ providerRequestId: string; status: string }> = [];
  readonly reconciliations: Array<{
    amountMinor: number;
    safeAppliedAmountMinor: number;
    reason: string;
  }> = [];
  readonly audits: Array<{ action: string }> = [];
  readonly outbox: Array<{ eventType: string }> = [];
  readonly #businessKeys = new Set<string>();
  readonly #events = new Map<
    string,
    { evidence: RazorpayVerifiedEventEvidence; result: RazorpayWebhookProcessingResult | null }
  >();
  readonly #invoice: RazorpayInvoiceSettlementSnapshot;
  readonly #existingPayment: RazorpayPaymentEffectSnapshot | null;

  constructor(
    options: {
      invoice?: RazorpayInvoiceSettlementSnapshot;
      existingPayment?: RazorpayPaymentEffectSnapshot;
    } = {}
  ) {
    this.#invoice = options.invoice ?? invoice;
    this.#existingPayment = options.existingPayment ?? null;
  }

  async transaction<T>(
    _account: RazorpayAccountScope,
    execute: (transaction: RazorpayTransactionalPort) => Promise<T>
  ): Promise<T> {
    this.transactionCount += 1;
    return execute(this);
  }

  async claimProviderEvent(
    input: Parameters<RazorpayTransactionalPort["claimProviderEvent"]>[0]
  ): Promise<RazorpayEventClaim> {
    const stored = this.#events.get(input.providerEventId);
    if (stored?.result)
      return {
        outcome: "duplicate",
        eventRecordId: `event-${input.providerEventId}`,
        storedEvidence: stored.evidence,
        storedResult: stored.result
      };
    this.#events.set(input.providerEventId, { evidence: input.evidence, result: null });
    return { outcome: "claimed", eventRecordId: `event-${input.providerEventId}` };
  }

  async findInvoice(invoiceId: string | null) {
    return invoiceId === this.#invoice.invoiceId ? this.#invoice : null;
  }
  async findPaymentRequest(input: { providerRequestId: string | null; invoiceId: string | null }) {
    return input.providerRequestId === paymentRequest.providerRequestId ||
      input.invoiceId === paymentRequest.invoiceId
      ? paymentRequest
      : null;
  }
  async findPaymentEffect(providerPaymentId: string | null) {
    return providerPaymentId === this.#existingPayment?.providerPaymentId
      ? this.#existingPayment
      : null;
  }
  async claimBusinessEffect(key: string) {
    if (this.#businessKeys.has(key)) return "duplicate" as const;
    this.#businessKeys.add(key);
    return "claimed" as const;
  }
  async recordPayment(input: Parameters<RazorpayTransactionalPort["recordPayment"]>[0]) {
    this.effects.push({ kind: "payment", amountMinor: input.decision.appliedAmountMinor });
    return { effectRecordId: `payment-${this.effects.length}` };
  }
  async recordFailure(input: Parameters<RazorpayTransactionalPort["recordFailure"]>[0]) {
    this.effects.push({ kind: "failure", amountMinor: input.decision.amountMinor });
    return { effectRecordId: `failure-${this.effects.length}` };
  }
  async recordRefund(input: Parameters<RazorpayTransactionalPort["recordRefund"]>[0]) {
    this.effects.push({ kind: "refund", amountMinor: input.decision.refundAmountMinor });
    return { effectRecordId: `refund-${this.effects.length}` };
  }
  async updatePaymentRequestState(
    input: Parameters<RazorpayTransactionalPort["updatePaymentRequestState"]>[0]
  ) {
    this.requestStates.push({ providerRequestId: input.providerRequestId, status: input.status });
    return { effectRecordId: `request-${this.requestStates.length}` };
  }
  async createReconciliation(
    input: Parameters<RazorpayTransactionalPort["createReconciliation"]>[0]
  ) {
    this.reconciliations.push({
      amountMinor: input.amountMinor,
      safeAppliedAmountMinor: input.safeAppliedAmountMinor,
      reason: input.reason
    });
    return { reconciliationId: `reconciliation-${this.reconciliations.length}` };
  }
  async appendAudit(input: Parameters<RazorpayTransactionalPort["appendAudit"]>[0]) {
    this.audits.push({ action: input.action });
  }
  async appendOutbox(input: Parameters<RazorpayTransactionalPort["appendOutbox"]>[0]) {
    this.outbox.push({ eventType: input.eventType });
  }
  async completeProviderEvent(
    input: Parameters<RazorpayTransactionalPort["completeProviderEvent"]>[0]
  ) {
    const stored = this.#events.get(input.result.providerEventId);
    if (!stored) throw new Error("provider event was not claimed");
    stored.result = input.result;
  }
}

async function process(harness: DurableHarness, body: Buffer, eventId = "evt_1") {
  return processRawRazorpayWebhook({
    raw: raw(body, sign(body), eventId),
    verifier: verifier(),
    unitOfWork: harness,
    metadata: metadata(),
    now: clock
  });
}

function verifier() {
  return {
    verify: (input: Parameters<typeof verifyAndNormalizeRazorpayWebhook>[0]) =>
      verifyAndNormalizeRazorpayWebhook(input, binding)
  };
}

function metadata() {
  return { requestId: "request-1", receivedAt: "2026-07-13T10:00:00.000Z" };
}
function clock() {
  return new Date("2026-07-13T10:00:01.000Z");
}
function sign(body: Buffer) {
  return createHmac("sha256", SECRET).update(body).digest("hex");
}
function raw(body: Buffer, signature: string, eventId = "evt_1") {
  return {
    rawBody: body,
    receivedAt: "2026-07-13T10:00:00.000Z",
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId }
  };
}

function paymentPayload(overrides: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      entity: "event",
      account_id: "acc_test",
      event: "payment.captured",
      created_at: 1783936800,
      payload: paymentPayloadObject(4_000),
      ...overrides
    })
  );
}

function paymentPayloadObject(amount: number) {
  return {
    payment: {
      entity: {
        id: "pay_1",
        amount,
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
        amount_paid: amount,
        currency: "INR"
      }
    }
  };
}

function refundPayload(amount: number) {
  return Buffer.from(
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
            amount,
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
}

function disputePayload() {
  return Buffer.from(
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
}
