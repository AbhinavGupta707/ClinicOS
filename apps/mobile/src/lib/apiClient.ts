import { mobileSystemClock, type MobileClock } from "./clock.ts";

export type UUID = string;

export interface MobileSession {
  user: {
    id: UUID;
    displayName: string;
    email: string | null;
    phone: string | null;
    status: string;
  };
  tenant: {
    id: UUID;
    slug: string;
    displayName: string;
    status: string;
  };
  clinics: {
    id: UUID;
    tenantId: UUID;
    slug: string;
    displayName: string;
    timezone: string;
    roleSlugs: string[];
  }[];
  permissions: string[];
}

export interface PatientSummary {
  id: UUID;
  displayName?: string;
  legalName?: string;
  preferredName?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string;
  status?: string;
}

export interface QueueEntrySummary {
  id: UUID;
  patientId: UUID;
  appointmentId: UUID;
  status: string;
  checkedInAt?: string | null;
  chairId?: UUID | null;
}

export interface EncounterSummary {
  id: UUID;
  patientId: UUID;
  appointmentId?: UUID | null;
  status: string;
  providerUserId?: UUID | null;
}

export interface ConsentEnforcementState {
  aiAudioCaptureAllowed: boolean;
  rawAudioRetentionAllowed: boolean;
  activePurposes: string[];
  revokedPurposes: string[];
}

export interface MediaUploadReservation {
  id: UUID;
  patientId: UUID;
  encounterId: UUID | null;
  mediaType: string;
  originalFilename: string;
  mimeType: string;
  expectedFileSizeBytes: number;
  expectedSha256Digest: string | null;
  status: string;
  expiresAt: string;
  tags: string[];
  provenance: Record<string, unknown>;
}

export interface MediaUploadTarget {
  method: "PUT";
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: string;
  maxBytes: number;
}

export interface PublicMediaAsset {
  id: UUID;
  patientId: UUID;
  encounterId: UUID | null;
  mediaType: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Digest: string | null;
  status: string;
  scanStatus: string;
  tags: string[];
  provenance: Record<string, unknown>;
  createdAt: string;
  uploadedAt: string;
}

export interface AuthTokenProvider {
  getAccessToken(): Promise<string | null>;
}

export interface ClinicOsApiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  tokenProvider?: AuthTokenProvider;
  devSubject?: string | null;
  requestTimeoutMs?: number;
  clock?: MobileClock;
}

export class ClinicOsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, status: number, code: string, details: unknown = null) {
    super(message);
    this.name = "ClinicOsApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ClinicOsApiClient {
  readonly baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #tokenProvider: AuthTokenProvider | undefined;
  readonly #devSubject: string | null;
  readonly #requestTimeoutMs: number;
  readonly #clock: MobileClock;
  #clinicId: UUID | null = null;

