import { MetaWhatsAppError } from "./errors.js";

export interface MetaTemplateSendPolicy {
  readonly consent: "granted" | "denied" | "revoked" | "unknown";
  readonly purpose: "care_instruction" | "appointment" | "payment" | "recall" | "marketing" | "human_reply";
  readonly mode: "approved_template";
  readonly templateState: "pending" | "approved" | "rejected" | "paused" | "disabled" | "deleted" | "unknown";
  readonly now: string;
}

export interface MetaPolicyDecision {
  readonly allowed: boolean;
  readonly code: string;
}

export interface MetaTemplateSendInput {
  readonly messageRequestId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly recipientPhoneE164: string;
  readonly template: {
    readonly name: string;
    readonly languageCode: string;
    readonly components?: readonly MetaTemplateComponent[];
  };
  readonly policy: MetaTemplateSendPolicy;
}

export type MetaTemplateComponent =
  | {
      readonly type: "header" | "body";
      readonly parameters: readonly MetaTemplateParameter[];
    }
  | {
      readonly type: "button";
      readonly sub_type: "quick_reply" | "url" | "copy_code";
      readonly index: string;
      readonly parameters: readonly MetaTemplateParameter[];
    };

export type MetaTemplateParameter =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "currency";
      readonly currency: {
        readonly fallback_value: string;
        readonly code: string;
        readonly amount_1000: number;
      };
    }
  | { readonly type: "date_time"; readonly date_time: { readonly fallback_value: string } }
  | { readonly type: "image" | "document" | "video"; readonly image?: { readonly id?: string; readonly link?: string }; readonly document?: { readonly id?: string; readonly link?: string }; readonly video?: { readonly id?: string; readonly link?: string } }
  | { readonly type: "payload"; readonly payload: string };

export type MetaTemplateSendResult =
  | {
      readonly outcome: "accepted_by_provider";
      readonly providerMessageId: string;
      readonly messageRequestId: string;
      readonly idempotencyKey: string;
      readonly correlationId: string;
      readonly deliveryState: null;
      readonly reconciliationRequired: false;
    }
  | {
      readonly outcome: "dispatch_ambiguous";
      readonly providerMessageId: null;
      readonly messageRequestId: string;
      readonly idempotencyKey: string;
      readonly correlationId: string;
      readonly deliveryState: null;
      readonly reconciliationRequired: true;
      readonly retryAutomatically: false;
    }
  | {
      readonly outcome: "not_dispatched";
      readonly providerMessageId: null;
      readonly messageRequestId: string;
      readonly idempotencyKey: string;
      readonly correlationId: string;
      readonly deliveryState: null;
      readonly reconciliationRequired: false;
      readonly retryAutomatically: true;
    }
  | {
      readonly outcome: "rejected_by_provider";
      readonly providerMessageId: null;
      readonly messageRequestId: string;
      readonly idempotencyKey: string;
      readonly correlationId: string;
      readonly deliveryState: null;
      readonly reconciliationRequired: false;
      readonly retryAutomatically: false;
      readonly providerHttpStatus: number;
    };

export interface MetaHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Uint8Array;
}

export interface MetaHttpTransport {
  post(input: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly timeoutMs: number;
  }): Promise<MetaHttpResponse>;
}

export class MetaTransportError extends Error {
  readonly requestMayHaveReachedProvider: boolean;

  constructor(message: string, requestMayHaveReachedProvider: boolean) {
    super(message);
    this.name = "MetaTransportError";
    this.requestMayHaveReachedProvider = requestMayHaveReachedProvider;
  }
}

export interface MetaWhatsAppClientOptions {
  readonly activationState: "configured" | "sandbox_verified" | "production_verified" | "degraded" | "disabled";
  readonly graphApiVersion: string;
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly transport?: MetaHttpTransport;
  readonly timeoutMs?: number;
}

export class MetaWhatsAppClient {
  readonly #url: string;
  readonly #accessToken: string;
  readonly #transport: MetaHttpTransport;
  readonly #timeoutMs: number;
  readonly #activationState: MetaWhatsAppClientOptions["activationState"];

