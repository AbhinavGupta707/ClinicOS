import { MetaWhatsAppError } from "./errors.js";
import type {
  MetaEncryptedRawBodyStore,
  MetaPersistVerifiedResult,
  MetaRawWebhookInput,
  MetaWebhookPersistence
} from "./types.js";
import { MetaWebhookBoundary } from "./webhook.js";
import type { MetaTemplateSendResult } from "./client.js";

export interface MetaWebhookServiceOptions {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly externalAccountId: string;
  readonly expectedBusinessAccountId: string;
  readonly expectedPhoneNumberId: string;
  readonly boundary: MetaWebhookBoundary;
  readonly rawBodyStore: MetaEncryptedRawBodyStore;
  readonly persistence: MetaWebhookPersistence;
}

export class MetaWebhookService {
  readonly #tenantId: string;
  readonly #clinicId: string;
  readonly #externalAccountId: string;
  readonly #expectedBusinessAccountId: string;
  readonly #expectedPhoneNumberId: string;
  readonly #boundary: MetaWebhookBoundary;
  readonly #rawBodyStore: MetaEncryptedRawBodyStore;
  readonly #persistence: MetaWebhookPersistence;

  constructor(options: MetaWebhookServiceOptions) {
    this.#tenantId = required(options.tenantId, "tenantId");
    this.#clinicId = required(options.clinicId, "clinicId");
    this.#externalAccountId = required(options.externalAccountId, "externalAccountId");
    this.#expectedBusinessAccountId = numericProviderId(
      options.expectedBusinessAccountId,
      "expectedBusinessAccountId"
    );
    this.#expectedPhoneNumberId = numericProviderId(
      options.expectedPhoneNumberId,
      "expectedPhoneNumberId"
    );
    this.#boundary = options.boundary;
    this.#rawBodyStore = options.rawBodyStore;
    this.#persistence = options.persistence;
  }

  verifyChallenge(input: { readonly mode: string | null; readonly verifyToken: string | null; readonly challenge: string | null }): string {
    return this.#boundary.verifyChallenge(input);
  }

  async processWebhook(input: MetaRawWebhookInput): Promise<MetaPersistVerifiedResult> {
    const verified = this.#boundary.verifyAndNormalize(input);
    for (const event of verified.events) {
      if (event.businessAccountId !== this.#expectedBusinessAccountId) {
        throw accountMismatch();
      }
      if (
        (event.kind === "inbound_message" || event.kind === "message_status") &&
        event.phoneNumberId !== this.#expectedPhoneNumberId
      ) {
        throw accountMismatch();
      }
    }
    const rawEventId = `meta_raw_${verified.rawBodySha256}`;
    const stored = await this.#rawBodyStore.put({
      tenantId: this.#tenantId,
      clinicId: this.#clinicId,
      rawEventId,
      bytes: input.rawBody,
      sha256: verified.rawBodySha256,
      retentionClass: "provider_webhook_restricted"
    });
    try {
      return await this.#persistence.persistVerified({
        tenantId: this.#tenantId,
        clinicId: this.#clinicId,
        externalAccountId: this.#externalAccountId,
        rawEventId,
        rawBodySha256: verified.rawBodySha256,
        rawBodyCiphertextRef: stored.ciphertextRef,
        receivedAt: verified.receivedAt,
        correlationId: verified.correlationId,
        events: verified.events.map((event) => ({ uniqueEventKey: event.uniqueEventKey, eventType: event.kind, occurredAt: event.occurredAt, payload: event })),
        audit: {
          action: "meta_whatsapp.webhook_verified",
          outcome: "accepted",
          eventCount: verified.events.length,
          rawBodySha256: verified.rawBodySha256
        },
        outbox: {
          topic: "provider.meta_whatsapp.webhook_verified",
          idempotencyKey: `meta:webhook:${verified.rawBodySha256}`
        }
      });
    } catch {
      try {
        await this.#rawBodyStore.deleteUncommitted({ ciphertextRef: stored.ciphertextRef, reason: "transaction_not_committed" });
      } catch {
        // The restricted store must have an orphan-reconciliation job; never hide the primary failure.
      }
      throw new MetaWhatsAppError({ code: "persistence_failed", message: "Verified Meta webhook could not be committed.", httpStatus: 503, retryable: true });
    }
  }
}

export interface MetaReconciliationPort {
  reconcile(input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly providerMessageId: string;
    readonly reason: "dispatch_ambiguous" | "unknown_status" | "conflicting_terminal_status" | "webhook_gap";
    readonly requestedAt: string;
    readonly correlationId: string;
  }): Promise<{ readonly outcome: "matched" | "difference" | "provider_unavailable" | "unsupported"; readonly observedStatus: string | null }>;
}

