import { createHash } from "node:crypto";
import {
  ChecksumMode,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  ServerSideEncryption,
  type DeleteObjectCommandOutput,
  type GetObjectCommandOutput,
  type GetObjectTaggingCommandOutput,
  type HeadObjectCommandOutput,
  type ListMultipartUploadsCommandOutput,
  type ListObjectVersionsCommandOutput,
  type PutObjectCommandOutput,
  type S3Client
} from "@aws-sdk/client-s3";
import { PrivateMediaError } from "./errors.js";
import type { S3ObjectLocator, S3ObjectSnapshot, S3PrivateObjectTransport } from "./types.js";

type AwsS3ObjectCommand =
  | HeadObjectCommand
  | GetObjectTaggingCommand
  | GetObjectCommand
  | PutObjectCommand
  | DeleteObjectCommand
  | ListMultipartUploadsCommand
  | ListObjectVersionsCommand;

type AwsS3ObjectOutput =
  | HeadObjectCommandOutput
  | GetObjectTaggingCommandOutput
  | GetObjectCommandOutput
  | PutObjectCommandOutput
  | DeleteObjectCommandOutput
  | ListMultipartUploadsCommandOutput
  | ListObjectVersionsCommandOutput;

export interface AwsS3ObjectCommandSender {
  send(command: AwsS3ObjectCommand): Promise<AwsS3ObjectOutput>;
}

export interface AwsS3PrivateObjectTransportConfig {
  readonly bucket: string;
  readonly region: string;
  readonly kmsKeyId: string;
  readonly effectReceiptPrefix?: string;
  readonly maximumVersionPages?: number;
}

interface TargetVersionHistory {
  readonly versions: readonly Readonly<{
    versionId: string;
    isLatest: boolean;
    lastModifiedAt: string;
  }>[];
  readonly deleteMarkers: readonly Readonly<{
    versionId: string;
    isLatest: boolean;
    lastModifiedAt: string;
  }>[];
}

/** Official AWS SDK v3, exact-version private object transport. */
export class AwsS3PrivateObjectTransport implements S3PrivateObjectTransport {
  readonly #client: AwsS3ObjectCommandSender;
  readonly #bucket: string;
  readonly #region: string;
  readonly #kmsKeyId: string;
  readonly #effectReceiptPrefix: string;
  readonly #maximumVersionPages: number;

  constructor(
    client: S3Client | AwsS3ObjectCommandSender,
    config: AwsS3PrivateObjectTransportConfig
  ) {
    assertObjectTransportConfig(config);
    this.#client = client as AwsS3ObjectCommandSender;
    this.#bucket = config.bucket;
    this.#region = config.region;
    this.#kmsKeyId = config.kmsKeyId;
    this.#effectReceiptPrefix = config.effectReceiptPrefix ?? ".clinicos-private-media-effects";
    this.#maximumVersionPages = config.maximumVersionPages ?? 10;
  }

