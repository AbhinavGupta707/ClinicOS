import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { MetaWhatsAppError } from "./errors.js";
import type {
  MetaEvidenceSummary,
  MetaInboundEvent,
  MetaNormalizedEvent,
  MetaNormalizedStatus,
  MetaRawReference,
  MetaRawWebhookInput,
  MetaStatusEvent,
  MetaTemplateEvent,
  MetaTemplateLifecycle,
  MetaUnsupportedChangeEvent,
  VerifiedMetaWebhook
} from "./types.js";

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const MAX_COLLECTION_ITEMS = 100;
const MAX_NORMALIZED_EVENTS = 500;
const MAX_IDENTIFIER_LENGTH = 512;

export interface MetaWebhookBoundaryOptions {
  readonly appSecret: string;
  readonly verifyToken: string;
  readonly maxBodyBytes?: number;
}

export class MetaWebhookBoundary {
  readonly #appSecret: string;
  readonly #verifyToken: string;
  readonly #maxBodyBytes: number;

  constructor(options: MetaWebhookBoundaryOptions) {
    this.#appSecret = requiredSecret(options.appSecret, "Meta app secret");
    this.#verifyToken = requiredSecret(options.verifyToken, "Meta webhook verify token");
    this.#maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    if (!Number.isSafeInteger(this.#maxBodyBytes) || this.#maxBodyBytes < 1024) {
      throw new MetaWhatsAppError({ code: "not_configured", message: "Meta webhook body limit is invalid.", httpStatus: 503 });
    }
  }

  verifyChallenge(input: { readonly mode: string | null; readonly verifyToken: string | null; readonly challenge: string | null }): string {
    if (input.mode !== "subscribe" || !input.challenge || input.challenge.length > 1024) {
      throw new MetaWhatsAppError({ code: "invalid_challenge", message: "Meta webhook challenge is invalid.", httpStatus: 403 });
    }
    if (!input.verifyToken || !constantTimeEqualUtf8(this.#verifyToken, input.verifyToken)) {
      throw new MetaWhatsAppError({ code: "invalid_challenge", message: "Meta webhook challenge is invalid.", httpStatus: 403 });
    }
    return input.challenge;
  }

  /** Signature verification deliberately precedes content-type checks, JSON parsing, and normalization. */
  verifyAndNormalize(input: MetaRawWebhookInput): VerifiedMetaWebhook {
    const bytes = Buffer.from(input.rawBody);
    if (bytes.byteLength > this.#maxBodyBytes) {
      throw new MetaWhatsAppError({ code: "body_too_large", message: "Meta webhook body exceeds the configured limit.", httpStatus: 413 });
    }

    const signatureCount = headerValueCount(input.headers, "x-hub-signature-256");
    const signature = singleHeader(input.headers, "x-hub-signature-256");
    if (signatureCount === 0) {
      throw new MetaWhatsAppError({ code: "missing_signature", message: "Meta webhook signature is required.", httpStatus: 401 });
    }
    if (signatureCount !== 1 || !signature || !/^sha256=[a-fA-F0-9]{64}$/u.test(signature)) {
      throw new MetaWhatsAppError({ code: "invalid_signature", message: "Meta webhook signature is invalid.", httpStatus: 401 });
    }
    const receivedMac = Buffer.from(signature.slice(7), "hex");
    const expectedMac = createHmac("sha256", this.#appSecret).update(bytes).digest();
    if (receivedMac.byteLength !== expectedMac.byteLength || !timingSafeEqual(receivedMac, expectedMac)) {
      throw new MetaWhatsAppError({ code: "invalid_signature", message: "Meta webhook signature is invalid.", httpStatus: 401 });
    }

    const contentType = singleHeader(input.headers, "content-type");
    if (!contentType || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
      throw new MetaWhatsAppError({ code: "invalid_content_type", message: "Meta webhook content type must be application/json.", httpStatus: 415 });
    }

    const rawBodySha256 = sha256(bytes);
    const payload = parseObject(bytes);
    const events = normalizePayload(payload, rawBodySha256, input.receivedAt);
    return Object.freeze({
      provider: "meta_whatsapp_cloud",
      verification: "x_hub_signature_256",
      rawBodySha256,
      byteLength: bytes.byteLength,
      receivedAt: validIso(input.receivedAt, "receivedAt"),
      correlationId: boundedString(input.correlationId, "correlationId", 256),
      events: Object.freeze(events)
    });
  }
}

export function metaWebhookEvidenceSummary(webhook: VerifiedMetaWebhook): MetaEvidenceSummary {
  const eventCounts = {
    inbound_message: 0,
    message_status: 0,
    template_lifecycle: 0,
    unsupported_change: 0
  };
  const eventKeyDigests: string[] = [];
  for (const event of webhook.events) {
    eventCounts[event.kind] += 1;
    eventKeyDigests.push(sha256(Buffer.from(event.uniqueEventKey, "utf8")));
  }
  return Object.freeze({
    provider: "meta_whatsapp_cloud",
    rawBodySha256: webhook.rawBodySha256,
    byteLength: webhook.byteLength,
    eventCounts: Object.freeze(eventCounts),
    eventKeyDigests: Object.freeze(eventKeyDigests.sort())
  });
}

export function signMetaWebhookBytes(rawBody: Uint8Array, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

function normalizePayload(payload: Record<string, unknown>, digest: string, receivedAt: string): MetaNormalizedEvent[] {
  if (payload.object !== "whatsapp_business_account") {
    throw new MetaWhatsAppError({ code: "unsupported_payload", message: "Meta webhook object is unsupported.", httpStatus: 422 });
  }
  const entries = boundedArray(payload.entry, "entry");
  const events: MetaNormalizedEvent[] = [];
  entries.forEach((rawEntry, entryIndex) => {
    const entry = object(rawEntry, "entry item");
    const businessAccountId = numericIdentifier(entry.id, "entry.id", 32);
    boundedArray(entry.changes, "entry.changes").forEach((rawChange, changeIndex) => {
      const change = object(rawChange, "change item");
      const field = boundedString(change.field, "change.field", 128);
      const value = object(change.value, "change.value");
      if (field === "messages") {
        const metadata = object(value.metadata, "change.value.metadata");
        const phoneNumberId = numericIdentifier(metadata.phone_number_id, "metadata.phone_number_id", 32);
        const countBefore = events.length;
        boundedArray(value.messages, "messages", true).forEach((rawMessage, itemIndex) => {
          events.push(normalizeInbound(rawMessage, businessAccountId, phoneNumberId, receivedAt, reference(digest, entryIndex, changeIndex, itemIndex)));
        });
        boundedArray(value.statuses, "statuses", true).forEach((rawStatus, itemIndex) => {
          events.push(normalizeStatus(rawStatus, businessAccountId, phoneNumberId, receivedAt, reference(digest, entryIndex, changeIndex, itemIndex)));
        });
        if (events.length === countBefore) {
          events.push(normalizeUnsupportedChange("messages_without_supported_items", businessAccountId, receivedAt, digest, entryIndex, changeIndex));
        }
      } else if (field === "message_template_status_update") {
        events.push(normalizeTemplate(value, businessAccountId, receivedAt, reference(digest, entryIndex, changeIndex, 0)));
      } else {
        events.push(normalizeUnsupportedChange(field, businessAccountId, receivedAt, digest, entryIndex, changeIndex));
      }
      if (events.length > MAX_NORMALIZED_EVENTS) {
        throw new MetaWhatsAppError({ code: "invalid_payload", message: "Meta webhook contains too many events.", httpStatus: 422 });
      }
    });
  });
  return events;
}

function normalizeUnsupportedChange(
  field: string,
  businessAccountId: string,
  receivedAt: string,
  digest: string,
  entryIndex: number,
  changeIndex: number
): MetaUnsupportedChangeEvent {
  const occurredAt = validIso(receivedAt, "receivedAt");
  const material = [digest, String(entryIndex), String(changeIndex), field].join("\u001f");
  return Object.freeze({
    kind: "unsupported_change",
    uniqueEventKey: `meta:unsupported:${sha256(Buffer.from(material, "utf8"))}`,
    businessAccountId,
    field,
    occurredAt,
    reconciliationRequired: true,
    rawReference: reference(digest, entryIndex, changeIndex, 0)
  });
}

function normalizeInbound(raw: unknown, businessAccountId: string, phoneNumberId: string, receivedAt: string, rawReference: MetaRawReference): MetaInboundEvent {
  const message = object(raw, "message");
  const providerMessageId = wamid(message.id, "message.id");
  const senderWaId = numericIdentifier(message.from, "message.from", 20);
  const messageType = boundedString(message.type, "message.type", 64).toLowerCase();
  const occurredAt = metaTimestamp(message.timestamp, receivedAt);
  const text = inboundText(message, messageType);
  const media = inboundMedia(message, messageType);
  return Object.freeze({
    kind: "inbound_message",
    uniqueEventKey: `meta:inbound:${providerMessageId}`,
    providerMessageId,
    businessAccountId,
    phoneNumberId,
    senderWaId,
    occurredAt,
    messageType,
    text,
    media,
    consentCommand: classifyConsentCommand(text),
    serviceWindowExpiresAt: new Date(Date.parse(occurredAt) + 86_400_000).toISOString(),
    rawReference
  });
}

function normalizeStatus(raw: unknown, businessAccountId: string, phoneNumberId: string, receivedAt: string, rawReference: MetaRawReference): MetaStatusEvent {
  const statusPayload = object(raw, "status");
  const providerMessageId = wamid(statusPayload.id, "status.id");
  const providerStatus = boundedString(statusPayload.status, "status.status", 64).toLowerCase();
  const occurredAt = metaTimestamp(statusPayload.timestamp, receivedAt);
  const firstError = boundedArray(statusPayload.errors, "status.errors", true)[0];
  const error = firstError === undefined ? null : normalizeError(object(firstError, "status error"));
  const status = normalizeStatusValue(providerStatus, error !== null);
  const uniquenessMaterial = [providerMessageId, providerStatus, String(statusPayload.timestamp ?? ""), error?.code ?? ""].join("\u001f");
  return Object.freeze({
    kind: "message_status",
    uniqueEventKey: `meta:status:${sha256(Buffer.from(uniquenessMaterial, "utf8"))}`,
    providerMessageId,
    businessAccountId,
    phoneNumberId,
    occurredAt,
    providerStatus,
    status,
    recipientWaId: optionalNumericIdentifier(statusPayload.recipient_id, 20),
    error,
    rawReference
  });
}

function normalizeTemplate(value: Record<string, unknown>, businessAccountId: string, receivedAt: string, rawReference: MetaRawReference): MetaTemplateEvent {
  const providerTemplateId = numericIdentifier(value.message_template_id ?? value.id, "message_template_id", 32);
  const templateName = templateNameValue(value.message_template_name ?? value.name);
  const languageCode = languageCodeValue(value.message_template_language ?? value.language);
  const providerEvent = boundedString(value.event ?? value.status, "template.event", 64).toUpperCase();
  const occurredAt = metaTimestamp(value.timestamp, receivedAt, true);
  const uniquenessMaterial = [providerTemplateId, providerEvent, String(value.timestamp ?? occurredAt)].join("\u001f");
  return Object.freeze({
    kind: "template_lifecycle",
    uniqueEventKey: `meta:template:${sha256(Buffer.from(uniquenessMaterial, "utf8"))}`,
    businessAccountId,
    providerTemplateId,
    templateName,
    languageCode,
    providerEvent,
    lifecycle: normalizeTemplateState(providerEvent),
    occurredAt,
    rawReference
  });
}

function normalizeStatusValue(value: string, hasError: boolean): MetaNormalizedStatus {
  if (value === "sent" || value === "delivered" || value === "read" || value === "deleted") return value;
  if (value === "failed" || hasError) return "failed";
  return "unknown";
}

function normalizeTemplateState(value: string): MetaTemplateLifecycle {
  if (value === "APPROVED") return "approved";
  if (value === "REJECTED") return "rejected";
  if (value === "PAUSED") return "paused";
  if (value === "DISABLED") return "disabled";
  if (value === "DELETED") return "deleted";
  if (["PENDING", "IN_APPEAL", "PENDING_DELETION"].includes(value)) return "pending";
  return "unknown";
}

function normalizeError(value: Record<string, unknown>): NonNullable<MetaStatusEvent["error"]> {
  const code = providerErrorCode(value.code);
  const numericCode = code ? Number(code) : Number.NaN;
  let safeCategory: NonNullable<MetaStatusEvent["error"]>["safeCategory"] = "unknown";
  if (numericCode === 4 || numericCode === 80007 || numericCode === 130429) safeCategory = "rate_limited";
  else if (numericCode === 190) safeCategory = "authentication";
  else if ([131026, 131047, 131051].includes(numericCode)) safeCategory = "recipient";
  else if (Number.isFinite(numericCode) && numericCode >= 132000 && numericCode < 133000) safeCategory = "template";
  else if (code) safeCategory = "provider";
  const nonRetryable = new Set(["131026", "131047", "131051", "132000", "132001", "132005"]);
  return Object.freeze({ code, retryable: !code || !nonRetryable.has(code), safeCategory });
}

function inboundText(message: Record<string, unknown>, type: string): string | null {
  if (type === "text") return payloadString(objectMaybe(message.text)?.body, "text.body", 65_536);
  if (type === "button") return payloadString(objectMaybe(message.button)?.text, "button.text", 4096);
  if (type === "interactive") {
    const interactive = objectMaybe(message.interactive);
    return payloadString(objectMaybe(interactive?.button_reply)?.title, "interactive.button_reply.title", 4096)
      ?? payloadString(objectMaybe(interactive?.list_reply)?.title, "interactive.list_reply.title", 4096);
  }
  return null;
}

function inboundMedia(message: Record<string, unknown>, type: string): MetaInboundEvent["media"] {
  if (!["image", "document", "audio", "video", "sticker"].includes(type)) return null;
  const media = objectMaybe(message[type]);
  if (!media) return null;
  const providerMediaId = boundedString(media.id, `${type}.id`, MAX_IDENTIFIER_LENGTH);
  return Object.freeze({ providerMediaId, mimeType: optionalString(media.mime_type, 256), sha256: optionalString(media.sha256, 256) });
}

function classifyConsentCommand(text: string | null): MetaInboundEvent["consentCommand"] {
  const normalized = text?.normalize("NFKC").trim().toLocaleLowerCase("en-US") ?? "";
  if (["stop", "unsubscribe", "opt out"].includes(normalized)) return "opt_out";
  if (["start", "subscribe", "opt in"].includes(normalized)) return "opt_in_request";
  return "none";
}

function parseObject(bytes: Buffer): Record<string, unknown> {
  try {
    return object(JSON.parse(bytes.toString("utf8")), "webhook payload");
  } catch (error) {
    if (error instanceof MetaWhatsAppError) throw error;
    throw new MetaWhatsAppError({ code: "invalid_payload", message: "Authenticated Meta webhook payload is invalid JSON.", httpStatus: 400 });
  }
}

function boundedArray(value: unknown, field: string, optional = false): readonly unknown[] {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_ITEMS) {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: `Authenticated Meta webhook field ${field} is invalid.`, httpStatus: 422 });
  }
  return value;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: `Authenticated Meta webhook field ${field} is invalid.`, httpStatus: 422 });
  }
  return value as Record<string, unknown>;
}

