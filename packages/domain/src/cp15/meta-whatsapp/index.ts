export const META_WHATSAPP_ACTIVATION_STATES = [
  "absent",
  "registered",
  "configured",
  "sandbox_verified",
  "production_verified",
  "degraded",
  "disabled"
] as const;

export type MetaWhatsAppActivationState = (typeof META_WHATSAPP_ACTIVATION_STATES)[number];

export const META_MESSAGE_STATES = [
  "send_requested",
  "accepted_by_provider",
  "sent",
  "delivered",
  "read",
  "failed"
] as const;

export type MetaMessageState = (typeof META_MESSAGE_STATES)[number];
export type MetaObservedStatus = "sent" | "delivered" | "read" | "failed" | "deleted" | "unknown";

export interface MetaStatusTransition {
  readonly decision: "apply" | "duplicate" | "ignore_stale" | "reconcile";
  readonly current: MetaMessageState;
  readonly next: MetaMessageState;
  readonly observed: MetaObservedStatus;
  readonly reason:
    | "monotonic_advance"
    | "same_state"
    | "terminal_state_preserved"
    | "lower_rank_observation"
    | "unknown_provider_status"
    | "deleted_requires_reconciliation";
}

const DELIVERY_RANK: Readonly<Record<MetaMessageState, number>> = {
  send_requested: 0,
  accepted_by_provider: 1,
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 5
};

/**
 * Applies only provider-authenticated observations. Skipped intermediate states are never invented:
 * a read event can advance directly to read while deliveredAt remains unknown.
 */
export function decideMetaStatusTransition(
  current: MetaMessageState,
  observed: MetaObservedStatus
): MetaStatusTransition {
  if (observed === "unknown") {
    return { decision: "reconcile", current, next: current, observed, reason: "unknown_provider_status" };
  }
  if (observed === "deleted") {
    return {
      decision: "reconcile",
      current,
      next: current,
      observed,
      reason: "deleted_requires_reconciliation"
    };
  }

  const candidate: MetaMessageState = observed;
  if (candidate === current) {
    return { decision: "duplicate", current, next: current, observed, reason: "same_state" };
  }

  if (current === "read" || current === "failed") {
    return {
      decision: "ignore_stale",
      current,
      next: current,
      observed,
      reason: "terminal_state_preserved"
    };
  }

  if (candidate === "failed") {
    if (current === "delivered") {
      return {
        decision: "reconcile",
        current,
        next: current,
        observed,
        reason: "terminal_state_preserved"
      };
    }
    return { decision: "apply", current, next: "failed", observed, reason: "monotonic_advance" };
  }

  if (DELIVERY_RANK[candidate] < DELIVERY_RANK[current]) {
    return {
      decision: "ignore_stale",
      current,
      next: current,
      observed,
      reason: "lower_rank_observation"
    };
  }

  return { decision: "apply", current, next: candidate, observed, reason: "monotonic_advance" };
}

export type WhatsAppConsentState = "granted" | "denied" | "revoked" | "unknown";
export type WhatsAppMessagePurpose =
  | "care_instruction"
  | "appointment"
  | "payment"
  | "recall"
  | "marketing"
  | "human_reply";

export interface MetaOutboundPolicyInput {
  readonly consent: WhatsAppConsentState;
  readonly purpose: WhatsAppMessagePurpose;
  readonly mode: "approved_template" | "freeform" | "media";
  readonly templateState?: MetaTemplateState | null;
  readonly serviceWindowExpiresAt?: string | null;
  readonly now: string;
}

export type MetaOutboundPolicyDecision =
  | { readonly allowed: true; readonly code: "allowed" }
  | {
      readonly allowed: false;
      readonly code:
        | "consent_required"
        | "recipient_opted_out"
        | "template_not_approved"
        | "service_window_closed"
        | "invalid_policy_time";
    };

export function evaluateMetaOutboundPolicy(
  input: MetaOutboundPolicyInput
): MetaOutboundPolicyDecision {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return { allowed: false, code: "invalid_policy_time" };
  if (input.consent === "denied" || input.consent === "revoked") {
    return { allowed: false, code: "recipient_opted_out" };
  }
  if (input.consent !== "granted") return { allowed: false, code: "consent_required" };

  if (input.mode === "approved_template") {
    return input.templateState === "approved"
      ? { allowed: true, code: "allowed" }
      : { allowed: false, code: "template_not_approved" };
  }

  const expiresAt = input.serviceWindowExpiresAt
    ? Date.parse(input.serviceWindowExpiresAt)
    : Number.NaN;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { allowed: false, code: "service_window_closed" };
  }
  return { allowed: true, code: "allowed" };
}

const OPT_OUT_WORDS = new Set(["stop", "unsubscribe", "opt out"]);
const OPT_IN_REQUEST_WORDS = new Set(["start", "subscribe", "opt in"]);

export type InboundConsentCommand = "opt_out" | "opt_in_request" | "none";

/** Exact command matching avoids treating clinical prose that happens to contain “stop” as opt-out. */
export function classifyInboundConsentCommand(text: string | null): InboundConsentCommand {
  if (text === null) return "none";
  const normalized = text.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (OPT_OUT_WORDS.has(normalized)) return "opt_out";
  // An inbound keyword is an opt-in request, not versioned consent by itself.
  if (OPT_IN_REQUEST_WORDS.has(normalized)) return "opt_in_request";
  return "none";
}

export function serviceWindowExpiryFromInbound(occurredAt: string): string {
  const timestamp = Date.parse(occurredAt);
  if (!Number.isFinite(timestamp)) throw new Error("Inbound WhatsApp timestamp is invalid.");
  return new Date(timestamp + 24 * 60 * 60 * 1000).toISOString();
}

export type MetaTemplateState =
  | "pending"
  | "approved"
  | "rejected"
  | "paused"
  | "disabled"
  | "deleted"
  | "unknown";

export function normalizeMetaTemplateState(providerEvent: string): MetaTemplateState {
  const event = providerEvent.trim().toUpperCase();
  if (event === "APPROVED") return "approved";
  if (event === "REJECTED") return "rejected";
  if (event === "PAUSED") return "paused";
  if (event === "DISABLED") return "disabled";
  if (event === "DELETED") return "deleted";
  if (["PENDING", "IN_APPEAL", "PENDING_DELETION"].includes(event)) return "pending";
  return "unknown";
}
