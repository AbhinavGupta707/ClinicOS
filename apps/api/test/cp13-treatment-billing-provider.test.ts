import assert from "node:assert/strict";
import test from "node:test";
import type { BillingRepositoryPort } from "@clinic-os/db";
import type { InvoiceDetail, PaymentTransactionRecord, UUID } from "@clinic-os/domain";
import { ApiError } from "../src/errors.ts";
import {
  createTreatmentBillingProviderOperationService,
  type DurablePaymentProviderEventPort,
  type PaymentProviderEventResultProjection,
  type PaymentProviderTransactionEvidencePort,
  type PaymentReconciliationProjection,
  type TreatmentBillingProviderExecutionContext,
  type VerifiedRazorpayPaymentEventRequest
} from "../src/features/treatment-billing/index.ts";

const TENANT_ID = "10000000-0000-4000-8000-000000000001" as UUID;
const CLINIC_ID = "10000000-0000-4000-8000-000000000101" as UUID;
const PATIENT_ID = "10000000-0000-4000-8000-000000002001" as UUID;
const INVOICE_ID = "10000000-0000-4000-8000-000000007001" as UUID;
const FIXED_NOW = "2026-07-10T12:00:00.000Z";
const RAW_DIGEST = "a".repeat(64);
const SIGNATURE_DIGEST = "b".repeat(64);

test("CP13 provider service covers the exact frozen Razorpay provider operation", () => {
  const service = createTreatmentBillingProviderOperationService();
  assert.deepEqual(service.operationIds, ["receiveRazorpayPaymentWebhook"]);
  assert.equal(Object.isFrozen(service), true);
});

test("CP13 signed provider overpayment applies only the balance and survives service restart", async () => {
  const durableLedger = new InMemoryDurableProviderLedger();
  const evidence = new EvidenceRecorder();
  const billing = new BillingStore(invoiceDetail(6_000));
  const context = providerContext(billing, durableLedger, evidence);
  const request = verifiedRequest({ providerEventId: "evt-overpayment-001", amountPaise: 7_000 });

  const firstService = createTreatmentBillingProviderOperationService();
  const first = await firstService.receiveRazorpayPaymentWebhook(request, context);
  const firstBody = first.body as PaymentProviderEventResultProjection;
  assert.equal(first.status, 200);
  assert.equal(firstBody.status, "reconciliation_required");
  assert.equal(firstBody.replayed, false);
  assert.equal(billing.recordCalls, 1);
  assert.equal(billing.transactions[0]?.amountMinor, 6_000);
  assert.equal(billing.transactions[0]?.verificationStatus, "verified");
  assert.equal(billing.transactions[0]?.reconciliationStatus, "requires_review");
  assert.equal(durableLedger.reconciliations[0]?.unallocatedAmountMinor, 1_000);
  assert.equal(evidence.audit.length, 1);
  assert.equal(evidence.outbox.length, 1);

  const restartedService = createTreatmentBillingProviderOperationService();
  const replay = await restartedService.receiveRazorpayPaymentWebhook(
    { ...request, metadata: { ...request.metadata, requestId: "provider-request-restarted" } },
    providerContext(billing, durableLedger, new EvidenceRecorder())
  );
  const replayBody = replay.body as PaymentProviderEventResultProjection;
  assert.equal(replayBody.status, "duplicate");
  assert.equal(replayBody.replayed, true);
  assert.equal(billing.recordCalls, 1, "restart/retry must not record settlement twice");
  assert.equal(durableLedger.reconciliations.length, 1);
});