function objectMaybe(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\u0000")) {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: `Authenticated Meta webhook field ${field} is invalid.`, httpStatus: 422 });
  }
  return value;
}

function optionalString(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max && !value.includes("\u0000") ? value : null;
}

function payloadString(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\u0000")) {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: `Authenticated Meta webhook field ${field} is invalid.`, httpStatus: 422 });
  }
  return value;
}

function numericIdentifier(value: unknown, field: string, max: number): string {
  const result = boundedString(value, field, max);
  if (!/^[1-9]\d+$/u.test(result)) {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: `Authenticated Meta webhook field ${field} is invalid.`, httpStatus: 422 });
  }
  return result;
}

function optionalNumericIdentifier(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  return numericIdentifier(value, "status.recipient_id", max);
}

function wamid(value: unknown, field: string): string {
  const result = boundedString(value, field, MAX_IDENTIFIER_LENGTH);
  if (!result.startsWith("wamid.")) {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: `Authenticated Meta webhook field ${field} is invalid.`, httpStatus: 422 });
  }
  return result;
}

function templateNameValue(value: unknown): string {
  const result = boundedString(value, "message_template_name", 512);
  if (!/^[a-z0-9_]+$/u.test(result)) {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: "Authenticated Meta webhook template name is invalid.", httpStatus: 422 });
  }
  return result;
}