  constructor(options: MetaWhatsAppClientOptions) {
    if (!/^v\d{1,3}\.\d{1,2}$/u.test(options.graphApiVersion)) {
      throw notConfigured("Meta Graph API version must be explicitly configured.");
    }
    if (!/^[1-9]\d{5,31}$/u.test(options.phoneNumberId)) {
      throw notConfigured("Meta phone number id is not configured.");
    }
    if (!options.accessToken || options.accessToken.length < 16 || options.accessToken.length > 8192) {
      throw notConfigured("Meta access token is not configured.");
    }
    this.#url = `https://graph.facebook.com/${options.graphApiVersion}/${encodeURIComponent(options.phoneNumberId)}/messages`;
    this.#accessToken = options.accessToken;
    this.#transport = options.transport ?? new FetchMetaHttpTransport();
    this.#activationState = options.activationState;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 100 || this.#timeoutMs > 60_000) {
      throw notConfigured("Meta request timeout is invalid.");
    }
  }

  async sendApprovedTemplate(input: MetaTemplateSendInput): Promise<MetaTemplateSendResult> {
    if (!["sandbox_verified", "production_verified"].includes(this.#activationState)) {
      throw new MetaWhatsAppError({
        code: "not_configured",
        message: "Meta WhatsApp outbound messaging is disabled until official verification passes.",
        httpStatus: 503
      });
    }
    const policy = evaluateMetaTemplateSendPolicy(input.policy);
    if (!policy.allowed) {
      throw new MetaWhatsAppError({ code: "policy_blocked", message: `Meta WhatsApp send blocked by policy: ${safeCode(policy.code)}.`, httpStatus: 409 });
    }
    const recipient = validateE164(input.recipientPhoneE164);
    const messageRequestId = opaqueIdentifier(input.messageRequestId, "messageRequestId", 128);
    const idempotencyKey = opaqueIdentifier(input.idempotencyKey, "idempotencyKey", 256);
    const correlationId = opaqueIdentifier(input.correlationId, "correlationId", 256);
    const templateName = templateIdentifier(input.template.name);
    const languageCode = templateLanguage(input.template.languageCode);
    const components = validateTemplateComponents(input.template.components ?? []);
    const requestBody = Buffer.from(JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient.slice(1),
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {})
      },
      biz_opaque_callback_data: messageRequestId
    }), "utf8");
    if (requestBody.byteLength > 128 * 1024) {
      throw new MetaWhatsAppError({ code: "policy_blocked", message: "Meta template request exceeds the configured limit.", httpStatus: 422 });
    }

    let response: MetaHttpResponse;
    try {
      response = await this.#transport.post({
        url: this.#url,
        headers: Object.freeze({ authorization: `Bearer ${this.#accessToken}`, "content-type": "application/json" }),
        body: requestBody,
        timeoutMs: this.#timeoutMs
      });
    } catch (error) {
      if (error instanceof MetaTransportError && !error.requestMayHaveReachedProvider) {
        return {
          outcome: "not_dispatched",
          providerMessageId: null,
          messageRequestId,
          idempotencyKey,
          correlationId,
          deliveryState: null,
          reconciliationRequired: false,
          retryAutomatically: true
        };
      }
      return {
        outcome: "dispatch_ambiguous",
        providerMessageId: null,
        messageRequestId,
        idempotencyKey,
        correlationId,
        deliveryState: null,
        reconciliationRequired: true,
        retryAutomatically: false
      };
    }

    if (response.body.byteLength > 256 * 1024) {
      return ambiguousDispatch(messageRequestId, idempotencyKey, correlationId);
    }
    if (response.status < 200 || response.status >= 300) {
      const isAmbiguous = response.status === 408 || response.status === 429 || response.status >= 500;
      if (isAmbiguous) {
        return {
          outcome: "dispatch_ambiguous",
          providerMessageId: null,
          messageRequestId,
          idempotencyKey,
          correlationId,
          deliveryState: null,
          reconciliationRequired: true,
          retryAutomatically: false
        };
      }
      return {
        outcome: "rejected_by_provider",
        providerMessageId: null,
        messageRequestId,
        idempotencyKey,
        correlationId,
        deliveryState: null,
        reconciliationRequired: false,
        retryAutomatically: false,
        providerHttpStatus: response.status
      };
    }

    let providerMessageId: string;
    try {
      providerMessageId = parseProviderMessageId(response.body);
    } catch {
      // A 2xx response proves that dispatch reached Meta even when its response is malformed.
      // Automatic retry could duplicate a patient message, so reconciliation is mandatory.
      return ambiguousDispatch(messageRequestId, idempotencyKey, correlationId);
    }
    return {
      outcome: "accepted_by_provider",
      providerMessageId,
      messageRequestId,
      idempotencyKey,
      correlationId,
      deliveryState: null,
      reconciliationRequired: false
    };
  }
}

