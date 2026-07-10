export type PrivateMediaErrorCode =
  | "invalid_request"
  | "authority_mismatch"
  | "reservation_conflict"
  | "reservation_expired"
  | "object_missing"
  | "object_incomplete"
  | "integrity_mismatch"
  | "magic_type_mismatch"
  | "kms_policy_mismatch"
  | "quarantined"
  | "scan_in_progress"
  | "scan_failed"
  | "scan_evidence_invalid"
  | "scan_evidence_conflict"
  | "retry_exhausted"
  | "legal_hold"
  | "restore_window_expired"
  | "operation_conflict"
  | "concurrent_change"
  | "not_found"
  | "provider_error";

export class PrivateMediaError extends Error {
  readonly code: PrivateMediaErrorCode;
  readonly retryable: boolean;
  readonly safeDetails: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    input: Readonly<{
      code: PrivateMediaErrorCode;
      message: string;
      retryable?: boolean;
      safeDetails?: Readonly<Record<string, string | number | boolean | null>>;
    }>
  ) {
    super(input.message);
    this.name = "PrivateMediaError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.safeDetails = Object.freeze({ ...(input.safeDetails ?? {}) });
  }
}
