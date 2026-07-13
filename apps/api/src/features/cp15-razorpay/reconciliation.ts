import type { RazorpayPaymentSnapshot } from "../../../../../packages/integrations/src/cp15/razorpay/client.ts";

export interface RazorpayLocalPaymentProjection {
  readonly providerPaymentId: string;
  readonly amountMinor: number;
  readonly refundedMinor: number;
  readonly currency: string;
  readonly captured: boolean;
}

export type RazorpayReconciliationEvaluation =
  | { readonly status: "matched"; readonly settlementAllowed: false }
  | {
      readonly status: "variance";
      readonly settlementAllowed: false;
      readonly reason:
        | "missing_local_capture"
        | "amount_mismatch"
        | "currency_mismatch"
        | "refund_mismatch"
        | "provider_not_captured";
      readonly providerPaymentId: string;
    };

export function evaluateRazorpayReconciliation(
  provider: RazorpayPaymentSnapshot,
  local: RazorpayLocalPaymentProjection | null
): RazorpayReconciliationEvaluation {
  if (!local && provider.captured)
    return variance("missing_local_capture", provider.providerPaymentId);
  if (!local) return variance("provider_not_captured", provider.providerPaymentId);
  if (provider.currency !== local.currency)
    return variance("currency_mismatch", provider.providerPaymentId);
  if (provider.amountMinor !== local.amountMinor)
    return variance("amount_mismatch", provider.providerPaymentId);
  if (provider.amountRefundedMinor !== local.refundedMinor)
    return variance("refund_mismatch", provider.providerPaymentId);
  if (provider.captured !== local.captured)
    return variance("provider_not_captured", provider.providerPaymentId);
  return { status: "matched", settlementAllowed: false };
}

export function nextRazorpayReconciliationAttempt(input: {
  readonly attempt: number;
  readonly now: string;
  readonly retryable: boolean;
}): {
  readonly status: "retry_scheduled" | "dead_lettered";
  readonly nextAttemptAt: string | null;
} {
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1)
    throw new Error("attempt must be a positive safe integer.");
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) throw new Error("now must be an ISO timestamp.");
  if (!input.retryable || input.attempt >= 8)
    return { status: "dead_lettered", nextAttemptAt: null };
  const delayMs = Math.min(60 * 60_000, 30_000 * 2 ** (input.attempt - 1));
  return { status: "retry_scheduled", nextAttemptAt: new Date(now + delayMs).toISOString() };
}

function variance(
  reason: Extract<RazorpayReconciliationEvaluation, { status: "variance" }>["reason"],
  providerPaymentId: string
): RazorpayReconciliationEvaluation {
  return { status: "variance", settlementAllowed: false, reason, providerPaymentId };
}
