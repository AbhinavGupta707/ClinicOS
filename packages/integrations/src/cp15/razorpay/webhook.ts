import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { RazorpayBoundaryError } from "./errors.js";

export const RAZORPAY_WEBHOOK_EVENT_NAMES = Object.freeze([
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment_link.paid",
  "payment_link.partially_paid",
  "payment_link.cancelled",
  "payment_link.expired",
  "qr_code.created",
  "qr_code.credited",
  "qr_code.closed",
  "refund.created",
  "refund.processed",
  "refund.failed",
  "payment.dispute.created",
  "payment.dispute.under_review",
  "payment.dispute.won",
  "payment.dispute.lost",
  "payment.dispute.closed"
] as const);

export type RazorpayWebhookEventName = (typeof RAZORPAY_WEBHOOK_EVENT_NAMES)[number];

export interface RazorpayWebhookAccountScope {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly externalAccountId: string;
  readonly razorpayAccountId: string;
  readonly mode: "test" | "live";
}

export interface NormalizedRazorpayWebhookEvent {
  readonly provider: "razorpay";
  readonly providerEventId: string;
  readonly eventName: RazorpayWebhookEventName;
  readonly resourceKind: "payment" | "payment_link" | "qr_code" | "refund" | "dispute";
  readonly accountId: string;
  readonly occurredAt: string;
  readonly rawBodySha256: string;
  readonly signatureSha256: string;
  readonly verifiedSecretVersion: string;
  readonly invoiceId: string | null;
  readonly patientId: string | null;
  readonly tenantId: string | null;
  readonly clinicId: string | null;
  readonly providerPaymentId: string | null;
  readonly providerRequestId: string | null;
  readonly providerRefundId: string | null;
  readonly providerDisputeId: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly paymentCaptured: boolean;
  readonly providerStatus: string | null;
  readonly method: string | null;
}

export const DEFAULT_RAZORPAY_WEBHOOK_LIMIT_BYTES = 256 * 1024;

export interface RazorpayWebhookSecretVersion {
  readonly version: string;
  readonly secret: string;
  readonly role: "current" | "previous";
  readonly acceptUntil?: string | null;
}

export interface RazorpayWebhookRouteBinding extends RazorpayWebhookAccountScope {
  readonly activationState: "configured" | "sandbox_verified" | "production_verified" | "degraded";
  readonly secrets: readonly RazorpayWebhookSecretVersion[];
}

export interface RawRazorpayWebhookRequest {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly rawBody: Uint8Array;
  readonly receivedAt: string;
}

export interface VerifiedRazorpayWebhook {
  readonly event: NormalizedRazorpayWebhookEvent;
  readonly account: RazorpayWebhookAccountScope;
  readonly rawBodyLength: number;
  readonly usedPreviousSecret: boolean;
}

