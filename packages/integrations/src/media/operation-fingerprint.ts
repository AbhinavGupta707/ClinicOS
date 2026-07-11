import { createHash } from "node:crypto";
import type {
  PrivateMediaAtomicOperation,
  PrivateMediaRecord,
  PrivateMediaScope,
  PrivateMediaState,
  SignedMalwareEvidence
} from "./types.js";

export const PRIVATE_MEDIA_FINGERPRINT_VERSION = "clinicos-private-media-semantic-v1";

export function privateMediaOperationSemanticFingerprint(
  operation: Omit<PrivateMediaAtomicOperation, "semanticFingerprintSha256">
): string {
  return sha256Canonical({
    version: PRIVATE_MEDIA_FINGERPRINT_VERSION,
    kind: "operation",
    operationId: operation.operationId,
    audit: {
      action: operation.audit.action,
      tenantId: operation.audit.tenantId,
      clinicId: operation.audit.clinicId,
      mediaId: operation.audit.mediaId,
      uploadId: operation.audit.uploadId,
      actorId: operation.audit.actorId,
      correlationId: operation.audit.correlationId,
      outcome: operation.audit.outcome,
      metadata: operation.audit.metadata
    },
    intent: {
      operationId: operation.reconciliationIntent.operationId,
      kind: operation.reconciliationIntent.kind,
      scope: operation.reconciliationIntent.scope,
      expectedRevision: operation.reconciliationIntent.expectedRevision,
      targetRevision: operation.reconciliationIntent.targetRevision,
      payload: operation.reconciliationIntent.payload
    }
  });
}

export function privateMediaRecordSemanticFingerprint(record: PrivateMediaRecord): string {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...semanticRecord } = record;
  return sha256Canonical({
    version: PRIVATE_MEDIA_FINGERPRINT_VERSION,
    kind: "record",
    record: semanticRecord
  });
}

export function privateMediaPersistenceWriteFingerprint(
  input: Readonly<{
    kind: "reserve" | "transition" | "scan_success" | "scan_conflict" | "audit";
    operation: PrivateMediaAtomicOperation;
    scope: PrivateMediaScope;
    expectedRevision: number | null;
    expectedStates: readonly PrivateMediaState[];
    next?: PrivateMediaRecord;
    evidence?: Readonly<{
      evidenceId: string;
      evidenceDigestSha256: string;
      evidence: SignedMalwareEvidence;
    }>;
  }>
): string {
  return sha256Canonical({
    version: PRIVATE_MEDIA_FINGERPRINT_VERSION,
    kind: input.kind,
    operationSemanticFingerprintSha256: input.operation.semanticFingerprintSha256,
    scope: input.scope,
    expectedRevision: input.expectedRevision,
    expectedStates: [...input.expectedStates].sort(),
    nextRecordSemanticFingerprintSha256: input.next
      ? privateMediaRecordSemanticFingerprint(input.next)
      : null,
    evidence: input.evidence
      ? {
          evidenceId: input.evidence.evidenceId,
          evidenceDigestSha256: input.evidence.evidenceDigestSha256,
          evidence: input.evidence.evidence
        }
      : null
  });
}

export function privateMediaChildEffectId(
  parentOperationId: string,
  effectKind: "purge_object_version" | "purge_delete_marker",
  immutableTargetFingerprintSha256: string
): string {
  return `pmef_${sha256Canonical({
    version: PRIVATE_MEDIA_FINGERPRINT_VERSION,
    kind: "child_effect",
    parentOperationId,
    effectKind,
    immutableTargetFingerprintSha256
  })}`;
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite semantic fingerprint number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new TypeError("Unsupported semantic fingerprint value.");
}
