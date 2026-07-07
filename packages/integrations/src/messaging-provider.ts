import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AdapterCapability, ProviderHealth } from "./provider-contracts.js";

export type MessagingProviderKey = "whatsapp_cloud" | "whatsapp_bsp" | "unconfigured" | "simulator";

export type WhatsAppProviderSelection =
  "meta_cloud" | "gupshup" | "wati" | "interakt" | "unconfigured" | "simulator";

export type MessageLifecycleState =
  | "draft"
  | "queued"
  | "sent_to_provider"
  | "delivered"
  | "read"
  | "failed"
  | "cancelled"
  | "requires_human_review";

export type MessageTemplateLifecycleState =
  "draft" | "submitted" | "approved" | "rejected" | "paused" | "disabled" | "superseded";

export type WhatsAppTemplateCategory = "utility" | "marketing" | "authentication";
export type MessagingPurpose =
  | "appointment_confirmation"
  | "appointment_reminder"
  | "recall"
  | "post_op_instruction"
  | "payment_link"
  | "care_instruction"
  | "human_reply"
  | "administrative"
  | "marketing";
export type MessagingConsentStatus = "opted_in" | "opted_out" | "unknown";
export type MessagingWebhookVerificationStatus =
  "verified" | "missing_signature" | "invalid_signature" | "not_configured";
export type MessagingChallengeVerificationStatus =
  "verified" | "invalid_token" | "unsupported_mode" | "not_configured";
export type NormalizedWhatsAppEventKind = "inbound_message" | "message_status";
export type WhatsAppInboundMessageType =
  | "text"
  | "image"
  | "document"
  | "audio"
  | "video"
  | "sticker"
  | "location"
  | "contacts"
  | "button"
  | "interactive"
  | "reaction"
  | "unknown";

export interface MessagingRecipient {
  readonly phoneE164: string;
  readonly patientId?: string | null;
  readonly displayName?: string | null;
  readonly consent: {
    readonly whatsapp: MessagingConsentStatus;
    readonly optedOutAt?: string | null;
    readonly optOutReason?: string | null;
  };
}

export interface MessagingSendPolicy {
  readonly purpose: MessagingPurpose;
  readonly containsPhi: boolean;
  readonly businessInitiated: boolean;
  readonly essentialOverride?: {
    readonly reason: string;
    readonly approvedByUserId: string;
  } | null;
  readonly conversationWindowExpiresAt?: string | null;
}