test("CP13 bad or missing provider references persist reconciliation without paid state", async () => {
  const durableLedger = new InMemoryDurableProviderLedger();
  const evidence = new EvidenceRecorder();
  const billing = new BillingStore(invoiceDetail(6_000));
  const service = createTreatmentBillingProviderOperationService();

  const missingInvoice = verifiedRequest({
    providerEventId: "evt-missing-invoice-001",
    invoiceId: null,
    amountPaise: 2_500
  });
  const response = await service.receiveRazorpayPaymentWebhook(
    missingInvoice,
    providerContext(billing, durableLedger, evidence)
  );
  const body = response.body as PaymentProviderEventResultProjection;
  assert.equal(body.status, "reconciliation_required");
  assert.equal(body.invoice, null);
  assert.equal(body.transaction, null);
  assert.equal(body.reconciliationItem?.reason, "missing_invoice_reference");
  assert.equal(billing.recordCalls, 0);
  assert.equal(durableLedger.reconciliations.length, 1);
  assert.equal(evidence.outbox[0]?.eventType, "payment.reconciliation_required");

  const scopeMismatch = verifiedRequest({
    providerEventId: "evt-scope-mismatch-001",
    tenantId: "20000000-0000-4000-8000-000000000001",
    amountPaise: 1_000
  });
  const scopeResponse = await service.receiveRazorpayPaymentWebhook(
    scopeMismatch,
    providerContext(billing, durableLedger, evidence)
  );
  assert.equal(
    (scopeResponse.body as PaymentProviderEventResultProjection).reconciliationItem?.reason,
    "scope_mismatch"
  );
  assert.equal(billing.recordCalls, 0);

  const missingPaymentIdentity = verifiedRequest({
    providerEventId: "evt-missing-payment-id-001",
    amountPaise: 1_000,
    providerPaymentId: null
  });
  const identityResponse = await service.receiveRazorpayPaymentWebhook(
    missingPaymentIdentity,
    providerContext(billing, durableLedger, evidence)
  );
  assert.equal(
    (identityResponse.body as PaymentProviderEventResultProjection).reconciliationItem?.reason,
    "manual_review_required"
  );
  assert.equal(billing.recordCalls, 0);
});

test("CP13 provider service rejects unverified or digest-mismatched input before durable effects", async () => {
  const durableLedger = new InMemoryDurableProviderLedger();
  const service = createTreatmentBillingProviderOperationService();
  const request = verifiedRequest({ providerEventId: "evt-bad-signature-001" });
  const invalid = {
    ...request,
    verification: { ...request.verification, rawBodySha256: "c".repeat(64) }
  };

  await assert.rejects(
    service.receiveRazorpayPaymentWebhook(
      invalid,
      providerContext(new BillingStore(invoiceDetail(6_000)), durableLedger, new EvidenceRecorder())
    ),
    (error) =>
      error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_ERROR"
  );
  assert.equal(durableLedger.claimCalls, 0);
  assert.equal(durableLedger.reconciliations.length, 0);
});

test("CP13 provider payment, audit, outbox, and event claim roll back as one transaction", async () => {
  const durableLedger = new InMemoryDurableProviderLedger();
  const billing = new BillingStore(invoiceDetail(6_000));
  const evidence = new EvidenceRecorder();
  evidence.failOutbox = true;
  const service = createTreatmentBillingProviderOperationService();

  await assert.rejects(
    runAtomically(billing, durableLedger, evidence, () =>
      service.receiveRazorpayPaymentWebhook(
        verifiedRequest({ providerEventId: "evt-atomic-rollback-001", amountPaise: 6_000 }),
        providerContext(billing, durableLedger, evidence)
      )
    ),
    /synthetic outbox failure/u
  );
  assert.equal(billing.transactions.length, 0);
  assert.equal(billing.recordCalls, 0);
  assert.equal(billing.invoice.invoice.balanceMinor, 6_000);
  assert.equal(durableLedger.claims.size, 0);
  assert.equal(durableLedger.completed.size, 0);
  assert.equal(durableLedger.reconciliations.length, 0);
  assert.equal(evidence.audit.length, 0);
  assert.equal(evidence.outbox.length, 0);
});

class BillingStore {
  invoice: InvoiceDetail;
  readonly transactions: PaymentTransactionRecord[] = [];
  recordCalls = 0;

  constructor(invoice: InvoiceDetail) {
    this.invoice = invoice;
  }

