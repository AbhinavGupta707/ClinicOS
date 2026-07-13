import { createHash, randomUUID } from "node:crypto";
import { buildSetLocalRlsStatements, type SqlQueryClient } from "@clinic-os/db";
import {
  razorpayEventRank,
  razorpayBusinessKey,
  type NormalizedRazorpayEvent,
  type RazorpayAccountScope,
  type RazorpayEventDecision,
  type RazorpayInvoiceSettlementSnapshot,
  type RazorpayPaymentEffectSnapshot,
  type RazorpayPaymentRequestBinding,
  type UUID
} from "@clinic-os/domain";
import type {
  RazorpayAuditRecord,
  RazorpayEventClaim,
  RazorpayOutboxRecord,
  RazorpayTransactionalPort,
  RazorpayUnitOfWorkPort,
  RazorpayVerifiedEventEvidence,
  RazorpayWebhookProcessingResult
} from "../../features/cp15-razorpay/contracts.ts";

interface ProviderUnitOfWork {
  run<T>(callback: (context: { readonly sqlClient?: SqlQueryClient }) => Promise<T>): Promise<T>;
}

interface RawEventRow {
  id: string;
  processing_status: string;
  lease_expires_at: string | null;
  raw_body_sha256: string | null;
  signature_sha256: string | null;
  normalized_event_sha256: string | null;
  normalized_event: unknown;
  verified_secret_version: string | null;
  verified_with_previous_secret: boolean;
  raw_body_length: number | null;
  result_projection: unknown;
}

interface InvoiceRow {
  id: string;
  patient_id: string;
  status: "issued" | "cancelled" | "void";
  currency: string;
  total_minor: string | number;
  paid_minor: string | number;
  refunded_minor: string | number;
  balance_minor: string | number;
  created_by_user_id: string;
}

interface PaymentRequestRow {
  id: string;
  provider_reference_id: string;
  invoice_id: string;
  patient_id: string;
  amount_minor: string | number;
  currency: string;
  request_type: "payment_link" | "dynamic_qr";
  status: string;
  metadata: unknown;
}

interface PaymentEffectRow {
  provider_payment_id: string;
  invoice_id: string;
  amount_minor: string | number;
  cumulative_refunded_amount_minor: string | number;
  event_rank: number;
}

interface IdRow {
  id: string;
}

export class PostgresRazorpayUnitOfWork implements RazorpayUnitOfWorkPort {
  readonly #unitOfWork: ProviderUnitOfWork;

  constructor(unitOfWork: ProviderUnitOfWork) {
    this.#unitOfWork = unitOfWork;
  }

  transaction<T>(
    account: RazorpayAccountScope,
    execute: (transaction: RazorpayTransactionalPort) => Promise<T>
  ): Promise<T> {
    return this.#unitOfWork.run(async ({ sqlClient }) => {
      if (!sqlClient) throw new Error("Razorpay processing requires a transaction-bound SQL client.");
      await setScope(sqlClient, account.tenantId as UUID, account.clinicId as UUID);
      return execute(new PostgresRazorpayTransaction(sqlClient, account));
    });
  }
}

class PostgresRazorpayTransaction implements RazorpayTransactionalPort {
  readonly #client: SqlQueryClient;
  readonly #account: RazorpayAccountScope;

  constructor(client: SqlQueryClient, account: RazorpayAccountScope) {
    this.#client = client;
    this.#account = account;
  }

