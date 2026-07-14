import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";

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

export interface Cp16KmsCommandSender {
  send(command: GenerateDataKeyCommand | DecryptCommand): Promise<{
    readonly Plaintext?: Uint8Array;
    readonly CiphertextBlob?: Uint8Array;
  }>;
}

const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const ENVELOPE_VERSION = 1;
const ENCRYPTED_DATA_KEY_PREFIX = "aws-kms:v1:";
const MAXIMUM_PLAINTEXT_BYTES = 8 * 1024 * 1024;

/**
 * AWS KMS envelope encryption for CP16 clinical payloads. KMS only wraps a one-use data key; the
 * bounded payload is encrypted locally with AES-256-GCM and the complete CP16 scope is bound as
 * authenticated additional data. The plaintext data key is zeroized after each operation.
 */
export class AwsKmsCp16ProtectedPayloadCodec implements Cp16ProtectedPayloadCodec {
  readonly #kms: Cp16KmsCommandSender;
  readonly #keyId: string;

  constructor(input: { readonly kms: Cp16KmsCommandSender; readonly keyId: string }) {
    if (!validKmsKeyId(input.keyId)) {
      throw new Error("CP16 payload KMS key configuration is invalid.");
    }
    this.#kms = input.kms;
    this.#keyId = input.keyId;
  }

  async protectJson(
    value: unknown,
    context: Cp16ProtectedPayloadContext
  ): Promise<Cp16ProtectedPayload> {
    const plaintext = serializeProtectedJson(value);
    const contextDigest = cp16PayloadContextDigest(context);
    const encryptionContext = kmsEncryptionContext(contextDigest);
    let response: { readonly Plaintext?: Uint8Array; readonly CiphertextBlob?: Uint8Array };
    try {
      response = await this.#kms.send(
        new GenerateDataKeyCommand({
          KeyId: this.#keyId,
          KeySpec: "AES_256",
          EncryptionContext: encryptionContext
        })
      );
    } catch {
      plaintext.fill(0);
      throw unavailableCodec();
    }
    const key = boundedDataKey(response.Plaintext);
    const encryptedDataKey = boundedEncryptedDataKey(response.CiphertextBlob);
    try {
      const iv = randomBytes(GCM_IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(contextDigest, "hex"), { plaintextLength: plaintext.byteLength });
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      const ciphertext = Buffer.concat([Buffer.from([ENVELOPE_VERSION]), iv, tag, encrypted]);
      return assertProtectedPayload(
        {
          algorithm: CP16_PROTECTED_PAYLOAD_ALGORITHM,
          ciphertext,
          keyReference: `${ENCRYPTED_DATA_KEY_PREFIX}${Buffer.from(encryptedDataKey).toString("base64")}`,
          plaintextDigest: createHash("sha256").update(plaintext).digest("hex")
        },
        MAXIMUM_PLAINTEXT_BYTES + 1 + GCM_IV_BYTES + GCM_TAG_BYTES
      );
    } catch {
      throw unavailableCodec();
    } finally {
      key.fill(0);
      plaintext.fill(0);
    }
  }

  async revealJson(
    payload: Cp16ProtectedPayload,
    context: Cp16ProtectedPayloadContext
  ): Promise<unknown> {
    const protectedPayload = assertProtectedPayload(
      payload,
      MAXIMUM_PLAINTEXT_BYTES + 1 + GCM_IV_BYTES + GCM_TAG_BYTES
    );
    const encryptedDataKey = parseEncryptedDataKey(protectedPayload.keyReference);
    const contextDigest = cp16PayloadContextDigest(context);
    let response: { readonly Plaintext?: Uint8Array };
    try {
      response = await this.#kms.send(
        new DecryptCommand({
          CiphertextBlob: encryptedDataKey,
          KeyId: this.#keyId,
          EncryptionAlgorithm: "SYMMETRIC_DEFAULT",
          EncryptionContext: kmsEncryptionContext(contextDigest)
        })
      );
    } catch {
      throw unavailableCodec();
    }
    const key = boundedDataKey(response.Plaintext);
    let plaintext: Buffer | null = null;
    try {
      const encrypted = unpackCiphertext(protectedPayload.ciphertext);
      const decipher = createDecipheriv("aes-256-gcm", key, encrypted.iv);
      decipher.setAAD(Buffer.from(contextDigest, "hex"), {
        plaintextLength: encrypted.body.byteLength
      });
      decipher.setAuthTag(encrypted.tag);
      plaintext = Buffer.concat([decipher.update(encrypted.body), decipher.final()]);
      if (plaintext.byteLength > MAXIMUM_PLAINTEXT_BYTES) throw unavailableCodec();
      const digest = createHash("sha256").update(plaintext).digest();
      const expectedDigest = Buffer.from(protectedPayload.plaintextDigest, "hex");
      if (
        digest.byteLength !== expectedDigest.byteLength ||
        !timingSafeEqual(digest, expectedDigest)
      ) {
        throw unavailableCodec();
      }
      return parseProtectedJson(plaintext);
    } catch {
      throw unavailableCodec();
    } finally {
      key.fill(0);
      plaintext?.fill(0);
    }
  }
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

