export type RazorpayBoundaryErrorCode =
  | "BODY_TOO_LARGE"
  | "MISSING_SIGNATURE"
  | "INVALID_SIGNATURE"
  | "MISSING_EVENT_ID"
  | "INVALID_JSON"
  | "INVALID_PAYLOAD"
  | "UNSUPPORTED_EVENT"
  | "ACCOUNT_MISMATCH"
  | "NOT_CONFIGURED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "PROVIDER_RATE_LIMITED";

export class RazorpayBoundaryError extends Error {
  readonly code: RazorpayBoundaryErrorCode;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;
  readonly safeDetails: Readonly<Record<string, unknown>>;

  constructor(input: {
    readonly code: RazorpayBoundaryErrorCode;
    readonly message: string;
    readonly retryable?: boolean;
    readonly outcomeUnknown?: boolean;
    readonly safeDetails?: Readonly<Record<string, unknown>>;
  }) {
    super(input.message);
    this.name = "RazorpayBoundaryError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.outcomeUnknown = input.outcomeUnknown ?? false;
    this.safeDetails = input.safeDetails ?? {};
  }
}