  async headObject(locator: S3ObjectLocator): Promise<S3ObjectSnapshot | null> {
    return this.#sanitized(async () => {
      this.#assertLocator(locator);
      let head: HeadObjectCommandOutput;
      try {
        head = asHeadOutput(
          await this.#client.send(
            new HeadObjectCommand({
              Bucket: this.#bucket,
              Key: locator.key,
              ChecksumMode: ChecksumMode.ENABLED
            })
          )
        );
      } catch (error) {
        if (!isNotFound(error)) throw error;
        if (await this.#hasIncompleteMultipart(locator.key)) {
          throw new PrivateMediaError({
            code: "object_incomplete",
            message: "Multipart media upload is incomplete.",
            retryable: true
          });
        }
        return null;
      }
      const versionId = requireOpaqueProviderValue(head.VersionId);
      const tags = await this.#readTags(locator.key, versionId);
      const incomplete = await this.#hasIncompleteMultipart(locator.key);
      return snapshotFromHead(head, versionId, tags, incomplete ? "incomplete" : undefined);
    });
  }

  async headObjectVersion(
    input: Parameters<S3PrivateObjectTransport["headObjectVersion"]>[0]
  ): Promise<S3ObjectSnapshot | null> {
    return this.#sanitized(async () => {
      this.#assertLocator(input.locator);
      const versionId = requireOpaqueProviderValue(input.versionId);
      let head: HeadObjectCommandOutput;
      try {
        head = asHeadOutput(
          await this.#client.send(
            new HeadObjectCommand({
              Bucket: this.#bucket,
              Key: input.locator.key,
              VersionId: versionId,
              ChecksumMode: ChecksumMode.ENABLED
            })
          )
        );
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      if (head.VersionId !== versionId) throw new Error("S3 returned a different object version.");
      return snapshotFromHead(head, versionId, await this.#readTags(input.locator.key, versionId));
    });
  }

  async readObjectRange(
    input: Parameters<S3PrivateObjectTransport["readObjectRange"]>[0]
  ): Promise<Uint8Array> {
    return this.#sanitized(async () => {
      this.#assertLocator(input.locator);
      const versionId = requireOpaqueProviderValue(input.versionId);
      if (
        !Number.isSafeInteger(input.start) ||
        !Number.isSafeInteger(input.endInclusive) ||
        input.start < 0 ||
        input.endInclusive < input.start ||
        input.endInclusive - input.start + 1 > 65_536
      ) {
        throw new Error("Invalid S3 range budget.");
      }
      const output = asGetOutput(
        await this.#client.send(
          new GetObjectCommand({
            Bucket: this.#bucket,
            Key: input.locator.key,
            VersionId: versionId,
            Range: `bytes=${input.start}-${input.endInclusive}`,
            ChecksumMode: ChecksumMode.ENABLED
          })
        )
      );
      if (output.VersionId !== versionId) throw new Error("S3 returned a different range version.");
      const expectedRange = `bytes ${input.start}-${input.endInclusive}/`;
      if (!output.ContentRange?.startsWith(expectedRange)) {
        throw new Error("S3 returned an unbound object range.");
      }
      const body = await bodyBytes(output.Body);
      if (body.byteLength !== input.endInclusive - input.start + 1) {
        throw new Error("S3 returned an incomplete object range.");
      }
      return body;
    });
  }

  async putObject(
    input: Parameters<S3PrivateObjectTransport["putObject"]>[0]
  ): Promise<S3ObjectSnapshot> {
    return this.#sanitized(async () => {
      this.#assertLocator(input.locator);
      if (input.body.byteLength <= 0 || input.body.byteLength > 512 * 1024 * 1024) {
        throw new Error("Invalid S3 upload size.");
      }
      const checksumHex = requireSha256Hex(input.checksumSha256Hex);
      const actualChecksum = createHash("sha256").update(input.body).digest("hex");
      if (checksumHex !== actualChecksum) throw new Error("S3 upload checksum is inconsistent.");
      const metadata = normalizeStringRecord(input.metadata, 16, 2_048);
      const tags = normalizeStringRecord(input.tags, 10, 256);
      const output = asPutOutput(
        await this.#client.send(
          new PutObjectCommand({
            Bucket: this.#bucket,
            Key: input.locator.key,
            Body: input.body,
            ContentLength: input.body.byteLength,
            ContentType: requireHeaderValue(input.contentType),
            ChecksumSHA256: Buffer.from(checksumHex, "hex").toString("base64"),
            Metadata: metadata,
            Tagging: encodedTags(tags),
            ServerSideEncryption: ServerSideEncryption.aws_kms,
            SSEKMSKeyId: this.#kmsKeyId,
            BucketKeyEnabled: true
          })
        )
      );
      const versionId = requireOpaqueProviderValue(output.VersionId);
      const snapshot = await this.headObjectVersion({ locator: input.locator, versionId });
      if (!snapshot) throw new Error("S3 upload version did not persist.");
      return snapshot;
    });
  }

  async ensureDeleteMarker(
    input: Parameters<S3PrivateObjectTransport["ensureDeleteMarker"]>[0]
  ): Promise<Readonly<{ deleteMarkerVersionId: string; deletedAt: string }>> {
    return this.#sanitized(async () => {
      this.#assertLocator(input.locator);
      const operationId = requireOperationId(input.operationId);
      const requestedAt = requireIsoInstant(input.requestedAt);
      await this.#ensureEffectReceipt("delete-marker", operationId, {
        targetSha256: targetFingerprint(input.locator, null),
        requestedAt
      });

      let history = await this.#listTargetHistory(input.locator.key);
      const threshold = Math.floor(Date.parse(requestedAt) / 1_000) * 1_000;
      const candidates = history.deleteMarkers.filter(
        (marker) => Date.parse(marker.lastModifiedAt) >= threshold
      );
      if (candidates.length > 1) throw new Error("Untracked S3 delete-marker sequence.");
      if (candidates[0]) {
        return Object.freeze({
          deleteMarkerVersionId: candidates[0].versionId,
          deletedAt: candidates[0].lastModifiedAt
        });
      }
      if (history.deleteMarkers.some((marker) => marker.isLatest)) {
        throw new Error("An unrelated S3 delete marker already controls this object.");
      }
      if (history.versions.length === 0) throw new Error("S3 object version is missing.");

      const deleted = asDeleteOutput(
        await this.#client.send(
          new DeleteObjectCommand({ Bucket: this.#bucket, Key: input.locator.key })
        )
      );
      const markerVersionId = requireOpaqueProviderValue(deleted.VersionId);
      if (deleted.DeleteMarker !== true) throw new Error("S3 did not create a delete marker.");
      history = await this.#listTargetHistory(input.locator.key);
      const marker = history.deleteMarkers.find(
        (candidate) => candidate.versionId === markerVersionId
      );
      if (!marker?.isLatest) throw new Error("S3 delete marker could not be reconciled.");
      return Object.freeze({
        deleteMarkerVersionId: marker.versionId,
        deletedAt: marker.lastModifiedAt
      });
    });
  }

  async removeDeleteMarker(
    input: Parameters<S3PrivateObjectTransport["removeDeleteMarker"]>[0]
  ): Promise<void> {
    await this.#sanitized(async () => {
      this.#assertLocator(input.locator);
      const operationId = requireOperationId(input.operationId);
      const versionId = requireOpaqueProviderValue(input.deleteMarkerVersionId);
      const requestedAt = requireIsoInstant(input.requestedAt);
      await this.#ensureEffectReceipt("restore-delete-marker", operationId, {
        targetSha256: targetFingerprint(input.locator, versionId),
        requestedAt
      });
      const history = await this.#listTargetHistory(input.locator.key);
      const marker = history.deleteMarkers.find((candidate) => candidate.versionId === versionId);
      if (!marker) return;
      if (!marker.isLatest)
        throw new Error("Recorded S3 delete marker is no longer authoritative.");
      const deleted = asDeleteOutput(
        await this.#client.send(
          new DeleteObjectCommand({
            Bucket: this.#bucket,
            Key: input.locator.key,
            VersionId: versionId
          })
        )
      );
      if (deleted.DeleteMarker !== true || deleted.VersionId !== versionId) {
        throw new Error("S3 restored a different delete marker.");
      }
      const after = await this.#listTargetHistory(input.locator.key);
      if (after.deleteMarkers.some((candidate) => candidate.versionId === versionId)) {
        throw new Error("S3 delete marker removal did not reconcile.");
      }
    });
  }

  async deleteObjectVersion(
    input: Parameters<S3PrivateObjectTransport["deleteObjectVersion"]>[0]
  ): Promise<void> {
    await this.#sanitized(async () => {
      this.#assertLocator(input.locator);
      const operationId = requireOperationId(input.operationId);
      const versionId = requireOpaqueProviderValue(input.versionId);
      const requestedAt = requireIsoInstant(input.requestedAt);
      await this.#ensureEffectReceipt("purge-version", operationId, {
        targetSha256: targetFingerprint(input.locator, versionId),
        requestedAt
      });
      const history = await this.#listTargetHistory(input.locator.key);
      const exists =
        history.versions.some((candidate) => candidate.versionId === versionId) ||
        history.deleteMarkers.some((candidate) => candidate.versionId === versionId);
      if (!exists) return;
      const deleted = asDeleteOutput(
        await this.#client.send(
          new DeleteObjectCommand({
            Bucket: this.#bucket,
            Key: input.locator.key,
            VersionId: versionId
          })
        )
      );
      if (deleted.VersionId !== versionId) throw new Error("S3 purged a different object version.");
      const after = await this.#listTargetHistory(input.locator.key);
      if (
        after.versions.some((candidate) => candidate.versionId === versionId) ||
        after.deleteMarkers.some((candidate) => candidate.versionId === versionId)
      ) {
        throw new Error("S3 object version purge did not reconcile.");
      }
    });
  }

  async #readTags(key: string, versionId: string): Promise<Readonly<Record<string, string>>> {
    const output = asTagsOutput(
      await this.#client.send(
        new GetObjectTaggingCommand({ Bucket: this.#bucket, Key: key, VersionId: versionId })
      )
    );
    const tags: Record<string, string> = {};
    for (const tag of output.TagSet ?? []) {
      const keyValue = requireOpaqueProviderValue(tag.Key);
      const value = requireOpaqueProviderValue(tag.Value);
      if (tags[keyValue] !== undefined) throw new Error("S3 returned duplicate object tags.");
      tags[keyValue] = value;
    }
    return Object.freeze(tags);
  }

  async #hasIncompleteMultipart(key: string): Promise<boolean> {
    let keyMarker: string | undefined;
    let uploadIdMarker: string | undefined;
    for (let page = 0; page < this.#maximumVersionPages; page += 1) {
      const output = asMultipartOutput(
        await this.#client.send(
          new ListMultipartUploadsCommand({
            Bucket: this.#bucket,
            Prefix: key,
            KeyMarker: keyMarker,
            UploadIdMarker: uploadIdMarker,
            MaxUploads: 1_000
          })
        )
      );
      if ((output.Uploads ?? []).some((upload) => upload.Key === key)) return true;
      if (!output.IsTruncated) return false;
      keyMarker = output.NextKeyMarker;
      uploadIdMarker = output.NextUploadIdMarker;
      if (!keyMarker) throw new Error("S3 multipart pagination was invalid.");
    }
    throw new Error("S3 multipart history exceeded the configured reconciliation budget.");
  }

  async #listTargetHistory(key: string): Promise<TargetVersionHistory> {
    const versions: Array<{ versionId: string; isLatest: boolean; lastModifiedAt: string }> = [];
    const deleteMarkers: Array<{ versionId: string; isLatest: boolean; lastModifiedAt: string }> =
      [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    for (let page = 0; page < this.#maximumVersionPages; page += 1) {
      const output = asVersionsOutput(
        await this.#client.send(
          new ListObjectVersionsCommand({
            Bucket: this.#bucket,
            Prefix: key,
            KeyMarker: keyMarker,
            VersionIdMarker: versionIdMarker,
            MaxKeys: 1_000
          })
        )
      );
      for (const version of output.Versions ?? []) {
        if (version.Key !== key) continue;
        versions.push({
          versionId: requireOpaqueProviderValue(version.VersionId),
          isLatest: version.IsLatest === true,
          lastModifiedAt: requireDate(version.LastModified)
        });
      }
      for (const marker of output.DeleteMarkers ?? []) {
        if (marker.Key !== key) continue;
        deleteMarkers.push({
          versionId: requireOpaqueProviderValue(marker.VersionId),
          isLatest: marker.IsLatest === true,
          lastModifiedAt: requireDate(marker.LastModified)
        });
      }
      if (!output.IsTruncated) {
        return Object.freeze({
          versions: Object.freeze(versions),
          deleteMarkers: Object.freeze(deleteMarkers)
        });
      }
      keyMarker = output.NextKeyMarker;
      versionIdMarker = output.NextVersionIdMarker;
      if (!keyMarker) throw new Error("S3 version pagination was invalid.");
    }
    throw new Error("S3 object history exceeded the configured reconciliation budget.");
  }

  async #ensureEffectReceipt(
    effect: "delete-marker" | "restore-delete-marker" | "purge-version",
    operationId: string,
    target: Readonly<{ targetSha256: string; requestedAt: string }>
  ): Promise<void> {
    const key = `${this.#effectReceiptPrefix}/${effect}/${sha256(operationId)}`;
    const expectedMetadata = Object.freeze({
      "clinicos-effect": effect,
      "clinicos-operation-id-sha256": sha256(operationId),
      "clinicos-target-sha256": target.targetSha256,
      "clinicos-requested-at": target.requestedAt
    });
    const existing = await this.#headEffectReceipt(key);
    if (existing) {
      assertExactMetadata(existing.Metadata, expectedMetadata);
      return;
    }
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: key,
          Body: new Uint8Array(),
          ContentLength: 0,
          ContentType: "application/octet-stream",
          ChecksumSHA256: createHash("sha256").update(new Uint8Array()).digest("base64"),
          Metadata: expectedMetadata,
          Tagging: "clinicos_state=system_receipt",
          ServerSideEncryption: ServerSideEncryption.aws_kms,
          SSEKMSKeyId: this.#kmsKeyId,
          BucketKeyEnabled: true,
          IfNoneMatch: "*"
        })
      );
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
    }
    const committed = await this.#headEffectReceipt(key);
    if (!committed) throw new Error("S3 lifecycle effect receipt was not committed.");
    assertExactMetadata(committed.Metadata, expectedMetadata);
  }

  async #headEffectReceipt(key: string): Promise<HeadObjectCommandOutput | null> {
    try {
      return asHeadOutput(
        await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }))
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  #assertLocator(locator: S3ObjectLocator): void {
    if (
      locator.bucket !== this.#bucket ||
      locator.region !== this.#region ||
      !locator.key ||
      locator.key.length > 1_024 ||
      /[\r\n\u0000]/u.test(locator.key) ||
      locator.key.startsWith(`${this.#effectReceiptPrefix}/`)
    ) {
      throw new PrivateMediaError({
        code: "authority_mismatch",
        message: "The private media object is outside the configured AWS scope."
      });
    }
  }

  async #sanitized<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PrivateMediaError) throw error;
      throw new PrivateMediaError({
        code: "provider_error",
        message: "The private media object service is temporarily unavailable.",
        retryable: true
      });
    }
  }
}

