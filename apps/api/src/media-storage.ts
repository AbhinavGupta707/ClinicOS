import { createHash, randomUUID } from "node:crypto";
import {
  buildPrivateMediaObjectKey,
  type MediaStorageProviderKey,
  type UUID
} from "@clinic-os/domain";

export interface MediaUploadTargetInput {
  uploadId: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  objectKey: string;
  mimeType: string;
  expectedFileSizeBytes: number;
  expectedSha256Digest?: string | null;
  expiresAt: string;
}

export interface MediaUploadTarget {
  method: "PUT";
  uploadUrl: string;
  expiresAt: string;
  maxBytes: number;
  requiredHeaders: Record<string, string>;
}

export interface StoredMediaObject {
  objectKey: string;
  contentLength: number;
  mimeType: string;
  sha256Digest: string;
  metadata: Record<string, string>;
  storedAt: string;
}

export interface MediaSignedReadAccess {
  method: "GET";
  signedUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
}

export interface MediaStorageProvider {
  readonly providerKey: MediaStorageProviderKey;
  readonly region: string | null;
  buildObjectKey(input: {
    tenantId: UUID;
    clinicId: UUID;
    patientId: UUID;
    uploadId: UUID;
    originalFilename: string;
  }): string;
  createUploadTarget(input: MediaUploadTargetInput): Promise<MediaUploadTarget>;
  receiveUpload(input: {
    objectKey: string;
    body: Buffer;
    mimeType: string;
    metadata: Record<string, string>;
  }): Promise<StoredMediaObject>;
  statObject(objectKey: string): Promise<StoredMediaObject | null>;
  createSignedReadAccess(input: {
    objectKey: string;
    mimeType: string;
    expiresAt: string;
  }): Promise<MediaSignedReadAccess>;
}

export interface LocalMediaStorageSimulatorOptions {
  environment: string;
  region?: string | null;
  publicBaseUrl?: string;
  uploadBasePath?: string;
}

export class LocalMediaStorageSimulator implements MediaStorageProvider {
  readonly providerKey = "local_simulator" as const;
  readonly region: string | null;
  readonly #environment: string;
  readonly #publicBaseUrl: string;
  readonly #uploadBasePath: string;
  readonly #objects = new Map<string, StoredMediaObject>();
  readonly #readTokens = new Map<string, { objectKey: string; expiresAt: string }>();

  constructor(options: LocalMediaStorageSimulatorOptions) {
    this.#environment = options.environment;
    this.region = options.region ?? null;
    this.#publicBaseUrl = (options.publicBaseUrl ?? "https://storage.clinicos.local").replace(
      /\/$/,
      ""
    );
    this.#uploadBasePath = options.uploadBasePath ?? "/v1/media/uploads";
  }

  buildObjectKey(input: {
    tenantId: UUID;
    clinicId: UUID;
    patientId: UUID;
    uploadId: UUID;
    originalFilename: string;
  }): string {
    return buildPrivateMediaObjectKey({
      environment: this.#environment,
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      uploadId: input.uploadId,
      originalFilename: input.originalFilename
    });
  }

  async createUploadTarget(input: MediaUploadTargetInput): Promise<MediaUploadTarget> {
    return {
      method: "PUT",
      uploadUrl: `${this.#uploadBasePath}/${input.uploadId}/content`,
      expiresAt: input.expiresAt,
      maxBytes: input.expectedFileSizeBytes,
      requiredHeaders: {
        "content-type": input.mimeType,
        "x-clinic-os-upload-id": input.uploadId
      }
    };
  }

  async receiveUpload(input: {
    objectKey: string;
    body: Buffer;
    mimeType: string;
    metadata: Record<string, string>;
  }): Promise<StoredMediaObject> {
    const object: StoredMediaObject = {
      objectKey: input.objectKey,
      contentLength: input.body.byteLength,
      mimeType: input.mimeType,
      sha256Digest: createHash("sha256").update(input.body).digest("hex"),
      metadata: input.metadata,
      storedAt: new Date().toISOString()
    };
    this.#objects.set(input.objectKey, object);
    return object;
  }

  async statObject(objectKey: string): Promise<StoredMediaObject | null> {
    return this.#objects.get(objectKey) ?? null;
  }

  async createSignedReadAccess(input: {
    objectKey: string;
    mimeType: string;
    expiresAt: string;
  }): Promise<MediaSignedReadAccess> {
    const token = randomUUID();
    this.#readTokens.set(token, { objectKey: input.objectKey, expiresAt: input.expiresAt });

    return {
      method: "GET",
      signedUrl: `${this.#publicBaseUrl}/media-access/${token}`,
      expiresAt: input.expiresAt,
      headers: {
        accept: input.mimeType
      }
    };
  }

  getObjectForReadToken(token: string): StoredMediaObject | null {
    const access = this.#readTokens.get(token);
    if (!access) return null;
    if (new Date(access.expiresAt).getTime() <= Date.now()) return null;
    return this.#objects.get(access.objectKey) ?? null;
  }
}
