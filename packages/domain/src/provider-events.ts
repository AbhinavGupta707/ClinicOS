import type { UUID } from "./ids.ts";

export const INTEGRATION_PROVIDER_KEYS = [
  "meta_whatsapp_cloud",
  "razorpay",
  "telephony",
  "google_business_profile",
  "practo",
  "manual_import"
] as const;

export type IntegrationProviderKey = (typeof INTEGRATION_PROVIDER_KEYS)[number] | string;

export const INTEGRATION_EVENT_STATUSES = [
  "received",
  "verified",
  "normalization_failed",
  "normalized",
  "applied",
  "dead_lettered",
  "replayed"
] as const;

export type IntegrationEventStatus = (typeof INTEGRATION_EVENT_STATUSES)[number];

export const INTEGRATION_DEAD_LETTER_STATUSES = [
  "open",
  "retry_scheduled",
  "replayed",
  "resolved",
  "discarded"
] as const;

export type IntegrationDeadLetterStatus = (typeof INTEGRATION_DEAD_LETTER_STATUSES)[number];

export interface ExternalSystemRecord {
  id: UUID;
  tenantId: UUID;
  providerKey: IntegrationProviderKey;
  displayName: string;
  status: "available" | "degraded" | "unavailable" | "not_configured";
  createdAt: string;
  updatedAt: string;
}

export interface ExternalAccountRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID | null;
  externalSystemId: UUID;
  accountType: string;
  status: "available" | "degraded" | "unavailable" | "not_configured";
  capabilityKeys: string[];
  credentialRef: string | null;
  lastHealthCheckAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RawProviderEventRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID | null;
  providerKey: IntegrationProviderKey;
  externalAccountId: UUID | null;
  eventType: string;
  providerEventId: string | null;
  idempotencyKey: string;
  verificationStatus: "unverified" | "verified" | "failed";
  processingStatus: IntegrationEventStatus;
  rawPayloadDigest: string;
  rawPayloadRef: {
    eventId: UUID;
    digest: string;
    retained: true;
  };
  receivedAt: string;
  processedAt: string | null;
}

export interface NormalizedIntegrationEventRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID | null;
  rawEventId: UUID;
  eventType: string;
  aggregateType: string | null;
  aggregateId: UUID | null;
  patientId: UUID | null;
  normalizedPayload: Record<string, unknown>;
  status: IntegrationEventStatus;
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationDeadLetterRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID | null;
  rawEventId: UUID | null;
  normalizedEventId: UUID | null;
  providerKey: IntegrationProviderKey;
  failureStage: "verification" | "normalization" | "domain_command" | "outbox" | "workflow";
  failureCode: string;
  failureSummary: string;
  retryCount: number;
  nextRetryAt: string | null;
  status: IntegrationDeadLetterStatus;
  lastErrorDigest: string | null;
  createdAt: string;
  updatedAt: string;
}

export function rawProviderEventPublicRef(input: {
  id: UUID;
  rawPayloadDigest: string;
}): RawProviderEventRecord["rawPayloadRef"] {
  return {
    eventId: input.id,
    digest: input.rawPayloadDigest,
    retained: true
  };
}