function snapshotFromHead(
  head: HeadObjectCommandOutput,
  versionId: string,
  tags: Readonly<Record<string, string>>,
  multipartOverride?: S3ObjectSnapshot["multipartStatus"]
): S3ObjectSnapshot {
  const checksum = requireSha256Base64(head.ChecksumSHA256);
  const contentLength = head.ContentLength;
  if (!Number.isSafeInteger(contentLength) || contentLength! <= 0) {
    throw new Error("S3 returned an invalid content length.");
  }
  const metadata = normalizeStringRecord(head.Metadata ?? {}, 32, 2_048);
  return Object.freeze({
    contentLength: contentLength!,
    contentType: requireHeaderValue(head.ContentType),
    checksumSha256Hex: Buffer.from(checksum, "base64").toString("hex"),
    versionId,
    etag: head.ETag ? requireOpaqueProviderValue(head.ETag) : null,
    lastModifiedAt: requireDate(head.LastModified),
    serverSideEncryption: head.ServerSideEncryption ?? null,
    kmsKeyId: head.SSEKMSKeyId ? requireOpaqueProviderValue(head.SSEKMSKeyId) : null,
    metadata,
    tags,
    multipartStatus: multipartOverride ?? ((head.PartsCount ?? 0) > 1 ? "completed" : "none")
  });
}

