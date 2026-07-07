import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import type { AdapterCapability, ProviderHealth } from "./provider-contracts.js";

export type PaymentProviderKey = "simulator" | "razorpay" | "manual_clinic_approved" | "unconfigured";
export type PaymentProviderRequestKind = "invoice_qr" | "payment_link";
export type PaymentProviderWebhookVerificationStatus =
  | "verified"
  | "missing_signature"
  | "invalid_signature"
  | "not_configured";
export type PaymentProviderEventKind =
  | "payment_succeeded"
  | "payment_failed"
  | "payment_authorized"
  | "payment_ignored";

export interface PaymentProviderCustomer {
  readonly name?: string | null;
  readonly email?: string | null;
  readonly contact?: string | null;
}

export interface CreatePaymentProviderRequestInput {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly invoiceId: string;
  readonly patientId: string;
  readonly amountPaise: number;
  readonly currency: string;
  readonly description?: string | null;
  readonly expiresAt?: string | null;
  readonly idempotencyKey?: string | null;
  readonly customer?: PaymentProviderCustomer | null;
  readonly metadata?: Record<string, unknown>;
}

export interface PaymentProviderRequestResult {
  readonly providerKey: PaymentProviderKey | string;
  readonly requestKind: PaymentProviderRequestKind;
  readonly providerRequestId: string;
  readonly amountPaise: number;
  readonly currency: string;
  readonly status: "created" | "failed";
  readonly paymentUrl?: string | null;
  readonly qrImageUrl?: string | null;
  readonly qrString?: string | null;
  readonly expiresAt?: string | null;
  readonly metadata: Record<string, unknown>;
  readonly providerHealth: ProviderHealth;
}

export interface FetchPaymentInput {
  readonly providerPaymentId: string;
}

export interface ProviderPaymentSnapshot {
  readonly providerKey: PaymentProviderKey | string;
  readonly providerPaymentId: string;
  readonly amountPaise: number;
  readonly currency: string;
  readonly status: string;
  readonly method?: string | null;
  readonly captured: boolean;
  readonly metadata: Record<string, unknown>;
}

export interface RawPaymentWebhook {
  readonly providerKey: PaymentProviderKey | string;
  readonly headers: Record<string, string | undefined>;
  readonly rawBody: string;
  readonly receivedAt: string;
}

export interface PaymentWebhookVerificationResult {
  readonly status: PaymentProviderWebhookVerificationStatus;
  readonly providerKey: PaymentProviderKey | string;
  readonly providerEventId?: string | null;
  readonly signatureHeader?: string | null;
  readonly message: string;
}

export interface PaymentProviderWebhookEvent {
  readonly providerKey: PaymentProviderKey | string;
  readonly providerEventId: string;
  readonly idempotencyKey: string;
  readonly eventName: string;
  readonly eventKind: PaymentProviderEventKind;
  readonly occurredAt: string;
  readonly tenantId?: string | null;
  readonly clinicId?: string | null;
  readonly patientId?: string | null;
  readonly invoiceId?: string | null;
  readonly providerPaymentId?: string | null;
  readonly providerPaymentRequestId?: string | null;
  readonly amountPaise?: number | null;
  readonly currency?: string | null;
  readonly method?: string | null;
  readonly rawBodySha256: string;
  readonly payload: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly providerKey: PaymentProviderKey | string;
  capabilities(): readonly AdapterCapability[];
  healthCheck(): Promise<ProviderHealth>;
  createInvoiceQr(input: CreatePaymentProviderRequestInput): Promise<PaymentProviderRequestResult>;
  closeQr(input: { providerRequestId: string }): Promise<{ providerRequestId: string; status: string }>;
  createPaymentLink(input: CreatePaymentProviderRequestInput): Promise<PaymentProviderRequestResult>;
  cancelPaymentLink(input: { providerRequestId: string }): Promise<{ providerRequestId: string; status: string }>;
  fetchPayment(input: FetchPaymentInput): Promise<ProviderPaymentSnapshot>;
  verifyWebhook(raw: RawPaymentWebhook): Promise<PaymentWebhookVerificationResult>;
  parseWebhook(raw: RawPaymentWebhook): Promise<PaymentProviderWebhookEvent>;
}

