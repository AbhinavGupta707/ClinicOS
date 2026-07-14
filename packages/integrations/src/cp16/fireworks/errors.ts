import type { FireworksRequestProvenance } from "./types.js";

export type FireworksGatewayErrorCode =
  | "not_configured"
  | "policy_blocked"
  | "kill_switch_active"
  | "budget_exhausted"
  | "idempotency_conflict"
  | "circuit_open"
  | "invalid_request"
  | "invalid_audio"
  | "provider_rejected"
  | "provider_unavailable"
  | "provider_outcome_uncertain"
  | "provider_succeeded_persistence_uncertain"
  | "invalid_response"
  | "truncated_response"
  | "unsafe_output";

export class FireworksGatewayError extends Error {
  readonly code: FireworksGatewayErrorCode;
  readonly retryable: boolean;
  readonly providerHttpStatus: number | null;
  /** Sanitized provider-success evidence only; never contains prompt, output, or audio. */
  readonly provenance: FireworksRequestProvenance | null;

  constructor(input: {
    readonly code: FireworksGatewayErrorCode;
    readonly message: string;
    readonly retryable?: boolean;
    readonly providerHttpStatus?: number | null;
    readonly provenance?: FireworksRequestProvenance | null;
  }) {
    super(input.message);
    this.name = "FireworksGatewayError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.providerHttpStatus = input.providerHttpStatus ?? null;
    this.provenance = input.provenance ?? null;
  }
}

export class FireworksUsageGuardError extends Error {
  readonly code: "budget_exhausted" | "idempotency_conflict";

  constructor(code: FireworksUsageGuardError["code"]) {
    super("Fireworks usage guard rejected the reservation.");
    this.name = "FireworksUsageGuardError";
    this.code = code;
  }
}

export function sanitizedFireworksError(
  code: FireworksGatewayErrorCode,
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly providerHttpStatus?: number | null;
    readonly provenance?: FireworksRequestProvenance | null;
  } = {}
): FireworksGatewayError {
  return new FireworksGatewayError({ code, message, ...options });
}