export interface SendTemplateMessageInput {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly messageRequestId: string;
  readonly recipient: MessagingRecipient;
  readonly template: {
    readonly name: string;
    readonly languageCode: string;
    readonly namespace?: string | null;
    readonly category: WhatsAppTemplateCategory;
    readonly lifecycleState: MessageTemplateLifecycleState;
    readonly components?: readonly WhatsAppTemplateSendComponent[];
  };
  readonly policy: MessagingSendPolicy;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface SendFreeformMessageInput {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly messageRequestId: string;
  readonly recipient: MessagingRecipient;
  readonly body: string;
  readonly previewUrl?: boolean;
  readonly policy: MessagingSendPolicy;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface SendMediaMessageInput {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly messageRequestId: string;
  readonly recipient: MessagingRecipient;
  readonly media: {
    readonly type: "image" | "document" | "audio" | "video" | "sticker";
    readonly providerMediaId?: string | null;
    readonly link?: string | null;
    readonly caption?: string | null;
    readonly filename?: string | null;
  };
  readonly policy: MessagingSendPolicy;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export type WhatsAppTemplateSendComponent =
  | {
      readonly type: "header" | "body";
      readonly parameters: readonly WhatsAppTemplateParameter[];
    }
  | {
      readonly type: "button";
      readonly subType: "quick_reply" | "url" | "copy_code";
      readonly index: string;
      readonly parameters: readonly WhatsAppTemplateParameter[];
    };

export type WhatsAppTemplateParameter =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "currency";
      readonly currency: {
        readonly fallbackValue: string;
        readonly code: string;
        readonly amount1000: number;
      };
    }
  | { readonly type: "date_time"; readonly dateTime: { readonly fallbackValue: string } }
  | {
      readonly type: "image" | "document" | "video";
      readonly media: { readonly id?: string; readonly link?: string };
    }
  | { readonly type: "payload"; readonly payload: string };

export interface MessagingSendResult {
  readonly providerKey: MessagingProviderKey;
  readonly providerMessageId: string;
  readonly providerRequestId: string;
  readonly toWaId?: string | null;
  readonly status: MessageLifecycleState;
  readonly providerStatus?: string | null;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly providerHealth: ProviderHealth;
  readonly rawProviderResponse: Record<string, unknown>;
}

export interface RawMessagingWebhook {
  readonly providerKey?: MessagingProviderKey | string;
  readonly accountId?: string | null;
  readonly rawEventId?: string | null;
  readonly receivedAt: string;
  readonly headers: Record<string, string | undefined>;
  readonly rawBody: string;
  readonly correlationId?: string | null;
}

export interface MessagingWebhookVerificationResult {
  readonly status: MessagingWebhookVerificationStatus;
  readonly providerKey: MessagingProviderKey;
  readonly signatureHeader?: string | null;
  readonly rawBodySha256: string;
  readonly message: string;
}

export interface MessagingChallengeInput {
  readonly mode?: string | null;
  readonly verifyToken?: string | null;
  readonly challenge?: string | null;
}

export interface MessagingChallengeVerificationResult {
  readonly status: MessagingChallengeVerificationStatus;
  readonly providerKey: MessagingProviderKey;
  readonly challenge?: string | null;
  readonly message: string;
}

export interface NormalizedWhatsAppRawReference {
  readonly rawEventId?: string | null;
  readonly rawBodySha256: string;
  readonly businessAccountId?: string | null;
  readonly phoneNumberId?: string | null;
  readonly entryId?: string | null;
  readonly changeIndex: number;
  readonly eventIndex: number;
}

export interface NormalizedWhatsAppInboundMessage {
  readonly providerKey: MessagingProviderKey;
  readonly eventKind: "inbound_message";
  readonly providerMessageId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly fromWaId: string;
  readonly fromPhoneE164?: string | null;
  readonly patientDisplayName?: string | null;
  readonly phoneNumberId?: string | null;
  readonly businessAccountId?: string | null;
  readonly messageType: WhatsAppInboundMessageType;
  readonly textBody?: string | null;
  readonly providerContextMessageId?: string | null;
  readonly media?: {
    readonly providerMediaId?: string | null;
    readonly mimeType?: string | null;
    readonly sha256?: string | null;
    readonly caption?: string | null;
    readonly filename?: string | null;
  } | null;
  readonly rawPayloadReference: NormalizedWhatsAppRawReference;
  readonly rawProviderPayload: Record<string, unknown>;
}

export interface NormalizedWhatsAppStatusEvent {
  readonly providerKey: MessagingProviderKey;
  readonly eventKind: "message_status";
  readonly providerMessageId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly recipientWaId?: string | null;
  readonly phoneNumberId?: string | null;
  readonly businessAccountId?: string | null;
  readonly status: MessageLifecycleState;
  readonly providerStatus: string;
  readonly conversationId?: string | null;
  readonly pricingCategory?: string | null;
  readonly failureReason?: MessagingFailureReason | null;
  readonly rawPayloadReference: NormalizedWhatsAppRawReference;
  readonly rawProviderPayload: Record<string, unknown>;
}

export interface MessagingFailureReason {
  readonly code?: string | null;
  readonly title?: string | null;
  readonly message: string;
  readonly details?: string | null;
  readonly retryable: boolean;
}

export type NormalizedWhatsAppWebhookEvent =
  NormalizedWhatsAppInboundMessage | NormalizedWhatsAppStatusEvent;

export interface ProviderMessageTemplateSnapshot {
  readonly providerKey: MessagingProviderKey;
  readonly providerTemplateId?: string | null;
  readonly name: string;
  readonly languageCode: string;
  readonly category: WhatsAppTemplateCategory;
  readonly lifecycleState: MessageTemplateLifecycleState;
  readonly providerStatus: string;
  readonly rejectionReason?: string | null;
  readonly previousTemplateName?: string | null;
  readonly components: readonly ProviderMessageTemplateComponent[];
  readonly rawProviderPayload: Record<string, unknown>;
}

export interface ProviderMessageTemplateComponent {
  readonly type: string;
  readonly format?: string | null;
  readonly text?: string | null;
  readonly buttons?: readonly Record<string, unknown>[];
}

export interface MessagingProvider {
  readonly providerKey: MessagingProviderKey;
  capabilities(): readonly AdapterCapability[];
  healthCheck(): Promise<ProviderHealth>;
  sendTemplateMessage(input: SendTemplateMessageInput): Promise<MessagingSendResult>;
  sendFreeformMessage(input: SendFreeformMessageInput): Promise<MessagingSendResult>;
  sendMediaMessage(input: SendMediaMessageInput): Promise<MessagingSendResult>;
  verifyWebhookChallenge(
    input: MessagingChallengeInput
  ): Promise<MessagingChallengeVerificationResult>;
  verifyWebhook(raw: RawMessagingWebhook): Promise<MessagingWebhookVerificationResult>;
  parseInboundWebhook(
    raw: RawMessagingWebhook
  ): Promise<readonly NormalizedWhatsAppInboundMessage[]>;
  parseStatusWebhook(raw: RawMessagingWebhook): Promise<readonly NormalizedWhatsAppStatusEvent[]>;
  parseWebhook(raw: RawMessagingWebhook): Promise<readonly NormalizedWhatsAppWebhookEvent[]>;
  normalizeTemplate(input: Record<string, unknown>): ProviderMessageTemplateSnapshot;
}

export interface MetaWhatsAppCloudProviderOptions {
  readonly accessToken?: string | null;
  readonly businessAccountId?: string | null;
  readonly phoneNumberId?: string | null;
  readonly webhookVerifyToken?: string | null;
  readonly appSecret?: string | null;
  readonly signatureVerificationRequired?: boolean;
  readonly templateNamespace?: string | null;
  readonly baseUrl?: string;
  readonly fetch?: MessagingProviderFetch;
  readonly allowLiveMetaApiCalls?: boolean;
  readonly liveHealthCheckEnabled?: boolean;
  readonly now?: () => Date;
}

export interface UnavailableMessagingProviderOptions {
  readonly providerKey: MessagingProviderKey;
  readonly message: string;
  readonly status?: "not_configured" | "unavailable";
}

export interface CreateMessagingProviderInput {
  readonly provider: WhatsAppProviderSelection;
  readonly accessToken?: string | null;
  readonly businessAccountId?: string | null;
  readonly phoneNumberId?: string | null;
  readonly webhookVerifyToken?: string | null;
  readonly appSecret?: string | null;
  readonly appSecretProofRequired?: boolean;
  readonly templateNamespace?: string | null;
  readonly fetch?: MessagingProviderFetch;
  readonly allowLiveMetaApiCalls?: boolean;
  readonly liveHealthCheckEnabled?: boolean;
}

export type MessagingProviderFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }
) => Promise<MessagingProviderHttpResponse>;

