import {
  MessageType,
  SigningAlgorithmSpec,
  VerifyCommand,
  type KMSClient,
  type VerifyCommandOutput
} from "@aws-sdk/client-kms";
import type {
  MalwareEvidenceSignatureVerifier,
  SignedMalwareEvidence,
  SignedMalwareEvidencePayload
} from "./types.js";

export type KmsEvidenceAlgorithm = SignedMalwareEvidence["signature"]["algorithm"];

export interface AwsKmsEvidenceVerifierConfig {
  readonly keyAlgorithms: Readonly<Record<string, readonly KmsEvidenceAlgorithm[]>>;
  readonly minimumSignatureBytes?: number;
  readonly maximumSignatureBytes?: number;
}

export interface AwsKmsCommandSender {
  send(command: VerifyCommand): Promise<VerifyCommandOutput>;
}

/** Exact bytes that the approved scanner must sign and the API verifies with KMS. */
export function canonicalMalwareEvidencePayloadBytes(
  payload: SignedMalwareEvidencePayload
): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      evidenceId: payload.evidenceId,
      tenantId: payload.tenantId,
      clinicId: payload.clinicId,
      mediaId: payload.mediaId,
      uploadId: payload.uploadId,
      scanOperationId: payload.scanOperationId,
      objectIdentitySha256: payload.objectIdentitySha256,
      objectVersionId: payload.objectVersionId,
      contentSha256Hex: payload.contentSha256Hex,
      contentLength: payload.contentLength,
      detectedMimeType: payload.detectedMimeType,
      verdict: payload.verdict,
      scanner: payload.scanner,
      engineVersion: payload.engineVersion,
      definitionsVersion: payload.definitionsVersion,
      scannedAt: payload.scannedAt
    }),
    "utf8"
  );
}

/** KMS Verify adapter with a composition-frozen key and algorithm allowlist. */
export class AwsKmsMalwareEvidenceSignatureVerifier implements MalwareEvidenceSignatureVerifier {
  readonly #client: AwsKmsCommandSender;
  readonly #keyAlgorithms: ReadonlyMap<string, ReadonlySet<KmsEvidenceAlgorithm>>;
  readonly #minimumSignatureBytes: number;
  readonly #maximumSignatureBytes: number;

  constructor(client: AwsKmsCommandSender | KMSClient, config: AwsKmsEvidenceVerifierConfig) {
    const entries = Object.entries(config.keyAlgorithms);
    if (entries.length === 0 || entries.length > 16) {
      throw new TypeError("KMS evidence verifier key allowlist is invalid.");
    }
    const keyAlgorithms = new Map<string, ReadonlySet<KmsEvidenceAlgorithm>>();
    for (const [keyId, algorithms] of entries) {
      if (!isSafeKeyId(keyId) || algorithms.length === 0 || algorithms.length > 2) {
        throw new TypeError("KMS evidence verifier key allowlist is invalid.");
      }
      const uniqueAlgorithms = new Set(algorithms);
      if (
        uniqueAlgorithms.size !== algorithms.length ||
        [...uniqueAlgorithms].some(
          (algorithm) => algorithm !== "RSASSA_PSS_SHA_256" && algorithm !== "ECDSA_SHA_256"
        )
      ) {
        throw new TypeError("KMS evidence verifier algorithm allowlist is invalid.");
      }
      keyAlgorithms.set(keyId, uniqueAlgorithms);
    }
    const minimumSignatureBytes = config.minimumSignatureBytes ?? 32;
    const maximumSignatureBytes = config.maximumSignatureBytes ?? 1_024;
    if (
      !Number.isSafeInteger(minimumSignatureBytes) ||
      !Number.isSafeInteger(maximumSignatureBytes) ||
      minimumSignatureBytes < 32 ||
      maximumSignatureBytes > 1_024 ||
      minimumSignatureBytes > maximumSignatureBytes
    ) {
      throw new TypeError("KMS evidence verifier signature bounds are invalid.");
    }
    this.#client = client;
    this.#keyAlgorithms = keyAlgorithms;
    this.#minimumSignatureBytes = minimumSignatureBytes;
    this.#maximumSignatureBytes = maximumSignatureBytes;
  }

  async verify(evidence: SignedMalwareEvidence): Promise<boolean> {
    const algorithms = this.#keyAlgorithms.get(evidence.signature.keyId);
    if (!algorithms?.has(evidence.signature.algorithm)) return false;
    const signature = decodeCanonicalBase64(evidence.signature.valueBase64);
    if (
      !signature ||
      signature.byteLength < this.#minimumSignatureBytes ||
      signature.byteLength > this.#maximumSignatureBytes
    ) {
      return false;
    }

    try {
      const output = await this.#client.send(
        new VerifyCommand({
          KeyId: evidence.signature.keyId,
          Message: canonicalMalwareEvidencePayloadBytes(evidence.payload),
          MessageType: MessageType.RAW,
          Signature: signature,
          SigningAlgorithm: awsSigningAlgorithm(evidence.signature.algorithm)
        })
      );
      return output.SignatureValid === true;
    } catch {
      return false;
    }
  }
}

function awsSigningAlgorithm(algorithm: KmsEvidenceAlgorithm): SigningAlgorithmSpec {
  return algorithm === "RSASSA_PSS_SHA_256"
    ? SigningAlgorithmSpec.RSASSA_PSS_SHA_256
    : SigningAlgorithmSpec.ECDSA_SHA_256;
}

function decodeCanonicalBase64(value: string): Uint8Array | null {
  if (
    value.length < 44 ||
    value.length > 1_368 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    return null;
  }
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

function isSafeKeyId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:/_.-]{0,511}$/u.test(value);
}