function assertObjectTransportConfig(config: AwsS3PrivateObjectTransportConfig): void {
  if (
    !/^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(config.bucket) ||
    !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(config.region) ||
    !config.kmsKeyId ||
    config.kmsKeyId.length > 512 ||
    (config.effectReceiptPrefix !== undefined &&
      !/^\.[a-z0-9][a-z0-9-]{2,63}$/u.test(config.effectReceiptPrefix)) ||
    !Number.isSafeInteger(config.maximumVersionPages ?? 10) ||
    (config.maximumVersionPages ?? 10) <= 0 ||
    (config.maximumVersionPages ?? 10) > 100
  ) {
    throw new TypeError("AWS S3 private object transport configuration is invalid.");
  }
}

function normalizeStringRecord(
  value: Readonly<Record<string, string>>,
  maximumEntries: number,
  maximumValueLength: number
): Readonly<Record<string, string>> {
  const entries = Object.entries(value);
  if (entries.length > maximumEntries) throw new Error("S3 metadata exceeded its field budget.");
  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(key) ||
      typeof rawValue !== "string" ||
      rawValue.length > maximumValueLength ||
      /[\r\n\u0000]/u.test(rawValue) ||
      normalized[key] !== undefined
    ) {
      throw new Error("S3 returned invalid metadata.");
    }
    normalized[key] = rawValue;
  }
  return Object.freeze(normalized);
}

