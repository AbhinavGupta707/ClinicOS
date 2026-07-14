import type { ConsentEnforcementState } from "../../../lib/apiClient";
import type {
  CaptureAuthorization,
  CaptureUploadTransport,
  MediaUploadReceipt,
  UploadQueueItem,
  UploadReservationState
} from "../types";
import { CaptureQueueError } from "../uploadQueue";

export class UnavailableLiveCaptureBoundary
  implements CaptureAuthorization, CaptureUploadTransport
{
  consentForPatient(_patientId: string): Promise<ConsentEnforcementState> {
    return Promise.reject(this.#error());
  }

  assertUploadAllowed(_item: UploadQueueItem, _signal: AbortSignal): Promise<void> {
    return Promise.reject(this.#error());
  }

  reserve(
    _item: UploadQueueItem,
    _idempotencyKey: string,
    _signal: AbortSignal
  ): Promise<UploadReservationState> {
    return Promise.reject(this.#error());
  }

  upload(
    _item: UploadQueueItem,
    _reservation: UploadReservationState,
    _bytes: Uint8Array,
    _signal: AbortSignal
  ): Promise<void> {
    return Promise.reject(this.#error());
  }

  complete(
    _item: UploadQueueItem,
    _reservation: UploadReservationState,
    _idempotencyKey: string,
    _signal: AbortSignal
  ): Promise<MediaUploadReceipt> {
    return Promise.reject(this.#error());
  }

  #error(): CaptureQueueError {
    return new CaptureQueueError(
      "UPLOAD_MANUAL_RETRY_REQUIRED",
      "A configured live ClinicOS service is required before protected uploads can run."
    );
  }
}
