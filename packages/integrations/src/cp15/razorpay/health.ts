import type { RazorpayActivationState } from "./types.js";

export interface RazorpayHealthInput {
  readonly activationState: RazorpayActivationState;
  readonly apiCredentialsConfigured: boolean;
  readonly webhookRouteRegistered: boolean;
  readonly currentSecretConfigured: boolean;
  readonly previousSecretAcceptUntil: string | null;
  readonly apiProbe: "healthy" | "failed" | "not_run";
  readonly lastWebhookAt: string | null;
  readonly lastReconciledAt: string | null;
  readonly checkedAt: string;
}

export interface RazorpayHealthContract {
  readonly provider: "razorpay";
  readonly status: "not_configured" | "unavailable" | "degraded" | "available" | "disabled";
  readonly activationState: RazorpayActivationState;
  readonly canCreatePaymentRequests: boolean;
  readonly canTrustWebhookSettlement: boolean;
  readonly needsReconciliation: boolean;
  readonly rotationWindowOpen: boolean;
  readonly checkedAt: string;
  readonly reasonCodes: readonly string[];
}

export function buildRazorpayHealth(input: RazorpayHealthInput): RazorpayHealthContract {
  const reasonCodes: string[] = [];
  if (input.activationState === "disabled") reasonCodes.push("PROVIDER_DISABLED");
  if (!input.apiCredentialsConfigured) reasonCodes.push("API_CREDENTIALS_MISSING");
  if (!input.webhookRouteRegistered) reasonCodes.push("WEBHOOK_REGISTRATION_MISSING");
  if (!input.currentSecretConfigured) reasonCodes.push("WEBHOOK_SECRET_MISSING");
  if (input.apiProbe === "failed") reasonCodes.push("API_PROBE_FAILED");
  if (input.activationState === "degraded") reasonCodes.push("ACTIVATION_DEGRADED");
  const rotationWindowOpen = Boolean(
    input.previousSecretAcceptUntil &&
    Date.parse(input.previousSecretAcceptUntil) >= Date.parse(input.checkedAt)
  );
  const canTrustWebhookSettlement =
    input.currentSecretConfigured &&
    input.webhookRouteRegistered &&
    ["sandbox_verified", "production_verified"].includes(input.activationState);
  const canCreatePaymentRequests =
    input.apiCredentialsConfigured && input.apiProbe !== "failed" && canTrustWebhookSettlement;
  const needsReconciliation = input.apiProbe === "failed" || input.activationState === "degraded";
  const status =
    input.activationState === "disabled"
      ? "disabled"
      : !input.apiCredentialsConfigured || !input.currentSecretConfigured
        ? "not_configured"
        : !input.webhookRouteRegistered
          ? "unavailable"
          : needsReconciliation || !canTrustWebhookSettlement
            ? "degraded"
            : "available";
  return Object.freeze({
    provider: "razorpay",
    status,
    activationState: input.activationState,
    canCreatePaymentRequests,
    canTrustWebhookSettlement,
    needsReconciliation,
    rotationWindowOpen,
    checkedAt: new Date(input.checkedAt).toISOString(),
    reasonCodes: Object.freeze(reasonCodes)
  });
}
