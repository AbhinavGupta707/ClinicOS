export type ProviderKey =
  | "whatsapp_cloud"
  | "whatsapp_bsp"
  | "razorpay"
  | "exotel"
  | "google_business"
  | "practo"
  | "manual_import"
  | "abdm"
  | "ai_gateway";

export type AdapterCapability =
  | "READ_PATIENTS"
  | "READ_APPOINTMENTS"
  | "WRITE_APPOINTMENTS"
  | "RECEIVE_WEBHOOKS"
  | "SEND_MESSAGES"
  | "CREATE_PAYMENT_QR"
  | "CREATE_PAYMENT_LINKS"
  | "FETCH_PAYMENT_STATUS"
  | "VERIFY_WEBHOOKS"
  | "FETCH_CALL_RECORDING"
  | "IMPORT_DOCUMENTS"
  | "EXPORT_ACCOUNTING_LEDGER";

export type SourceOfTruthMode =
  | "clinic_os_primary"
  | "external_primary_readonly"
  | "dual_run"
  | "archive_only";

export type ProviderHealthStatus = "available" | "degraded" | "unavailable" | "not_configured";

export interface ProviderHealth {
  readonly providerKey: ProviderKey | string;
  readonly accountId?: string;
  readonly status: ProviderHealthStatus;
  readonly checkedAt: string;
  readonly capabilities: readonly AdapterCapability[];
  readonly message?: string;
  readonly latencyMs?: number;
  readonly correlationId?: string;
}

export interface RawWebhookEvent {
  readonly rawEventId: string;
  readonly providerKey: ProviderKey | string;
  readonly accountId: string;
  readonly receivedAt: string;
  readonly headers: Record<string, string>;
  readonly rawBody: string;
  readonly correlationId: string;
}

export interface NormalizedExternalEvent {
  readonly eventType: string;
  readonly schemaVersion: string;
  readonly tenantId: string;
  readonly clinicId?: string;
  readonly aggregateType?: string;
  readonly aggregateId?: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly source: {
    readonly kind: "external_system" | "manual_import" | "system";
    readonly providerKey: ProviderKey | string;
    readonly externalRef?: string;
    readonly rawEventId?: string;
  };
  readonly payload: Record<string, unknown>;
  readonly occurredAt: string;
}

export interface ImportRequest {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly accountId: string;
  readonly requestedByUserId: string;
  readonly sourceOfTruthMode: SourceOfTruthMode;
  readonly correlationId: string;
}

export interface ImportBatchResult {
  readonly batchId: string;
  readonly acceptedRows: number;
  readonly rejectedRows: number;
  readonly conflictRows: number;
  readonly correlationId: string;
}

export interface ApprovedExternalAction {
  readonly actionId: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly providerKey: ProviderKey | string;
  readonly actionType: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly approvedByUserId: string;
  readonly payload: Record<string, unknown>;
}

export interface ExternalActionResult {
  readonly actionId: string;
  readonly providerKey: ProviderKey | string;
  readonly status: "accepted" | "succeeded" | "failed";
  readonly externalRef?: string;
  readonly correlationId: string;
  readonly details?: Record<string, unknown>;
}

export interface ExternalAdapter {
  readonly providerKey: ProviderKey | string;
  capabilities(): readonly AdapterCapability[];
  healthCheck(accountId?: string): Promise<ProviderHealth>;
  importBatch?(request: ImportRequest): Promise<ImportBatchResult>;
  handleWebhook?(event: RawWebhookEvent): Promise<readonly NormalizedExternalEvent[]>;
  pushAction?(action: ApprovedExternalAction): Promise<ExternalActionResult>;
}
