import type {
  FhirIssueCode,
  FhirIssueSeverity,
  FhirOperationOutcome,
  FhirOperationOutcomeIssue
} from "./types.ts";

export const CLINIC_OS_FHIR_ISSUE_SYSTEM =
  "https://fhir.clinicos.in/CodeSystem/interoperability-issue";

export interface ClinicOsFhirIssueInput {
  readonly code: FhirIssueCode;
  readonly diagnostics: string;
  readonly expression?: readonly string[];
  readonly clinicOsCode: string;
  readonly severity?: FhirIssueSeverity;
}

export class ClinicOsFhirError extends Error {
  readonly httpStatus: number;
  readonly outcome: FhirOperationOutcome;
  readonly retryable: boolean;

  constructor(input: {
    readonly httpStatus: number;
    readonly issues: readonly ClinicOsFhirIssueInput[];
    readonly message?: string;
    readonly retryable?: boolean;
  }) {
    const outcome = operationOutcome(input.issues);
    super(input.message ?? input.issues[0]?.diagnostics ?? "FHIR interoperability request failed.");
    this.name = "ClinicOsFhirError";
    this.httpStatus = input.httpStatus;
    this.outcome = outcome;
    this.retryable = input.retryable ?? false;
  }
}

export function operationOutcome(issues: readonly ClinicOsFhirIssueInput[]): FhirOperationOutcome {
  if (issues.length === 0) {
    throw new Error("OperationOutcome requires at least one issue.");
  }
  return {
    resourceType: "OperationOutcome",
    issue: issues.map(toOutcomeIssue)
  };
}

export function fhirIssue(input: ClinicOsFhirIssueInput): FhirOperationOutcomeIssue {
  return toOutcomeIssue(input);
}

function toOutcomeIssue(input: ClinicOsFhirIssueInput): FhirOperationOutcomeIssue {
  if (!/^[A-Z][A-Z0-9_]{2,63}$/u.test(input.clinicOsCode)) {
    throw new Error("ClinicOS interoperability issue code is invalid.");
  }
  return {
    severity: input.severity ?? "error",
    code: input.code,
    details: {
      coding: [
        {
          system: CLINIC_OS_FHIR_ISSUE_SYSTEM,
          code: input.clinicOsCode
        }
      ],
      text: input.diagnostics
    },
    diagnostics: input.diagnostics,
    ...(input.expression?.length ? { expression: [...input.expression] } : {})
  };
}