  port(): BillingRepositoryPort {
    return {
      findInvoiceById: async (invoiceId: UUID) =>
        invoiceId === this.invoice.invoice.id ? this.invoice : null,
      recordPaymentTransaction: async (input) => {
        this.recordCalls += 1;
        const transaction: PaymentTransactionRecord = {
          id: `10000000-0000-4000-8000-${String(8_000 + this.recordCalls).padStart(12, "0")}` as UUID,
          tenantId: TENANT_ID,
          clinicId: CLINIC_ID,
          invoiceId: input.invoiceId,
          patientId: PATIENT_ID,
          paymentRequestId: input.paymentRequestId ?? null,
          provider: input.provider,
          providerPaymentId: input.providerPaymentId ?? null,
          providerOrderId: input.providerOrderId ?? null,
          amountMinor: input.amountMinor,
          currency: input.currency ?? "INR",
          method: input.method,
          status: input.status,
          verificationStatus: input.verificationStatus,
          reconciliationStatus: input.reconciliationStatus ?? "matched",
          idempotencyKey: input.idempotencyKey ?? null,
          receivedAt: input.receivedAt ?? FIXED_NOW,
          recordedByUserId: input.recordedByUserId ?? null,
          receiptId: null,
          metadata: input.metadata ?? {},
          createdAt: FIXED_NOW,
          updatedAt: FIXED_NOW
        };
        this.transactions.push(transaction);
        const settled = input.status === "succeeded" && input.verificationStatus === "verified";
        const paidMinor = this.invoice.invoice.paidMinor + (settled ? input.amountMinor : 0);
        const balanceMinor = Math.max(this.invoice.invoice.totalMinor - paidMinor, 0);
        this.invoice = {
          ...this.invoice,
          invoice: {
            ...this.invoice.invoice,
            paidMinor,
            balanceMinor,
            paymentStatus:
              input.reconciliationStatus === "requires_review"
                ? "reconciliation_required"
                : balanceMinor === 0
                  ? "paid"
                  : paidMinor > 0
                    ? "partially_paid"
                    : this.invoice.invoice.paymentStatus
          },
          payments: [...this.invoice.payments, transaction]
        };
        return transaction;
      }
    } as unknown as BillingRepositoryPort;
  }
}

class InMemoryDurableProviderLedger implements DurablePaymentProviderEventPort {
  readonly completed = new Map<string, PaymentProviderEventResultProjection>();
  readonly claims = new Map<UUID, string>();
  readonly reconciliations: PaymentReconciliationProjection[] = [];
  claimCalls = 0;

  async claimVerifiedEvent(
    input: Parameters<DurablePaymentProviderEventPort["claimVerifiedEvent"]>[0]
  ) {
    this.claimCalls += 1;
    const completed = this.completed.get(input.providerEventId);
    const existingId = [...this.claims.entries()].find(
      ([, eventId]) => eventId === input.providerEventId
    )?.[0];
    if (completed && existingId) {
      return { outcome: "duplicate" as const, eventId: existingId, result: completed };
    }
    const eventId =
      existingId ??
      (`10000000-0000-4000-8000-${String(9_000 + this.claimCalls).padStart(12, "0")}` as UUID);
    this.claims.set(eventId, input.providerEventId);
    return { outcome: "claimed" as const, eventId };
  }

  async createReconciliation(
    input: Parameters<DurablePaymentProviderEventPort["createReconciliation"]>[0]
  ) {
    const item: PaymentReconciliationProjection = {
      id: `10000000-0000-4000-8000-${String(10_000 + this.reconciliations.length).padStart(12, "0")}` as UUID,
      reason: input.reason,
      invoiceId: input.invoiceId,
      patientId: input.patientId,
      capturedAmountMinor: input.capturedAmountMinor,
      appliedAmountMinor: input.appliedAmountMinor,
      unallocatedAmountMinor: input.unallocatedAmountMinor,
      currency: input.currency,
      status: "open"
    };
    this.reconciliations.push(item);
    return item;
  }

  async completeEvent(input: Parameters<DurablePaymentProviderEventPort["completeEvent"]>[0]) {
    const providerEventId = this.claims.get(input.providerEventRecordId);
    if (!providerEventId) throw new Error("Provider event claim was not found.");
    this.completed.set(providerEventId, input.result);
  }
}

class EvidenceRecorder implements PaymentProviderTransactionEvidencePort {
  readonly audit: Array<Record<string, unknown>> = [];
  readonly outbox: Array<Record<string, unknown>> = [];
  failOutbox = false;

  async appendIntegrationAudit(
    input: Parameters<PaymentProviderTransactionEvidencePort["appendIntegrationAudit"]>[0]
  ) {
    this.audit.push(input);
  }

  async appendOutboxEvent(
    input: Parameters<PaymentProviderTransactionEvidencePort["appendOutboxEvent"]>[0]
  ) {
    if (this.failOutbox) throw new Error("synthetic outbox failure");
    this.outbox.push(input);
  }
}

