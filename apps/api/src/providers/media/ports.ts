import type { MediaType, UUID } from "@clinic-os/domain";

export interface PrivateMediaGatewayScope {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly mediaId: string;
  readonly uploadId: string;
}

export interface PrivateMediaGatewayAuthority extends PrivateMediaGatewayScope {
  readonly actorId: string;
  readonly correlationId: string;
}

export interface PrivateMediaGateway {
  allocateInternalObjectKey(scope: PrivateMediaGatewayScope): string;
  scopeFromInternalObjectKey(key: string): PrivateMediaGatewayScope;
  reserveUpload(
    input: Readonly<{
      authority: PrivateMediaGatewayAuthority;
      internalObjectKey: string;
      kind: MediaType;
      declaredMimeType: string;
      expectedBytes: number;
      expectedSha256Hex: string;
      expiresAt: string;
    }>
  ): Promise<
    Readonly<{
      mediaId: string;
      uploadId: string;
      state: "reserved";
      expiresAt: string;
      upload: Readonly<{
        method: "PUT";
        url: string;
        expiresAt: string;
        requiredHeaders: Readonly<Record<string, string>>;
        maxBytes?: number;
      }>;
    }>
  >;
  ingestProxiedUpload(
    input: Readonly<{
      authority: PrivateMediaGatewayAuthority;
      body: Uint8Array;
      contentType: string;
    }>
  ): Promise<unknown>;
  verifyUploadCompletion(authority: PrivateMediaGatewayAuthority): Promise<unknown>;
  inspectQuarantinedMedia(authority: PrivateMediaGatewayAuthority): Promise<
    Readonly<{
      mediaId: string;
      uploadId: string;
      state: "available" | "quarantined" | "scan_failed";
      scanStatus: "clean" | "quarantined" | "failed";
      evidenceId: string | null;
      scannedAt: string;
    }>
  >;
  createSignedReadAccess(
    authority: PrivateMediaGatewayAuthority,
    expiresAt: string
  ): Promise<
    Readonly<{
      method: "GET";
      url: string;
      expiresAt: string;
      requiredHeaders: Readonly<Record<string, string>>;
    }>
  >;
  internalSnapshot(authority: PrivateMediaGatewayAuthority): Promise<
    Readonly<{
      objectKey: string;
      contentLength: number;
      mimeType: string;
      sha256Digest: string;
      objectVersionId: string | null;
      storedAt: string;
    }>
  >;
  deleteMedia(
    input: Readonly<{
      authority: PrivateMediaGatewayAuthority;
      reason: string;
    }>
  ): Promise<PrivateMediaLifecycleResult>;
  restoreMedia(
    input: Readonly<{
      authority: PrivateMediaGatewayAuthority;
      reason: string;
    }>
  ): Promise<PrivateMediaLifecycleResult>;
  purgeExpiredDeletedMedia(
    authority: PrivateMediaGatewayAuthority
  ): Promise<PrivateMediaLifecycleResult>;
  setLegalHold(authority: PrivateMediaGatewayAuthority, legalHold: boolean): Promise<void>;
}

export interface PrivateMediaLifecycleResult {
  readonly mediaId: string;
  readonly uploadId: string;
  readonly state: "deleted" | "quarantined" | "purged";
  readonly occurredAt: string;
  readonly recoverableUntil: string | null;
}

export interface MediaRequestAuthorityFactory {
  forScope(
    scope: Readonly<{
      tenantId: UUID | string;
      clinicId: UUID | string;
      mediaId: UUID | string;
      uploadId: UUID | string;
    }>
  ): PrivateMediaGatewayAuthority;
}