function encodedTags(tags: Readonly<Record<string, string>>): string {
  return Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function assertExactMetadata(
  actual: Readonly<Record<string, string>> | undefined,
  expected: Readonly<Record<string, string>>
): void {
  const normalized = normalizeStringRecord(actual ?? {}, 16, 2_048);
  const actualKeys = Object.keys(normalized).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some(
      (key, index) => key !== expectedKeys[index] || normalized[key] !== expected[key]
    )
  ) {
    throw new Error("S3 lifecycle operation ID was reused for a different target.");
  }
}

async function bodyBytes(body: GetObjectCommandOutput["Body"]): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (body && typeof body === "object" && "transformToByteArray" in body) {
    const transform = body.transformToByteArray;
    if (typeof transform === "function") return transform.call(body);
  }
  throw new Error("S3 range response body was unavailable.");
}

function targetFingerprint(locator: S3ObjectLocator, versionId: string | null): string {
  return sha256([locator.region, locator.bucket, locator.key, versionId ?? ""].join("\u001f"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireOperationId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw new Error("Invalid private-media lifecycle operation ID.");
  }
  return value;
}

function requireIsoInstant(value: string): string {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error("Invalid private-media lifecycle timestamp.");
  }
  return value;
}

function requireDate(value: Date | undefined): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("S3 returned an invalid timestamp.");
  }
  return value.toISOString();
}