function ambiguousDispatch(
  messageRequestId: string,
  idempotencyKey: string,
  correlationId: string
): Extract<MetaTemplateSendResult, { outcome: "dispatch_ambiguous" }> {
  return {
    outcome: "dispatch_ambiguous",
    providerMessageId: null,
    messageRequestId,
    idempotencyKey,
    correlationId,
    deliveryState: null,
    reconciliationRequired: true,
    retryAutomatically: false
  };
}

export function evaluateMetaTemplateSendPolicy(input: MetaTemplateSendPolicy): MetaPolicyDecision {
  if (!input || typeof input !== "object") return { allowed: false, code: "invalid_policy" };
  if (!Number.isFinite(Date.parse(input.now))) return { allowed: false, code: "invalid_policy_time" };
  if (input.consent === "denied" || input.consent === "revoked") {
    return { allowed: false, code: "recipient_opted_out" };
  }
  if (input.consent !== "granted") return { allowed: false, code: "consent_required" };
  if (input.templateState !== "approved") return { allowed: false, code: "template_not_approved" };
  return { allowed: true, code: "allowed" };
}

export class FetchMetaHttpTransport implements MetaHttpTransport {
  async post(input: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly timeoutMs: number;
  }): Promise<MetaHttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetch(input.url, {
        method: "POST",
        headers: input.headers,
        body: Buffer.from(input.body),
        signal: controller.signal,
        redirect: "error"
      });
      const body = await readBoundedResponse(response, 256 * 1024);
      return {
        status: response.status,
        headers: Object.freeze({
          "retry-after": response.headers.get("retry-after") ?? undefined,
          "x-fb-request-id": response.headers.get("x-fb-request-id") ?? undefined
        }),
        body
      };
    } catch {
      // Once fetch is invoked, DNS/socket/timeout failures cannot prove that Meta received no bytes.
      throw new MetaTransportError("Meta transport failed after dispatch began.", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response_too_large");
        throw new MetaWhatsAppError({ code: "provider_response_invalid", message: "Meta response exceeded the configured limit.", httpStatus: 502, retryable: true });
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

function parseProviderMessageId(bytes: Uint8Array): string {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new MetaWhatsAppError({ code: "provider_response_invalid", message: "Meta response was not valid JSON.", httpStatus: 502, retryable: true });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidProviderResponse();
  const messages = (value as Record<string, unknown>).messages;
  if (!Array.isArray(messages) || messages.length !== 1) throw invalidProviderResponse();
  const message = messages[0];
  if (!message || typeof message !== "object" || Array.isArray(message)) throw invalidProviderResponse();
  const id = (message as Record<string, unknown>).id;
  if (typeof id !== "string" || !id.startsWith("wamid.") || id.length > 512) throw invalidProviderResponse();
  return id;
}

function invalidProviderResponse(): MetaWhatsAppError {
  return new MetaWhatsAppError({ code: "provider_response_invalid", message: "Meta response did not contain one provider message id.", httpStatus: 502, retryable: true });
}

function validateE164(value: string): string {
  if (!/^\+[1-9]\d{7,14}$/u.test(value)) {
    throw new MetaWhatsAppError({ code: "policy_blocked", message: "WhatsApp recipient must be a valid E.164 number.", httpStatus: 422 });
  }
  return value;
}

function opaqueIdentifier(value: string, field: string, max: number): string {
  if (!value || value.length > max || !/^[A-Za-z0-9._:-]+$/u.test(value)) {
    throw new MetaWhatsAppError({ code: "policy_blocked", message: `${field} is invalid.`, httpStatus: 422 });
  }
  return value;
}

function templateIdentifier(value: string): string {
  if (!/^[a-z0-9_]{1,512}$/u.test(value)) {
    throw new MetaWhatsAppError({ code: "policy_blocked", message: "template.name is invalid.", httpStatus: 422 });
  }
  return value;
}

function templateLanguage(value: string): string {
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(value)) {
    throw new MetaWhatsAppError({ code: "policy_blocked", message: "template.languageCode is invalid.", httpStatus: 422 });
  }
  return value;
}

function validateTemplateComponents(
  components: readonly MetaTemplateComponent[]
): readonly Readonly<Record<string, unknown>>[] {
  if (!Array.isArray(components)) throw policyError("Meta template components are invalid.");
  if (components.length > 20) throw policyError("Meta template has too many components.");
  return components.map((component) => {
    if (!component || typeof component !== "object" || Array.isArray(component)) {
      throw policyError("Meta template component is invalid.");
    }
    const value = component as unknown as Record<string, unknown>;
    if (component.type === "button") {
      exactKeys(value, ["type", "sub_type", "index", "parameters"]);
      if (!/^(?:[0-9]|[1-9][0-9])$/u.test(component.index)) throw policyError("Meta template button index is invalid.");
    } else {
      exactKeys(value, ["type", "parameters"]);
    }
    if (!Array.isArray(component.parameters) || component.parameters.length > 20) {
      throw policyError("Meta template component parameters are invalid.");
    }
    return Object.freeze({ ...component, parameters: Object.freeze(component.parameters.map(validateTemplateParameter)) });
  });
}

function validateTemplateParameter(parameter: MetaTemplateParameter): Readonly<Record<string, unknown>> {
  if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) {
    throw policyError("Meta template parameter is invalid.");
  }
  const value = parameter as unknown as Record<string, unknown>;
  if (parameter.type === "text") {
    exactKeys(value, ["type", "text"]);
    return Object.freeze({ type: "text", text: boundedText(parameter.text, 4096) });
  }
  if (parameter.type === "currency") {
    exactKeys(value, ["type", "currency"]);
    exactKeys(parameter.currency as unknown as Record<string, unknown>, ["fallback_value", "code", "amount_1000"]);
    if (!/^[A-Z]{3}$/u.test(parameter.currency.code) || !Number.isSafeInteger(parameter.currency.amount_1000)) throw policyError("Meta currency parameter is invalid.");
    return Object.freeze({ type: "currency", currency: Object.freeze({ fallback_value: boundedText(parameter.currency.fallback_value, 256), code: parameter.currency.code, amount_1000: parameter.currency.amount_1000 }) });
  }
  if (parameter.type === "date_time") {
    exactKeys(value, ["type", "date_time"]);
    exactKeys(parameter.date_time as unknown as Record<string, unknown>, ["fallback_value"]);
    return Object.freeze({ type: "date_time", date_time: Object.freeze({ fallback_value: boundedText(parameter.date_time.fallback_value, 256) }) });
  }
  if (parameter.type === "payload") {
    exactKeys(value, ["type", "payload"]);
    return Object.freeze({ type: "payload", payload: boundedText(parameter.payload, 1024) });
  }
  exactKeys(value, ["type", parameter.type]);
  const media = parameter[parameter.type];
  if (!media) throw policyError("Meta media parameter is invalid.");
  exactKeys(media as unknown as Record<string, unknown>, ["id", "link"], true);
  const id = media.id ? opaqueIdentifier(media.id, "media.id", 512) : null;
  const link = media.link ? httpsUrl(media.link) : null;
  if ((id === null) === (link === null)) throw policyError("Meta media parameter requires exactly one id or HTTPS link.");
  return Object.freeze({ type: parameter.type, [parameter.type]: Object.freeze(id ? { id } : { link }) });
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], allowSubset = false): void {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || (!allowSubset && allowed.some((key) => !keys.includes(key)))) {
    throw policyError("Meta template contains unsupported fields.");
  }
}

function boundedText(value: string, max: number): string {
  if (!value || value.length > max || value.includes("\u0000")) throw policyError("Meta template parameter is invalid.");
  return value;
}

function httpsUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw policyError("Meta media link is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || value.length > 2048) throw policyError("Meta media link is invalid.");
  return url.toString();
}

function policyError(message: string): MetaWhatsAppError {
  return new MetaWhatsAppError({ code: "policy_blocked", message, httpStatus: 422 });
}

function safeCode(value: string): string {
  return /^[a-z0-9_]{1,64}$/u.test(value) ? value : "blocked";
}

function notConfigured(message: string): MetaWhatsAppError {
  return new MetaWhatsAppError({ code: "not_configured", message, httpStatus: 503 });
}
