export type OutboxFailureKind = "transient" | "permanent";

export class OutboxProcessingError extends Error {
  readonly code: string;
  readonly kind: OutboxFailureKind;

  constructor(message: string, options: { readonly code: string; readonly kind: OutboxFailureKind }) {
    super(message);
    this.name = "OutboxProcessingError";
    this.code = options.code;
    this.kind = options.kind;
  }
}

export interface ClassifiedOutboxFailure {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export function classifyOutboxFailure(error: unknown): ClassifiedOutboxFailure {
  if (error instanceof OutboxProcessingError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.kind === "transient"
    };
  }

  if (error instanceof Error) {
    return {
      code: "UNEXPECTED_ERROR",
      message: error.message,
      retryable: true
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "unknown outbox handler failure",
    retryable: true
  };
}

export function permanentOutboxFailure(code: string, message: string): OutboxProcessingError {
  return new OutboxProcessingError(message, { code, kind: "permanent" });
}

export function transientOutboxFailure(code: string, message: string): OutboxProcessingError {
  return new OutboxProcessingError(message, { code, kind: "transient" });
}
