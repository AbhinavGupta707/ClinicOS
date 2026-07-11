import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { PrivateMediaError } from "./errors.js";
import type { S3ObjectLocator, S3PresigningTransport, SignedTransportRequest } from "./types.js";

const PUT_SIGNED_HEADERS = Object.freeze([
  "content-length",
  "content-type",
  "host",
  "x-amz-checksum-sha256",
  "x-amz-meta-clinicos-binding",
  "x-amz-server-side-encryption",
  "x-amz-server-side-encryption-aws-kms-key-id",
  "x-amz-tagging"
]);
const GET_SIGNED_HEADERS = Object.freeze(["host"]);

export type AwsS3PresignCommand = PutObjectCommand | GetObjectCommand;

export interface AwsS3PresignClient {}

export type AwsS3PresignFunction = (
  client: AwsS3PresignClient,
  command: AwsS3PresignCommand,
  options: Readonly<{
    expiresIn: number;
    signableHeaders?: ReadonlySet<string>;
    unhoistableHeaders?: ReadonlySet<string>;
  }>
) => Promise<string>;

export interface AwsS3PresigningTransportConfig {
  readonly bucket: string;
  readonly region: string;
  /** Exact KMS key required by bucket default encryption/policy and verified at completion. */
  readonly kmsKeyId: string;
  readonly endpointOrigins: readonly string[];
  readonly now: () => Date;
}

/** Official AWS SDK v3 presigner with an exact, short-lived object/method/header capability. */
export class AwsS3PresigningTransport implements S3PresigningTransport {
  readonly #client: AwsS3PresignClient;
  readonly #bucket: string;
  readonly #region: string;
  readonly #kmsKeyId: string;
  readonly #endpointOrigins: ReadonlySet<string>;
  readonly #now: () => Date;
  readonly #presign: AwsS3PresignFunction;

  constructor(
    client: S3Client | AwsS3PresignClient,
    config: AwsS3PresigningTransportConfig,
    presign: AwsS3PresignFunction = officialPresign
  ) {
    assertAwsScopeConfig(config);
    this.#client = client;
    this.#bucket = config.bucket;
    this.#region = config.region;
    this.#kmsKeyId = config.kmsKeyId;
    this.#endpointOrigins = new Set(config.endpointOrigins.map((origin) => new URL(origin).origin));
    this.#now = config.now;
    this.#presign = presign;
  }

