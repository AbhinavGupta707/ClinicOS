import assert from "node:assert/strict";
import test from "node:test";
import { ClinicOsCaptureTransport } from "../src/features/capture/adapters/clinicOsCaptureTransport.ts";
import {
  audioConsentState,
  evaluateAudioControl,
  permissionStateFromResponse
} from "../src/features/capture/audioConsent.ts";
import { BoundedDiagnosticBuffer, assertSafeDiagnostic } from "../src/features/capture/diagnostics.ts";
import { performSecureSignOut } from "../src/features/capture/secureSignOut.ts";
import type {
  CaptureAuthorization,
  CaptureDigestProvider,
  EncryptedCaptureBlobStore,
  QueueStats,
  UploadQueueItem,
  UploadQueueRepository
} from "../src/features/capture/types.ts";
import { DurableCaptureQueue } from "../src/features/capture/uploadQueue.ts";
import { ClinicOsApiClient } from "../src/lib/apiClient.ts";

const tenantId = "10000000-0000-4000-8000-000000001001";
const clinicId = "10000000-0000-4000-8000-000000001002";
const patientId = "10000000-0000-4000-8000-000000002001";
const encounterId = "10000000-0000-4000-8000-000000004001";
const uploadId = "40000000-0000-4000-8000-000000009001";
const mediaAssetId = "40000000-0000-4000-8000-000000008001";
const fixedNow = new Date("2026-07-14T09:00:00.000Z");

test("permission and audio consent state machines fail closed", () => {
  assert.deepEqual(permissionStateFromResponse(null), { state: "checking" });
  assert.deepEqual(
    permissionStateFromResponse({ granted: false, status: "undetermined" as never, canAskAgain: true, expires: "never" }),
    { state: "requestable" }
  );
  assert.deepEqual(audioConsentState(undefined), { state: "checking" });
  assert.deepEqual(audioConsentState(null), { state: "unavailable" });
  assert.deepEqual(
    audioConsentState({
      aiAudioCaptureAllowed: true,
      rawAudioRetentionAllowed: true,
      activePurposes: ["ai_audio_capture", "raw_audio_retention"],
      revokedPurposes: ["raw_audio_retention"]
    }),
    { state: "revoked" }
  );
  const decision = evaluateAudioControl({
    native: true,
    patientId,
    encounterVerified: true,
    consent: { state: "allowed" },
    permission: { state: "granted" }
  });
  assert.equal(decision.enabled, true);
});

test("API client sends exact stable idempotency headers for audio reserve, mediated content, and complete", async () => {
  const requests: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    requests.push({ url, method, headers: new Headers(init.headers), body: init.body });
    if (url.endsWith("/v1/media/upload-urls")) {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(body.mediaType, "audio_chunk");
      assert.equal(body.mimeType, "audio/mp4");
      return jsonResponse(reservationPayload("audio_chunk", "audio/mp4", 4), 201);
    }
    if (url.endsWith(`/v1/media/uploads/${uploadId}/content`)) return jsonResponse({ upload: { id: uploadId } });
    if (url.endsWith(`/v1/media/uploads/${uploadId}/complete`)) return jsonResponse(assetPayload("audio_chunk", "audio/mp4"));
    return jsonResponse({}, 404);
  };
  const api = new ClinicOsApiClient({ baseUrl: "https://mobile-api.clinicos.test", fetchImpl });
  api.setClinicId(clinicId);
  const signal = new AbortController().signal;
  const reserved = await api.reserveMediaUpload(
    {
      patientId,
      encounterId,
      mediaType: "audio_chunk",
      originalFilename: "clinical-audio.m4a",
      mimeType: "audio/mp4",
      fileSizeBytes: 4,
      sha256Digest: null,
      tags: ["mobile-capture"],
      provenance: { captureSurface: "expo_native" }
    },
    { idempotencyKey: "queue-1:reserve", signal }
  );
  await api.uploadMediaContent(reserved.uploadTarget, new Uint8Array([1, 2, 3, 4]), "audio/mp4", {
    idempotencyKey: "queue-1:content",
    signal
  });
  await api.completeMediaUpload(
    {
      uploadId,
      patientId,
      encounterId,
      contentLength: 4,
      sha256Digest: null,
      mimeType: "audio/mp4"
    },
    { idempotencyKey: "queue-1:complete", signal }
  );
  assert.deepEqual(
    requests.map((request) => request.headers.get("idempotency-key")),
    ["queue-1:reserve", "queue-1:content", "queue-1:complete"]
  );
  assert.equal(requests[1]?.headers.get("x-clinic-id"), clinicId);
});