function serializeProtectedJson(value: unknown): Buffer {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw unavailableCodec();
  }
  if (encoded === undefined) throw unavailableCodec();
  const plaintext = Buffer.from(encoded, "utf8");
  if (plaintext.byteLength < 1 || plaintext.byteLength > MAXIMUM_PLAINTEXT_BYTES) {
    plaintext.fill(0);
    throw unavailableCodec();
  }
  return plaintext;
}

function parseProtectedJson(plaintext: Uint8Array): unknown {
  try {
    return JSON.parse(Buffer.from(plaintext).toString("utf8")) as unknown;
  } catch {
    throw unavailableCodec();
  }
}

function boundedDataKey(value: Uint8Array | undefined): Buffer {
  if (!value || value.byteLength !== AES_KEY_BYTES) throw unavailableCodec();
  return Buffer.from(value);
}

function boundedEncryptedDataKey(value: Uint8Array | undefined): Uint8Array {
  if (!value || value.byteLength < 32 || value.byteLength > 1_400) throw unavailableCodec();
  return value;
}

function parseEncryptedDataKey(keyReference: string): Uint8Array {
  if (!keyReference.startsWith(ENCRYPTED_DATA_KEY_PREFIX)) throw unavailableCodec();
  const encoded = keyReference.slice(ENCRYPTED_DATA_KEY_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)) throw unavailableCodec();
  return boundedEncryptedDataKey(Buffer.from(encoded, "base64"));
}

function unpackCiphertext(value: Uint8Array): {
  readonly iv: Uint8Array;
  readonly tag: Uint8Array;
  readonly body: Uint8Array;
} {
  const minimumLength = 1 + GCM_IV_BYTES + GCM_TAG_BYTES + 1;
  if (value.byteLength < minimumLength || value[0] !== ENVELOPE_VERSION) throw unavailableCodec();
  const ivStart = 1;
  const tagStart = ivStart + GCM_IV_BYTES;
  const bodyStart = tagStart + GCM_TAG_BYTES;
  return {
    iv: value.slice(ivStart, tagStart),
    tag: value.slice(tagStart, bodyStart),
    body: value.slice(bodyStart)
  };
}

function kmsEncryptionContext(contextDigest: string): Readonly<Record<string, string>> {
  return {
    "clinicos:purpose": "cp16-protected-payload-v1",
    "clinicos:context-digest": contextDigest
  };
}

function validKmsKeyId(value: string): boolean {
  return (
    value.length >= 5 &&
    value.length <= 512 &&
    !/[\s\0\r\n]/u.test(value) &&
    /^(?:alias\/[A-Za-z0-9/_-]+|arn:aws(?:-[a-z]+)?:kms:[a-z0-9-]+:\d{12}:(?:key\/[0-9a-f-]{36}|alias\/[A-Za-z0-9/_-]+)|[0-9a-f-]{36})$/iu.test(
      value
    )
  );
}

function unavailableCodec(): Error {
  return new Error("Protected clinical payload encryption is unavailable.");
}