  async signPutObject(
    input: Parameters<S3PresigningTransport["signPutObject"]>[0]
  ): Promise<SignedTransportRequest> {
    try {
      this.#assertLocator(input.locator);
      const expires = boundedExpiry(input.expiresAt, this.#now(), 900);
      if (!Number.isSafeInteger(input.contentLength) || input.contentLength <= 0) {
        throw new Error("invalid content length");
      }
      const contentType = requireHeaderValue(input.contentType);
      const checksum = requireSha256Base64(input.checksumSha256Base64);
      if (
        Object.keys(input.metadata).length !== 1 ||
        !/^[A-Za-z0-9_-]{40,128}$/u.test(input.metadata["clinicos-binding"] ?? "") ||
        Object.keys(input.tags).length !== 1 ||
        input.tags.clinicos_state !== "quarantine"
      ) {
        throw new Error("invalid private-media binding");
      }
      const headers = Object.freeze({
        "content-type": contentType,
        "content-length": String(input.contentLength),
        "x-amz-checksum-sha256": checksum,
        "x-amz-meta-clinicos-binding": input.metadata["clinicos-binding"]!,
        "x-amz-server-side-encryption": "aws:kms",
        "x-amz-server-side-encryption-aws-kms-key-id": this.#kmsKeyId,
        "x-amz-tagging": "clinicos_state=quarantine"
      });
      const url = await this.#presign(
        this.#client,
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: input.locator.key,
          ContentLength: input.contentLength,
          ContentType: contentType,
          ChecksumSHA256: checksum,
          Metadata: { "clinicos-binding": input.metadata["clinicos-binding"]! },
          Tagging: "clinicos_state=quarantine",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: this.#kmsKeyId
        }),
        {
          expiresIn: expires.expiresIn,
          signableHeaders: new Set(PUT_SIGNED_HEADERS.filter((name) => name !== "host")),
          unhoistableHeaders: new Set(PUT_SIGNED_HEADERS.filter((name) => name !== "host"))
        }
      );
      this.#validateSignedUrl(url, {
        locator: input.locator,
        expiresIn: expires.expiresIn,
        method: "PUT",
        versionId: null,
        responseContentType: null,
        signedHeaders: PUT_SIGNED_HEADERS
      });
      return Object.freeze({
        method: "PUT",
        url,
        expiresAt: expires.expiresAt,
        requiredHeaders: headers
      });
    } catch {
      throw sanitizedPresigningError();
    }
  }

  async signGetObject(
    input: Parameters<S3PresigningTransport["signGetObject"]>[0]
  ): Promise<SignedTransportRequest> {
    try {
      this.#assertLocator(input.locator);
      const expires = boundedExpiry(input.expiresAt, this.#now(), 300);
      const versionId = requireOpaque(input.versionId);
      const responseContentType = requireHeaderValue(input.responseContentType);
      const url = await this.#presign(
        this.#client,
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: input.locator.key,
          VersionId: versionId,
          ResponseContentType: responseContentType
        }),
        { expiresIn: expires.expiresIn }
      );
      this.#validateSignedUrl(url, {
        locator: input.locator,
        expiresIn: expires.expiresIn,
        method: "GET",
        versionId,
        responseContentType,
        signedHeaders: GET_SIGNED_HEADERS
      });
      return Object.freeze({
        method: "GET",
        url,
        expiresAt: expires.expiresAt,
        requiredHeaders: Object.freeze({})
      });
    } catch {
      throw sanitizedPresigningError();
    }
  }

  #assertLocator(locator: S3ObjectLocator): void {
    if (
      locator.bucket !== this.#bucket ||
      locator.region !== this.#region ||
      !isSafeObjectKey(locator.key)
    ) {
      throw new Error("invalid S3 object scope");
    }
  }

  #validateSignedUrl(
    value: string,
    expected: Readonly<{
      locator: S3ObjectLocator;
      expiresIn: number;
      method: "PUT" | "GET";
      versionId: string | null;
      responseContentType: string | null;
      signedHeaders: readonly string[];
    }>
  ): void {
    if (value.length > 8_192) throw new Error("oversized signed URL");
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.hash ||
      !this.#endpointOrigins.has(parsed.origin)
    ) {
      throw new Error("unapproved signed endpoint");
    }
    const encodedKey = `/${expected.locator.key
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")}`;
    const virtualHosted = parsed.hostname.startsWith(`${this.#bucket}.s3.`);
    const expectedPath = virtualHosted
      ? encodedKey
      : `/${encodeURIComponent(this.#bucket)}${encodedKey}`;
    if (parsed.pathname !== expectedPath) throw new Error("wrong signed object path");

    if (parsed.searchParams.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256") {
      throw new Error("wrong signing algorithm");
    }
    const credential = parsed.searchParams.get("X-Amz-Credential") ?? "";
    const credentialParts = credential.split("/");
    if (
      credentialParts.length !== 5 ||
      credentialParts[2] !== this.#region ||
      credentialParts[3] !== "s3" ||
      credentialParts[4] !== "aws4_request"
    ) {
      throw new Error("wrong signing scope");
    }
    if (parsed.searchParams.get("X-Amz-Expires") !== String(expected.expiresIn)) {
      throw new Error("wrong signing expiry");
    }
    if (!/^[a-f0-9]{64}$/u.test(parsed.searchParams.get("X-Amz-Signature") ?? "")) {
      throw new Error("invalid signing output");
    }
    const signedHeaders = (parsed.searchParams.get("X-Amz-SignedHeaders") ?? "")
      .split(";")
      .filter(Boolean)
      .sort();
    const requiredSignedHeaders = [...expected.signedHeaders].sort();
    if (
      signedHeaders.length !== requiredSignedHeaders.length ||
      signedHeaders.some((header, index) => header !== requiredSignedHeaders[index])
    ) {
      throw new Error("wrong signed headers");
    }
    const versionIds = parsed.searchParams.getAll("versionId");
    if (
      expected.versionId === null
        ? versionIds.length !== 0
        : versionIds.length !== 1 || versionIds[0] !== expected.versionId
    ) {
      throw new Error("wrong signed object version");
    }
    const responseTypes = parsed.searchParams.getAll("response-content-type");
    if (
      expected.responseContentType === null
        ? responseTypes.length !== 0
        : responseTypes.length !== 1 || responseTypes[0] !== expected.responseContentType
    ) {
      throw new Error("wrong response type capability");
    }
    const xId = parsed.searchParams.get("x-id");
    if (xId !== null && xId !== (expected.method === "PUT" ? "PutObject" : "GetObject")) {
      throw new Error("wrong signed operation");
    }
  }
}