export interface MessagingProviderHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export class MessagingProviderError extends Error {
  readonly providerKey: string;
  readonly status:
    | "not_configured"
    | "unavailable"
    | "provider_error"
    | "verification_failed"
    | "policy_blocked"
    | "conversation_window_closed"
    | "live_api_disabled";
  readonly details: Record<string, unknown>;

  constructor(input: {
    providerKey: string;
    status: MessagingProviderError["status"];
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "MessagingProviderError";
    this.providerKey = input.providerKey;
    this.status = input.status;
    this.details = input.details ?? {};
  }
}

const META_CAPABILITIES: AdapterCapability[] = [
  "SEND_MESSAGES",
  "SEND_TEMPLATE_MESSAGES",
  "SEND_FREEFORM_MESSAGES",
  "SEND_MEDIA_MESSAGES",
  "MANAGE_MESSAGE_TEMPLATES"
] as const;

const WEBHOOK_CAPABILITIES: AdapterCapability[] = [
  "RECEIVE_WEBHOOKS",
  "VERIFY_WEBHOOKS",
  "RECEIVE_MESSAGE_STATUS"
] as const;

const MESSAGE_TYPE_KEYS = ["image", "document", "audio", "video", "sticker"] as const;

export class MetaWhatsAppCloudProvider implements MessagingProvider {
  readonly providerKey = "whatsapp_cloud";
  readonly #accessToken?: string | null;
  readonly #businessAccountId?: string | null;
  readonly #phoneNumberId?: string | null;
  readonly #webhookVerifyToken?: string | null;
  readonly #appSecret?: string | null;
  readonly #signatureVerificationRequired: boolean;
  readonly #templateNamespace?: string | null;
  readonly #baseUrl: string;
  readonly #fetch: MessagingProviderFetch;
  readonly #usesDefaultFetch: boolean;
  readonly #allowLiveMetaApiCalls: boolean;
  readonly #liveHealthCheckEnabled: boolean;
  readonly #now: () => Date;

  constructor(options: MetaWhatsAppCloudProviderOptions) {
    this.#accessToken = options.accessToken;
    this.#businessAccountId = options.businessAccountId;
    this.#phoneNumberId = options.phoneNumberId;
    this.#webhookVerifyToken = options.webhookVerifyToken;
    this.#appSecret = options.appSecret;
    this.#signatureVerificationRequired = options.signatureVerificationRequired ?? true;
    this.#templateNamespace = options.templateNamespace;
    this.#baseUrl = options.baseUrl ?? "https://graph.facebook.com/v21.0";
    this.#fetch = options.fetch ?? defaultMessagingFetch;
    this.#usesDefaultFetch = options.fetch === undefined;
    this.#allowLiveMetaApiCalls = options.allowLiveMetaApiCalls ?? false;
    this.#liveHealthCheckEnabled = options.liveHealthCheckEnabled ?? false;
    this.#now = options.now ?? (() => new Date());
  }

