import {
  ClinicOsFhirError,
  clinicOsFhirR4CapabilityStatement,
  evaluateAbdmCapabilityBoundary,
  operationOutcome,
  type AbdmOfficialActivationEvidence,
  type ClinicalSummaryRecipient
} from "@clinic-os/fhir";
import type {
  AuthenticatedInteroperabilityContext,
  InteroperabilityExportResult,
  InteroperabilityImportResult,
  InteroperabilityReviewResult
} from "./contracts.ts";
import { InteroperabilityExchangeService } from "./service.ts";

export interface InteroperabilityApiResponse {
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
  readonly status: number;
}

export interface InteroperabilityRequestHeaders {
  readonly [name: string]: string | readonly string[] | undefined;
}

export function createInteroperabilityHandlers(input: {
  readonly abdmActivation: AbdmOfficialActivationEvidence | null;
  readonly now: () => Date;
  readonly service: InteroperabilityExchangeService;
}) {
  return Object.freeze({
    capability(): InteroperabilityApiResponse {
      return fhirResponse(200, clinicOsFhirR4CapabilityStatement());
    },
    abdmCapability(): InteroperabilityApiResponse {
      const evaluatedAt = validNow(input.now).toISOString();
      const capability = evaluateAbdmCapabilityBoundary({
        activation: input.abdmActivation,
        evaluatedAt
      });
      if (!capability.registered) {
        return {
          status: 503,
          headers: noStoreHeaders("application/fhir+json; charset=utf-8"),
          body: operationOutcome([
            {
              clinicOsCode: "ABDM_CAPABILITY_UNREGISTERED",
              code: "not-supported",
              diagnostics:
                "ABDM is unregistered and unavailable until official ndhm.in#6.5.0 validator and sandbox activation evidence exists.",
              expression: ["CapabilityStatement"]
            }
          ])
        };
      }
      return jsonResponse(200, capability);
    },
    async exportClinicalSummary(request: {
      readonly body: unknown;
      readonly context: AuthenticatedInteroperabilityContext;
      readonly encounterId: string;
      readonly headers: InteroperabilityRequestHeaders;
      readonly patientId: string;
      readonly requestId: string;
    }): Promise<InteroperabilityApiResponse> {
      try {
        requireMediaType(request.headers, "application/json");
        const body = exportBody(request.body);
        const result = await input.service.exportClinicalSummary({
          context: request.context,
          encounterId: request.encounterId,
          expectedSourceVersion: conditionalVersion(request.headers),
          idempotencyKey: requiredHeader(request.headers, "idempotency-key"),
          patientId: request.patientId,
          recipient: body.recipient,
          requestId: request.requestId
        });
        return exportResponse(result);
      } catch (error) {
        return errorResponse(error);
      }
    },
    async importClinicalSummary(request: {
      readonly context: AuthenticatedInteroperabilityContext;
      readonly headers: InteroperabilityRequestHeaders;
      readonly patientId: string;
      readonly rawBody: Uint8Array;
      readonly requestId: string;
    }): Promise<InteroperabilityApiResponse> {
      try {
        requireMediaType(request.headers, "application/fhir+json");
        const result = await input.service.importClinicalSummary({
          context: request.context,
          expectedPatientVersion: conditionalVersion(request.headers),
          idempotencyKey: requiredHeader(request.headers, "idempotency-key"),
          patientId: request.patientId,
          rawBody: request.rawBody,
          requestId: request.requestId
        });
        return importResponse(result);
      } catch (error) {
        return errorResponse(error);
      }
    },
    async reviewClinicalSummaryImport(request: {
      readonly body: unknown;
      readonly context: AuthenticatedInteroperabilityContext;
      readonly headers: InteroperabilityRequestHeaders;
      readonly reconciliationId: string;
      readonly requestId: string;
    }): Promise<InteroperabilityApiResponse> {
      try {
        requireMediaType(request.headers, "application/json");
        const body = reviewBody(request.body);
        const result = await input.service.reviewClinicalSummaryImport({
          context: request.context,
          decision: body.decision,
          expectedReconciliationVersion: conditionalVersion(request.headers),
          reason: body.reason,
          reconciliationId: request.reconciliationId,
          requestId: request.requestId
        });
        return reviewResponse(result);
      } catch (error) {
        return errorResponse(error);
      }
    }
  });
}

function exportResponse(result: InteroperabilityExportResult): InteroperabilityApiResponse {
  return {
    status: 200,
    headers: {
      ...noStoreHeaders("application/fhir+json; charset=utf-8"),
      digest: `sha-256=${Buffer.from(result.artifact.digest.value, "hex").toString("base64")}`,
      etag: `"rv-${result.artifact.sourceVersion}"`,
      "x-clinicos-canonicalization": result.artifact.digest.canonicalization,
      "idempotency-replayed": String(result.replayed)
    },
    body: result.artifact.bundle
  };
}

function importResponse(result: InteroperabilityImportResult): InteroperabilityApiResponse {
  return {
    status: 202,
    headers: {
      ...noStoreHeaders("application/json; charset=utf-8"),
      etag: `"rv-${result.reconciliationVersion}"`,
      "idempotency-replayed": String(result.replayed)
    },
    body: result
  };
}

function reviewResponse(result: InteroperabilityReviewResult): InteroperabilityApiResponse {
  return {
    status: 200,
    headers: {
      ...noStoreHeaders("application/json; charset=utf-8"),
      etag: `"rv-${result.reconciliationVersion}"`
    },
    body: result
  };
}