  async recordVerifiedCallback(receivedAt: string): Promise<void> {
    const updated = await this.#client.query<IdRow>(
      `update provider_callback_registrations
          set last_verified_callback_at = case
                when last_verified_callback_at is null
                  or last_verified_callback_at < $4::timestamptz
                then $4::timestamptz
                else last_verified_callback_at
              end,
              last_health_check_at = case
                when last_health_check_at is null or last_health_check_at < $4::timestamptz
                then $4::timestamptz
                else last_health_check_at
              end,
              last_failure_code = null,
              row_version = row_version + 1
        where tenant_id = $1 and clinic_id = $2 and external_account_id = $3
          and provider_key = 'razorpay'
        returning id`,
      [
        this.#account.tenantId,
        this.#account.clinicId,
        this.#account.externalAccountId,
        receivedAt
      ]
    );
    if (updated.rows.length !== 1) {
      throw new Error("Verified Razorpay callback has no unique durable provider registration.");
    }
  }

  async claimProviderEvent(input: {
    readonly account: RazorpayAccountScope;
    readonly providerEventId: string;
    readonly eventName: string;
    readonly evidence: RazorpayVerifiedEventEvidence;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: string;
    readonly receivedAt: string;
  }): Promise<RazorpayEventClaim> {
    const existing = await this.#client.query<RawEventRow>(
      `select id, processing_status, lease_expires_at, raw_body_sha256, signature_sha256,
              normalized_event_sha256, normalized_event, verified_secret_version,
              verified_with_previous_secret, raw_body_length, result_projection
         from raw_webhook_events
        where tenant_id = $1 and clinic_id = $2 and external_account_id = $3
          and provider_event_id = $4
        for update`,
      [
        this.#account.tenantId,
        this.#account.clinicId,
        this.#account.externalAccountId,
        input.providerEventId
      ]
    );
    const row = existing.rows[0];
    if (row) {
      if (!razorpayEvidenceMatches(row, input.evidence)) {
        return { outcome: "evidence_conflict", eventRecordId: row.id };
      }
      const completed = parseStoredResult(row.result_projection);
      if (completed) {
        return {
          outcome: "duplicate",
          eventRecordId: row.id,
          storedEvidence: input.evidence,
          storedResult: completed
        };
      }
      if (
        row.processing_status === "processing" &&
        row.lease_expires_at &&
        Date.parse(row.lease_expires_at) > Date.parse(input.receivedAt)
      ) {
        return { outcome: "in_progress", eventRecordId: row.id };
      }
      await this.#client.query(
        `update raw_webhook_events
            set processing_status = 'processing', lease_owner = $5,
                lease_expires_at = $6::timestamptz, attempt_count = attempt_count + 1
          where tenant_id = $1 and clinic_id = $2 and external_account_id = $3 and id = $4`,
        [
          this.#account.tenantId,
          this.#account.clinicId,
          this.#account.externalAccountId,
          row.id,
          input.leaseOwner,
          input.leaseExpiresAt
        ]
      );
      return { outcome: "claimed", eventRecordId: row.id };
    }
    const normalizedDigest = sha256Text(canonicalJson(input.evidence.normalizedEvent));
    const inserted = await this.#client.query<IdRow>(
      `insert into raw_webhook_events (
         tenant_id, clinic_id, provider_key, external_account_id, event_type,
         provider_event_id, idempotency_key, verification_status, processing_status,
         raw_payload, raw_payload_digest, received_at, event_kind,
         raw_body_sha256, signature_sha256, normalized_event_sha256, normalized_event,
         evidence_state, lease_owner, lease_expires_at, attempt_count,
         verified_secret_version, verified_with_previous_secret, raw_body_length
       ) values (
         $1,$2,'razorpay',$3,$4,$5,$5,'verified','processing',null,$6,$7::timestamptz,$4,
         $6,$8,$9,$10::jsonb,'verified',$11,$12::timestamptz,1,$13,$14,$15
       ) returning id`,
      [
        this.#account.tenantId,
        this.#account.clinicId,
        this.#account.externalAccountId,
        input.eventName,
        input.providerEventId,
        input.evidence.rawBodySha256,
        input.receivedAt,
        input.evidence.signatureSha256,
        normalizedDigest,
        JSON.stringify(input.evidence.normalizedEvent),
        input.leaseOwner,
        input.leaseExpiresAt,
        input.evidence.verifiedSecretVersion,
        input.evidence.usedPreviousSecret,
        input.evidence.rawBodyLength
      ]
    );
    return { outcome: "claimed", eventRecordId: requiredId(inserted.rows[0]) };
  }

  async findInvoice(invoiceId: string | null): Promise<RazorpayInvoiceSettlementSnapshot | null> {
    if (!invoiceId) return null;
    const result = await this.#client.query<InvoiceRow>(
      `select id, patient_id, status, currency, total_minor, paid_minor,
              refunded_minor, balance_minor, created_by_user_id
         from invoices
        where tenant_id = $1 and clinic_id = $2 and id = $3
        for update`,
      [this.#account.tenantId, this.#account.clinicId, invoiceId]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      invoiceId: row.id,
      patientId: row.patient_id,
      status: row.status,
      currency: row.currency,
      totalMinor: minor(row.total_minor),
      paidMinor: minor(row.paid_minor),
      refundedMinor: minor(row.refunded_minor),
      balanceMinor: minor(row.balance_minor)
    };
  }

  async findPaymentRequest(input: {
    readonly providerRequestId: string | null;
    readonly invoiceId: string | null;
  }): Promise<RazorpayPaymentRequestBinding | null> {
    if (!input.providerRequestId && !input.invoiceId) return null;
    const result = await this.#client.query<PaymentRequestRow>(
      `select id, provider_reference_id, invoice_id, patient_id, amount_minor,
              currency, request_type, status, metadata
         from payment_requests
        where tenant_id = $1 and clinic_id = $2 and provider = 'razorpay'
          and (($3::text is not null and provider_reference_id = $3)
            or ($3::text is null and $4::uuid is not null and invoice_id = $4))
        order by created_at desc limit 1 for update`,
      [
        this.#account.tenantId,
        this.#account.clinicId,
        input.providerRequestId,
        input.invoiceId
      ]
    );
    const row = result.rows[0];
    if (!row) return null;
    const metadata = object(row.metadata);
    return {
      providerRequestId: row.provider_reference_id,
      invoiceId: row.invoice_id,
      patientId: row.patient_id,
      amountMinor: minor(row.amount_minor),
      currency: row.currency,
      requestKind: row.request_type === "dynamic_qr" ? "invoice_qr" : "payment_link",
      acceptPartial: metadata.acceptPartial === true,
      status: paymentRequestStatus(row.status)
    };
  }

  async findPaymentEffect(
    providerPaymentId: string | null
  ): Promise<RazorpayPaymentEffectSnapshot | null> {
    if (!providerPaymentId) return null;
    const result = await this.#client.query<PaymentEffectRow>(
      `select provider_payment_id, coalesce(pt.invoice_id, ri.invoice_id) as invoice_id,
              max(case when effect_kind = 'payment_capture' then rbe.amount_minor else 0 end) as amount_minor,
              max(rbe.cumulative_refunded_amount_minor) as cumulative_refunded_amount_minor,
              max(rbe.event_rank) as event_rank
         from razorpay_business_effects rbe
         left join payment_transactions pt
           on pt.tenant_id = rbe.tenant_id and pt.clinic_id = rbe.clinic_id
          and pt.id = rbe.payment_transaction_id
         left join payment_reconciliation_items ri
           on ri.tenant_id = rbe.tenant_id and ri.clinic_id = rbe.clinic_id
          and ri.id = rbe.payment_reconciliation_item_id
        where rbe.tenant_id = $1 and rbe.clinic_id = $2
          and rbe.external_account_id = $3 and rbe.provider_payment_id = $4
        group by provider_payment_id, coalesce(pt.invoice_id, ri.invoice_id)`,
      [
        this.#account.tenantId,
        this.#account.clinicId,
        this.#account.externalAccountId,
        providerPaymentId
      ]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      providerPaymentId: row.provider_payment_id,
      invoiceId: row.invoice_id,
      capturedAmountMinor: minor(row.amount_minor),
      refundedAmountMinor: minor(row.cumulative_refunded_amount_minor),
      lastRank: row.event_rank
    };
  }

  async claimBusinessEffect(businessKey: string): Promise<"claimed" | "duplicate"> {
    const digest = sha256Text(
      `${this.#account.tenantId}:${this.#account.clinicId}:${this.#account.externalAccountId}:${businessKey}`
    );
    await this.#client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [digest]);
    const existing = await this.#client.query<IdRow>(
      `select id from razorpay_business_effects
        where tenant_id = $1 and clinic_id = $2 and external_account_id = $3
          and business_key = $4`,
      [
        this.#account.tenantId,
        this.#account.clinicId,
        this.#account.externalAccountId,
        businessKey
      ]
    );
    return existing.rows[0] ? "duplicate" : "claimed";
  }

  async recordPayment(input: {
    readonly eventRecordId: string;
    readonly event: NormalizedRazorpayEvent;
    readonly decision: Extract<RazorpayEventDecision, { kind: "record_payment" }>;
  }): Promise<{ readonly effectRecordId: string }> {
    const invoice = await requiredInvoice(this.#client, this.#account, input.event.invoiceId);
    const transactionId = randomUUID();
    await this.#client.query(
      `insert into payment_transactions (
         id, tenant_id, clinic_id, invoice_id, patient_id, payment_request_id,
         provider, provider_payment_id, provider_order_id, amount_minor, currency,
         method, status, verification_status, reconciliation_status,
         idempotency_key, received_at, metadata
       ) values ($1,$2,$3,$4,$5,$6,'razorpay',$7,$8,$9,$10,$11,'succeeded','verified',$12,$13,$14::timestamptz,$15::jsonb)`,
      [
        transactionId,
        this.#account.tenantId,
        this.#account.clinicId,
        invoice.id,
        invoice.patient_id,
        await paymentRequestDatabaseId(this.#client, this.#account, input.event.providerRequestId),
        input.event.providerPaymentId,
        input.event.providerRequestId,
        input.decision.appliedAmountMinor,
        input.event.currency,
        input.event.method ?? "razorpay",
        input.decision.reconciliationReason ? "requires_review" : "matched",
        input.decision.businessKey,
        input.event.occurredAt,
        JSON.stringify({
          provider_event_id: input.event.providerEventId,
          captured_amount_minor: input.decision.capturedAmountMinor,
          unallocated_amount_minor: input.decision.unallocatedAmountMinor
        })
      ]
    );
    await updateInvoiceSettlement(this.#client, this.#account, invoice.id, {
      paidDelta: input.decision.appliedAmountMinor,
      refundedDelta: 0,
      reconciliationRequired: input.decision.reconciliationReason !== null
    });
    const effectId = await insertEffect(this.#client, this.#account, {
      eventRecordId: input.eventRecordId,
      businessKey: input.decision.businessKey,
      effectKind: "payment_capture",
      event: input.event,
      transactionId,
      requestId: null,
      reconciliationId: null,
      amountMinor: input.decision.capturedAmountMinor,
      appliedMinor: input.decision.appliedAmountMinor,
      unallocatedMinor: input.decision.unallocatedAmountMinor,
      cumulativeRefundedMinor: 0
    });
    return { effectRecordId: effectId };
  }

  async recordFailure(input: {
    readonly eventRecordId: string;
    readonly event: NormalizedRazorpayEvent;
    readonly decision: Extract<RazorpayEventDecision, { kind: "record_failure" }>;
  }): Promise<{ readonly effectRecordId: string }> {
    const invoice = await requiredInvoice(this.#client, this.#account, input.event.invoiceId);
    const transactionId = randomUUID();
    await this.#client.query(
      `insert into payment_transactions (
         id, tenant_id, clinic_id, invoice_id, patient_id, provider,
         provider_payment_id, provider_order_id, amount_minor, currency, method,
         status, verification_status, reconciliation_status, idempotency_key,
         received_at, metadata
       ) values ($1,$2,$3,$4,$5,'razorpay',$6,$7,$8,$9,$10,'failed','verified','matched',$11,$12::timestamptz,$13::jsonb)`,
      [
        transactionId,
        this.#account.tenantId,
        this.#account.clinicId,
        invoice.id,
        invoice.patient_id,
        input.event.providerPaymentId,
        input.event.providerRequestId,
        input.decision.amountMinor,
        input.event.currency,
        input.event.method ?? "razorpay",
        input.decision.businessKey,
        input.event.occurredAt,
        JSON.stringify({ provider_event_id: input.event.providerEventId })
      ]
    );
    return {
      effectRecordId: await insertEffect(this.#client, this.#account, {
        eventRecordId: input.eventRecordId,
        businessKey: input.decision.businessKey,
        effectKind: "payment_failure",
        event: input.event,
        transactionId,
        requestId: null,
        reconciliationId: null,
        amountMinor: input.decision.amountMinor,
        appliedMinor: 0,
        unallocatedMinor: input.decision.amountMinor,
        cumulativeRefundedMinor: 0
      })
    };
  }

  async recordRefund(input: {
    readonly eventRecordId: string;
    readonly event: NormalizedRazorpayEvent;
    readonly decision: Extract<RazorpayEventDecision, { kind: "record_refund" }>;
  }): Promise<{ readonly effectRecordId: string }> {
    const capture = await this.#client.query<{ id: string; invoice_id: string; patient_id: string; amount_minor: string | number }>(
      `select id, invoice_id, patient_id, amount_minor from payment_transactions
        where tenant_id = $1 and clinic_id = $2 and provider = 'razorpay'
          and provider_payment_id = $3 and status in ('succeeded','refunded')
        for update`,
      [this.#account.tenantId, this.#account.clinicId, input.event.providerPaymentId]
    );
    const original = capture.rows[0];
    if (!original) throw new Error("Verified Razorpay refund has no captured transaction.");
    const refundTransactionId = randomUUID();
    await this.#client.query(
      `insert into payment_transactions (
         id, tenant_id, clinic_id, invoice_id, patient_id, provider,
         provider_payment_id, provider_order_id, amount_minor, currency, method,
         status, verification_status, reconciliation_status, idempotency_key,
         received_at, metadata
       ) values ($1,$2,$3,$4,$5,'razorpay',null,$6,$7,$8,'refund','refunded','verified','matched',$9,$10::timestamptz,$11::jsonb)`,
      [
        refundTransactionId,
        this.#account.tenantId,
        this.#account.clinicId,
        original.invoice_id,
        original.patient_id,
        input.event.providerRefundId,
        input.decision.refundAmountMinor,
        input.event.currency,
        input.decision.businessKey,
        input.event.occurredAt,
        JSON.stringify({
          provider_event_id: input.event.providerEventId,
          provider_payment_id: input.event.providerPaymentId,
          provider_refund_id: input.event.providerRefundId
        })
      ]
    );
    if (input.decision.nextRefundedAmountMinor >= minor(original.amount_minor)) {
      await this.#client.query(
        `update payment_transactions set status = 'refunded'
          where tenant_id = $1 and clinic_id = $2 and id = $3`,
        [this.#account.tenantId, this.#account.clinicId, original.id]
      );
    }
    await updateInvoiceSettlement(this.#client, this.#account, original.invoice_id, {
      paidDelta: 0,
      refundedDelta: input.decision.refundAmountMinor,
      reconciliationRequired: false
    });
    return {
      effectRecordId: await insertEffect(this.#client, this.#account, {
        eventRecordId: input.eventRecordId,
        businessKey: input.decision.businessKey,
        effectKind: "refund",
        event: input.event,
        transactionId: refundTransactionId,
        requestId: null,
        reconciliationId: null,
        amountMinor: input.decision.refundAmountMinor,
        appliedMinor: input.decision.refundAmountMinor,
        unallocatedMinor: 0,
        cumulativeRefundedMinor: input.decision.nextRefundedAmountMinor
      })
    };
  }

  async updatePaymentRequestState(input: {
    readonly providerRequestId: string;
    readonly status: "cancelled" | "expired" | "closed" | "partially_paid" | "paid";
    readonly eventRecordId: string;
  }): Promise<{ readonly effectRecordId: string }> {
    const request = await this.#client.query<{ id: string }>(
      `update payment_requests set status = $4
        where tenant_id = $1 and clinic_id = $2 and provider = 'razorpay'
          and provider_reference_id = $3
        returning id`,
      [this.#account.tenantId, this.#account.clinicId, input.providerRequestId, input.status]
    );
    const requestId = requiredId(request.rows[0]);
    const raw = await this.#client.query<{ normalized_event: unknown }>(
      `select normalized_event from raw_webhook_events
        where tenant_id = $1 and clinic_id = $2 and external_account_id = $3 and id = $4`,
      [
        this.#account.tenantId,
        this.#account.clinicId,
        this.#account.externalAccountId,
        input.eventRecordId
      ]
    );
    const event = raw.rows[0]?.normalized_event as NormalizedRazorpayEvent | undefined;
    if (!event || event.provider !== "razorpay") {
      throw new Error("Razorpay request-state event evidence is unavailable.");
    }
    await insertEffect(this.#client, this.#account, {
      eventRecordId: input.eventRecordId,
      businessKey: razorpayBusinessKey(event),
      effectKind: "payment_request_state",
      event,
      transactionId: null,
      requestId,
      reconciliationId: null,
      amountMinor: 0,
      appliedMinor: 0,
      unallocatedMinor: 0,
      cumulativeRefundedMinor: 0
    });
    return { effectRecordId: requestId };
  }

  async createReconciliation(input: Parameters<RazorpayTransactionalPort["createReconciliation"]>[0]) {
    const invoice = input.invoiceId
      ? await requiredInvoice(this.#client, this.#account, input.invoiceId)
      : null;
    const reconciliationId = randomUUID();
    const safeApplied = Math.min(input.amountMinor, input.safeAppliedAmountMinor);
    await this.#client.query(
      `insert into payment_reconciliation_items (
         id, tenant_id, clinic_id, raw_webhook_event_id, invoice_id, patient_id,
         reason, captured_amount_minor, applied_amount_minor, unallocated_amount_minor,
         currency, status, evidence, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open',$12::jsonb,$13::timestamptz,$13::timestamptz)`,
      [
        reconciliationId,
        this.#account.tenantId,
        this.#account.clinicId,
        input.eventRecordId,
        invoice?.id ?? null,
        invoice?.patient_id ?? null,
        input.reason,
        input.amountMinor,
        safeApplied,
        input.amountMinor - safeApplied,
        input.event.currency,
        JSON.stringify({
          provider: "razorpay",
          provider_event_id: input.event.providerEventId,
          event_name: input.event.eventName,
          raw_body_sha256: input.event.rawBodySha256,
          business_key: input.businessKey
        }),
        input.event.occurredAt
      ]
    );
    await insertEffect(this.#client, this.#account, {
      eventRecordId: input.eventRecordId,
      businessKey: input.businessKey,
      effectKind: input.reason === "dispute_requires_review" ? "dispute_review" : "reconciliation",
      event: input.event,
      transactionId: null,
      requestId: null,
      reconciliationId,
      amountMinor: input.amountMinor,
      appliedMinor: safeApplied,
      unallocatedMinor: input.amountMinor - safeApplied,
      cumulativeRefundedMinor: 0
    });
    return { reconciliationId };
  }

  async appendAudit(input: RazorpayAuditRecord): Promise<void> {
    await this.#client.query(
      `insert into audit_events (
         tenant_id, clinic_id, actor_type, actor_id, action, category, risk_level,
         phi_involved, resource_type, resource_id, correlation_id, metadata, occurred_at
       ) values ($1,$2,'integration',$3,$4,'financial','high',true,$5,$6,$7,$8::jsonb,$9::timestamptz)`,
      [
        input.tenantId,
        input.clinicId,
        this.#account.externalAccountId,
        input.action,
        input.resourceType,
        input.resourceId,
        input.correlationId,
        JSON.stringify(input.metadata),
        input.occurredAt
      ]
    );
  }

  async appendOutbox(input: RazorpayOutboxRecord): Promise<void> {
    await this.#client.query(
      `insert into outbox_events (
         tenant_id, clinic_id, event_type, actor_type, actor_id, aggregate_type,
         aggregate_id, idempotency_key, correlation_id, payload, occurred_at
       ) values ($1,$2,$3,'integration',$4,$5,$6,$7,$8,$9::jsonb,$10::timestamptz)
       on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing`,
      [
        this.#account.tenantId,
        this.#account.clinicId,
        input.eventType,
        this.#account.externalAccountId,
        input.aggregateType,
        input.aggregateId,
        input.idempotencyKey,
        input.correlationId,
        JSON.stringify(input.payload),
        input.occurredAt
      ]
    );
  }

  async completeProviderEvent(input: {
    readonly eventRecordId: string;
    readonly processingStatus: "applied" | "ignored" | "reconciliation_required";
    readonly processedAt: string;
    readonly result: RazorpayWebhookProcessingResult;
  }): Promise<void> {
    const resultJson = canonicalJson(input.result);
    await this.#client.query(
      `update raw_webhook_events
          set processing_status = $5, evidence_state = $6, processed_at = $7::timestamptz,
              lease_owner = null, lease_expires_at = null,
              result_digest = $8, result_projection = $9::jsonb
        where tenant_id = $1 and clinic_id = $2 and external_account_id = $3 and id = $4`,
      [
        this.#account.tenantId,
        this.#account.clinicId,
        this.#account.externalAccountId,
        input.eventRecordId,
        input.processingStatus,
        input.processingStatus === "applied" ? "applied" : "reconciliation_required",
        input.processedAt,
        sha256Text(resultJson),
        resultJson
      ]
    );
  }
}

