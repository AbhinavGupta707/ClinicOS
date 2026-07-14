import {
  boundedRetryDelayMs,
  productionCaptureQueuePolicy,
  type CaptureQueuePolicy
} from "./policy.ts";
import type {
  CaptureAuthorization,
  CaptureDigestProvider,
  CaptureDraft,
  CaptureUploadTransport,
  EncryptedCaptureBlobStore,
  NetworkReachability,
  QueueClock,
  QueueDiagnosticCode,
  QueueEvent,
  SafeDiagnosticSink,
  UploadQueueItem,
  UploadQueueRepository
} from "./types.ts";
import { mobileSystemClock } from "../../lib/clock.ts";

export class CaptureQueueError extends Error {
  readonly code: QueueDiagnosticCode;
  readonly retryable: boolean;
  readonly outcomeUncertain: boolean;

  constructor(
    code: QueueDiagnosticCode,
    message: string,
    options: { retryable?: boolean; outcomeUncertain?: boolean } = {}
  ) {
    super(message);
    this.name = "CaptureQueueError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.outcomeUncertain = options.outcomeUncertain ?? false;
  }
}

export interface DurableCaptureQueueOptions {
  repository: UploadQueueRepository;
  blobs: EncryptedCaptureBlobStore;
  digest: CaptureDigestProvider;
  transport: CaptureUploadTransport;
  authorization: CaptureAuthorization;
  network: NetworkReachability;
  diagnostics: SafeDiagnosticSink;
  clock?: QueueClock;
  policy?: CaptureQueuePolicy;
  randomUnit?: () => number;
  onEvent?: (event: QueueEvent) => void;
  onSessionRevoked?: (localStorageDeleted: boolean) => Promise<void>;
}

export class DurableCaptureQueue {
  readonly #repository: UploadQueueRepository;
  readonly #blobs: EncryptedCaptureBlobStore;
  readonly #digest: CaptureDigestProvider;
  readonly #transport: CaptureUploadTransport;
  readonly #authorization: CaptureAuthorization;
  readonly #network: NetworkReachability;
  readonly #diagnostics: SafeDiagnosticSink;
  readonly #clock: QueueClock;
  readonly #policy: CaptureQueuePolicy;
  readonly #randomUnit: () => number;
  readonly #onEvent: ((event: QueueEvent) => void) | undefined;
  readonly #onSessionRevoked: ((localStorageDeleted: boolean) => Promise<void>) | undefined;
  readonly #leaseOwner: string;
  #activeAbort: AbortController | null = null;
  #processing = false;
  #destroyed = false;
  readonly #idleWaiters: (() => void)[] = [];

  constructor(options: DurableCaptureQueueOptions) {
    this.#repository = options.repository;
    this.#blobs = options.blobs;
    this.#digest = options.digest;
    this.#transport = options.transport;
    this.#authorization = options.authorization;
    this.#network = options.network;
    this.#diagnostics = options.diagnostics;
    this.#clock = options.clock ?? mobileSystemClock;
    this.#policy = options.policy ?? productionCaptureQueuePolicy;
    this.#randomUnit = options.randomUnit ?? Math.random;
    this.#onEvent = options.onEvent;
    this.#onSessionRevoked = options.onSessionRevoked;
    this.#leaseOwner = this.#digest.randomId();
  }