function errorResponse(error: unknown): InteroperabilityApiResponse {
  if (error instanceof ClinicOsFhirError) {
    return {
      status: error.httpStatus,
      headers: {
        ...noStoreHeaders("application/fhir+json; charset=utf-8"),
        ...(error.retryable ? { "retry-after": "2" } : {})
      },
      body: error.outcome
    };
  }
  return {
    status: 503,
    headers: {
      ...noStoreHeaders("application/fhir+json; charset=utf-8"),
      "retry-after": "2"
    },
    body: operationOutcome([
      {
        clinicOsCode: "FHIR_INTEROPERABILITY_UNAVAILABLE",
        code: "transient",
        diagnostics:
          "FHIR interoperability is temporarily unavailable; no successful exchange effect is implied.",
        expression: ["Bundle"]
      }
    ])
  };
}

function exportBody(value: unknown): { readonly recipient: ClinicalSummaryRecipient } {
  const body = exactObject(value, ["recipient"], "export body");
  const recipient = exactObject(body.recipient, ["identifier", "type"], "recipient");
  if (recipient.type !== "authorized_organization" && recipient.type !== "authorized_system") {
    throw inputError("FHIR_RECIPIENT_INVALID", "recipient.type is unsupported.", "recipient.type");
  }
  if (typeof recipient.identifier !== "string") {
    throw inputError(
      "FHIR_RECIPIENT_INVALID",
      "recipient.identifier is required.",
      "recipient.identifier"
    );
  }
  return {
    recipient: {
      type: recipient.type,
      identifier: recipient.identifier
    }
  };
}

function reviewBody(value: unknown): {
  readonly decision: "accept" | "reject";
  readonly reason: string;
} {
  const body = exactObject(value, ["decision", "reason"], "review body");
  if (body.decision !== "accept" && body.decision !== "reject") {
    throw inputError(
      "FHIR_REVIEW_DECISION_INVALID",
      "review decision must be accept or reject.",
      "decision"
    );
  }
  if (typeof body.reason !== "string") {
    throw inputError("FHIR_REVIEW_REASON_REQUIRED", "A review reason is required.", "reason");
  }
  return { decision: body.decision, reason: body.reason };
}

function exactObject(
  value: unknown,
  allowedFields: readonly string[],
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError("FHIR_REQUEST_BODY_INVALID", `${label} must be an object.`, label);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowedFields.includes(key));
  if (unknown.length > 0 || allowedFields.some((key) => !(key in record))) {
    throw inputError(
      "FHIR_REQUEST_BODY_INVALID",
      `${label} has missing or unsupported fields.`,
      label
    );
  }
  return record;
}

function conditionalVersion(headers: InteroperabilityRequestHeaders): number {
  const value = requiredHeader(headers, "if-match");
  const match = /^"rv-([1-9]\d{0,14})"$/u.exec(value);
  if (!match) {
    throw inputError(
      "FHIR_IF_MATCH_REQUIRED",
      'If-Match must contain a canonical strong ETag such as "rv-3".',
      "If-Match",
      428,
      "required"
    );
  }
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version)) {
    throw inputError(
      "FHIR_IF_MATCH_REQUIRED",
      "If-Match version is outside the supported range.",
      "If-Match",
      428,
      "value"
    );
  }
  return version;
}

function requiredHeader(headers: InteroperabilityRequestHeaders, name: string): string {
  const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  const value = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw inputError(
      name === "idempotency-key"
        ? "FHIR_IDEMPOTENCY_KEY_REQUIRED"
        : name === "if-match"
          ? "FHIR_IF_MATCH_REQUIRED"
          : name === "content-type"
            ? "FHIR_CONTENT_TYPE_REQUIRED"
            : "FHIR_HEADER_REQUIRED",
      `${name} header is required exactly once.`,
      name,
      name === "if-match" ? 428 : name === "content-type" ? 415 : 400,
      "required"
    );
  }
  return value.trim();
}

function requireMediaType(
  headers: InteroperabilityRequestHeaders,
  expected: "application/fhir+json" | "application/json"
): void {
  const value = requiredHeader(headers, "content-type");
  const parts = value.split(";").map((part) => part.trim().toLowerCase());
  const validParameters = parts
    .slice(1)
    .every((parameter) => parameter === "charset=utf-8" || parameter === 'charset="utf-8"');
  if (parts[0] !== expected || !validParameters) {
    throw inputError(
      "FHIR_CONTENT_TYPE_UNSUPPORTED",
      `Content-Type must be ${expected} with optional UTF-8 charset.`,
      "Content-Type",
      415,
      "not-supported"
    );
  }
}

function inputError(
  clinicOsCode: string,
  diagnostics: string,
  expression: string,
  httpStatus = 422,
  code: "not-supported" | "required" | "value" = "value"
): ClinicOsFhirError {
  return new ClinicOsFhirError({
    httpStatus,
    issues: [{ clinicOsCode, code, diagnostics, expression: [expression] }]
  });
}

function fhirResponse(status: number, body: unknown): InteroperabilityApiResponse {
  return {
    status,
    headers: noStoreHeaders("application/fhir+json; charset=utf-8"),
    body
  };
}

function jsonResponse(status: number, body: unknown): InteroperabilityApiResponse {
  return {
    status,
    headers: noStoreHeaders("application/json; charset=utf-8"),
    body
  };
}

function noStoreHeaders(contentType: string): Readonly<Record<string, string>> {
  return Object.freeze({
    "cache-control": "no-store, private",
    "content-type": contentType,
    pragma: "no-cache",
    "x-content-type-options": "nosniff"
  });
}

function validNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Interoperability handler clock returned an invalid Date.");
  }
  return value;
}