async function insertEffect(
  client: SqlQueryClient,
  account: RazorpayAccountScope,
  input: {
    readonly eventRecordId: string;
    readonly businessKey: string;
    readonly effectKind:
      | "payment_capture"
      | "payment_failure"
      | "refund"
      | "dispute_review"
      | "payment_request_state"
      | "reconciliation";
    readonly event: NormalizedRazorpayEvent;
    readonly transactionId: string | null;
    readonly requestId: string | null;
    readonly reconciliationId: string | null;
    readonly amountMinor: number;
    readonly appliedMinor: number;
    readonly unallocatedMinor: number;
    readonly cumulativeRefundedMinor: number;
  }
): Promise<string> {
  const id = randomUUID();
  const resultDigest = sha256Text(
    canonicalJson({
      effectKind: input.effectKind,
      amountMinor: input.amountMinor,
      appliedMinor: input.appliedMinor,
      unallocatedMinor: input.unallocatedMinor,
      cumulativeRefundedMinor: input.cumulativeRefundedMinor
    })
  );
  await client.query(
    `insert into razorpay_business_effects (
       id, tenant_id, clinic_id, external_account_id, raw_webhook_event_id,
       business_key, effect_kind, provider_payment_id, provider_refund_id,
       provider_dispute_id, payment_transaction_id, payment_request_id,
       payment_reconciliation_item_id, amount_minor, safe_applied_amount_minor,
       unallocated_amount_minor, cumulative_refunded_amount_minor, event_rank,
       result_digest, occurred_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::timestamptz)`,
    [
      id,
      account.tenantId,
      account.clinicId,
      account.externalAccountId,
      input.eventRecordId,
      input.businessKey,
      input.effectKind,
      input.event.providerPaymentId,
      input.event.providerRefundId,
      input.event.providerDisputeId,
      input.transactionId,
      input.requestId,
      input.reconciliationId,
      input.amountMinor,
      input.appliedMinor,
      input.unallocatedMinor,
      input.cumulativeRefundedMinor,
      razorpayEventRank(input.event.eventName),
      resultDigest,
      input.event.occurredAt
    ]
  );
  return id;
}