const officialPresign: AwsS3PresignFunction = async (client, command, options) =>
  getSignedUrl(client as S3Client, command, {
    expiresIn: options.expiresIn,
    signableHeaders: options.signableHeaders ? new Set(options.signableHeaders) : undefined,
    unhoistableHeaders: options.unhoistableHeaders ? new Set(options.unhoistableHeaders) : undefined
  });

function assertAwsScopeConfig(config: AwsS3PresigningTransportConfig): void {
  if (
    !isSafeBucket(config.bucket) ||
    !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(config.region) ||
    !config.kmsKeyId ||
    config.kmsKeyId.length > 512 ||
    typeof config.now !== "function" ||
    config.endpointOrigins.length === 0 ||
    config.endpointOrigins.length > 4
  ) {
    throw new TypeError("AWS S3 presigning scope configuration is invalid.");
  }
  const supported = new Set([
    `https://${config.bucket}.s3.${config.region}.amazonaws.com`,
    `https://${config.bucket}.s3.dualstack.${config.region}.amazonaws.com`,
    `https://s3.${config.region}.amazonaws.com`,
    `https://s3.dualstack.${config.region}.amazonaws.com`
  ]);
  const origins = new Set<string>();
  for (const value of config.endpointOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new TypeError("AWS S3 presigning endpoint configuration is invalid.");
    }
    if (
      parsed.origin !== value ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      !supported.has(parsed.origin)
    ) {
      throw new TypeError("AWS S3 presigning endpoint configuration is invalid.");
    }
    origins.add(parsed.origin);
  }
  if (origins.size !== config.endpointOrigins.length) {
    throw new TypeError("AWS S3 presigning endpoint configuration is invalid.");
  }
}

function boundedExpiry(value: string, now: Date, maximumSeconds: number) {
  const expiresAt = Date.parse(value);
  const expiresIn = Math.floor((expiresAt - now.getTime()) / 1_000);
  if (!Number.isSafeInteger(expiresIn) || expiresIn <= 0 || expiresIn > maximumSeconds) {
    throw new Error("invalid presigning expiry");
  }
  return {
    expiresIn,
    expiresAt: new Date(now.getTime() + expiresIn * 1_000).toISOString()
  };
}

function requireSha256Base64(value: string): string {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) throw new Error("invalid SHA-256 checksum");
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength !== 32 || bytes.toString("base64") !== value) {
    throw new Error("invalid SHA-256 checksum");
  }
  return value;
}

function requireHeaderValue(value: string): string {
  if (!value || value.length > 256 || /[\r\n\u0000]/u.test(value)) {
    throw new Error("invalid signed header");
  }
  return value;
}

function requireOpaque(value: string): string {
  if (!value || value.length > 1_024 || /[\r\n\u0000]/u.test(value)) {
    throw new Error("invalid opaque provider value");
  }
  return value;
}

function isSafeBucket(value: string): boolean {
  return /^(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value);
}

function isSafeObjectKey(value: string): boolean {
  return value.length > 0 && value.length <= 1_024 && !/[\r\n\u0000]/u.test(value);
}

function sanitizedPresigningError(): PrivateMediaError {
  return new PrivateMediaError({
    code: "provider_error",
    message: "The private media signing service is temporarily unavailable.",
    retryable: true
  });
}
