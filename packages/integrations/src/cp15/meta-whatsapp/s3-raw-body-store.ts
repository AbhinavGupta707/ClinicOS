import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import { MetaWhatsAppError } from "./errors.js";
import type { MetaEncryptedRawBodyStore } from "./types.js";

interface S3WriteClient {
  send(command: PutObjectCommand | DeleteObjectCommand): Promise<{ VersionId?: string }>;
}

export class S3MetaEncryptedRawBodyStore implements MetaEncryptedRawBodyStore {
  readonly #client: S3WriteClient;
  readonly #bucket: string;
  readonly #prefix: string;
  readonly #kmsKeyId: string;

  constructor(input: {
    readonly client: S3WriteClient;
    readonly bucket: string;
    readonly prefix: string;
    readonly kmsKeyId: string;
  }) {
    this.#client = input.client;
    this.#bucket = bucket(input.bucket);
    this.#prefix = prefix(input.prefix);
    this.#kmsKeyId = required(input.kmsKeyId, 2048);
  }

  async put(input: Parameters<MetaEncryptedRawBodyStore["put"]>[0]) {
    if (input.bytes.byteLength < 1 || input.bytes.byteLength > 1024 * 1024) {
      throw storeError();
    }
    if (!/^[0-9a-f]{64}$/u.test(input.sha256)) throw storeError();
    const actual = createHash("sha256").update(input.bytes).digest("hex");
    if (actual !== input.sha256) throw storeError();
    const key = objectKey(this.#prefix, input);
    let versionId: string | undefined;
    try {
      const result = await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          Body: input.bytes,
          ContentLength: input.bytes.byteLength,
          ContentType: "application/octet-stream",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: this.#kmsKeyId,
          BucketKeyEnabled: true,
          Metadata: {
            sha256: input.sha256,
            retention_class: input.retentionClass
          },
          Tagging: "data-classification=provider-webhook-restricted&managed-by=clinicos"
        })
      );
      versionId = result.VersionId;
    } catch {
      throw storeError();
    }
    return {
      ciphertextRef: `s3://${this.#bucket}/${key}${versionId ? `#version=${encodeURIComponent(versionId)}` : ""}`
    };
  }

  async deleteUncommitted(input: { readonly ciphertextRef: string; readonly reason: string }) {
    if (input.reason !== "transaction_not_committed") throw storeError();
    const parsed = parseReference(input.ciphertextRef, this.#bucket, this.#prefix);
    try {
      await this.#client.send(
        new DeleteObjectCommand({
          Bucket: this.#bucket,
          Key: parsed.key,
          ...(parsed.versionId ? { VersionId: parsed.versionId } : {})
        })
      );
    } catch {
      throw storeError();
    }
  }
}

export function createS3MetaEncryptedRawBodyStore(input: {
  readonly aws: S3ClientConfig;
  readonly bucket: string;
  readonly prefix: string;
  readonly kmsKeyId: string;
}): S3MetaEncryptedRawBodyStore {
  return new S3MetaEncryptedRawBodyStore({
    client: new S3Client(input.aws),
    bucket: input.bucket,
    prefix: input.prefix,
    kmsKeyId: input.kmsKeyId
  });
}

function objectKey(
  root: string,
  input: Parameters<MetaEncryptedRawBodyStore["put"]>[0]
): string {
  for (const value of [input.tenantId, input.clinicId]) {
    if (!/^[0-9a-f-]{36}$/iu.test(value)) throw storeError();
  }
  if (!/^meta_raw_[0-9a-f]{64}$/u.test(input.rawEventId)) throw storeError();
  return `${root}/${input.tenantId}/${input.clinicId}/${input.rawEventId}.bin`;
}

function parseReference(value: string, expectedBucket: string, expectedPrefix: string) {
  const match = /^s3:\/\/([^/]+)\/(.+?)(?:#version=([^#]+))?$/u.exec(value);
  if (!match || match[1] !== expectedBucket || !match[2]?.startsWith(`${expectedPrefix}/`)) {
    throw storeError();
  }
  return {
    key: match[2],
    versionId: match[3] ? decodeURIComponent(match[3]) : null
  };
}

function bucket(value: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value)) throw storeError();
  return value;
}

function prefix(value: string): string {
  const normalized = value.replace(/^\/+|\/+$/gu, "");
  if (!normalized || normalized.length > 512 || /\.\.|[\0\r\n]/u.test(normalized)) {
    throw storeError();
  }
  return normalized;
}

function required(value: string, maximum: number): string {
  if (!value || value.length > maximum || /[\0\r\n]/u.test(value)) throw storeError();
  return value;
}

function storeError(): MetaWhatsAppError {
  return new MetaWhatsAppError({
    code: "persistence_failed",
    message: "Restricted Meta webhook storage is unavailable.",
    httpStatus: 503,
    retryable: true
  });
}