test("signed cross-origin upload never receives ClinicOS credentials or the Nest idempotency header", async () => {
  const observedHeaders: Headers[] = [];
  const api = new ClinicOsApiClient({
    baseUrl: "https://mobile-api.clinicos.test",
    tokenProvider: { getAccessToken: async () => "synthetic-token-value" },
    fetchImpl: async (_input, init = {}) => {
      observedHeaders.push(new Headers(init.headers));
      return new Response(null, { status: 200 });
    }
  });
  await api.uploadMediaContent(
    {
      method: "PUT",
      uploadUrl: "https://signed-storage.clinicos.test/upload",
      requiredHeaders: { "content-type": "image/jpeg", "x-provider-signature": "opaque" },
      expiresAt: "2099-07-14T10:00:00.000Z",
      maxBytes: 4
    },
    new Uint8Array([1, 2, 3, 4]),
    "image/jpeg",
    { idempotencyKey: "queue-2:content", signal: new AbortController().signal }
  );
  const received = observedHeaders[0];
  assert.ok(received);
  assert.equal(received.get("authorization"), null);
  assert.equal(received.get("idempotency-key"), null);
  assert.equal(received.get("x-provider-signature"), "opaque");
});

test("signed cross-origin target rejection is manual review, never session revocation or destructive purge", async () => {
  const fixture = queueFixture(async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/media/upload-urls")) {
      const payload = reservationPayload("audio_chunk", "audio/mp4", 4);
      payload.uploadTarget.uploadUrl = "https://signed-storage.clinicos.test/upload";
      return jsonResponse(payload, 201);
    }
    if (url === "https://signed-storage.clinicos.test/upload") {
      return new Response(null, { status: 401 });
    }
    return jsonResponse({}, 404);
  });
  await fixture.queue.enqueue(audioDraft());
  const result = await fixture.queue.processNext();
  assert.equal(result?.status, "manual_retry_required");
  assert.equal(result?.lastErrorCode, "UPLOAD_MANUAL_RETRY_REQUIRED");
  assert.equal(fixture.blobs.size, 1);
  assert.equal((await fixture.repository.stats()).itemCount, 1);
});

test("a 400 mutation rejection is not retried automatically", async () => {
  const fixture = queueFixture(async (input, init = {}) => {
    if (String(input).endsWith("/v1/media/upload-urls")) {
      assert.equal(new Headers(init.headers).get("idempotency-key"), `${fixture.itemId}:reserve`);
      return jsonResponse({ error: { code: "INVALID_REQUEST", message: "idempotency-key required" } }, 400);
    }
    return jsonResponse({}, 500);
  });
  await fixture.queue.enqueue(audioDraft());
  const result = await fixture.queue.processNext();
  assert.equal(result?.status, "manual_retry_required");
  assert.equal(result?.lastErrorCode, "UPLOAD_MANUAL_RETRY_REQUIRED");
  assert.equal(result?.attempts, 1);
  assert.equal(fixture.blobs.size, 1);
});

test("completion conflict is outcome-uncertain, preserves encrypted media, and replays the same stable keys only after operator retry", async () => {
  const seen: string[] = [];
  let completionCalls = 0;
  const fixture = queueFixture(async (input, init = {}) => {
    const url = String(input);
    const key = new Headers(init.headers).get("idempotency-key");
    if (key) seen.push(key);
    if (url.endsWith("/v1/media/upload-urls")) return jsonResponse(reservationPayload("audio_chunk", "audio/mp4", 4), 201);
    if (url.endsWith(`/v1/media/uploads/${uploadId}/content`)) return jsonResponse({ upload: { id: uploadId } });
    if (url.endsWith(`/v1/media/uploads/${uploadId}/complete`)) {
      completionCalls += 1;
      return completionCalls === 1
        ? jsonResponse({ error: { code: "IDEMPOTENCY_CONFLICT" } }, 409)
        : jsonResponse(assetPayload("audio_chunk", "audio/mp4"));
    }
    return jsonResponse({}, 404);
  });
  await fixture.queue.enqueue(audioDraft());
  const uncertain = await fixture.queue.processNext();
  assert.equal(uncertain?.status, "manual_retry_required");
  assert.equal(uncertain?.lastErrorCode, "UPLOAD_OUTCOME_UNCERTAIN");
  assert.equal(fixture.blobs.size, 1);
  await fixture.queue.retry(fixture.itemId);
  await fixture.queue.processNext();
  assert.equal(fixture.blobs.size, 0);
  assert.equal((await fixture.repository.stats()).itemCount, 0);
  assert.deepEqual(seen, [
    `${fixture.itemId}:reserve`,
    `${fixture.itemId}:content`,
    `${fixture.itemId}:complete`,
    `${fixture.itemId}:content`,
    `${fixture.itemId}:complete`
  ]);
});

