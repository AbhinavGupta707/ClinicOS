import { createHash } from "node:crypto";

export const CP16_PROTECTED_PAYLOAD_ALGORITHM = "AES-256-GCM" as const;

export interface Cp16ProtectedPayload {
  readonly algorithm: typeof CP16_PROTECTED_PAYLOAD_ALGORITHM;
  readonly ciphertext: Uint8Array;
  readonly keyReference: string;
  readonly plaintextDigest: string;
}

export interface Cp16ProtectedPayloadContext {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly patientId: string;
  readonly resourceType: "ai_invocation_result" | "fhir_export" | "fhir_import_minimized";
  readonly resourceId: string;
}

/**
 * Production implementations must use an approved envelope-encryption service and bind every
 * context field as authenticated additional data. Plaintext, data keys and provider credentials
 * must never be logged or persisted by this boundary.
 */
export interface Cp16ProtectedPayloadCodec {
  protectJson(value: unknown, context: Cp16ProtectedPayloadContext): Promise<Cp16ProtectedPayload>;
  revealJson(payload: Cp16ProtectedPayload, context: Cp16ProtectedPayloadContext): Promise<unknown>;
}

export function assertProtectedPayload(
  payload: Cp16ProtectedPayload,
  maximumCiphertextBytes: number
): Cp16ProtectedPayload {
  if (
    payload.algorithm !== CP16_PROTECTED_PAYLOAD_ALGORITHM ||
    !(payload.ciphertext instanceof Uint8Array) ||
    payload.ciphertext.byteLength < 1 ||
    payload.ciphertext.byteLength > maximumCiphertextBytes ||
    payload.keyReference.length < 20 ||
    payload.keyReference.length > 2_048 ||
    /[\r\n\0]/u.test(payload.keyReference) ||
    !/^[0-9a-f]{64}$/u.test(payload.plaintextDigest)
  ) {
    throw new Error("Protected clinical payload failed its encryption envelope contract.");
  }
  return payload;
}

export function cp16PayloadContextDigest(context: Cp16ProtectedPayloadContext): string {
  validateContext(context);
  return createHash("sha256")
    .update(
      [
        "clinicos-cp16-protected-payload-v1",
        context.tenantId,
        context.clinicId,
        context.patientId,
        context.resourceType,
        context.resourceId
      ].join("\0"),
      "utf8"
    )
    .digest("hex");
}

export function protectedPayloadFromDatabase(input: {
  readonly ciphertext: Uint8Array;
  readonly keyReference: string;
  readonly algorithm: string;
  readonly plaintextDigest: string;
}): Cp16ProtectedPayload {
  if (input.algorithm !== CP16_PROTECTED_PAYLOAD_ALGORITHM) {
    throw new Error("Protected clinical payload uses an unsupported encryption algorithm.");
  }
  return assertProtectedPayload(
    {
      algorithm: input.algorithm,
      ciphertext: input.ciphertext,
      keyReference: input.keyReference,
      plaintextDigest: input.plaintextDigest
    },
    8 * 1024 * 1024
  );
}

function validateContext(context: Cp16ProtectedPayloadContext): void {
  for (const [field, value] of Object.entries(context)) {
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > 256 ||
      /[\r\n\0]/u.test(value)
    ) {
      throw new Error(`Protected payload ${field} is invalid.`);
    }
  }
}
