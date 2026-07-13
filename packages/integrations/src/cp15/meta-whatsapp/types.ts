export type MetaNormalizedStatus = "sent" | "delivered" | "read" | "failed" | "deleted" | "unknown";
export type MetaTemplateLifecycle = "pending" | "approved" | "rejected" | "paused" | "disabled" | "deleted" | "unknown";

export interface MetaRawWebhookInput {
  readonly rawBody: Uint8Array;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly receivedAt: string;
  readonly correlationId: string;
}

export interface MetaRawReference {
  readonly rawBodySha256: string;
  readonly entryIndex: number;
  readonly changeIndex: number;
  readonly itemIndex: number;
}

export interface MetaInboundEvent {
  readonly kind: "inbound_message";
  readonly uniqueEventKey: string;
  readonly providerMessageId: string;
  readonly businessAccountId: string;
  readonly phoneNumberId: string;
  readonly senderWaId: string;
  readonly occurredAt: string;
  readonly messageType: string;
  readonly text: string | null;
  readonly media: {
    readonly providerMediaId: string;
    readonly mimeType: string | null;
    readonly sha256: string | null;
  } | null;
  readonly consentCommand: "opt_out" | "opt_in_request" | "none";
  readonly serviceWindowExpiresAt: string;
  readonly rawReference: MetaRawReference;
}

export interface MetaStatusEvent {
  readonly kind: "message_status";
  readonly uniqueEventKey: string;
  readonly providerMessageId: string;
  readonly businessAccountId: string;
  readonly phoneNumberId: string;
  readonly occurredAt: string;
  readonly providerStatus: string;
  readonly status: MetaNormalizedStatus;
  readonly recipientWaId: string | null;
  readonly error: {
    readonly code: string | null;
    readonly retryable: boolean;
    readonly safeCategory: "rate_limited" | "authentication" | "recipient" | "template" | "provider" | "unknown";
  } | null;
  readonly rawReference: MetaRawReference;
}

export interface MetaTemplateEvent {
  readonly kind: "template_lifecycle";
  readonly uniqueEventKey: string;
  readonly businessAccountId: string;
  readonly providerTemplateId: string;
  readonly templateName: string;
  readonly languageCode: string;
  readonly providerEvent: string;
  readonly lifecycle: MetaTemplateLifecycle;
  readonly occurredAt: string;
  readonly rawReference: MetaRawReference;
}

export interface MetaUnsupportedChangeEvent {
  readonly kind: "unsupported_change";
  readonly uniqueEventKey: string;
  readonly businessAccountId: string;
  readonly field: string;
  readonly occurredAt: string;
  readonly reconciliationRequired: true;
  readonly rawReference: MetaRawReference;
}

export type MetaNormalizedEvent =
  | MetaInboundEvent
  | MetaStatusEvent
  | MetaTemplateEvent
  | MetaUnsupportedChangeEvent;

export interface VerifiedMetaWebhook {
  readonly provider: "meta_whatsapp_cloud";
  readonly verification: "x_hub_signature_256";
  readonly rawBodySha256: string;
  readonly signatureSha256: string;
  readonly normalizedEventSha256: string;
  readonly verifiedSecretVersion: string;
  readonly verifiedWithPreviousSecret: boolean;
  readonly byteLength: number;
  readonly receivedAt: string;
  readonly correlationId: string;
  readonly events: readonly MetaNormalizedEvent[];
}

export interface MetaPersistenceEvent {
  readonly uniqueEventKey: string;
  readonly eventType: MetaNormalizedEvent["kind"];
  readonly occurredAt: string;
  readonly payload: MetaNormalizedEvent;
}

export interface MetaPersistVerifiedInput {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly externalAccountId: string;
  readonly rawEventId: string;
  readonly rawBodySha256: string;
  readonly signatureSha256: string;
  readonly normalizedEventSha256: string;
  readonly verifiedSecretVersion: string;
  readonly verifiedWithPreviousSecret: boolean;
  readonly rawBodyByteLength: number;
  readonly rawBodyCiphertextRef: string;
  readonly receivedAt: string;
  readonly correlationId: string;
  readonly events: readonly MetaPersistenceEvent[];
  readonly audit: {
    readonly action: "meta_whatsapp.webhook_verified";
    readonly outcome: "accepted";
    readonly eventCount: number;
    readonly rawBodySha256: string;
  };
  readonly outbox: {
    readonly topic: "provider.meta_whatsapp.webhook_verified";
    readonly idempotencyKey: string;
  };
}

export interface MetaPersistVerifiedResult {
  readonly outcome: "committed" | "duplicate";
  readonly rawEventId: string;
  readonly acceptedEventKeys: readonly string[];
  readonly duplicateEventKeys: readonly string[];
}

/** Implemented by the DB adapter as one tenant-scoped transaction with audit and outbox. */
export interface MetaWebhookPersistence {
  persistVerified(input: MetaPersistVerifiedInput): Promise<MetaPersistVerifiedResult>;
}

export interface MetaEncryptedRawBodyStore {
  put(input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly rawEventId: string;
    readonly bytes: Uint8Array;
    readonly sha256: string;
    readonly retentionClass: "provider_webhook_restricted";
  }): Promise<{ readonly ciphertextRef: string }>;
  deleteUncommitted(input: { readonly ciphertextRef: string; readonly reason: string }): Promise<void>;
}

export interface MetaEvidenceSummary {
  readonly provider: "meta_whatsapp_cloud";
  readonly rawBodySha256: string;
  readonly byteLength: number;
  readonly eventCounts: Readonly<Record<MetaNormalizedEvent["kind"], number>>;
  readonly eventKeyDigests: readonly string[];
}