export function verifyAndNormalizeRazorpayWebhook(
  request: RawRazorpayWebhookRequest,
  binding: RazorpayWebhookRouteBinding,
  options: { readonly maxBodyBytes?: number } = {}
): VerifiedRazorpayWebhook {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_RAZORPAY_WEBHOOK_LIMIT_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) {
    throw new Error("Razorpay webhook body limit must be a positive safe integer.");
  }
  if (request.rawBody.byteLength > maxBodyBytes) {
    throw new RazorpayBoundaryError({
      code: "BODY_TOO_LARGE",
      message: "Razorpay webhook exceeded its configured body limit.",
      safeDetails: { receivedBytes: request.rawBody.byteLength, maxBodyBytes }
    });
  }
  const signature = header(request.headers, "x-razorpay-signature");
  if (!signature) {
    throw new RazorpayBoundaryError({
      code: "MISSING_SIGNATURE",
      message: "Razorpay webhook signature is missing."
    });
  }
  const providerEventId = header(request.headers, "x-razorpay-event-id");
  if (!providerEventId) {
    throw new RazorpayBoundaryError({
      code: "MISSING_EVENT_ID",
      message: "Razorpay webhook event identifier is missing."
    });
  }
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(providerEventId)) {
    throw new RazorpayBoundaryError({
      code: "INVALID_PAYLOAD",
      message: "Razorpay webhook event identifier is invalid."
    });
  }
  const receivedAt = validIso(request.receivedAt, "receivedAt");
  const eligibleSecrets = binding.secrets.filter((candidate) =>
    secretEligible(candidate, receivedAt)
  );
  if (eligibleSecrets.length === 0) {
    throw new RazorpayBoundaryError({
      code: "NOT_CONFIGURED",
      message: "No active Razorpay webhook secret is configured."
    });
  }
  const matched = eligibleSecrets.find((candidate) =>
    verifySignature(candidate.secret, request.rawBody, signature)
  );
  if (!matched) {
    throw new RazorpayBoundaryError({
      code: "INVALID_SIGNATURE",
      message: "Razorpay webhook signature is invalid."
    });
  }

  // Parsing is intentionally below the bounded raw-body signature gate.
  const payload = parseObject(Buffer.from(request.rawBody).toString("utf8"));
  const accountId = requiredProviderId(payload.account_id, "account_id", "acc_");
  if (accountId !== binding.razorpayAccountId) {
    throw new RazorpayBoundaryError({
      code: "ACCOUNT_MISMATCH",
      message: "Razorpay webhook account does not match the registered route binding."
    });
  }
  const eventName = parseEventName(payload.event);
  const payment = nestedEntity(payload, "payment");
  const paymentLink = nestedEntity(payload, "payment_link");
  const qrCode = nestedEntity(payload, "qr_code");
  const refund = nestedEntity(payload, "refund");
  const dispute = nestedEntity(payload, "dispute");
  const notes = firstObject(payment?.notes, paymentLink?.notes, qrCode?.notes, refund?.notes);
  const amountEntity =
    eventName === "refund.processed" || eventName.startsWith("refund.")
      ? refund
      : eventName.startsWith("payment.dispute.")
        ? dispute
        : payment;
  const rawBodySha256 = sha256(request.rawBody);
  const signatureSha256 = sha256(Buffer.from(signature, "utf8"));
  const occurredAt = epochToIso(optionalSafeInteger(payload.created_at), receivedAt);
  const invoiceId = firstOpaqueId(notes.clinic_os_invoice_id, paymentLink?.reference_id);

  return {
    account: {
      tenantId: binding.tenantId,
      clinicId: binding.clinicId,
      externalAccountId: binding.externalAccountId,
      razorpayAccountId: binding.razorpayAccountId,
      mode: binding.mode
    },
    rawBodyLength: request.rawBody.byteLength,
    usedPreviousSecret: matched.role === "previous",
    event: {
      provider: "razorpay",
      providerEventId,
      eventName,
      resourceKind: resourceKind(eventName),
      accountId,
      occurredAt,
      rawBodySha256,
      signatureSha256,
      verifiedSecretVersion: matched.version,
      invoiceId,
      patientId: firstOpaqueId(notes.clinic_os_patient_id),
      tenantId: firstOpaqueId(notes.clinic_os_tenant_id),
      clinicId: firstOpaqueId(notes.clinic_os_clinic_id),
      providerPaymentId: firstProviderId(
        "pay_",
        payment?.id,
        refund?.payment_id,
        dispute?.payment_id
      ),
      providerRequestId: firstProviderId(null, paymentLink?.id, qrCode?.id),
      providerRefundId: firstProviderId("rfnd_", refund?.id),
      providerDisputeId: firstProviderId(null, dispute?.id),
      amountMinor: optionalSafeInteger(amountEntity?.amount),
      currency: firstCurrency(amountEntity?.currency, payment?.currency, paymentLink?.currency),
      paymentCaptured: payment?.captured === true || payment?.status === "captured",
      providerStatus: firstBoundedString(
        64,
        amountEntity?.status,
        paymentLink?.status,
        qrCode?.status
      ),
      method: firstBoundedString(64, payment?.method)
    }
  };
}

function secretEligible(candidate: RazorpayWebhookSecretVersion, receivedAt: string): boolean {
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(candidate.version) || !candidate.secret) return false;
  if (candidate.role === "current") return true;
  if (!candidate.acceptUntil) return false;
  return (
    Date.parse(receivedAt) <= Date.parse(validIso(candidate.acceptUntil, "secret.acceptUntil"))
  );
}