  constructor(options: ClinicOsApiClientOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl);
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#tokenProvider = options.tokenProvider;
    this.#devSubject = options.devSubject ?? null;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.#clock = options.clock ?? mobileSystemClock;
  }

  setClinicId(clinicId: UUID | null): void {
    this.#clinicId = clinicId;
  }

  async getSession(): Promise<MobileSession> {
    const payload = await this.#jsonRequest<unknown>("/v1/me", { method: "GET" });
    return parseSession(payload);
  }

  async listPatients(query = ""): Promise<PatientSummary[]> {
    const search = new URLSearchParams();
    if (query.trim()) search.set("query", query.trim());
    const suffix = search.toString() ? `?${search.toString()}` : "";
    const payload = await this.#jsonRequest<unknown>(`/v1/patients${suffix}`, { method: "GET" });
    return arrayFromPayload(payload, "patients").filter(isPatientSummary);
  }

  async listQueue(date: string): Promise<QueueEntrySummary[]> {
    const payload = await this.#jsonRequest<unknown>(`/v1/queue?date=${encodeURIComponent(date)}`, {
      method: "GET"
    });
    return arrayFromPayload(payload, "queue").filter(isQueueEntrySummary);
  }

  async getEncounter(encounterId: UUID): Promise<EncounterSummary> {
    const payload = await this.#jsonRequest<unknown>(
      `/v1/encounters/${encodeURIComponent(encounterId)}`,
      { method: "GET" }
    );
    const encounter = recordValue(payload, "encounter");
    if (!isEncounterSummary(encounter)) {
      throw new ClinicOsApiError(
        "Encounter response did not match the mobile contract.",
        0,
        "BAD_PAYLOAD"
      );
    }
    return encounter;
  }

  async getPatientConsents(patientId: UUID): Promise<ConsentEnforcementState> {
    const payload = await this.#jsonRequest<unknown>(
      `/v1/patients/${encodeURIComponent(patientId)}/consents`,
      { method: "GET" }
    );
    const state = recordValue(payload, "enforcementState");
    if (!isConsentEnforcementState(state)) {
      throw new ClinicOsApiError(
        "Consent response did not match the mobile contract.",
        0,
        "BAD_PAYLOAD"
      );
    }
    return state;
  }

  async reserveMediaUpload(
    input: {
      patientId: UUID;
      encounterId: UUID | null;
      mediaType: "intraoral_photo" | "audio_chunk";
      originalFilename: string;
      mimeType: string;
      fileSizeBytes: number;
      sha256Digest: string | null;
      tags: string[];
      provenance: Record<string, unknown>;
    },
    options: { idempotencyKey: string; signal: AbortSignal }
  ): Promise<{ upload: MediaUploadReservation; uploadTarget: MediaUploadTarget }> {
    const payload = await this.#jsonRequest<unknown>("/v1/media/upload-urls", {
      method: "POST",
      headers: { "idempotency-key": options.idempotencyKey },
      signal: options.signal,
      body: JSON.stringify(input)
    });
    const upload = recordValue(payload, "upload");
    const uploadTarget = recordValue(payload, "uploadTarget");
    if (!isMediaUploadReservation(upload) || !isMediaUploadTarget(uploadTarget)) {
      throw new ClinicOsApiError(
        "Media reservation response did not match the mobile contract.",
        0,
        "BAD_PAYLOAD"
      );
    }
    assertNoPrivateMediaReferences(payload);
    return { upload, uploadTarget };
  }

  async uploadMediaContent(
    target: MediaUploadTarget,
    bytes: Uint8Array,
    mimeType: string,
    options: { idempotencyKey: string; signal: AbortSignal }
  ): Promise<void> {
    if (bytes.byteLength > target.maxBytes) {
      throw new ClinicOsApiError(
        "Upload exceeds the reserved byte limit.",
        0,
        "UPLOAD_TARGET_INVALID"
      );
    }
    if (Date.parse(target.expiresAt) <= this.#clock.now().getTime()) {
      throw new ClinicOsApiError("Upload reservation expired.", 409, "UPLOAD_TARGET_EXPIRED");
    }
    const url = resolveUploadUrl(this.baseUrl, target.uploadUrl);
    const headers = new Headers(target.requiredHeaders);
    if (
      [...headers.keys()].some((name) =>
        /^(authorization|cookie|proxy-authorization|idempotency-key|x-clinic-id|x-clinic-os-dev-subject)$/i.test(
          name
        )
      )
    ) {
      throw new ClinicOsApiError(
        "Upload target requested a prohibited credential header.",
        0,
        "UPLOAD_TARGET_INVALID"
      );
    }
    if (!headers.has("Content-Type")) headers.set("Content-Type", mimeType);
    const sameOrigin = new URL(url).origin === new URL(this.baseUrl).origin;
    if (sameOrigin) {
      headers.set("idempotency-key", options.idempotencyKey);
      const token = await this.#tokenProvider?.getAccessToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (!token && this.#devSubject) headers.set("X-Clinic-OS-Dev-Subject", this.#devSubject);
      if (this.#clinicId) headers.set("X-Clinic-Id", this.#clinicId);
    }
    const response = await this.#fetchWithTimeout(
      url,
      { method: "PUT", headers, body: new Uint8Array(bytes).buffer, signal: options.signal },
      options.signal
    );
    if (!response.ok) {
      if (!sameOrigin && (response.status === 401 || response.status === 403)) {
        throw new ClinicOsApiError(
          "The signed upload target rejected the protected content request.",
          response.status,
          "UPLOAD_TARGET_REJECTED"
        );
      }
      throw safeHttpError(response.status);
    }
  }

  async completeMediaUpload(
    input: {
      uploadId: UUID;
      patientId: UUID;
      encounterId: UUID | null;
      contentLength: number;
      sha256Digest: string | null;
      mimeType: string;
    },
    options: { idempotencyKey: string; signal: AbortSignal }
  ): Promise<PublicMediaAsset> {
    const payload = await this.#jsonRequest<unknown>(
      `/v1/media/uploads/${encodeURIComponent(input.uploadId)}/complete`,
      {
        method: "POST",
        headers: { "idempotency-key": options.idempotencyKey },
        signal: options.signal,
        body: JSON.stringify({
          patientId: input.patientId,
          encounterId: input.encounterId,
          contentLength: input.contentLength,
          sha256Digest: input.sha256Digest,
          mimeType: input.mimeType
        })
      }
    );
    const mediaAsset = recordValue(payload, "mediaAsset");
    if (!isPublicMediaAsset(mediaAsset)) {
      throw new ClinicOsApiError(
        "Media completion response did not match the mobile contract.",
        0,
        "BAD_PAYLOAD"
      );
    }
    assertNoPrivateMediaReferences(payload);
    return mediaAsset;
  }

  async #jsonRequest<T>(path: string, init: RequestInit): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (init.body !== undefined && typeof init.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const token = await this.#tokenProvider?.getAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (!token && this.#devSubject) headers.set("X-Clinic-OS-Dev-Subject", this.#devSubject);
    if (this.#clinicId) headers.set("X-Clinic-Id", this.#clinicId);

    let response: Response;
    try {
      response = await this.#fetchWithTimeout(
        `${this.baseUrl}${path}`,
        { ...init, headers },
        init.signal ?? null
      );
    } catch {
      throw new ClinicOsApiError("ClinicOS could not reach the live service.", 0, "NETWORK_ERROR");
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = recordValue(payload, "error");
      throw new ClinicOsApiError(
        safeHttpMessage(response.status),
        response.status,
        readString(error, "code") ?? "HTTP_ERROR",
        null
      );
    }
    return payload as T;
  }

  async #fetchWithTimeout(
    url: string,
    init: RequestInit,
    upstream: AbortSignal | null
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("REQUEST_TIMEOUT")),
      this.#requestTimeoutMs
    );
    const abort = () => controller.abort(upstream?.reason);
    upstream?.addEventListener("abort", abort, { once: true });
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener("abort", abort);
    }
  }
}