async function requiredInvoice(
  client: SqlQueryClient,
  account: RazorpayAccountScope,
  invoiceId: string | null
): Promise<InvoiceRow> {
  if (!invoiceId) throw new Error("Verified Razorpay effect has no invoice.");
  const result = await client.query<InvoiceRow>(
    `select id, patient_id, status, currency, total_minor, paid_minor,
            refunded_minor, balance_minor, created_by_user_id
       from invoices where tenant_id = $1 and clinic_id = $2 and id = $3 for update`,
    [account.tenantId, account.clinicId, invoiceId]
  );
  const row = result.rows[0];
  if (!row) throw new Error("Verified Razorpay effect invoice is unavailable.");
  return row;
}

async function paymentRequestDatabaseId(
  client: SqlQueryClient,
  account: RazorpayAccountScope,
  providerRequestId: string | null
): Promise<string | null> {
  if (!providerRequestId) return null;
  const result = await client.query<IdRow>(
    `select id from payment_requests
      where tenant_id = $1 and clinic_id = $2 and provider = 'razorpay'
        and provider_reference_id = $3`,
    [account.tenantId, account.clinicId, providerRequestId]
  );
  return result.rows[0]?.id ?? null;
}

async function updateInvoiceSettlement(
  client: SqlQueryClient,
  account: RazorpayAccountScope,
  invoiceId: string,
  input: {
    readonly paidDelta: number;
    readonly refundedDelta: number;
    readonly reconciliationRequired: boolean;
  }
): Promise<void> {
  await client.query(
    `update invoices
        set paid_minor = paid_minor + $4,
            refunded_minor = refunded_minor + $5,
            balance_minor = greatest(total_minor - (paid_minor + $4) + (refunded_minor + $5), 0),
            payment_status = case
              when $6 then 'reconciliation_required'
              when refunded_minor + $5 >= paid_minor + $4 and refunded_minor + $5 > 0 then 'refunded'
              when paid_minor + $4 > total_minor then 'overpaid'
              when paid_minor + $4 >= total_minor then 'paid'
              when paid_minor + $4 > 0 then 'partially_paid'
              else payment_status
            end
      where tenant_id = $1 and clinic_id = $2 and id = $3`,
    [
      account.tenantId,
      account.clinicId,
      invoiceId,
      input.paidDelta,
      input.refundedDelta,
      input.reconciliationRequired
    ]
  );
}