test("diagnostics reject PHI, secrets, URLs, and private file references", () => {
  const sink = new BoundedDiagnosticBuffer(2);
  sink.record({ code: "CAPTURE_QUEUED", at: fixedNow.toISOString(), captureKind: "photo" });
  assert.equal(sink.snapshot().length, 1);
  assert.throws(
    () => assertSafeDiagnostic({ code: "CAPTURE_QUEUED", at: "file:///private/patient" }),
    /prohibited/i
  );
});

test("secure sign-out clears tokens, verifies physical deletion, then destroys capture keys", async () => {
  const order: string[] = [];
  const result = await performSecureSignOut({
    clearSessionTokens: async () => { order.push("session-tokens"); },
    shutdownAndDeleteLocalState: async () => { order.push("ciphertext-files"); },
    destroyCaptureKeysAfterVerifiedPurge: async () => { order.push("capture-keys"); }
  });
  assert.deepEqual(order, ["session-tokens", "ciphertext-files", "capture-keys"]);
  assert.deepEqual(result, {
    sessionTokensCleared: true,
    localStateDeleted: true,
    captureKeysDestroyed: true
  });
});

test("physical deletion failure keeps capture keys but does not skip session-token deletion", async () => {
  const order: string[] = [];
  const result = await performSecureSignOut({
    clearSessionTokens: async () => { order.push("session-tokens"); },
    shutdownAndDeleteLocalState: async () => {
      order.push("ciphertext-files");
      throw new Error("synthetic deletion failure");
    },
    destroyCaptureKeysAfterVerifiedPurge: async () => { order.push("capture-keys"); }
  });
  assert.deepEqual(order, ["session-tokens", "ciphertext-files"]);
  assert.deepEqual(result, {
    sessionTokensCleared: true,
    localStateDeleted: false,
    captureKeysDestroyed: false
  });
});

test("queue destructive shutdown deletes media before closing and deleting SQLCipher state", async () => {
  const order: string[] = [];
  const repository = new TestQueueRepository(order);
  const blobs = new TestBlobStore(order);
  const queue = new DurableCaptureQueue({
    repository,
    blobs,
    digest: new TestDigest(),
    transport: new ClinicOsCaptureTransport(
      new ClinicOsApiClient({ baseUrl: "https://mobile-api.clinicos.test", fetchImpl: async () => jsonResponse({}, 500) })
    ),
    authorization: allowAuthorization,
    network: { isInternetReachable: async () => false },
    diagnostics: new BoundedDiagnosticBuffer(),
    clock: { now: () => new Date(fixedNow) }
  });
  await queue.initialize();
  await queue.shutdownAndDeleteLocalState();
  assert.deepEqual(order, ["media-delete", "database-delete"]);
  assert.deepEqual(await queue.list(), []);
});

function queueFixture(fetchImpl: typeof fetch) {
  const repository = new TestQueueRepository();
  const blobs = new TestBlobStore();
  const digest = new TestDigest();
  const api = new ClinicOsApiClient({ baseUrl: "https://mobile-api.clinicos.test", fetchImpl });
  const transport = new ClinicOsCaptureTransport(api);
  const queue = new DurableCaptureQueue({
    repository,
    blobs,
    digest,
    transport,
    authorization: allowAuthorization,
    network: { isInternetReachable: async () => true },
    diagnostics: new BoundedDiagnosticBuffer(),
    clock: { now: () => new Date(fixedNow) },
    randomUnit: () => 0
  });
  void queue.initialize();
  return { queue, repository, blobs, itemId: digest.itemId };
}

const allowAuthorization: CaptureAuthorization = {
  consentForPatient: async () => ({
    aiAudioCaptureAllowed: true,
    rawAudioRetentionAllowed: true,
    activePurposes: ["ai_audio_capture", "raw_audio_retention"],
    revokedPurposes: []
  }),
  assertUploadAllowed: async () => undefined
};

function audioDraft() {
  return {
    kind: "audio" as const,
    binding: { tenantId, clinicId, patientId, encounterId },
    bytes: new Uint8Array([1, 2, 3, 4]),
    mimeType: "audio/mp4" as const,
    capturedAt: fixedNow.toISOString(),
    durationMs: 1000
  };
}