export function assertNoPrivateMediaReferences(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  if (
    /objectKey|storageProvider|storageRegion|tenants\/|patients\/[^"]*\/media\//i.test(serialized)
  ) {
    throw new ClinicOsApiError(
      "Media response exposed a private storage reference.",
      0,
      "PRIVATE_MEDIA_REFERENCE"
    );
  }
}

function parseSession(payload: unknown): MobileSession {
  if (!isRecord(payload)) {
    throw new ClinicOsApiError(
      "Session response did not match the mobile contract.",
      0,
      "BAD_PAYLOAD"
    );
  }
  const user = recordValue(payload, "user");
  const tenant = recordValue(payload, "tenant");
  const clinics = arrayFromPayload(payload, "clinics").filter(isRecord);
  const permissions = arrayFromPayload(payload, "permissions").filter(
    (item): item is string => typeof item === "string"
  );
  if (!isRecord(user) || !isRecord(tenant)) {
    throw new ClinicOsApiError(
      "Session response did not match the mobile contract.",
      0,
      "BAD_PAYLOAD"
    );
  }
  return {
    user: {
      id: requiredStringFrom(user, "id"),
      displayName: requiredStringFrom(user, "displayName"),
      email: readNullableString(user, "email"),
      phone: readNullableString(user, "phone"),
      status: requiredStringFrom(user, "status")
    },
    tenant: {
      id: requiredStringFrom(tenant, "id"),
      slug: requiredStringFrom(tenant, "slug"),
      displayName: requiredStringFrom(tenant, "displayName"),
      status: requiredStringFrom(tenant, "status")
    },
    clinics: clinics.map((clinic) => ({
      id: requiredStringFrom(clinic, "id"),
      tenantId: requiredStringFrom(clinic, "tenantId"),
      slug: requiredStringFrom(clinic, "slug"),
      displayName: requiredStringFrom(clinic, "displayName"),
      timezone: requiredStringFrom(clinic, "timezone"),
      roleSlugs: arrayFromPayload(clinic, "roleSlugs").filter(
        (item): item is string => typeof item === "string"
      )
    })),
    permissions
  };
}

function isPatientSummary(value: unknown): value is PatientSummary {
  return isRecord(value) && typeof value.id === "string";
}

function isQueueEntrySummary(value: unknown): value is QueueEntrySummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.appointmentId === "string" &&
    typeof value.status === "string"
  );
}