export interface RazorpayPaymentProviderOptions {
  readonly keyId?: string | null;
  readonly keySecret?: string | null;
  readonly webhookSecret?: string | null;
  readonly webhookUrl?: string | null;
  readonly qrMode?: "payment_link_qr" | "razorpay_qr";
  readonly baseUrl?: string;
  readonly fetch?: PaymentProviderFetch;
  readonly now?: () => Date;
}

export interface SimulatorPaymentProviderOptions {
  readonly webhookSecret?: string;
  readonly now?: () => Date;
}

export interface UnavailablePaymentProviderOptions {
  readonly providerKey: PaymentProviderKey;
  readonly message: string;
}

export type PaymentProviderFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }
) => Promise<PaymentProviderHttpResponse>;

export interface PaymentProviderHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export class PaymentProviderError extends Error {
  readonly providerKey: string;
  readonly status: "not_configured" | "unavailable" | "provider_error" | "verification_failed";
  readonly details: Record<string, unknown>;

  constructor(input: {
    providerKey: string;
    status: PaymentProviderError["status"];
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "PaymentProviderError";
    this.providerKey = input.providerKey;
    this.status = input.status;
    this.details = input.details ?? {};
  }
}

const RAZORPAY_CAPABILITIES: AdapterCapability[] = [
  "CREATE_PAYMENT_QR",
  "CREATE_PAYMENT_LINKS",
  "FETCH_PAYMENT_STATUS",
  "VERIFY_WEBHOOKS"
] as const;
const WEBHOOK_CAPABILITY: AdapterCapability = "RECEIVE_WEBHOOKS";
const SIMULATOR_SECRET = "clinic-os-local-payment-simulator-webhook-secret";

export class RazorpayPaymentProvider implements PaymentProvider {
  readonly providerKey = "razorpay";
  readonly #keyId?: string | null;
  readonly #keySecret?: string | null;
  readonly #webhookSecret?: string | null;
  readonly #webhookUrl?: string | null;
  readonly #qrMode: "payment_link_qr" | "razorpay_qr";
  readonly #baseUrl: string;
  readonly #fetch: PaymentProviderFetch;
  readonly #now: () => Date;

  constructor(options: RazorpayPaymentProviderOptions) {
    this.#keyId = options.keyId;
    this.#keySecret = options.keySecret;
    this.#webhookSecret = options.webhookSecret;
    this.#webhookUrl = options.webhookUrl;
    this.#qrMode = options.qrMode ?? "payment_link_qr";
    this.#baseUrl = options.baseUrl ?? "https://api.razorpay.com/v1";
    this.#fetch = options.fetch ?? defaultPaymentFetch;
    this.#now = options.now ?? (() => new Date());
  }

  capabilities(): readonly AdapterCapability[] {
    if (!this.hasApiCredentials()) return [];

    const capabilities = [...RAZORPAY_CAPABILITIES];
    if (this.#webhookSecret && this.#webhookUrl) capabilities.push(WEBHOOK_CAPABILITY);
    return capabilities;
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.hasApiCredentials()) {
      return {
        providerKey: this.providerKey,
        status: "not_configured",
        checkedAt: this.#now().toISOString(),
        capabilities: [],
        message: "Razorpay API key id and key secret are required before payment requests can be created."
      };
    }

    if (!this.#webhookSecret) {
      return {
        providerKey: this.providerKey,
        status: "unavailable",
        checkedAt: this.#now().toISOString(),
        capabilities: this.capabilities(),
        message: "RAZORPAY_WEBHOOK_SECRET is required before provider-paid state can be trusted."
      };
    }

    if (!this.#webhookUrl) {
      return {
        providerKey: this.providerKey,
        status: "degraded",
        checkedAt: this.#now().toISOString(),
        capabilities: this.capabilities(),
        message:
          "RAZORPAY_WEBHOOK_URL is not configured; live dashboard webhook registration is deferred."
      };
    }

    return {
      providerKey: this.providerKey,
      status: "available",
      checkedAt: this.#now().toISOString(),
      capabilities: this.capabilities()
    };
  }