function requireHeaderValue(value: string | undefined): string {
  if (!value || value.length > 256 || /[\r\n\u0000]/u.test(value)) {
    throw new Error("S3 returned an invalid header value.");
  }
  return value;
}

function requireOpaqueProviderValue(value: string | undefined): string {
  if (!value || value.length > 1_024 || /[\r\n\u0000]/u.test(value)) {
    throw new Error("S3 returned an invalid opaque value.");
  }
  return value;
}

function requireSha256Hex(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new Error("Invalid SHA-256 digest.");
  return normalized;
}

function requireSha256Base64(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
    throw new Error("S3 did not return a full-object SHA-256 checksum.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength !== 32 || bytes.toString("base64") !== value) {
    throw new Error("S3 returned an invalid SHA-256 checksum.");
  }
  return value;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  const status =
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object" &&
    "httpStatusCode" in error.$metadata
      ? error.$metadata.httpStatusCode
      : null;
  return status === 404 || name === "NotFound" || name === "NoSuchKey" || name === "NoSuchVersion";
}

function isPreconditionFailed(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error && typeof error.name === "string" ? error.name : "";
  const status =
    "$metadata" in error &&
    error.$metadata &&
    typeof error.$metadata === "object" &&
    "httpStatusCode" in error.$metadata
      ? error.$metadata.httpStatusCode
      : null;
  return status === 412 || name === "PreconditionFailed";
}

function asHeadOutput(value: AwsS3ObjectOutput): HeadObjectCommandOutput {
  return value as HeadObjectCommandOutput;
}
function asTagsOutput(value: AwsS3ObjectOutput): GetObjectTaggingCommandOutput {
  return value as GetObjectTaggingCommandOutput;
}
function asGetOutput(value: AwsS3ObjectOutput): GetObjectCommandOutput {
  return value as GetObjectCommandOutput;
}
function asPutOutput(value: AwsS3ObjectOutput): PutObjectCommandOutput {
  return value as PutObjectCommandOutput;
}
function asDeleteOutput(value: AwsS3ObjectOutput): DeleteObjectCommandOutput {
  return value as DeleteObjectCommandOutput;
}
function asMultipartOutput(value: AwsS3ObjectOutput): ListMultipartUploadsCommandOutput {
  return value as ListMultipartUploadsCommandOutput;
}
function asVersionsOutput(value: AwsS3ObjectOutput): ListObjectVersionsCommandOutput {
  return value as ListObjectVersionsCommandOutput;
}