function isEncounterSummary(value: unknown): value is EncounterSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.status === "string"
  );
}

function isConsentEnforcementState(value: unknown): value is ConsentEnforcementState {
  return (
    isRecord(value) &&
    typeof value.aiAudioCaptureAllowed === "boolean" &&
    typeof value.rawAudioRetentionAllowed === "boolean" &&
    Array.isArray(value.activePurposes) &&
    Array.isArray(value.revokedPurposes)
  );
}

function isMediaUploadReservation(value: unknown): value is MediaUploadReservation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.mediaType === "string" &&
    typeof value.originalFilename === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.expectedFileSizeBytes === "number" &&
    typeof value.status === "string" &&
    typeof value.expiresAt === "string"
  );
}

function isMediaUploadTarget(value: unknown): value is MediaUploadTarget {
  const expiresAt =
    isRecord(value) && typeof value.expiresAt === "string"
      ? Date.parse(value.expiresAt)
      : Number.NaN;
  return (
    isRecord(value) &&
    value.method === "PUT" &&
    typeof value.uploadUrl === "string" &&
    isRecord(value.requiredHeaders) &&
    Number.isFinite(expiresAt) &&
    Number.isSafeInteger(value.maxBytes) &&
    Number(value.maxBytes) > 0
  );
}

function isPublicMediaAsset(value: unknown): value is PublicMediaAsset {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.mediaType === "string" &&
    typeof value.mimeType === "string" &&
    typeof value.fileSizeBytes === "number" &&
    typeof value.status === "string" &&
    typeof value.scanStatus === "string"
  );
}

function arrayFromPayload(payload: unknown, key: string): unknown[] {
  if (!isRecord(payload)) return [];
  const value = payload[key];
  return Array.isArray(value) ? value : [];
}

function recordValue(payload: unknown, key: string): unknown {
  return isRecord(payload) ? payload[key] : null;
}

function readString(payload: unknown, key: string): string | null {
  const value = isRecord(payload) ? payload[key] : null;
  return typeof value === "string" ? value : null;
}

function readNullableString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function requiredStringFrom(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== "string") {
    throw new ClinicOsApiError(
      "Session response did not match the mobile contract.",
      0,
      "BAD_PAYLOAD"
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateBaseUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, "");
  const url = new URL(value);
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(typeof __DEV__ !== "undefined" && __DEV__ && loopback)) {
    throw new TypeError("ClinicOS mobile API origin must use HTTPS outside local development.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new TypeError(
      "ClinicOS mobile API origin must not contain credentials, path, query, or fragment."
    );
  }
  return value;
}

function resolveUploadUrl(baseUrl: string, target: string): string {
  const url = new URL(target, `${baseUrl}/`);
  const loopback =
    url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(typeof __DEV__ !== "undefined" && __DEV__ && loopback)) {
    throw new ClinicOsApiError("Upload target must use HTTPS.", 0, "UPLOAD_TARGET_INVALID");
  }
  if (url.username || url.password) {
    throw new ClinicOsApiError(
      "Upload target contains prohibited URL credentials.",
      0,
      "UPLOAD_TARGET_INVALID"
    );
  }
  return url.toString();
}

function safeHttpMessage(status: number): string {
  if (status === 401) return "The device session is no longer authorized.";
  if (status === 403) return "This session is not authorized for the selected clinic action.";
  if (status === 409) return "The workflow changed or the previous upload outcome is uncertain.";
  if (status === 429)
    return "The live service is rate-limiting uploads; the queue will retry later.";
  if (status >= 500) return "The live service is temporarily unavailable.";
  return `ClinicOS request failed (${status}).`;
}

function safeHttpError(status: number): ClinicOsApiError {
  return new ClinicOsApiError(
    safeHttpMessage(status),
    status,
    status === 401 ? "SESSION_REVOKED" : status === 409 ? "OUTCOME_UNCERTAIN" : "HTTP_ERROR"
  );
}