async function runAtomically<TResult>(
  billing: BillingStore,
  ledger: InMemoryDurableProviderLedger,
  evidence: EvidenceRecorder,
  callback: () => Promise<TResult>
): Promise<TResult> {
  const snapshot = {
    invoice: structuredClone(billing.invoice),
    transactions: structuredClone(billing.transactions),
    recordCalls: billing.recordCalls,
    completed: new Map(ledger.completed),
    claims: new Map(ledger.claims),
    reconciliations: structuredClone(ledger.reconciliations),
    claimCalls: ledger.claimCalls,
    audit: structuredClone(evidence.audit),
    outbox: structuredClone(evidence.outbox)
  };
  try {
    return await callback();
  } catch (error) {
    billing.invoice = snapshot.invoice;
    billing.transactions.splice(0, billing.transactions.length, ...snapshot.transactions);
    billing.recordCalls = snapshot.recordCalls;
    ledger.completed.clear();
    snapshot.completed.forEach((value, key) => ledger.completed.set(key, value));
    ledger.claims.clear();
    snapshot.claims.forEach((value, key) => ledger.claims.set(key, value));
    ledger.reconciliations.splice(0, ledger.reconciliations.length, ...snapshot.reconciliations);
    ledger.claimCalls = snapshot.claimCalls;
    evidence.audit.splice(0, evidence.audit.length, ...snapshot.audit);
    evidence.outbox.splice(0, evidence.outbox.length, ...snapshot.outbox);
    throw error;
  }
}

function providerContext(
  billing: BillingStore,
  providerEvents: DurablePaymentProviderEventPort,
  evidence: PaymentProviderTransactionEvidencePort
): TreatmentBillingProviderExecutionContext {
  return {
    billing: billing.port(),
    providerEvents,
    evidence,
    now: () => new Date(FIXED_NOW)
  };
}

function verifiedRequest(input: {
  readonly providerEventId: string;
  readonly invoiceId?: string | null;
  readonly tenantId?: string | null;
  readonly amountPaise?: number;
  readonly providerPaymentId?: string | null;
}): VerifiedRazorpayPaymentEventRequest {
  return {
    operationId: "receiveRazorpayPaymentWebhook",
    accountScope: {
      tenantId: TENANT_ID,
      clinicId: CLINIC_ID,
      providerAccountKey: "synthetic-razorpay-account"
    },
    verification: {
      status: "verified",
      providerKey: "razorpay",
      rawBodySha256: RAW_DIGEST,
      signatureSha256: SIGNATURE_DIGEST
    },
    event: {
      providerKey: "razorpay",
      providerEventId: input.providerEventId,
      idempotencyKey: `razorpay:webhook:${input.providerEventId}`,
      eventName: "payment.captured",
      eventKind: "payment_succeeded",
      occurredAt: FIXED_NOW,
      tenantId: input.tenantId === undefined ? TENANT_ID : input.tenantId,
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      invoiceId: input.invoiceId === undefined ? INVOICE_ID : input.invoiceId,
      providerPaymentId:
        input.providerPaymentId === undefined
          ? `pay-${input.providerEventId}`
          : input.providerPaymentId,
      providerPaymentRequestId: "plink-synthetic-001",
      amountPaise: input.amountPaise ?? 6_000,
      currency: "INR",
      method: "upi",
      rawBodySha256: RAW_DIGEST,
      payload: { redactedInLaneService: true }
    },
    metadata: {
      requestId: `provider-request-${input.providerEventId}`,
      receivedAt: new Date(FIXED_NOW),
      ipAddress: "127.0.0.1",
      userAgent: "cp13-provider-test"
    }
  };
}

function invoiceDetail(balanceMinor: number): InvoiceDetail {
  return {
    invoice: {
      id: INVOICE_ID,
      tenantId: TENANT_ID,
      clinicId: CLINIC_ID,
      patientId: PATIENT_ID,
      invoiceNumber: "SYN-INV-001",
      status: "issued",
      paymentStatus: "payment_requested",
      currency: "INR",
      subtotalMinor: 10_000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 10_000,
      paidMinor: 10_000 - balanceMinor,
      refundedMinor: 0,
      balanceMinor,
      treatmentPlanId: null,
      issuedAt: FIXED_NOW,
      dueAt: null,
      createdByUserId: "10000000-0000-4000-8000-000000001001" as UUID,
      updatedByUserId: null,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW
    },
    items: [],
    paymentRequests: [],
    payments: [],
    receipts: []
  };
}
