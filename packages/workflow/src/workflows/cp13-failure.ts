import { ActivityFailure, ApplicationFailure } from "@temporalio/workflow";
import { CP13_PERMANENT_ACTIVITY_FAILURE, type Cp13WorkflowFailure } from "../cp13-contracts.js";

export function classifyCp13ActivityFailure(error: unknown): Cp13WorkflowFailure {
  const cause = error instanceof ActivityFailure ? error.cause : error;
  if (cause instanceof ApplicationFailure) {
    return {
      classification:
        cause.nonRetryable === true || cause.type === CP13_PERMANENT_ACTIVITY_FAILURE
          ? "permanent"
          : "retry_exhausted",
      code: safeFailureCode(cause.message)
    };
  }
  return {
    classification: "retry_exhausted",
    code: "CP13_ACTIVITY_FAILED"
  };
}

function safeFailureCode(value: string): string {
  return /^[A-Z][A-Z0-9_]{2,79}$/u.test(value) ? value : "CP13_ACTIVITY_FAILED";
}