  capabilities(): readonly AdapterCapability[] {
    if (!this.hasApiCredentials()) return [];

    const capabilities = [...META_CAPABILITIES];
    if (this.#webhookVerifyToken && (this.#appSecret || !this.#signatureVerificationRequired)) {
      capabilities.push(...WEBHOOK_CAPABILITIES);
    }
    return capabilities;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const checkedAt = this.#now().toISOString();

    if (!this.hasApiCredentials()) {
      return {
        providerKey: this.providerKey,
        status: "not_configured",
        checkedAt,
        capabilities: [],
        message:
          "WHATSAPP_ACCESS_TOKEN, WHATSAPP_BUSINESS_ACCOUNT_ID, and WHATSAPP_PHONE_NUMBER_ID are required before Meta WhatsApp Cloud can send messages."
      };
    }

    if (this.#signatureVerificationRequired && !this.#appSecret) {
      return {
        providerKey: this.providerKey,
        status: "unavailable",
        checkedAt,
        capabilities: this.capabilities(),
        message: "WHATSAPP_APP_SECRET is required before signed Meta webhook events can be trusted."
      };
    }

    if (!this.#webhookVerifyToken) {
      return {
        providerKey: this.providerKey,
        status: "degraded",
        checkedAt,
        capabilities: this.capabilities(),
        message:
          "WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured; outbound sends may work but Meta webhook activation cannot be completed."
      };
    }

    if (this.#usesDefaultFetch && !this.#allowLiveMetaApiCalls) {
      return {
        providerKey: this.providerKey,
        status: "degraded",
        checkedAt,
        capabilities: this.capabilities(),
        message:
          "Meta WhatsApp Cloud configuration is complete, but live API calls are disabled until an explicit live-call flag is enabled."
      };
    }

    if (!this.#liveHealthCheckEnabled) {
      return {
        providerKey: this.providerKey,
        status: "available",
        checkedAt,
        capabilities: this.capabilities(),
        message: "Meta WhatsApp Cloud configuration is complete; live API health probe is disabled."
      };
    }

    try {
      const startedAt = this.#now().getTime();
      await this.getJson(
        `/${encodeURIComponent(this.#phoneNumberId ?? "")}?fields=id,display_phone_number,verified_name`
      );
      return {
        providerKey: this.providerKey,
        status: "available",
        checkedAt,
        capabilities: this.capabilities(),
        latencyMs: Math.max(0, this.#now().getTime() - startedAt)
      };
    } catch (error) {
      return {
        providerKey: this.providerKey,
        status: "degraded",
        checkedAt,
        capabilities: this.capabilities(),
        message: error instanceof Error ? error.message : "Meta WhatsApp Cloud health probe failed."
      };
    }
  }

  async sendTemplateMessage(input: SendTemplateMessageInput): Promise<MessagingSendResult> {
    const health = await this.healthCheck();
    this.assertCanSend(health);
    assertTemplateCanSend(input.template);
    assertMessagingPolicyAllowed(input.recipient, input.policy, this.#now);

    const response = await this.postJson(
      `/${encodeURIComponent(this.#phoneNumberId ?? "")}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: whatsappTo(input.recipient.phoneE164),
        type: "template",
        template: stripUndefined({
          name: input.template.name,
          namespace: input.template.namespace ?? this.#templateNamespace ?? undefined,
          language: { code: input.template.languageCode },
          components: input.template.components?.map(templateSendComponentToMeta)
        }),
        biz_opaque_callback_data: opaqueCallbackData(input)
      }
    );

    return this.sendResultFromResponse(response, input, health);
  }

  async sendFreeformMessage(input: SendFreeformMessageInput): Promise<MessagingSendResult> {
    const health = await this.healthCheck();
    this.assertCanSend(health);
    assertMessagingPolicyAllowed(input.recipient, input.policy, this.#now);
    assertOpenConversationWindow(input.policy, this.#now);

    const response = await this.postJson(
      `/${encodeURIComponent(this.#phoneNumberId ?? "")}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: whatsappTo(input.recipient.phoneE164),
        type: "text",
        text: {
          preview_url: input.previewUrl ?? false,
          body: input.body
        },
        biz_opaque_callback_data: opaqueCallbackData(input)
      }
    );

    return this.sendResultFromResponse(response, input, health);
  }

  async sendMediaMessage(input: SendMediaMessageInput): Promise<MessagingSendResult> {
    const health = await this.healthCheck();
    this.assertCanSend(health);
    assertMessagingPolicyAllowed(input.recipient, input.policy, this.#now);
    assertOpenConversationWindow(input.policy, this.#now);

    const mediaPayload = stripUndefined({
      id: input.media.providerMediaId ?? undefined,
      link: input.media.link ?? undefined,
      caption: input.media.caption ?? undefined,
      filename: input.media.filename ?? undefined
    });
    if (!mediaPayload.id && !mediaPayload.link) {
      throw new MessagingProviderError({
        providerKey: this.providerKey,
        status: "provider_error",
        message: "WhatsApp media sends require either a provider media id or an HTTPS media link."
      });
    }

    const response = await this.postJson(
      `/${encodeURIComponent(this.#phoneNumberId ?? "")}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: whatsappTo(input.recipient.phoneE164),
        type: input.media.type,
        [input.media.type]: mediaPayload,
        biz_opaque_callback_data: opaqueCallbackData(input)
      }
    );

    return this.sendResultFromResponse(response, input, health);
  }

  async verifyWebhookChallenge(
    input: MessagingChallengeInput
  ): Promise<MessagingChallengeVerificationResult> {
    if (!this.#webhookVerifyToken) {
      return {
        status: "not_configured",
        providerKey: this.providerKey,
        challenge: null,
        message: "WHATSAPP_WEBHOOK_VERIFY_TOKEN is not configured."
      };
    }
    if (input.mode !== "subscribe") {
      return {
        status: "unsupported_mode",
        providerKey: this.providerKey,
        challenge: null,
        message: "Meta webhook challenge mode must be subscribe."
      };
    }
    if (!input.challenge) {
      return {
        status: "invalid_token",
        providerKey: this.providerKey,
        challenge: null,
        message: "Meta webhook challenge is missing."
      };
    }
    if (input.verifyToken !== this.#webhookVerifyToken) {
      return {
        status: "invalid_token",
        providerKey: this.providerKey,
        challenge: null,
        message: "Meta webhook verify token mismatch."
      };
    }
    return {
      status: "verified",
      providerKey: this.providerKey,
      challenge: input.challenge,
      message: "Meta webhook challenge verified."
    };
  }

  async verifyWebhook(raw: RawMessagingWebhook): Promise<MessagingWebhookVerificationResult> {
    const signature = header(raw.headers, "x-hub-signature-256");
    const rawBodySha256 = sha256Hex(raw.rawBody);

    if (!this.#appSecret) {
      return {
        status: "not_configured",
        providerKey: this.providerKey,
        signatureHeader: signature,
        rawBodySha256,
        message:
          "WHATSAPP_APP_SECRET is not configured; signed Meta webhook verification cannot run."
      };
    }
    if (!signature) {
      return {
        status: "missing_signature",
        providerKey: this.providerKey,
        signatureHeader: null,
        rawBodySha256,
        message: "Meta webhook signature header x-hub-signature-256 is missing."
      };
    }

    const expected = `sha256=${hmacSha256Hex(this.#appSecret, raw.rawBody)}`;
    const valid = timingSafeStringEqual(expected, signature);
    return {
      status: valid ? "verified" : "invalid_signature",
      providerKey: this.providerKey,
      signatureHeader: signature,
      rawBodySha256,
      message: valid ? "Meta webhook signature verified." : "Meta webhook signature mismatch."
    };
  }

  async parseInboundWebhook(
    raw: RawMessagingWebhook
  ): Promise<readonly NormalizedWhatsAppInboundMessage[]> {
    const parsed = parseWhatsAppWebhook(raw);
    return parsed.inbound;
  }

  async parseStatusWebhook(
    raw: RawMessagingWebhook
  ): Promise<readonly NormalizedWhatsAppStatusEvent[]> {
    const parsed = parseWhatsAppWebhook(raw);
    return parsed.statuses;
  }

  async parseWebhook(raw: RawMessagingWebhook): Promise<readonly NormalizedWhatsAppWebhookEvent[]> {
    const parsed = parseWhatsAppWebhook(raw);
    return [...parsed.inbound, ...parsed.statuses];
  }

  normalizeTemplate(input: Record<string, unknown>): ProviderMessageTemplateSnapshot {
    return normalizeMetaTemplate(input);
  }

  assertCanSend(health: ProviderHealth): void {
    if (!this.hasApiCredentials()) {
      throw new MessagingProviderError({
        providerKey: this.providerKey,
        status: "not_configured",
        message: "Meta WhatsApp Cloud API credentials are not configured."
      });
    }
    if (!["available", "degraded"].includes(health.status)) {
      throw new MessagingProviderError({
        providerKey: this.providerKey,
        status: health.status === "not_configured" ? "not_configured" : "unavailable",
        message: health.message ?? "Meta WhatsApp Cloud provider is unavailable.",
        details: { providerHealth: health }
      });
    }
  }

  hasApiCredentials(): boolean {
    return Boolean(this.#accessToken && this.#businessAccountId && this.#phoneNumberId);
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
    if (!this.hasApiCredentials()) {
      throw new MessagingProviderError({
        providerKey: this.providerKey,
        status: "not_configured",
        message: "Meta WhatsApp Cloud API credentials are not configured."
      });
    }
    if (this.#usesDefaultFetch && !this.#allowLiveMetaApiCalls) {
      throw new MessagingProviderError({
        providerKey: this.providerKey,
        status: "live_api_disabled",
        message:
          "Live Meta WhatsApp Cloud API calls are disabled. Enable them explicitly only for sandbox/live smoke."
      });
    }

    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${this.#accessToken}`,
        "content-type": "application/json"
      },
      ...(init.body ? { body: init.body } : {})
    });

    if (!response.ok) {
      const text = await response.text();
      throw new MessagingProviderError({
        providerKey: this.providerKey,
        status: "provider_error",
        message: `Meta WhatsApp Cloud API request failed with HTTP ${response.status}.`,
        details: { status: response.status, responseText: text.slice(0, 500) }
      });
    }

    return response.json();
  }

  sendResultFromResponse(
    response: unknown,
    input: { messageRequestId: string; idempotencyKey: string; correlationId: string },
    health: ProviderHealth
  ): MessagingSendResult {
    const entity = objectRecord(response, "Meta WhatsApp send response");
    const messages = arrayMaybe(entity.messages);
    const message = messages.length > 0 ? objectRecord(messages[0], "Meta WhatsApp message") : null;
    const providerMessageId = nullableString(message?.id);
    if (!providerMessageId) {
      throw new MessagingProviderError({
        providerKey: this.providerKey,
        status: "provider_error",
        message: "Meta WhatsApp Cloud send response did not include a provider message id.",
        details: { rawProviderResponse: entity }
      });
    }
    const contact = firstRecord(arrayMaybe(entity.contacts));

    return {
      providerKey: this.providerKey,
      providerMessageId,
      providerRequestId: input.messageRequestId,
      toWaId: nullableString(contact?.wa_id),
      status: "sent_to_provider",
      providerStatus: nullableString(message?.message_status),
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
      providerHealth: health,
      rawProviderResponse: entity
    };
  }
}

export class UnavailableMessagingProvider implements MessagingProvider {
  readonly providerKey: MessagingProviderKey;
  readonly #message: string;
  readonly #status: "not_configured" | "unavailable";

  constructor(options: UnavailableMessagingProviderOptions) {
    this.providerKey = options.providerKey;
    this.#message = options.message;
    this.#status = options.status ?? "not_configured";
  }

  capabilities(): readonly AdapterCapability[] {
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerKey: this.providerKey,
      status: this.#status,
      checkedAt: new Date().toISOString(),
      capabilities: [],
      message: this.#message
    };
  }

  async sendTemplateMessage(): Promise<MessagingSendResult> {
    throw this.error();
  }

  async sendFreeformMessage(): Promise<MessagingSendResult> {
    throw this.error();
  }

  async sendMediaMessage(): Promise<MessagingSendResult> {
    throw this.error();
  }

  async verifyWebhookChallenge(): Promise<MessagingChallengeVerificationResult> {
    return {
      status: "not_configured",
      providerKey: this.providerKey,
      challenge: null,
      message: this.#message
    };
  }

  async verifyWebhook(raw: RawMessagingWebhook): Promise<MessagingWebhookVerificationResult> {
    return {
      status: "not_configured",
      providerKey: this.providerKey,
      signatureHeader: header(raw.headers, "x-hub-signature-256"),
      rawBodySha256: sha256Hex(raw.rawBody),
      message: this.#message
    };
  }

  async parseInboundWebhook(
    raw: RawMessagingWebhook
  ): Promise<readonly NormalizedWhatsAppInboundMessage[]> {
    const parsed = parseWhatsAppWebhook(raw);
    return parsed.inbound;
  }

  async parseStatusWebhook(
    raw: RawMessagingWebhook
  ): Promise<readonly NormalizedWhatsAppStatusEvent[]> {
    const parsed = parseWhatsAppWebhook(raw);
    return parsed.statuses;
  }

  async parseWebhook(raw: RawMessagingWebhook): Promise<readonly NormalizedWhatsAppWebhookEvent[]> {
    const parsed = parseWhatsAppWebhook(raw);
    return [...parsed.inbound, ...parsed.statuses];
  }

  normalizeTemplate(input: Record<string, unknown>): ProviderMessageTemplateSnapshot {
    return normalizeMetaTemplate(input);
  }

  error(): MessagingProviderError {
    return new MessagingProviderError({
      providerKey: this.providerKey,
      status: this.#status,
      message: this.#message
    });
  }
}

export function createMessagingProvider(input: CreateMessagingProviderInput): MessagingProvider {
  if (input.provider === "meta_cloud") {
    return new MetaWhatsAppCloudProvider({
      accessToken: input.accessToken,
      businessAccountId: input.businessAccountId,
      phoneNumberId: input.phoneNumberId,
      webhookVerifyToken: input.webhookVerifyToken,
      appSecret: input.appSecret,
      signatureVerificationRequired: input.appSecretProofRequired ?? true,
      templateNamespace: input.templateNamespace,
      fetch: input.fetch,
      allowLiveMetaApiCalls: input.allowLiveMetaApiCalls,
      liveHealthCheckEnabled: input.liveHealthCheckEnabled
    });
  }

  if (input.provider === "simulator") {
    return new UnavailableMessagingProvider({
      providerKey: "simulator",
      status: "unavailable",
      message:
        "WHATSAPP_PROVIDER=simulator is not accepted as a production messaging provider. Use Meta Cloud, an approved BSP adapter, or unconfigured unavailable state."
    });
  }

  if (["gupshup", "wati", "interakt"].includes(input.provider)) {
    return new UnavailableMessagingProvider({
      providerKey: "whatsapp_bsp",
      status: "unavailable",
      message:
        "WhatsApp BSP adapters are not implemented in CP7; configure Meta Cloud or keep messaging unavailable."
    });
  }

  return new UnavailableMessagingProvider({
    providerKey: "unconfigured",
    status: "not_configured",
    message: "WhatsApp messaging provider is not configured."
  });
}

export function signMetaWebhook(rawBody: string, appSecret: string): string {
  return `sha256=${hmacSha256Hex(appSecret, rawBody)}`;
}

export function normalizeMetaTemplate(
  input: Record<string, unknown>
): ProviderMessageTemplateSnapshot {
  const category = normalizeTemplateCategory(nullableString(input.category));
  const providerStatus = stringValue(input.status, "status");
  const name = stringValue(input.name, "name");
  const components = arrayMaybe(input.components).map((component) => {
    const record = objectRecord(component, "Meta WhatsApp template component");
    const buttons = arrayMaybe(record.buttons).map((button) =>
      objectRecord(button, "template button")
    );
    const normalized: ProviderMessageTemplateComponent = {
      type: stringValue(record.type, "component.type"),
      ...(nullableString(record.format) ? { format: nullableString(record.format) } : {}),
      ...(nullableString(record.text) ? { text: nullableString(record.text) } : {}),
      ...(buttons.length > 0 ? { buttons } : {})
    };
    return normalized;
  });

  return {
    providerKey: "whatsapp_cloud",
    providerTemplateId: nullableString(input.id),
    name,
    languageCode: stringValue(input.language, "language"),
    category,
    lifecycleState: templateLifecycleFromMetaStatus(providerStatus),
    providerStatus,
    rejectionReason: nullableString(input.rejected_reason) ?? nullableString(input.reason),
    previousTemplateName: nullableString(input.previous_category),
    components,
    rawProviderPayload: input
  };
}

async function defaultMessagingFetch(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  }
): Promise<MessagingProviderHttpResponse> {
  return fetch(url, init);
}

function parseWhatsAppWebhook(raw: RawMessagingWebhook): {
  readonly inbound: readonly NormalizedWhatsAppInboundMessage[];
  readonly statuses: readonly NormalizedWhatsAppStatusEvent[];
} {
  const payload = parseJsonObject(raw.rawBody, "Meta WhatsApp webhook payload");
  const entries = arrayMaybe(payload.entry);
  const inbound: NormalizedWhatsAppInboundMessage[] = [];
  const statuses: NormalizedWhatsAppStatusEvent[] = [];
  const rawBodySha256 = sha256Hex(raw.rawBody);
  const correlationId = correlationIdFromRaw(raw, rawBodySha256);

  for (const entry of entries) {
    const entryRecord = objectRecord(entry, "Meta WhatsApp webhook entry");
    const entryId = nullableString(entryRecord.id);
    const changes = arrayMaybe(entryRecord.changes);
    changes.forEach((change, changeIndex) => {
      const changeRecord = objectRecord(change, "Meta WhatsApp webhook change");
      const value = objectMaybe(changeRecord.value);
      if (!value) return;
      const metadata = objectMaybe(value.metadata);
      const phoneNumberId = nullableString(metadata?.phone_number_id);
      const contacts = arrayMaybe(value.contacts).map((contact) =>
        objectRecord(contact, "Meta WhatsApp contact")
      );
      const contactsByWaId = new Map(
        contacts
          .map((contact) => [nullableString(contact.wa_id), contact] as const)
          .filter((entry): entry is readonly [string, Record<string, unknown>] => Boolean(entry[0]))
      );

      arrayMaybe(value.messages).forEach((message, eventIndex) => {
        const messageRecord = objectRecord(message, "Meta WhatsApp inbound message");
        const providerMessageId = stringValue(messageRecord.id, "message.id");
        const fromWaId = stringValue(messageRecord.from, "message.from");
        const contact = contactsByWaId.get(fromWaId);
        const profile = objectMaybe(contact?.profile);

        inbound.push({
          providerKey: "whatsapp_cloud",
          eventKind: "inbound_message",
          providerMessageId,
          idempotencyKey: `whatsapp_cloud:inbound:${providerMessageId}`,
          correlationId,
          occurredAt: whatsappTimestampToIso(messageRecord.timestamp, raw.receivedAt),
          fromWaId,
          fromPhoneE164: waIdToE164(fromWaId),
          patientDisplayName: nullableString(profile?.name),
          phoneNumberId,
          businessAccountId: entryId,
          messageType: inboundMessageType(messageRecord.type),
          textBody: textBodyFromMessage(messageRecord),
          providerContextMessageId: nullableString(objectMaybe(messageRecord.context)?.id),
          media: mediaFromMessage(messageRecord),
          rawPayloadReference: {
            rawEventId: raw.rawEventId ?? null,
            rawBodySha256,
            businessAccountId: entryId,
            phoneNumberId,
            entryId,
            changeIndex,
            eventIndex
          },
          rawProviderPayload: messageRecord
        });
      });

      arrayMaybe(value.statuses).forEach((status, eventIndex) => {
        const statusRecord = objectRecord(status, "Meta WhatsApp message status");
        const providerMessageId = stringValue(statusRecord.id, "status.id");
        const providerStatus = stringValue(statusRecord.status, "status.status");
        const firstError = firstRecord(arrayMaybe(statusRecord.errors));
        const normalizedStatus = messageLifecycleFromMetaStatus(providerStatus, firstError);
        const errorCode = nullableString(firstError?.code);
        const occurredAt = whatsappTimestampToIso(statusRecord.timestamp, raw.receivedAt);

        statuses.push({
          providerKey: "whatsapp_cloud",
          eventKind: "message_status",
          providerMessageId,
          idempotencyKey: [
            "whatsapp_cloud:status",
            providerMessageId,
            providerStatus,
            statusRecord.timestamp ?? occurredAt,
            errorCode ?? ""
          ].join(":"),
          correlationId,
          occurredAt,
          recipientWaId: nullableString(statusRecord.recipient_id),
          phoneNumberId,
          businessAccountId: entryId,
          status: normalizedStatus,
          providerStatus,
          conversationId: nullableString(objectMaybe(statusRecord.conversation)?.id),
          pricingCategory: nullableString(objectMaybe(statusRecord.pricing)?.category),
          failureReason: failureReasonFromStatus(providerStatus, firstError),
          rawPayloadReference: {
            rawEventId: raw.rawEventId ?? null,
            rawBodySha256,
            businessAccountId: entryId,
            phoneNumberId,
            entryId,
            changeIndex,
            eventIndex
          },
          rawProviderPayload: statusRecord
        });
      });
    });
  }

  return { inbound, statuses };
}

function assertTemplateCanSend(template: SendTemplateMessageInput["template"]): void {
  if (template.lifecycleState !== "approved") {
    throw new MessagingProviderError({
      providerKey: "whatsapp_cloud",
      status: "policy_blocked",
      message: `WhatsApp template ${template.name} is ${template.lifecycleState}; only approved templates may be sent.`
    });
  }
}

function assertMessagingPolicyAllowed(
  recipient: MessagingRecipient,
  policy: MessagingSendPolicy,
  now: () => Date
): void {
  if (recipient.consent.whatsapp === "opted_out" && !policy.essentialOverride) {
    throw new MessagingProviderError({
      providerKey: "whatsapp_cloud",
      status: "policy_blocked",
      message:
        "Recipient has opted out of WhatsApp messaging; provider send is blocked before calling Meta.",
      details: {
        optedOutAt: recipient.consent.optedOutAt ?? null,
        optOutReason: recipient.consent.optOutReason ?? null,
        purpose: policy.purpose
      }
    });
  }

  if (
    recipient.consent.whatsapp === "unknown" &&
    policy.businessInitiated &&
    !policy.essentialOverride
  ) {
    throw new MessagingProviderError({
      providerKey: "whatsapp_cloud",
      status: "policy_blocked",
      message:
        "Business-initiated WhatsApp messages require recorded opt-in or an explicit essential override."
    });
  }

  if (policy.essentialOverride) {
    if (
      !policy.essentialOverride.reason.trim() ||
      !policy.essentialOverride.approvedByUserId.trim()
    ) {
      throw new MessagingProviderError({
        providerKey: "whatsapp_cloud",
        status: "policy_blocked",
        message: "Essential WhatsApp override requires a reason and approving user id."
      });
    }
    if (policy.purpose === "marketing" || policy.purpose === "recall") {
      throw new MessagingProviderError({
        providerKey: "whatsapp_cloud",
        status: "policy_blocked",
        message:
          "Marketing and recall messages cannot bypass WhatsApp opt-out with an essential override."
      });
    }
  }

  const checkedAt = now();
  if (Number.isNaN(checkedAt.getTime())) {
    throw new MessagingProviderError({
      providerKey: "whatsapp_cloud",
      status: "policy_blocked",
      message: "Messaging policy clock returned an invalid timestamp."
    });
  }
}

function assertOpenConversationWindow(policy: MessagingSendPolicy, now: () => Date): void {
  if (policy.businessInitiated) return;
  const expiresAt = policy.conversationWindowExpiresAt
    ? new Date(policy.conversationWindowExpiresAt)
    : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now().getTime()) {
    throw new MessagingProviderError({
      providerKey: "whatsapp_cloud",
      status: "conversation_window_closed",
      message:
        "WhatsApp freeform/media messages require an open customer service conversation window."
    });
  }
}

function templateSendComponentToMeta(
  component: WhatsAppTemplateSendComponent
): Record<string, unknown> {
  if (component.type === "button") {
    return {
      type: "button",
      sub_type: component.subType,
      index: component.index,
      parameters: component.parameters.map(templateParameterToMeta)
    };
  }
  return {
    type: component.type,
    parameters: component.parameters.map(templateParameterToMeta)
  };
}

function templateParameterToMeta(parameter: WhatsAppTemplateParameter): Record<string, unknown> {
  if (parameter.type === "currency") {
    return {
      type: "currency",
      currency: {
        fallback_value: parameter.currency.fallbackValue,
        code: parameter.currency.code,
        amount_1000: parameter.currency.amount1000
      }
    };
  }
  if (parameter.type === "date_time") {
    return {
      type: "date_time",
      date_time: {
        fallback_value: parameter.dateTime.fallbackValue
      }
    };
  }
  if (parameter.type === "payload") {
    return {
      type: "payload",
      payload: parameter.payload
    };
  }
  if (parameter.type === "text") {
    return {
      type: "text",
      text: parameter.text
    };
  }
  return {
    type: parameter.type,
    [parameter.type]: parameter.media
  };
}

function opaqueCallbackData(input: {
  tenantId: string;
  clinicId: string;
  messageRequestId: string;
  idempotencyKey: string;
  correlationId: string;
}): string {
  const value = JSON.stringify({
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    messageRequestId: input.messageRequestId,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId
  });
  return value.length <= 512 ? value : value.slice(0, 512);
}

function whatsappTo(phoneE164: string): string {
  return phoneE164.replace(/[^\d]/g, "");
}

function messageLifecycleFromMetaStatus(
  providerStatus: string,
  firstError?: Record<string, unknown> | null
): MessageLifecycleState {
  const normalized = providerStatus.toLowerCase();
  if (normalized === "sent") return "sent_to_provider";
  if (normalized === "delivered") return "delivered";
  if (normalized === "read") return "read";
  if (normalized === "failed" || firstError) return "failed";
  if (normalized === "deleted") return "cancelled";
  return "requires_human_review";
}

function templateLifecycleFromMetaStatus(providerStatus: string): MessageTemplateLifecycleState {
  const normalized = providerStatus.toUpperCase();
  if (normalized === "APPROVED") return "approved";
  if (normalized === "REJECTED") return "rejected";
  if (normalized === "PAUSED") return "paused";
  if (normalized === "DISABLED") return "disabled";
  if (["PENDING", "IN_APPEAL", "PENDING_DELETION"].includes(normalized)) return "submitted";
  if (["DELETED", "ARCHIVED"].includes(normalized)) return "superseded";
  return "submitted";
}

function normalizeTemplateCategory(category: string | null): WhatsAppTemplateCategory {
  const normalized = category?.toUpperCase();
  if (normalized === "MARKETING") return "marketing";
  if (normalized === "AUTHENTICATION") return "authentication";
  return "utility";
}

function failureReasonFromStatus(
  providerStatus: string,
  firstError?: Record<string, unknown> | null
): MessagingFailureReason | null {
  if (providerStatus.toLowerCase() !== "failed" && !firstError) return null;
  const code = nullableString(firstError?.code);
  const title = nullableString(firstError?.title);
  const details = nullableString(objectMaybe(firstError?.error_data)?.details);
  const message =
    nullableString(firstError?.message) ??
    details ??
    title ??
    "WhatsApp provider reported message delivery failure.";
  return {
    code,
    title,
    message,
    details,
    retryable: isRetryableWhatsAppError(code)
  };
}

function isRetryableWhatsAppError(code?: string | null): boolean {
  if (!code) return true;
  return !new Set(["131026", "131047", "131051", "132000", "132001", "132005"]).has(code);
}

function inboundMessageType(type: unknown): WhatsAppInboundMessageType {
  if (typeof type !== "string") return "unknown";
  const normalized = type.toLowerCase();
  if (
    [
      "text",
      "image",
      "document",
      "audio",
      "video",
      "sticker",
      "location",
      "contacts",
      "button",
      "interactive",
      "reaction"
    ].includes(normalized)
  ) {
    return normalized as WhatsAppInboundMessageType;
  }
  return "unknown";
}

function textBodyFromMessage(message: Record<string, unknown>): string | null {
  const type = inboundMessageType(message.type);
  if (type === "text") return nullableString(objectMaybe(message.text)?.body);
  if (type === "button") return nullableString(objectMaybe(message.button)?.text);
  if (type === "interactive") {
    const interactive = objectMaybe(message.interactive);
    const buttonReply = objectMaybe(interactive?.button_reply);
    const listReply = objectMaybe(interactive?.list_reply);
    return nullableString(buttonReply?.title) ?? nullableString(listReply?.title);
  }
  if (type === "reaction") return nullableString(objectMaybe(message.reaction)?.emoji);
  return null;
}

function mediaFromMessage(
  message: Record<string, unknown>
): NormalizedWhatsAppInboundMessage["media"] {
  for (const key of MESSAGE_TYPE_KEYS) {
    const media = objectMaybe(message[key]);
    if (!media) continue;
    return {
      providerMediaId: nullableString(media.id),
      mimeType: nullableString(media.mime_type),
      sha256: nullableString(media.sha256),
      caption: nullableString(media.caption),
      filename: nullableString(media.filename)
    };
  }
  return null;
}

function waIdToE164(waId: string): string | null {
  const digits = waId.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `+${digits}`;
}

function whatsappTimestampToIso(value: unknown, fallback: string): string {
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return new Date(Number(value) * 1000).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString();
  }
  return fallback;
}

function correlationIdFromRaw(raw: RawMessagingWebhook, rawBodySha256: string): string {
  return (
    raw.correlationId ??
    header(raw.headers, "x-clinic-os-correlation-id") ??
    header(raw.headers, "x-request-id") ??
    `whatsapp-${rawBodySha256.slice(0, 16)}`
  );
}

function parseJsonObject(rawBody: string, label: string): Record<string, unknown> {
  try {
    return objectRecord(JSON.parse(rawBody), label);
  } catch (error) {
    if (error instanceof MessagingProviderError) throw error;
    throw new MessagingProviderError({
      providerKey: "whatsapp_cloud",
      status: "verification_failed",
      message: `${label} must be valid JSON.`
    });
  }
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MessagingProviderError({
      providerKey: "whatsapp_cloud",
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

function arrayMaybe(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstRecord(value: readonly unknown[]): Record<string, unknown> | null {
  if (value.length === 0) return null;
  return objectRecord(value[0], "first provider payload item");
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MessagingProviderError({
      providerKey: "whatsapp_cloud",
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

function timingSafeStringEqual(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.byteLength !== receivedBuffer.byteLength) return false;
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}