function razorpayEvidenceMatches(row: RawEventRow, evidence: RazorpayVerifiedEventEvidence): boolean {
  return (
    row.raw_body_sha256 === evidence.rawBodySha256 &&
    row.signature_sha256 === evidence.signatureSha256 &&
    row.normalized_event_sha256 === sha256Text(canonicalJson(evidence.normalizedEvent)) &&
    row.verified_secret_version === evidence.verifiedSecretVersion &&
    row.verified_with_previous_secret === evidence.usedPreviousSecret &&
    row.raw_body_length === evidence.rawBodyLength &&
    canonicalJson(row.normalized_event) === canonicalJson(evidence.normalizedEvent)
  );
}

function parseStoredResult(value: unknown): RazorpayWebhookProcessingResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    !["applied", "duplicate", "ignored", "reconciliation_required"].includes(
      String(candidate.status)
    ) ||
    typeof candidate.providerEventId !== "string" ||
    typeof candidate.eventRecordId !== "string"
  ) {
    return null;
  }
  return candidate as unknown as RazorpayWebhookProcessingResult;
}

function paymentRequestStatus(value: string): RazorpayPaymentRequestBinding["status"] {
  if (
    ["partially_paid", "paid", "cancelled", "expired", "closed"].includes(value)
  ) {
    return value as RazorpayPaymentRequestBinding["status"];
  }
  return "created";
}

function minor(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Financial minor amount is invalid.");
  return parsed;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function setScope(client: SqlQueryClient, tenantId: UUID, clinicId: UUID): Promise<void> {
  for (const statement of buildSetLocalRlsStatements({ tenantId, clinicId, userId: null })) {
    await client.query(statement.sql, statement.values);
  }
}

function requiredId(row: IdRow | undefined): string {
  if (!row || !/^[0-9a-f-]{36}$/iu.test(row.id)) throw new Error("Database did not return a UUID.");
  return row.id;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}