  async createInvoiceQr(
    input: CreatePaymentProviderRequestInput
  ): Promise<PaymentProviderRequestResult> {
    const health = await this.healthCheck();
    this.assertCanCreate(health);

    if (this.#qrMode === "payment_link_qr") {
      const link = await this.createPaymentLink(input);
      return {
        ...link,
        requestKind: "invoice_qr",
        qrString: link.paymentUrl ?? null,
        metadata: { ...link.metadata, qrMode: this.#qrMode }
      };
    }

    const response = await this.postJson("/payments/qr_codes", {
      type: "upi_qr",
      name: `ClinicOS invoice ${input.invoiceId}`,
      usage: "single_use",
      fixed_amount: true,
      payment_amount: input.amountPaise,
      description: input.description ?? `Invoice ${input.invoiceId}`,
      close_by: input.expiresAt ? Math.floor(new Date(input.expiresAt).getTime() / 1000) : undefined,
      notes: providerNotes(input)
    });
    const entity = objectRecord(response, "razorpay QR response");
    const providerRequestId = stringValue(entity.id, "id");

    return {
      providerKey: this.providerKey,
      requestKind: "invoice_qr",
      providerRequestId,
      amountPaise: input.amountPaise,
      currency: input.currency,
      status: "created",
      qrImageUrl: nullableString(entity.image_url),
      qrString: nullableString(entity.qr_string),
      paymentUrl: nullableString(entity.image_url),
      expiresAt: input.expiresAt ?? null,
      metadata: {
        mode: "razorpay_qr",
        providerStatus: nullableString(entity.status),
        rawProviderResponse: entity
      },
      providerHealth: health
    };
  }

  async closeQr(input: { providerRequestId: string }): Promise<{ providerRequestId: string; status: string }> {
    this.assertApiCredentials();
    const response = await this.postJson(`/payments/qr_codes/${encodeURIComponent(input.providerRequestId)}/close`, {});
    const entity = objectRecord(response, "razorpay close QR response");
    return {
      providerRequestId: input.providerRequestId,
      status: nullableString(entity.status) ?? "closed"
    };
  }

  async createPaymentLink(
    input: CreatePaymentProviderRequestInput
  ): Promise<PaymentProviderRequestResult> {
    const health = await this.healthCheck();
    this.assertCanCreate(health);
    const response = await this.postJson("/payment_links", {
      amount: input.amountPaise,
      currency: input.currency,
      accept_partial: true,
      first_min_partial_amount: Math.min(input.amountPaise, Math.max(100, Math.ceil(input.amountPaise / 2))),
      description: input.description ?? `ClinicOS invoice ${input.invoiceId}`,
      reference_id: input.invoiceId,
      expire_by: input.expiresAt ? Math.floor(new Date(input.expiresAt).getTime() / 1000) : undefined,
      customer: compactRecord({
        name: input.customer?.name ?? undefined,
        email: input.customer?.email ?? undefined,
        contact: input.customer?.contact ?? undefined
      }),
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: providerNotes(input)
    });
    const entity = objectRecord(response, "razorpay payment link response");
    const providerRequestId = stringValue(entity.id, "id");

    return {
      providerKey: this.providerKey,
      requestKind: "payment_link",
      providerRequestId,
      amountPaise: input.amountPaise,
      currency: input.currency,
      status: "created",
      paymentUrl: nullableString(entity.short_url),
      qrString: nullableString(entity.short_url),
      qrImageUrl: null,
      expiresAt: input.expiresAt ?? null,
      metadata: {
        providerStatus: nullableString(entity.status),
        rawProviderResponse: entity,
        webhookRegistration: this.#webhookUrl ? "configured" : "not_configured"
      },
      providerHealth: health
    };
  }

  async cancelPaymentLink(
    input: { providerRequestId: string }
  ): Promise<{ providerRequestId: string; status: string }> {
    this.assertApiCredentials();
    const response = await this.postJson(`/payment_links/${encodeURIComponent(input.providerRequestId)}/cancel`, {});
    const entity = objectRecord(response, "razorpay cancel payment link response");
    return {
      providerRequestId: input.providerRequestId,
      status: nullableString(entity.status) ?? "cancelled"
    };
  }

  async fetchPayment(input: FetchPaymentInput): Promise<ProviderPaymentSnapshot> {
    this.assertApiCredentials();
    const response = await this.getJson(`/payments/${encodeURIComponent(input.providerPaymentId)}`);
    const entity = objectRecord(response, "razorpay payment response");

    return {
      providerKey: this.providerKey,
      providerPaymentId: stringValue(entity.id, "id"),
      amountPaise: numberValue(entity.amount, "amount"),
      currency: stringValue(entity.currency, "currency"),
      status: stringValue(entity.status, "status"),
      method: nullableString(entity.method),
      captured: Boolean(entity.captured),
      metadata: entity
    };
  }

  async verifyWebhook(raw: RawPaymentWebhook): Promise<PaymentWebhookVerificationResult> {
    const providerEventId = header(raw.headers, "x-razorpay-event-id");
    const signature = header(raw.headers, "x-razorpay-signature");

    if (!this.#webhookSecret) {
      return {
        status: "not_configured",
        providerKey: this.providerKey,
        providerEventId,
        signatureHeader: signature,
        message: "Razorpay webhook secret is not configured."
      };
    }
    if (!signature) {
      return {
        status: "missing_signature",
        providerKey: this.providerKey,
        providerEventId,
        signatureHeader: null,
        message: "Razorpay webhook signature is missing."
      };
    }

    const expected = hmacSha256Hex(this.#webhookSecret, raw.rawBody);
    const valid = timingSafeHexEqual(expected, signature);

    return {
      status: valid ? "verified" : "invalid_signature",
      providerKey: this.providerKey,
      providerEventId,
      signatureHeader: signature,
      message: valid ? "Razorpay webhook signature verified." : "Razorpay webhook signature mismatch."
    };
  }

  async parseWebhook(raw: RawPaymentWebhook): Promise<PaymentProviderWebhookEvent> {
    const payload = parseJsonObject(raw.rawBody, "Razorpay webhook payload");
    const eventName = stringValue(payload.event, "event");
    const providerEventId =
      header(raw.headers, "x-razorpay-event-id") ??
      nullableString(payload.id) ??
      `${eventName}:${sha256Hex(raw.rawBody)}`;
    const payment = extractRazorpayPaymentEntity(payload);
    const paymentLink = extractNestedEntity(payload, "payment_link");
    const qrCode = extractNestedEntity(payload, "qr_code");
    const notes = objectRecord(
      payment.notes ?? paymentLink?.notes ?? qrCode?.notes ?? {},
      "razorpay notes"
    );
    const providerPaymentId = nullableString(payment.id);
    const providerPaymentRequestId =
      nullableString(paymentLink?.id) ??
      nullableString(qrCode?.id) ??
      nullableString(paymentLink?.reference_id) ??
      null;
    const amountPaise = numberMaybe(payment.amount) ?? numberMaybe(paymentLink?.amount_paid);
    const currency = nullableString(payment.currency) ?? nullableString(paymentLink?.currency);

    return {
      providerKey: this.providerKey,
      providerEventId,
      idempotencyKey: `razorpay:webhook:${providerEventId}`,
      eventName,
      eventKind: eventKindFromRazorpayEvent(eventName, payment),
      occurredAt: epochSecondsToIso(numberMaybe(payload.created_at), raw.receivedAt),
      tenantId: nullableString(notes.clinic_os_tenant_id),
      clinicId: nullableString(notes.clinic_os_clinic_id),
      patientId: nullableString(notes.clinic_os_patient_id),
      invoiceId: nullableString(notes.clinic_os_invoice_id) ?? nullableString(paymentLink?.reference_id),
      providerPaymentId,
      providerPaymentRequestId,
      amountPaise: amountPaise ?? null,
      currency,
      method: nullableString(payment.method),
      rawBodySha256: sha256Hex(raw.rawBody),
      payload
    };
  }

  assertApiCredentials(): void {
    if (!this.hasApiCredentials()) {
      throw new PaymentProviderError({
        providerKey: this.providerKey,
        status: "not_configured",
        message: "Razorpay API credentials are not configured."
      });
    }
  }

  assertCanCreate(health: ProviderHealth): void {
    this.assertApiCredentials();
    if (!this.#webhookSecret) {
      throw new PaymentProviderError({
        providerKey: this.providerKey,
        status: "not_configured",
        message: "Razorpay webhook secret is required before creating payment requests."
      });
    }
    if (!["available", "degraded"].includes(health.status)) {
      throw new PaymentProviderError({
        providerKey: this.providerKey,
        status: "unavailable",
        message: health.message ?? "Razorpay is unavailable.",
        details: { providerHealth: health }
      });
    }
  }

  hasApiCredentials(): boolean {
    return Boolean(this.#keyId && this.#keySecret);
  }

  async postJson(path: string, body: Record<string, unknown>): Promise<unknown> {
    return this.fetchJson(path, {
      method: "POST",
      body: JSON.stringify(stripUndefined(body))
    });
  }

  async getJson(path: string): Promise<unknown> {
    return this.fetchJson(path, { method: "GET" });
  }

  async fetchJson(path: string, init: { method: string; body?: string }): Promise<unknown> {
    this.assertApiCredentials();
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Basic ${Buffer.from(`${this.#keyId}:${this.#keySecret}`).toString("base64")}`,
        "content-type": "application/json"
      },
      ...(init.body ? { body: init.body } : {})
    });

    if (!response.ok) {
      const text = await response.text();
      throw new PaymentProviderError({
        providerKey: this.providerKey,
        status: "provider_error",
        message: `Razorpay API request failed with HTTP ${response.status}.`,
        details: { status: response.status, responseText: text.slice(0, 500) }
      });
    }

    return response.json();
  }
}

export class SimulatorPaymentProvider implements PaymentProvider {
  readonly providerKey = "simulator";
  readonly #webhookSecret: string;
  readonly #now: () => Date;

  constructor(options: SimulatorPaymentProviderOptions = {}) {
    this.#webhookSecret = options.webhookSecret ?? SIMULATOR_SECRET;
    this.#now = options.now ?? (() => new Date());
  }

  capabilities(): readonly AdapterCapability[] {
    return [
      "CREATE_PAYMENT_QR",
      "CREATE_PAYMENT_LINKS",
      "FETCH_PAYMENT_STATUS",
      "VERIFY_WEBHOOKS",
      WEBHOOK_CAPABILITY
    ];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerKey: this.providerKey,
      status: "available",
      checkedAt: this.#now().toISOString(),
      capabilities: this.capabilities(),
      message: "Local simulator is available for contract tests and local development."
    };
  }

  async createInvoiceQr(
    input: CreatePaymentProviderRequestInput
  ): Promise<PaymentProviderRequestResult> {
    return this.createRequest("invoice_qr", input);
  }

  async closeQr(input: { providerRequestId: string }): Promise<{ providerRequestId: string; status: string }> {
    return { providerRequestId: input.providerRequestId, status: "closed" };
  }

  async createPaymentLink(
    input: CreatePaymentProviderRequestInput
  ): Promise<PaymentProviderRequestResult> {
    return this.createRequest("payment_link", input);
  }

  async cancelPaymentLink(
    input: { providerRequestId: string }
  ): Promise<{ providerRequestId: string; status: string }> {
    return { providerRequestId: input.providerRequestId, status: "cancelled" };
  }

  async fetchPayment(input: FetchPaymentInput): Promise<ProviderPaymentSnapshot> {
    return {
      providerKey: this.providerKey,
      providerPaymentId: input.providerPaymentId,
      amountPaise: 0,
      currency: "INR",
      status: "unknown_in_simulator_until_signed_webhook",
      captured: false,
      metadata: {}
    };
  }

  async verifyWebhook(raw: RawPaymentWebhook): Promise<PaymentWebhookVerificationResult> {
    const providerEventId = header(raw.headers, "x-clinic-os-simulator-event-id");
    const signature = header(raw.headers, "x-clinic-os-simulator-signature");

    if (!signature) {
      return {
        status: "missing_signature",
        providerKey: this.providerKey,
        providerEventId,
        signatureHeader: null,
        message: "Simulator webhook signature is missing."
      };
    }

    const expected = hmacSha256Hex(this.#webhookSecret, raw.rawBody);
    return {
      status: timingSafeHexEqual(expected, signature) ? "verified" : "invalid_signature",
      providerKey: this.providerKey,
      providerEventId,
      signatureHeader: signature,
      message: "Simulator webhook signature checked."
    };
  }

  async parseWebhook(raw: RawPaymentWebhook): Promise<PaymentProviderWebhookEvent> {
    const payload = parseJsonObject(raw.rawBody, "simulator payment webhook payload");
    const eventName = stringValue(payload.event, "event");
    const event = objectRecord(payload.payment, "payment");
    const providerEventId =
      header(raw.headers, "x-clinic-os-simulator-event-id") ??
      nullableString(payload.id) ??
      `${eventName}:${sha256Hex(raw.rawBody)}`;

    return {
      providerKey: this.providerKey,
      providerEventId,
      idempotencyKey: `simulator:webhook:${providerEventId}`,
      eventName,
      eventKind: eventName === "payment.failed" ? "payment_failed" : "payment_succeeded",
      occurredAt: nullableString(payload.occurred_at) ?? raw.receivedAt,
      tenantId: nullableString(event.tenantId),
      clinicId: nullableString(event.clinicId),
      patientId: nullableString(event.patientId),
      invoiceId: nullableString(event.invoiceId),
      providerPaymentId: nullableString(event.providerPaymentId),
      providerPaymentRequestId: nullableString(event.providerPaymentRequestId),
      amountPaise: numberMaybe(event.amountPaise) ?? null,
      currency: nullableString(event.currency),
      method: nullableString(event.method),
      rawBodySha256: sha256Hex(raw.rawBody),
      payload
    };
  }

  buildSignedWebhook(input: {
    tenantId: string;
    clinicId: string;
    patientId: string;
    invoiceId: string;
    amountPaise: number;
    currency?: string;
    method?: string;
    providerPaymentRequestId?: string | null;
    providerPaymentId?: string | null;
    eventName?: "payment.captured" | "payment.failed";
    providerEventId?: string;
  }): RawPaymentWebhook {
    const providerEventId = input.providerEventId ?? `evt_sim_${randomUUID()}`;
    const rawBody = JSON.stringify({
      id: providerEventId,
      event: input.eventName ?? "payment.captured",
      occurred_at: this.#now().toISOString(),
      payment: {
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        patientId: input.patientId,
        invoiceId: input.invoiceId,
        providerPaymentId: input.providerPaymentId ?? `pay_sim_${randomUUID()}`,
        providerPaymentRequestId: input.providerPaymentRequestId ?? null,
        amountPaise: input.amountPaise,
        currency: input.currency ?? "INR",
        method: input.method ?? "upi"
      }
    });

    return {
      providerKey: this.providerKey,
      receivedAt: this.#now().toISOString(),
      rawBody,
      headers: {
        "x-clinic-os-simulator-event-id": providerEventId,
        "x-clinic-os-simulator-signature": hmacSha256Hex(this.#webhookSecret, rawBody)
      }
    };
  }

  async createRequest(
    requestKind: PaymentProviderRequestKind,
    input: CreatePaymentProviderRequestInput
  ): Promise<PaymentProviderRequestResult> {
    const providerRequestId = `sim_${requestKind}_${randomUUID()}`;
    const url = `https://simulator.payments.clinic-os.local/${requestKind}/${providerRequestId}`;

    return {
      providerKey: this.providerKey,
      requestKind,
      providerRequestId,
      amountPaise: input.amountPaise,
      currency: input.currency,
      status: "created",
      paymentUrl: url,
      qrString: requestKind === "invoice_qr" ? url : null,
      qrImageUrl: null,
      expiresAt: input.expiresAt ?? null,
      metadata: {
        simulator: true,
        invoiceId: input.invoiceId,
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        patientId: input.patientId
      },
      providerHealth: await this.healthCheck()
    };
  }
}

export class UnavailablePaymentProvider implements PaymentProvider {
  readonly providerKey: PaymentProviderKey;
  readonly #message: string;

  constructor(options: UnavailablePaymentProviderOptions) {
    this.providerKey = options.providerKey;
    this.#message = options.message;
  }

  capabilities(): readonly AdapterCapability[] {
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerKey: this.providerKey,
      status: "not_configured",
      checkedAt: new Date().toISOString(),
      capabilities: [],
      message: this.#message
    };
  }

  async createInvoiceQr(): Promise<PaymentProviderRequestResult> {
    throw this.error();
  }

  async closeQr(): Promise<{ providerRequestId: string; status: string }> {
    throw this.error();
  }

  async createPaymentLink(): Promise<PaymentProviderRequestResult> {
    throw this.error();
  }

  async cancelPaymentLink(): Promise<{ providerRequestId: string; status: string }> {
    throw this.error();
  }

  async fetchPayment(): Promise<ProviderPaymentSnapshot> {
    throw this.error();
  }

  async verifyWebhook(): Promise<PaymentWebhookVerificationResult> {
    return {
      status: "not_configured",
      providerKey: this.providerKey,
      message: this.#message
    };
  }

  async parseWebhook(): Promise<PaymentProviderWebhookEvent> {
    throw this.error();
  }

  error(): PaymentProviderError {
    return new PaymentProviderError({
      providerKey: this.providerKey,
      status: "not_configured",
      message: this.#message
    });
  }
}

export function createPaymentProvider(input: {
  provider: PaymentProviderKey;
  qrMode?: "payment_link_qr" | "razorpay_qr";
  razorpayKeyId?: string;
  razorpayKeySecret?: string;
  razorpayWebhookSecret?: string;
  razorpayWebhookUrl?: string;
  fetch?: PaymentProviderFetch;
}): PaymentProvider {
  if (input.provider === "simulator") return new SimulatorPaymentProvider();
  if (input.provider === "razorpay") {
    return new RazorpayPaymentProvider({
      keyId: input.razorpayKeyId,
      keySecret: input.razorpayKeySecret,
      webhookSecret: input.razorpayWebhookSecret,
      webhookUrl: input.razorpayWebhookUrl,
      qrMode: input.qrMode,
      fetch: input.fetch
    });
  }
  return new UnavailablePaymentProvider({
    providerKey: input.provider,
    message:
      input.provider === "manual_clinic_approved"
        ? "Payment provider requests are disabled; use audited manual payment recording."
        : "Payment provider is not configured."
  });
}

export function signRazorpayWebhook(rawBody: string, webhookSecret: string): string {
  return hmacSha256Hex(webhookSecret, rawBody);
}

async function defaultPaymentFetch(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }
): Promise<PaymentProviderHttpResponse> {
  return fetch(url, init);
}

function providerNotes(input: CreatePaymentProviderRequestInput): Record<string, string> {
  return {
    clinic_os_tenant_id: input.tenantId,
    clinic_os_clinic_id: input.clinicId,
    clinic_os_patient_id: input.patientId,
    clinic_os_invoice_id: input.invoiceId,
    clinic_os_idempotency_key: input.idempotencyKey ?? ""
  };
}

function eventKindFromRazorpayEvent(
  eventName: string,
  payment: Record<string, unknown>
): PaymentProviderEventKind {
  if (eventName === "payment.failed") return "payment_failed";
  if (eventName === "payment.authorized") return "payment_authorized";
  if (
    eventName === "payment.captured" ||
    eventName === "qr_code.credited" ||
    eventName === "payment_link.paid" ||
    payment.status === "captured"
  ) {
    return "payment_succeeded";
  }
  return "payment_ignored";
}

function extractRazorpayPaymentEntity(payload: Record<string, unknown>): Record<string, unknown> {
  return extractNestedEntity(payload, "payment") ?? {};
}

function extractNestedEntity(
  payload: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const payloadRecord = objectMaybe(payload.payload);
  const wrapper = objectMaybe(payloadRecord?.[key]);
  return objectMaybe(wrapper?.entity);
}

function parseJsonObject(rawBody: string, label: string): Record<string, unknown> {
  try {
    return objectRecord(JSON.parse(rawBody), label);
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError({
      providerKey: "payment",
      status: "verification_failed",
      message: `${label} must be valid JSON.`
    });
  }
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PaymentProviderError({
      providerKey: "payment",
      status: "verification_failed",
      message: `${label} must be a JSON object.`
    });
  }
  return value as Record<string, unknown>;
}

function objectMaybe(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PaymentProviderError({
      providerKey: "payment",
      status: "verification_failed",
      message: `${field} must be a non-empty string.`
    });
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  return value;
}

function numberValue(value: unknown, field: string): number {
  const parsed = numberMaybe(value);
  if (parsed === null) {
    throw new PaymentProviderError({
      providerKey: "payment",
      status: "verification_failed",
      message: `${field} must be a number.`
    });
  }
  return parsed;
}

function numberMaybe(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function epochSecondsToIso(seconds: number | null, fallback: string): string {
  if (!seconds) return fallback;
  return new Date(seconds * 1000).toISOString();
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function header(headers: Record<string, string | undefined>, name: string): string | null {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && value) return value;
  }
  return null;
}

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function sha256Hex(message: string): string {
  return createHash("sha256").update(message).digest("hex");
}

function timingSafeHexEqual(expectedHex: string, receivedHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(receivedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const received = Buffer.from(receivedHex, "hex");
  if (expected.byteLength !== received.byteLength) return false;
  return timingSafeEqual(expected, received);
}