  async initialize(): Promise<void> {
    if (this.#destroyed) throw new Error("Protected capture state has been destroyed.");
    await this.#blobs.initialize();
    await this.#repository.initialize();
    if (!(await this.#repository.verifyIntegrity())) {
      this.#record("QUEUE_INTEGRITY_FAILED", null);
      throw new CaptureQueueError(
        "QUEUE_INTEGRITY_FAILED",
        "Encrypted upload queue integrity verification failed."
      );
    }
    const recovered = await this.#repository.recoverInterrupted(this.#nowIso());
    if (recovered > 0) this.#record("QUEUE_RECOVERED", null);
  }

  async list(): Promise<readonly UploadQueueItem[]> {
    if (this.#destroyed) return [];
    return this.#repository.list();
  }

  async enqueue(draft: CaptureDraft): Promise<UploadQueueItem> {
    if (this.#destroyed) throw new Error("Protected capture state has been destroyed.");
    assertDraft(draft, this.#policy);
    const stats = await this.#repository.stats();
    if (stats.itemCount >= this.#policy.maxQueueItems) {
      throw new CaptureQueueError(
        "UPLOAD_MANUAL_RETRY_REQUIRED",
        "The protected offline queue has reached its item limit. Upload or purge an item first."
      );
    }
    if (stats.totalBytes + draft.bytes.byteLength > this.#policy.maxQueueBytes) {
      throw new CaptureQueueError(
        "UPLOAD_MANUAL_RETRY_REQUIRED",
        "The protected offline queue has reached its byte limit. Upload or purge an item first."
      );
    }
    const available = await this.#blobs.availableBytes();
    if (available - draft.bytes.byteLength < this.#policy.minimumFreeBytesAfterWrite) {
      throw new CaptureQueueError(
        "UPLOAD_MANUAL_RETRY_REQUIRED",
        "The device does not have enough free protected storage for this capture."
      );
    }

    const id = this.#digest.randomId();
    const now = this.#nowIso();
    const digest = await this.#digest.sha256Hex(draft.bytes);
    const item: UploadQueueItem = {
      id,
      kind: draft.kind,
      binding: { ...draft.binding },
      blobId: id,
      mimeType: draft.mimeType,
      byteLength: draft.bytes.byteLength,
      sha256Digest: digest,
      capturedAt: draft.capturedAt,
      durationMs: draft.durationMs,
      status: "queued",
      attempts: 0,
      nextAttemptAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      reservationSequence: 0,
      reservation: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now
    };

    await this.#blobs.put(id, draft.bytes);
    try {
      await this.#repository.insert(item);
    } catch (error) {
      await this.#blobs.delete(id).catch(() => undefined);
      throw error;
    }
    this.#record("CAPTURE_QUEUED", item);
    return item;
  }

  abortActive(): void {
    this.#activeAbort?.abort(new Error("APP_INACTIVE_INTERRUPTION"));
    this.#record("APP_INACTIVE_INTERRUPTION", null);
  }

  async processNext(): Promise<UploadQueueItem | null> {
    if (this.#destroyed) return null;
    if (this.#processing) return null;
    if (!(await this.#network.isInternetReachable())) {
      this.#record("NETWORK_OFFLINE", null);
      return null;
    }

    this.#processing = true;
    let item: UploadQueueItem | null = null;
    try {
      const now = this.#clock.now();
      item = await this.#repository.claimNext({
        now: now.toISOString(),
        leaseOwner: this.#leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + this.#policy.leaseMs).toISOString()
      });
      if (!item) return null;

      const abort = new AbortController();
      this.#activeAbort = abort;
      await this.#authorization.assertUploadAllowed(item, abort.signal);
      const bytes = await this.#readAndVerify(item);
      let working = item;
      if (!reservationUsable(working, now, this.#policy.targetExpirySafetyMs)) {
        if (working.reservation) {
          working = await this.#save({
            ...working,
            status: "leased",
            reservationSequence: working.reservationSequence + 1,
            reservation: null,
            updatedAt: this.#nowIso()
          });
        }
        const reservation = await this.#transport.reserve(
          working,
          queueMutationKey(working, "reserve"),
          abort.signal
        );
        working = await this.#save({
          ...working,
          status: "reserved",
          reservation,
          updatedAt: this.#nowIso()
        });
      }
      const reservation = working.reservation;
      if (!reservation) throw new Error("Upload reservation was not persisted.");
      working = await this.#save({ ...working, status: "uploading", updatedAt: this.#nowIso() });
      await this.#transport.upload(working, reservation, bytes, abort.signal);
      working = await this.#save({ ...working, status: "completing", updatedAt: this.#nowIso() });
      await this.#transport.complete(
        working,
        reservation,
        queueMutationKey(working, "complete"),
        abort.signal
      );
      working = await this.#save({ ...working, status: "purging", updatedAt: this.#nowIso() });
      await this.#blobs.delete(working.blobId);
      await this.#repository.delete(working.id);
      this.#record("UPLOAD_CONFIRMED_AND_PURGED", working);
      return null;
    } catch (error) {
      if (!item) throw error;
      return this.#handleFailure(item, error);
    } finally {
      this.#activeAbort = null;
      this.#processing = false;
      for (const resolve of this.#idleWaiters.splice(0)) resolve();
    }
  }

  async drain(limit = 3): Promise<void> {
    const bounded = Math.max(1, Math.min(limit, 10));
    for (let index = 0; index < bounded; index += 1) {
      const before = await this.#repository.stats();
      await this.processNext();
      const after = await this.#repository.stats();
      if (before.itemCount === 0 || after.itemCount >= before.itemCount) break;
    }
  }

  async retry(itemId: string): Promise<void> {
    if (this.#destroyed) return;
    const item = await this.#repository.get(itemId);
    if (!item) return;
    if (item.status === "purge_failed") {
      await this.purge(item.id);
      return;
    }
    if (item.status === "quarantined") {
      throw new CaptureQueueError(
        "CAPTURE_CORRUPT",
        "A quarantined capture cannot be retried; purge it and recapture."
      );
    }
    if (item.status === "purging") {
      throw new CaptureQueueError(
        "LOCAL_PURGE_FAILED",
        "Deletion is already in progress and cannot be converted back into an upload."
      );
    }
    await this.#repository.update({
      ...item,
      status: "queued",
      attempts: 0,
      nextAttemptAt: this.#nowIso(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      updatedAt: this.#nowIso()
    });
  }

  async purge(itemId: string): Promise<void> {
    if (this.#destroyed) return;
    const item = await this.#repository.get(itemId);
    if (!item) return;
    const purging = { ...item, status: "purging" as const, updatedAt: this.#nowIso() };
    await this.#repository.update(purging);
    try {
      await this.#blobs.delete(item.blobId);
      await this.#repository.delete(item.id);
    } catch {
      await this.#repository.update({
        ...purging,
        status: "purge_failed",
        lastErrorCode: "LOCAL_PURGE_FAILED",
        updatedAt: this.#nowIso()
      });
      this.#record("LOCAL_PURGE_FAILED", item);
      throw new CaptureQueueError(
        "LOCAL_PURGE_FAILED",
        "Protected local deletion did not complete."
      );
    }
  }

  async purgeAll(): Promise<void> {
    if (this.#destroyed) return;
    this.abortActive();
    const items = await this.#repository.list();
    const failures: unknown[] = [];
    for (const item of items) {
      await this.purge(item.id).catch((error) => failures.push(error));
    }
    await this.#blobs.purgeAll().catch((error) => failures.push(error));
    if (failures.length > 0) {
      throw new CaptureQueueError(
        "LOCAL_PURGE_FAILED",
        "One or more protected captures could not be purged."
      );
    }
  }

  async purgeRevokedAudio(patientId: string): Promise<void> {
    if (this.#destroyed) return;
    this.abortActive();
    const items = await this.#repository.list();
    for (const item of items) {
      if (item.kind === "audio" && item.binding.patientId === patientId) {
        await this.purge(item.id);
      }
    }
    this.#record("CAPTURE_CONSENT_REVOKED", null);
  }

  async shutdownAndDeleteLocalState(): Promise<void> {
    if (this.#destroyed) return;
    this.abortActive();
    if (this.#processing) {
      await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
    }
    await this.#destroyLocalState();
  }

  async #readAndVerify(item: UploadQueueItem): Promise<Uint8Array> {
    try {
      const bytes = await this.#blobs.get(item.blobId);
      const digest = await this.#digest.sha256Hex(bytes);
      if (bytes.byteLength !== item.byteLength || digest !== item.sha256Digest) {
        throw new Error("Capture digest mismatch.");
      }
      return bytes;
    } catch {
      await this.#blobs.quarantine(item.blobId).catch(() => undefined);
      const quarantined = {
        ...item,
        status: "quarantined" as const,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: "CAPTURE_CORRUPT" as const,
        updatedAt: this.#nowIso()
      };
      await this.#repository.update(quarantined);
      this.#record("CAPTURE_CORRUPT", item);
      throw new CaptureQueueError(
        "CAPTURE_CORRUPT",
        "Encrypted capture integrity verification failed."
      );
    }
  }

  async #handleFailure(item: UploadQueueItem, error: unknown): Promise<UploadQueueItem | null> {
    const current = (await this.#repository.get(item.id)) ?? item;
    if (current.status === "quarantined") return current;
    if (current.status === "purging") {
      const failed = {
        ...current,
        status: "purge_failed" as const,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: "LOCAL_PURGE_FAILED" as const,
        updatedAt: this.#nowIso()
      };
      await this.#repository.update(failed);
      this.#record("LOCAL_PURGE_FAILED", failed);
      return failed;
    }
    const typed = error instanceof CaptureQueueError ? error : null;

    if (typed?.code === "CAPTURE_CONSENT_REVOKED") {
      await this.purge(current.id);
      this.#record("CAPTURE_CONSENT_REVOKED", current);
      return null;
    }
    if (typed?.code === "SESSION_REVOKED_PURGE_REQUIRED") {
      let deleted = false;
      try {
        await this.#destroyLocalState();
        deleted = true;
      } finally {
        await this.#onSessionRevoked?.(deleted);
        this.#record("SESSION_REVOKED_PURGE_REQUIRED", current);
      }
      return null;
    }
    if (typed?.code === "CAPTURE_CORRUPT") return this.#repository.get(current.id);

    const attempts = current.attempts;
    const manual =
      typed?.outcomeUncertain || !typed?.retryable || attempts >= this.#policy.maxAutomaticAttempts;
    const code: QueueDiagnosticCode = typed?.outcomeUncertain
      ? "UPLOAD_OUTCOME_UNCERTAIN"
      : manual
        ? "UPLOAD_MANUAL_RETRY_REQUIRED"
        : "UPLOAD_RETRY_SCHEDULED";
    const delay = boundedRetryDelayMs(attempts, this.#randomUnit(), this.#policy);
    const next: UploadQueueItem = {
      ...current,
      status: manual ? "manual_retry_required" : "retry_wait",
      nextAttemptAt: new Date(this.#clock.now().getTime() + delay).toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: code,
      updatedAt: this.#nowIso()
    };
    await this.#repository.update(next);
    this.#record(code, next);
    return next;
  }

  async #save(item: UploadQueueItem): Promise<UploadQueueItem> {
    await this.#repository.update(item);
    return item;
  }

  async #destroyLocalState(): Promise<void> {
    const failures: unknown[] = [];
    await this.#blobs.shutdownAndDelete().catch((error) => failures.push(error));
    await this.#repository.shutdownAndDelete().catch((error) => failures.push(error));
    this.#destroyed = true;
    if (failures.length > 0) {
      throw new CaptureQueueError(
        "LOCAL_PURGE_FAILED",
        "Protected local database or media deletion could not be verified."
      );
    }
  }

  #record(code: QueueDiagnosticCode, item: UploadQueueItem | null): void {
    const at = this.#nowIso();
    this.#diagnostics.record({
      code,
      at,
      ...(item ? { attemptCount: item.attempts, captureKind: item.kind } : {})
    });
    this.#onEvent?.({ code, itemId: item?.id ?? null });
  }

