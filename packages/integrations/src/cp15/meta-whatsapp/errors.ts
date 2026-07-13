export type MetaWhatsAppErrorCode =
  | "not_configured"
  | "invalid_challenge"
  | "body_too_large"
  | "missing_signature"
  | "invalid_signature"
  | "invalid_content_type"
  | "invalid_payload"
  | "unsupported_payload"
  | "account_mismatch"
  | "policy_blocked"
  | "provider_rejected"
  | "provider_response_invalid"
  | "dispatch_ambiguous"
  | "persistence_failed";

export class MetaWhatsAppError extends Error {
  readonly code: MetaWhatsAppErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(input: {
    readonly code: MetaWhatsAppErrorCode;
    readonly message: string;
    readonly httpStatus: number;
    readonly retryable?: boolean;
  }) {
    super(input.message);
    this.name = "MetaWhatsAppError";
    this.code = input.code;
    this.httpStatus = input.httpStatus;
    this.retryable = input.retryable ?? false;
  }
}