function verifySignature(secret: string, body: Uint8Array, receivedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/iu.test(receivedHex)) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const received = Buffer.from(receivedHex, "hex");
  return expected.byteLength === received.byteLength && timingSafeEqual(expected, received);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RazorpayBoundaryError({
      code: "INVALID_JSON",
      message: "Verified Razorpay webhook body is not valid JSON."
    });
  }
  return objectValue(parsed, "payload");
}

function parseEventName(value: unknown): RazorpayWebhookEventName {
  const name = requiredString(value, "event");
  if (!(RAZORPAY_WEBHOOK_EVENT_NAMES as readonly string[]).includes(name)) {
    throw new RazorpayBoundaryError({
      code: "UNSUPPORTED_EVENT",
      message: "Verified Razorpay webhook event is not supported by this integration.",
      safeDetails: { eventName: name }
    });
  }
  return name as RazorpayWebhookEventName;
}

function nestedEntity(
  payload: Record<string, unknown>,
  key: string
): Record<string, unknown> | null {
  const wrapper = optionalObject(optionalObject(payload.payload)?.[key]);
  return optionalObject(wrapper?.entity);
}

function objectValue(value: unknown, field: string): Record<string, unknown> {
  const result = optionalObject(value);
  if (!result)
    throw new RazorpayBoundaryError({
      code: "INVALID_PAYLOAD",
      message: `Razorpay ${field} must be an object.`
    });
  return result;
}

function optionalObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstObject(...values: readonly unknown[]): Record<string, unknown> {
  for (const value of values) {
    const object = optionalObject(value);
    if (object) return object;
  }
  return {};
}

function requiredString(value: unknown, field: string): string {
  const result = firstString(value);
  if (!result)
    throw new RazorpayBoundaryError({
      code: "INVALID_PAYLOAD",
      message: `Razorpay ${field} is required.`
    });
  return result;
}

function requiredProviderId(value: unknown, field: string, prefix: string): string {
  const result = firstProviderId(prefix, value);
  if (!result) {
    throw new RazorpayBoundaryError({
      code: "INVALID_PAYLOAD",
      message: `Razorpay ${field} is invalid.`
    });
  }
  return result;
}

function firstProviderId(prefix: string | null, ...values: readonly unknown[]): string | null {
  for (const value of values) {
    const result = firstBoundedString(128, value);
    if (
      result &&
      /^[A-Za-z0-9_-]+$/u.test(result) &&
      (prefix === null || result.startsWith(prefix))
    ) {
      return result;
    }
  }
  return null;
}

function firstOpaqueId(...values: readonly unknown[]): string | null {
  for (const value of values) {
    const result = firstBoundedString(128, value);
    if (result && /^[A-Za-z0-9_-]+$/u.test(result)) return result;
  }
  return null;
}

function firstCurrency(...values: readonly unknown[]): string | null {
  for (const value of values) {
    const result = firstBoundedString(3, value);
    if (result && /^[A-Z]{3}$/u.test(result)) return result;
  }
  return null;
}

function firstBoundedString(maxLength: number, ...values: readonly unknown[]): string | null {
  const result = firstString(...values);
  return result && result.length <= maxLength ? result : null;
}

function firstString(...values: readonly unknown[]): string | null {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function optionalSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function epochToIso(value: number | null, fallback: string): string {
  if (value === null || value < 0) return fallback;
  const result = new Date(value * 1000);
  return Number.isFinite(result.getTime()) ? result.toISOString() : fallback;
}

function validIso(value: string, field: string): string {
  if (!value || !Number.isFinite(Date.parse(value)))
    throw new Error(`${field} must be an ISO timestamp.`);
  return new Date(value).toISOString();
}

function header(headers: RawRazorpayWebhookRequest["headers"], name: string): string | null {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = entry?.[1];
  if (Array.isArray(value)) return value.length === 1 && value[0]?.trim() ? value[0].trim() : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resourceKind(
  event: RazorpayWebhookEventName
): NormalizedRazorpayWebhookEvent["resourceKind"] {
  if (event.startsWith("payment_link.")) return "payment_link";
  if (event.startsWith("qr_code.")) return "qr_code";
  if (event.startsWith("refund.")) return "refund";
  if (event.startsWith("payment.dispute.")) return "dispute";
  return "payment";
}