function languageCodeValue(value: unknown): string {
  const result = boundedString(value, "message_template_language", 64);
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(result)) {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: "Authenticated Meta webhook template language is invalid.", httpStatus: 422 });
  }
  return result;
}

function providerErrorCode(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return optionalString(value, 64);
}

function metaTimestamp(value: unknown, fallback: string, optional = false): string {
  const receivedAt = validIso(fallback, "receivedAt");
  if ((value === undefined || value === null) && optional) return receivedAt;
  const seconds = typeof value === "string" && /^\d{1,16}$/u.test(value) ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(seconds)) throw new MetaWhatsAppError({ code: "invalid_payload", message: "Authenticated Meta webhook timestamp is invalid.", httpStatus: 422 });
  const milliseconds = seconds * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds > Date.parse(receivedAt) + 5 * 60 * 1000) {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: "Authenticated Meta webhook timestamp is invalid.", httpStatus: 422 });
  }
  try {
    return validIso(new Date(milliseconds).toISOString(), "provider timestamp");
  } catch {
    throw new MetaWhatsAppError({ code: "invalid_payload", message: "Authenticated Meta webhook timestamp is invalid.", httpStatus: 422 });
  }
}

function validIso(value: string, field: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new MetaWhatsAppError({ code: "invalid_payload", message: `${field} is invalid.`, httpStatus: 422 });
  return new Date(time).toISOString();
}

function reference(rawBodySha256: string, entryIndex: number, changeIndex: number, itemIndex: number): MetaRawReference {
  return Object.freeze({ rawBodySha256, entryIndex, changeIndex, itemIndex });
}

function requiredSecret(value: string, label: string): string {
  if (!value || value.length < 16 || value.length > 4096) {
    throw new MetaWhatsAppError({ code: "not_configured", message: `${label} is not configured.`, httpStatus: 503 });
  }
  return value;
}

function singleHeader(headers: MetaRawWebhookInput["headers"], target: string): string | null {
  const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === target);
  if (matches.length !== 1) return null;
  const value = matches[0]?.[1];
  if (Array.isArray(value)) return value.length === 1 ? value[0] ?? null : null;
  return typeof value === "string" ? value : null;
}

function headerValueCount(headers: MetaRawWebhookInput["headers"], target: string): number {
  return Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === target)
    .reduce((count, [, value]) => count + (Array.isArray(value) ? value.length : value === undefined ? 0 : 1), 0);
}

function constantTimeEqualUtf8(expected: string, received: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(received, "utf8");
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