function reservationPayload(mediaType: "intraoral_photo" | "audio_chunk", mimeType: string, bytes: number) {
  return {
    upload: {
      id: uploadId,
      patientId,
      encounterId,
      mediaType,
      originalFilename: mediaType === "audio_chunk" ? "clinical-audio.m4a" : "chairside-capture.jpg",
      mimeType,
      expectedFileSizeBytes: bytes,
      expectedSha256Digest: "a".repeat(64),
      status: "reserved",
      expiresAt: "2099-07-14T10:00:00.000Z",
      tags: [],
      provenance: {}
    },
    uploadTarget: {
      method: "PUT",
      uploadUrl: `/v1/media/uploads/${uploadId}/content`,
      requiredHeaders: { "content-type": mimeType },
      expiresAt: "2099-07-14T10:00:00.000Z",
      maxBytes: bytes
    }
  };
}

function assetPayload(mediaType: string, mimeType: string) {
  return {
    mediaAsset: {
      id: mediaAssetId,
      patientId,
      encounterId,
      mediaType,
      originalFilename: mediaType === "audio_chunk" ? "clinical-audio.m4a" : "chairside-capture.jpg",
      mimeType,
      fileSizeBytes: 4,
      sha256Digest: null,
      status: "scan_pending",
      scanStatus: "pending",
      tags: [],
      provenance: {},
      createdAt: fixedNow.toISOString(),
      uploadedAt: fixedNow.toISOString()
    }
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

class TestDigest implements CaptureDigestProvider {
  readonly itemId = "22222222-2222-4222-8222-222222222222";
  #count = 0;

  sha256Hex(_bytes: Uint8Array): Promise<string> {
    return Promise.resolve("a".repeat(64));
  }

  randomId(): string {
    this.#count += 1;
    return this.#count === 1 ? "11111111-1111-4111-8111-111111111111" : this.itemId;
  }
}

class TestBlobStore implements EncryptedCaptureBlobStore {
  readonly blobs = new Map<string, Uint8Array>();
  readonly order: string[];
  constructor(order: string[] = []) { this.order = order; }
  get size() { return this.blobs.size; }
  async initialize() {}
  async availableBytes() { return 1024 * 1024 * 1024; }
  async put(id: string, bytes: Uint8Array) { this.blobs.set(id, new Uint8Array(bytes)); }
  async get(id: string) {
    const value = this.blobs.get(id);
    if (!value) throw new Error("missing");
    return new Uint8Array(value);
  }
  async delete(id: string) { this.blobs.delete(id); }
  async quarantine(id: string) { this.blobs.delete(id); }
  async purgeAll() { this.blobs.clear(); }
  async shutdownAndDelete() { this.order.push("media-delete"); this.blobs.clear(); }
}

class TestQueueRepository implements UploadQueueRepository {
  readonly items = new Map<string, UploadQueueItem>();
  readonly order: string[];
  constructor(order: string[] = []) { this.order = order; }
  async initialize() {}
  async verifyIntegrity() { return true; }
  async recoverInterrupted(_now: string) { return 0; }
  async stats(): Promise<QueueStats> {
    return {
      itemCount: this.items.size,
      totalBytes: [...this.items.values()].reduce((sum, item) => sum + item.byteLength, 0)
    };
  }
  async list() { return [...this.items.values()].map(cloneItem); }
  async get(id: string) { return this.items.has(id) ? cloneItem(this.items.get(id)!) : null; }
  async insert(item: UploadQueueItem) { this.items.set(item.id, cloneItem(item)); }
  async update(item: UploadQueueItem) { this.items.set(item.id, cloneItem(item)); }
  async delete(id: string) { this.items.delete(id); }
  async claimNext(input: { now: string; leaseOwner: string; leaseExpiresAt: string }) {
    const item = [...this.items.values()].find(
      (candidate) =>
        (candidate.status === "queued" || candidate.status === "retry_wait") &&
        candidate.nextAttemptAt <= input.now
    );
    if (!item) return null;
    const claimed: UploadQueueItem = {
      ...item,
      status: "leased",
      attempts: item.attempts + 1,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.now
    };
    this.items.set(item.id, cloneItem(claimed));
    return cloneItem(claimed);
  }
  async shutdownAndDelete() { this.order.push("database-delete"); this.items.clear(); }
}

function cloneItem(item: UploadQueueItem): UploadQueueItem {
  return {
    ...item,
    binding: { ...item.binding },
    reservation: item.reservation
      ? { ...item.reservation, target: { ...item.reservation.target, requiredHeaders: { ...item.reservation.target.requiredHeaders } } }
      : null
  };
}
