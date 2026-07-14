import {
  ClinicOsApiClient,
  ClinicOsApiError,
  type ConsentEnforcementState
} from "../../../lib/apiClient.ts";
import type {
  CaptureAuthorization,
  CaptureUploadTransport,
  MediaUploadReceipt,
  UploadQueueItem,
  UploadReservationState
} from "../types.ts";
import { CaptureQueueError, queueMutationKey } from "../uploadQueue.ts";

export class ClinicOsCaptureTransport implements CaptureUploadTransport {
  readonly #api: ClinicOsApiClient;

  constructor(api: ClinicOsApiClient) {
    this.#api = api;
  }

  async reserve(
    item: UploadQueueItem,
    idempotencyKey: string,
    signal: AbortSignal
  ): Promise<UploadReservationState> {
    try {
      const mediaType = item.kind === "audio" ? "audio_chunk" : "intraoral_photo";
      const originalFilename = item.kind === "audio" ? "clinical-audio.m4a" : "chairside-capture.jpg";
      const response = await this.#api.reserveMediaUpload(
        {
          patientId: item.binding.patientId,
          encounterId: item.binding.encounterId,
          mediaType,
          originalFilename,
          mimeType: item.mimeType,
          fileSizeBytes: item.byteLength,
          sha256Digest: item.sha256Digest,
          tags: ["mobile-capture", item.kind],
          provenance: { captureSurface: "expo_native", offlineQueue: true }
        },
        { idempotencyKey, signal }
      );
      const upload = response.upload;
      if (
        upload.patientId !== item.binding.patientId ||
        upload.encounterId !== item.binding.encounterId ||
        upload.mediaType !== mediaType ||
        upload.mimeType.toLowerCase() !== item.mimeType ||
        upload.expectedFileSizeBytes !== item.byteLength ||
        upload.expectedSha256Digest !== item.sha256Digest
      ) {
        throw new CaptureQueueError(
          "UPLOAD_MANUAL_RETRY_REQUIRED",
          "Media reservation did not preserve the queue binding."
        );
      }
      return { uploadId: upload.id, target: response.uploadTarget };
    } catch (error) {
      throw queueError(error, "reserve");
    }
  }

  async upload(
    item: UploadQueueItem,
    reservation: UploadReservationState,
    bytes: Uint8Array,
    signal: AbortSignal
  ): Promise<void> {
    try {
      await this.#api.uploadMediaContent(reservation.target, bytes, item.mimeType, {
        idempotencyKey: queueMutationKey(item, "content"),
        signal
      });
    } catch (error) {
      throw queueError(error, "content");
    }
  }

  async complete(
    item: UploadQueueItem,
    reservation: UploadReservationState,
    idempotencyKey: string,
    signal: AbortSignal
  ): Promise<MediaUploadReceipt> {
    try {
      const asset = await this.#api.completeMediaUpload(
        {
          uploadId: reservation.uploadId,
          patientId: item.binding.patientId,
          encounterId: item.binding.encounterId,
          contentLength: item.byteLength,
          sha256Digest: item.sha256Digest,
          mimeType: item.mimeType
        },
        { idempotencyKey, signal }
      );
      if (
        asset.patientId !== item.binding.patientId ||
        asset.encounterId !== item.binding.encounterId ||
        asset.mimeType.toLowerCase() !== item.mimeType
      ) {
        throw new CaptureQueueError(
          "UPLOAD_OUTCOME_UNCERTAIN",
          "Media completion response did not preserve the queue binding.",
          { outcomeUncertain: true }
        );
      }
      return { mediaAssetId: asset.id, scanStatus: asset.scanStatus };
    } catch (error) {
      throw queueError(error, "complete");
    }
  }
}

export class ClinicOsCaptureAuthorization implements CaptureAuthorization {
  readonly #api: ClinicOsApiClient;

  constructor(api: ClinicOsApiClient) {
    this.#api = api;
  }

  consentForPatient(patientId: string): Promise<ConsentEnforcementState> {
    return this.#api.getPatientConsents(patientId);
  }

  async assertUploadAllowed(item: UploadQueueItem, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new CaptureQueueError("UPLOAD_RETRY_SCHEDULED", "Upload interrupted.", { retryable: true });
    try {
      const consent = await this.consentForPatient(item.binding.patientId);
      const revoked =
        item.kind === "audio"
          ? !audioConsentActive(consent)
          : !consent.activePurposes.includes("photo_capture") ||
            consent.revokedPurposes.includes("photo_capture");
      if (revoked) {
        throw new CaptureQueueError(
          "CAPTURE_CONSENT_REVOKED",
          "Capture consent is no longer active."
        );
      }
    } catch (error) {
      if (error instanceof CaptureQueueError) throw error;
      throw queueError(error, "authorize");
    }
  }
}

export function audioConsentActive(consent: ConsentEnforcementState): boolean {
  return (
    consent.aiAudioCaptureAllowed &&
    consent.rawAudioRetentionAllowed &&
    !consent.revokedPurposes.includes("ai_audio_capture") &&
    !consent.revokedPurposes.includes("raw_audio_retention")
  );
}

function queueError(
  error: unknown,
  phase: "authorize" | "reserve" | "content" | "complete"
): CaptureQueueError {
  if (error instanceof CaptureQueueError) return error;
  if (!(error instanceof ClinicOsApiError)) {
    return new CaptureQueueError("UPLOAD_RETRY_SCHEDULED", "Live upload request failed.", {
      retryable: true
    });
  }
  if (
    error.code === "UPLOAD_TARGET_INVALID" ||
    error.code === "UPLOAD_TARGET_REJECTED" ||
    error.code === "PRIVATE_MEDIA_REFERENCE"
  ) {
    return new CaptureQueueError(
      "UPLOAD_MANUAL_RETRY_REQUIRED",
      "The live service returned an upload target that requires review."
    );
  }
  if (error.status === 401 || error.code === "SESSION_REVOKED") {
    return new CaptureQueueError(
      "SESSION_REVOKED_PURGE_REQUIRED",
      "The device session is no longer authorized."
    );
  }
  if (phase === "complete" && error.status === 409) {
    return new CaptureQueueError(
      "UPLOAD_OUTCOME_UNCERTAIN",
      "Upload completion could not be reconciled automatically.",
      { outcomeUncertain: true }
    );
  }
  if (error.status === 400 || error.status === 403 || error.code === "BAD_PAYLOAD") {
    return new CaptureQueueError(
      "UPLOAD_MANUAL_RETRY_REQUIRED",
      "The live service rejected the protected upload request."
    );
  }
  const retryable =
    error.status === 0 ||
    error.status === 408 ||
    error.status === 409 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500;
  return new CaptureQueueError(
    retryable ? "UPLOAD_RETRY_SCHEDULED" : "UPLOAD_MANUAL_RETRY_REQUIRED",
    retryable ? "Live upload is temporarily unavailable." : "Live upload requires review.",
    { retryable }
  );
}