export interface MetaDispatchPersistence {
  recordDispatchOutcome(input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly externalAccountId: string;
    readonly messageRequestId: string;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly attemptedAt: string;
    readonly providerMessageId: string | null;
    readonly dispatchOutcome:
      | "not_dispatched"
      | "accepted_by_provider"
      | "dispatch_ambiguous"
      | "rejected";
    readonly state: "send_requested" | "accepted_by_provider";
    readonly automaticRetryAllowed: boolean;
    readonly nextRetryAt: string | null;
    readonly reconciliationReason: "dispatch_ambiguous" | null;
    readonly providerHttpStatus: number | null;
    readonly audit: {
      readonly action: "meta_whatsapp.dispatch_recorded";
      readonly outcome: "not_dispatched" | "accepted_by_provider" | "dispatch_ambiguous" | "rejected";
    };
    readonly outbox: {
      readonly topic:
        | "provider.meta_whatsapp.accepted"
        | "provider.meta_whatsapp.retry_requested"
        | "provider.meta_whatsapp.reconciliation_requested"
        | "provider.meta_whatsapp.rejected";
      readonly idempotencyKey: string;
    };
  }): Promise<{ readonly outcome: "committed" | "duplicate" }>;
}

export class MetaDispatchRecoveryService {
  readonly #tenantId: string;
  readonly #clinicId: string;
  readonly #externalAccountId: string;
  readonly #persistence: MetaDispatchPersistence;

  constructor(input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly externalAccountId: string;
    readonly persistence: MetaDispatchPersistence;
  }) {
    this.#tenantId = required(input.tenantId, "tenantId");
    this.#clinicId = required(input.clinicId, "clinicId");
    this.#externalAccountId = required(input.externalAccountId, "externalAccountId");
    this.#persistence = input.persistence;
  }

  async record(input: {
    readonly result: MetaTemplateSendResult;
    readonly attemptedAt: string;
    readonly nextRetryAt: string | null;
  }): Promise<{ readonly outcome: "committed" | "duplicate" }> {
    const attemptedAt = iso(input.attemptedAt, "attemptedAt");
    const result = input.result;
    const accepted = result.outcome === "accepted_by_provider";
    const ambiguous = result.outcome === "dispatch_ambiguous";
    const retry = result.outcome === "not_dispatched";
    const rejected = result.outcome === "rejected_by_provider";
    const nextRetryAt = retry ? iso(input.nextRetryAt, "nextRetryAt") : null;
    if (retry && Date.parse(nextRetryAt!) <= Date.parse(attemptedAt)) {
      throw new MetaWhatsAppError({ code: "persistence_failed", message: "Meta retry time must follow the dispatch attempt.", httpStatus: 500 });
    }
    if (!retry && input.nextRetryAt !== null) {
      throw new MetaWhatsAppError({ code: "persistence_failed", message: "Meta retry is forbidden for this dispatch outcome.", httpStatus: 500 });
    }
    const outcome = accepted
      ? "accepted_by_provider"
      : ambiguous
        ? "dispatch_ambiguous"
        : retry
          ? "not_dispatched"
          : "rejected";
    const topic = accepted
      ? "provider.meta_whatsapp.accepted"
      : ambiguous
        ? "provider.meta_whatsapp.reconciliation_requested"
        : retry
          ? "provider.meta_whatsapp.retry_requested"
          : "provider.meta_whatsapp.rejected";
    return this.#persistence.recordDispatchOutcome({
      tenantId: this.#tenantId,
      clinicId: this.#clinicId,
      externalAccountId: this.#externalAccountId,
      messageRequestId: result.messageRequestId,
      idempotencyKey: result.idempotencyKey,
      correlationId: result.correlationId,
      attemptedAt,
      providerMessageId: result.providerMessageId,
      dispatchOutcome: outcome,
      state: accepted ? "accepted_by_provider" : "send_requested",
      automaticRetryAllowed: retry,
      nextRetryAt,
      reconciliationReason: ambiguous ? "dispatch_ambiguous" : null,
      providerHttpStatus: rejected ? result.providerHttpStatus : null,
      audit: { action: "meta_whatsapp.dispatch_recorded", outcome },
      outbox: { topic, idempotencyKey: `meta:dispatch:${result.idempotencyKey}:${outcome}` }
    });
  }
}

function required(value: string, field: string): string {
  if (!value || value.length > 512) throw new MetaWhatsAppError({ code: "not_configured", message: `Meta ${field} is not configured.`, httpStatus: 503 });
  return value;
}

function numericProviderId(value: string, field: string): string {
  if (!/^[1-9]\d{5,31}$/u.test(value)) {
    throw new MetaWhatsAppError({
      code: "not_configured",
      message: `Meta ${field} is not configured.`,
      httpStatus: 503
    });
  }
  return value;
}

function accountMismatch(): MetaWhatsAppError {
  return new MetaWhatsAppError({
    code: "account_mismatch",
    message: "Signed Meta webhook does not match the registered provider account.",
    httpStatus: 403
  });
}

function iso(value: string | null, field: string): string {
  const timestamp = value === null ? Number.NaN : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new MetaWhatsAppError({ code: "persistence_failed", message: `Meta ${field} is invalid.`, httpStatus: 500 });
  }
  return new Date(timestamp).toISOString();
}