  #nowIso(): string {
    return this.#clock.now().toISOString();
  }
}

export function queueMutationKey(
  item: Pick<UploadQueueItem, "id" | "reservationSequence">,
  phase: "reserve" | "content" | "complete"
): string {
  const generation = item.reservationSequence === 0 ? "" : `:${item.reservationSequence}`;
  return `${item.id}:${phase}${generation}`;
}

function assertDraft(draft: CaptureDraft, policy: CaptureQueuePolicy): void {
  for (const value of [
    draft.binding.tenantId,
    draft.binding.clinicId,
    draft.binding.patientId,
    draft.capturedAt
  ]) {
    if (!value.trim()) throw new TypeError("Capture binding and timestamp are required.");
  }
  if (!Number.isFinite(Date.parse(draft.capturedAt))) {
    throw new TypeError("Capture timestamp is invalid.");
  }
  if (draft.kind === "audio" && draft.mimeType !== "audio/mp4") {
    throw new TypeError("Clinical audio must use the canonical audio/mp4 capture format.");
  }
  if (draft.kind === "photo" && !["image/jpeg", "image/png"].includes(draft.mimeType)) {
    throw new TypeError("Photo capture must use a supported image format.");
  }
  if (draft.bytes.byteLength < 1 || draft.bytes.byteLength > policy.maxItemBytes[draft.kind]) {
    throw new CaptureQueueError(
      "UPLOAD_MANUAL_RETRY_REQUIRED",
      `Capture size is outside the ${draft.kind} policy.`
    );
  }
  if (draft.kind === "audio") {
    if (!draft.binding.encounterId) {
      throw new TypeError("Audio capture requires a verified encounter binding.");
    }
    if (
      draft.durationMs === null ||
      draft.durationMs < 1 ||
      draft.durationMs > policy.maxAudioDurationMs
    ) {
      throw new CaptureQueueError(
        "UPLOAD_MANUAL_RETRY_REQUIRED",
        "Audio duration is outside the recording policy."
      );
    }
  }
}

function reservationUsable(item: UploadQueueItem, now: Date, safetyMs: number): boolean {
  if (!item.reservation) return false;
  const expiresAt = Date.parse(item.reservation.target.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt - safetyMs > now.getTime();
}
