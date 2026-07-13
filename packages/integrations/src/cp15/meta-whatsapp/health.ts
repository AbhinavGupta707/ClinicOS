export type MetaProviderActivation = "absent" | "registered" | "configured" | "sandbox_verified" | "production_verified" | "degraded" | "disabled";

export interface MetaProviderHealth {
  readonly provider: "meta_whatsapp_cloud";
  readonly activation: MetaProviderActivation;
  readonly operational: boolean;
  readonly checkedAt: string;
  readonly reasonCode: string;
  readonly lastOfficialVerificationAt: string | null;
  readonly capabilities: readonly ("verify_webhook" | "receive_messages" | "receive_status" | "send_templates" | "reconcile")[];
}

export function deriveMetaProviderHealth(input: {
  readonly enabled: boolean;
  readonly registrationPresent: boolean;
  readonly credentialsPresent: boolean;
  readonly sandboxVerifiedAt: string | null;
  readonly productionVerifiedAt: string | null;
  readonly degradedReasonCode: string | null;
  readonly checkedAt: string;
}): MetaProviderHealth {
  const checkedAt = iso(input.checkedAt);
  if (!input.enabled) return health("disabled", false, checkedAt, "disabled_by_configuration", null, []);
  if (!input.registrationPresent && !input.credentialsPresent) return health("absent", false, checkedAt, "registration_absent", null, []);
  if (!input.registrationPresent) return health("absent", false, checkedAt, "registration_absent", null, []);
  if (!input.credentialsPresent) return health("registered", false, checkedAt, "credentials_absent", null, []);
  const capabilities = ["verify_webhook", "receive_messages", "receive_status", "send_templates", "reconcile"] as const;
  if (input.degradedReasonCode) return health("degraded", false, checkedAt, safeReason(input.degradedReasonCode), latest(input.productionVerifiedAt, input.sandboxVerifiedAt), capabilities);
  if (input.productionVerifiedAt) return health("production_verified", true, checkedAt, "official_production_verified", iso(input.productionVerifiedAt), capabilities);
  if (input.sandboxVerifiedAt) return health("sandbox_verified", true, checkedAt, "official_sandbox_verified", iso(input.sandboxVerifiedAt), capabilities);
  return health("configured", false, checkedAt, "official_verification_pending", null, capabilities);
}

function health(activation: MetaProviderActivation, operational: boolean, checkedAt: string, reasonCode: string, lastOfficialVerificationAt: string | null, capabilities: MetaProviderHealth["capabilities"]): MetaProviderHealth {
  return Object.freeze({ provider: "meta_whatsapp_cloud", activation, operational, checkedAt, reasonCode, lastOfficialVerificationAt, capabilities: Object.freeze([...capabilities]) });
}

function iso(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("Meta provider health timestamp is invalid.");
  return new Date(timestamp).toISOString();
}

function latest(a: string | null, b: string | null): string | null {
  if (a) return iso(a);
  if (b) return iso(b);
  return null;
}

function safeReason(value: string): string {
  return /^[a-z0-9_]{1,64}$/u.test(value) ? value : "provider_degraded";
}
