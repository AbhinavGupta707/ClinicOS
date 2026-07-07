import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import type { AdapterCapability, ProviderHealth } from "./provider-contracts.js";

export type TelephonyProviderKey =
  | "simulator"
  | "exotel"
  | "knowlarity"
  | "twilio"
  | "unconfigured";

export type TelephonyCallEventName =
  | "call.incoming"
  | "call.missed"
  | "call.answered"
  | "call.completed"
  | "call.recording.available"
  | "call.status.updated";

export type TelephonyCallDirection = "inbound" | "outbound" | "unknown";
export type TelephonyCallStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "busy"
  | "no_answer"
  | "cancelled"
  | "unknown";
export type TelephonyWebhookVerificationStatus =
  | "verified"
  | "missing_signature"
  | "invalid_signature"
  | "not_configured";

export interface RawTelephonyWebhook {
  readonly providerKey: TelephonyProviderKey | string;
  readonly headers: Record<string, string | undefined>;
  readonly rawBody: string;
  readonly receivedAt: string;
}

export interface TelephonyWebhookVerificationResult {
  readonly status: TelephonyWebhookVerificationStatus;
  readonly providerKey: TelephonyProviderKey | string;
  readonly providerEventId?: string | null;
  readonly signatureHeader?: string | null;
  readonly message: string;
}

export interface TelephonyRecordingPointer {
  readonly availability: "not_available" | "available";
  readonly providerRecordingId: string | null;
  readonly rawProviderUrlSha256: string | null;
  readonly accessPolicy: "no_recording" | "requires_call_recording_permission";
  readonly rawProviderUrlExposed: false;
}

export interface NormalizedTelephonyCallEvent {
  readonly providerKey: TelephonyProviderKey | string;
  readonly providerCallId: string;
  readonly providerEventId: string;
  readonly idempotencyKey: string;
  readonly eventName: TelephonyCallEventName;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly direction: TelephonyCallDirection;
  readonly status: TelephonyCallStatus;
  readonly callerNumber: string | null;
  readonly calledNumber: string | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  readonly durationSeconds: number | null;
  readonly virtualNumber: string | null;
  readonly recording: TelephonyRecordingPointer;
  readonly source: {
    readonly sourceType: "phone";
    readonly captureMethod: "provider_webhook";
    readonly externalSystemId: string;
    readonly externalReference: string;
    readonly confidence: number;
  };
  readonly rawBodySha256: string;
  readonly payload: Record<string, unknown>;
}

export interface TelephonyProvider {
  readonly providerKey: TelephonyProviderKey | string;
  capabilities(): readonly AdapterCapability[];
  healthCheck(): Promise<ProviderHealth>;
  verifyWebhook(raw: RawTelephonyWebhook): Promise<TelephonyWebhookVerificationResult>;
  parseWebhook(raw: RawTelephonyWebhook): Promise<readonly NormalizedTelephonyCallEvent[]>;
}

export interface ExotelTelephonyProviderOptions {
  readonly accountSid?: string | null | undefined;
  readonly apiKey?: string | null | undefined;
  readonly apiToken?: string | null | undefined;
  readonly virtualNumber?: string | null | undefined;
  readonly webhookSecret?: string | null | undefined;
  readonly regionSubdomain?: string | null | undefined;
  readonly webhookCallbackConfigured?: boolean;
  readonly now?: () => Date;
}

export interface SimulatorTelephonyProviderOptions {
  readonly webhookSecret?: string;
  readonly now?: () => Date;
}

export interface UnavailableTelephonyProviderOptions {
  readonly providerKey: TelephonyProviderKey;
  readonly message: string;
  readonly now?: () => Date;
}

export class TelephonyProviderError extends Error {
  readonly providerKey: string;
  readonly status: "not_configured" | "unavailable" | "verification_failed";
  readonly details: Record<string, unknown>;

  constructor(input: {
    providerKey: string;
    status: TelephonyProviderError["status"];
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "TelephonyProviderError";
    this.providerKey = input.providerKey;
    this.status = input.status;
    this.details = input.details ?? {};
  }
}

const TELEPHONY_WEBHOOK_CAPABILITIES: AdapterCapability[] = [
  "RECEIVE_WEBHOOKS",
  "FETCH_CALL_RECORDING"
] as const;
const SIMULATOR_SECRET = "clinic-os-local-telephony-simulator-webhook-secret";
const SIGNATURE_HEADER = "x-clinic-os-telephony-signature";
const EVENT_ID_HEADER = "x-clinic-os-telephony-event-id";

export class ExotelTelephonyProvider implements TelephonyProvider {
  readonly providerKey = "exotel";
  readonly #accountSid?: string | null;
  readonly #apiKey?: string | null;
  readonly #apiToken?: string | null;
  readonly #virtualNumber?: string | null;
  readonly #webhookSecret?: string | null;
  readonly #regionSubdomain: string;
  readonly #webhookCallbackConfigured: boolean;
  readonly #now: () => Date;

  constructor(options: ExotelTelephonyProviderOptions) {
    this.#accountSid = options.accountSid;
    this.#apiKey = options.apiKey;
    this.#apiToken = options.apiToken;
    this.#virtualNumber = options.virtualNumber;
    this.#webhookSecret = options.webhookSecret;
    this.#regionSubdomain = options.regionSubdomain ?? "api.in.exotel.com";
    this.#webhookCallbackConfigured = options.webhookCallbackConfigured ?? false;
    this.#now = options.now ?? (() => new Date());
  }

  capabilities(): readonly AdapterCapability[] {
    if (!this.isActivated()) return [];
    return TELEPHONY_WEBHOOK_CAPABILITIES;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const missingFields = this.missingActivationFields();
    if (missingFields.length > 0) {
      return {
        providerKey: this.providerKey,
        status: "not_configured",
        checkedAt: this.#now().toISOString(),
        capabilities: [],
        message: `Exotel telephony is not configured. Missing: ${missingFields.join(", ")}.`
      };
    }

    if (!this.#webhookCallbackConfigured) {
      return {
        providerKey: this.providerKey,
        status: "not_configured",
        checkedAt: this.#now().toISOString(),
        capabilities: [],
        message:
          "Exotel credentials are present, but the signed ClinicOS callback has not been registered with the provider."
      };
    }

    const health: ProviderHealth = {
      providerKey: this.providerKey,
      status: "available",
      checkedAt: this.#now().toISOString(),
      capabilities: this.capabilities(),
      message: `Exotel callback is configured for ${this.#regionSubdomain}.`
    };
    return this.#accountSid ? { ...health, accountId: this.#accountSid } : health;
  }

  async verifyWebhook(raw: RawTelephonyWebhook): Promise<TelephonyWebhookVerificationResult> {
    return verifySignedTelephonyWebhook({
      providerKey: this.providerKey,
      webhookSecret: this.#webhookSecret,
      raw
    });
  }

  async parseWebhook(raw: RawTelephonyWebhook): Promise<readonly NormalizedTelephonyCallEvent[]> {
    this.assertActivated();
    const payload = parseWebhookBody(raw.rawBody);
    return normalizeExotelEvents({
      payload,
      raw,
      virtualNumber: this.#virtualNumber ?? null
    });
  }

  assertActivated(): void {
    const missingFields = this.missingActivationFields();
    if (missingFields.length > 0 || !this.#webhookCallbackConfigured) {
      throw new TelephonyProviderError({
        providerKey: this.providerKey,
        status: "not_configured",
        message:
          missingFields.length > 0
            ? `Exotel telephony is not configured. Missing: ${missingFields.join(", ")}.`
            : "Exotel signed callback registration is required before parsing live call events.",
        details: {
          missingFields,
          webhookCallbackConfigured: this.#webhookCallbackConfigured
        }
      });
    }
  }

  isActivated(): boolean {
    return this.missingActivationFields().length === 0 && this.#webhookCallbackConfigured;
  }

  missingActivationFields(): string[] {
    const missing: string[] = [];
    if (!nonEmptyString(this.#accountSid)) missing.push("TELEPHONY_ACCOUNT_SID");
    if (!nonEmptyString(this.#apiKey)) missing.push("TELEPHONY_API_KEY");
    if (!nonEmptyString(this.#apiToken)) missing.push("TELEPHONY_API_TOKEN");
    if (!nonEmptyString(this.#virtualNumber)) missing.push("TELEPHONY_VIRTUAL_NUMBER");
    if (!nonEmptyString(this.#webhookSecret)) missing.push("TELEPHONY_WEBHOOK_SECRET");
    return missing;
  }
}

export class SimulatorTelephonyProvider implements TelephonyProvider {
  readonly providerKey = "simulator";
  readonly #webhookSecret: string;
  readonly #now: () => Date;

  constructor(options: SimulatorTelephonyProviderOptions = {}) {
    this.#webhookSecret = options.webhookSecret ?? SIMULATOR_SECRET;
    this.#now = options.now ?? (() => new Date());
  }

  capabilities(): readonly AdapterCapability[] {
    return ["RECEIVE_WEBHOOKS"];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerKey: this.providerKey,
      status: "available",
      checkedAt: this.#now().toISOString(),
      capabilities: this.capabilities(),
      message: "Local telephony simulator is available for signed contract tests."
    };
  }

  async verifyWebhook(raw: RawTelephonyWebhook): Promise<TelephonyWebhookVerificationResult> {
    return verifySignedTelephonyWebhook({
      providerKey: this.providerKey,
      webhookSecret: this.#webhookSecret,
      raw
    });
  }

  async parseWebhook(raw: RawTelephonyWebhook): Promise<readonly NormalizedTelephonyCallEvent[]> {
    const payload = parseWebhookBody(raw.rawBody);
    return normalizeSimulatorEvents({ payload, raw });
  }

  buildSignedWebhook(input: {
    providerCallId?: string;
    eventName?: TelephonyCallEventName;
    status?: TelephonyCallStatus;
    direction?: TelephonyCallDirection;
    callerNumber: string;
    calledNumber: string;
    occurredAt?: string;
    startedAt?: string | null;
    endedAt?: string | null;
    durationSeconds?: number | null;
    recordingUrl?: string | null;
    providerEventId?: string;
  }): RawTelephonyWebhook {
    const providerEventId = input.providerEventId ?? `evt_tel_${randomUUID()}`;
    const rawBody = JSON.stringify({
      providerCallId: input.providerCallId ?? `call_sim_${randomUUID()}`,
      eventName: input.eventName ?? "call.missed",
      status: input.status ?? "no_answer",
      direction: input.direction ?? "inbound",
      callerNumber: input.callerNumber,
      calledNumber: input.calledNumber,
      occurredAt: input.occurredAt ?? this.#now().toISOString(),
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? null,
      durationSeconds: input.durationSeconds ?? null,
      recordingUrl: input.recordingUrl ?? null
    });

    return {
      providerKey: this.providerKey,
      receivedAt: this.#now().toISOString(),
      rawBody,
      headers: {
        [EVENT_ID_HEADER]: providerEventId,
        [SIGNATURE_HEADER]: signTelephonyWebhook(rawBody, this.#webhookSecret)
      }
    };
  }
}

export class UnavailableTelephonyProvider implements TelephonyProvider {
  readonly providerKey: TelephonyProviderKey;
  readonly #message: string;
  readonly #now: () => Date;

  constructor(options: UnavailableTelephonyProviderOptions) {
    this.providerKey = options.providerKey;
    this.#message = options.message;
    this.#now = options.now ?? (() => new Date());
  }

  capabilities(): readonly AdapterCapability[] {
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerKey: this.providerKey,
      status: "not_configured",
      checkedAt: this.#now().toISOString(),
      capabilities: [],
      message: this.#message
    };
  }

  async verifyWebhook(): Promise<TelephonyWebhookVerificationResult> {
    return {
      status: "not_configured",
      providerKey: this.providerKey,
      message: this.#message
    };
  }

  async parseWebhook(): Promise<readonly NormalizedTelephonyCallEvent[]> {
    throw new TelephonyProviderError({
      providerKey: this.providerKey,
      status: "not_configured",
      message: this.#message
    });
  }
}

export function createTelephonyProvider(input: {
  provider: TelephonyProviderKey;
  accountSid?: string;
  apiKey?: string;
  apiToken?: string;
  virtualNumber?: string;
  webhookSecret?: string;
  regionSubdomain?: string;
  webhookCallbackConfigured?: boolean;
}): TelephonyProvider {
  if (input.provider === "simulator") return new SimulatorTelephonyProvider();
  if (input.provider === "exotel") {
    return new ExotelTelephonyProvider({
      accountSid: input.accountSid,
      apiKey: input.apiKey,
      apiToken: input.apiToken,
      virtualNumber: input.virtualNumber,
      webhookSecret: input.webhookSecret,
      regionSubdomain: input.regionSubdomain,
      webhookCallbackConfigured: input.webhookCallbackConfigured
    });
  }
  return new UnavailableTelephonyProvider({
    providerKey: input.provider,
    message:
      input.provider === "unconfigured"
        ? "Telephony provider is not configured; use audited manual missed-call entry."
        : `${input.provider} telephony provider adapter is not configured for this clinic.`
  });
}

export function signTelephonyWebhook(rawBody: string, webhookSecret: string): string {
  return hmacSha256Hex(webhookSecret, rawBody);
}

function normalizeExotelEvents(input: {
  payload: Record<string, unknown>;
  raw: RawTelephonyWebhook;
  virtualNumber: string | null;
}): readonly NormalizedTelephonyCallEvent[] {
  const payload = input.payload;
  const providerCallId = stringValue(
    firstValue(payload, ["CallSid", "call_sid", "callSid", "Sid"]),
    "CallSid"
  );
  const providerEventId =
    header(input.raw.headers, EVENT_ID_HEADER) ??
    nullableString(firstValue(payload, ["EventId", "EventID", "event_id"])) ??
    `${providerCallId}:${sha256Hex(input.raw.rawBody).slice(0, 16)}`;
  const status = normalizeCallStatus(nullableString(firstValue(payload, ["Status", "CallStatus"])));
  const direction = normalizeCallDirection(nullableString(firstValue(payload, ["Direction"])));
  const callerNumber = nullableString(firstValue(payload, ["From", "Caller", "callerNumber"]));
  const calledNumber =
    nullableString(firstValue(payload, ["To", "Called", "calledNumber"])) ?? input.virtualNumber;
  const occurredAt = dateTimeToIso(
    nullableString(firstValue(payload, ["DateUpdated", "EndTime", "StartTime", "DateCreated"])),
    input.raw.receivedAt
  );
  const startedAt = nullableDateTime(firstValue(payload, ["StartTime", "DateCreated"]));
  const endedAt = nullableDateTime(firstValue(payload, ["EndTime", "DateUpdated"]));
  const durationSeconds = numberMaybe(firstValue(payload, ["ConversationDuration", "Duration"]));
  const recordingUrl = nullableString(firstValue(payload, ["RecordingUrl", "RecordingURL"]));
  const recording = recordingPointer(providerCallId, recordingUrl);
  const eventName = eventNameFromCall({
    providerEventType: nullableString(firstValue(payload, ["EventType"])),
    status,
    direction,
    recording
  });

  const events = [
    buildTelephonyCallEvent({
      providerKey: "exotel",
      providerCallId,
      providerEventId,
      eventName,
      occurredAt,
      receivedAt: input.raw.receivedAt,
      direction,
      status,
      callerNumber,
      calledNumber,
      startedAt,
      endedAt,
      durationSeconds,
      virtualNumber: input.virtualNumber,
      recording,
      rawBody: input.raw.rawBody,
      payload: sanitizeTelephonyPayload(payload)
    })
  ];

  if (recording.availability === "available" && eventName !== "call.recording.available") {
    return [
      ...events,
      buildTelephonyCallEvent({
        providerKey: "exotel",
        providerCallId,
        providerEventId: `${providerEventId}:recording`,
        eventName: "call.recording.available",
        occurredAt,
        receivedAt: input.raw.receivedAt,
        direction,
        status,
        callerNumber,
        calledNumber,
        startedAt,
        endedAt,
        durationSeconds,
        virtualNumber: input.virtualNumber,
        recording,
        rawBody: input.raw.rawBody,
        payload: sanitizeTelephonyPayload(payload)
      })
    ];
  }

  return events;
}

function normalizeSimulatorEvents(input: {
  payload: Record<string, unknown>;
  raw: RawTelephonyWebhook;
}): readonly NormalizedTelephonyCallEvent[] {
  const payload = input.payload;
  const providerCallId = stringValue(firstValue(payload, ["providerCallId", "CallSid"]), "providerCallId");
  const providerEventId =
    header(input.raw.headers, EVENT_ID_HEADER) ??
    nullableString(firstValue(payload, ["providerEventId"])) ??
    `${providerCallId}:${sha256Hex(input.raw.rawBody).slice(0, 16)}`;
  const status = normalizeCallStatus(nullableString(firstValue(payload, ["status", "Status"])));
  const direction = normalizeCallDirection(nullableString(firstValue(payload, ["direction", "Direction"])));
  const callerNumber = nullableString(firstValue(payload, ["callerNumber", "From"]));
  const calledNumber = nullableString(firstValue(payload, ["calledNumber", "To"]));
  const occurredAt = dateTimeToIso(nullableString(firstValue(payload, ["occurredAt"])), input.raw.receivedAt);
  const startedAt = nullableDateTime(firstValue(payload, ["startedAt"]));
  const endedAt = nullableDateTime(firstValue(payload, ["endedAt"]));
  const durationSeconds = numberMaybe(firstValue(payload, ["durationSeconds"]));
  const recording = recordingPointer(providerCallId, nullableString(firstValue(payload, ["recordingUrl"])));
  const eventName =
    normalizeEventName(nullableString(firstValue(payload, ["eventName"]))) ??
    eventNameFromCall({
      providerEventType: null,
      status,
      direction,
      recording
    });

  return [
    buildTelephonyCallEvent({
      providerKey: "simulator",
      providerCallId,
      providerEventId,
      eventName,
      occurredAt,
      receivedAt: input.raw.receivedAt,
      direction,
      status,
      callerNumber,
      calledNumber,
      startedAt,
      endedAt,
      durationSeconds,
      virtualNumber: calledNumber,
      recording,
      rawBody: input.raw.rawBody,
      payload: sanitizeTelephonyPayload(payload)
    })
  ];
}

function buildTelephonyCallEvent(input: {
  providerKey: TelephonyProviderKey;
  providerCallId: string;
  providerEventId: string;
  eventName: TelephonyCallEventName;
  occurredAt: string;
  receivedAt: string;
  direction: TelephonyCallDirection;
  status: TelephonyCallStatus;
  callerNumber: string | null;
  calledNumber: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  virtualNumber: string | null;
  recording: TelephonyRecordingPointer;
  rawBody: string;
  payload: Record<string, unknown>;
}): NormalizedTelephonyCallEvent {
  return {
    providerKey: input.providerKey,
    providerCallId: input.providerCallId,
    providerEventId: input.providerEventId,
    idempotencyKey: `${input.providerKey}:call:${input.providerCallId}:${input.eventName}:${input.providerEventId}`,
    eventName: input.eventName,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
    direction: input.direction,
    status: input.status,
    callerNumber: input.callerNumber,
    calledNumber: input.calledNumber,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationSeconds: input.durationSeconds,
    virtualNumber: input.virtualNumber,
    recording: input.recording,
    source: {
      sourceType: "phone",
      captureMethod: "provider_webhook",
      externalSystemId: input.providerKey,
      externalReference: input.providerCallId,
      confidence: input.callerNumber && input.calledNumber ? 0.95 : 0.75
    },
    rawBodySha256: sha256Hex(input.rawBody),
    payload: input.payload
  };
}

function eventNameFromCall(input: {
  providerEventType: string | null;
  status: TelephonyCallStatus;
  direction: TelephonyCallDirection;
  recording: TelephonyRecordingPointer;
}): TelephonyCallEventName {
  const providerEventType = input.providerEventType?.trim().toLowerCase();
  if (providerEventType === "answered") return "call.answered";
  if (input.recording.availability === "available" && providerEventType === "recording") {
    return "call.recording.available";
  }
  if (input.direction === "inbound" && input.status === "queued") return "call.incoming";
  if (input.status === "in_progress") return "call.answered";
  if (input.status === "completed") return "call.completed";
  if (input.status === "no_answer" && input.direction === "inbound") return "call.missed";
  return "call.status.updated";
}

function normalizeEventName(value: string | null): TelephonyCallEventName | null {
  if (!value) return null;
  if (
    value === "call.incoming" ||
    value === "call.missed" ||
    value === "call.answered" ||
    value === "call.completed" ||
    value === "call.recording.available" ||
    value === "call.status.updated"
  ) {
    return value;
  }
  return null;
}

function recordingPointer(
  providerCallId: string,
  rawRecordingUrl: string | null
): TelephonyRecordingPointer {
  if (!rawRecordingUrl) {
    return {
      availability: "not_available",
      providerRecordingId: null,
      rawProviderUrlSha256: null,
      accessPolicy: "no_recording",
      rawProviderUrlExposed: false
    };
  }

  const hash = sha256Hex(rawRecordingUrl);
  return {
    availability: "available",
    providerRecordingId: `${providerCallId}:recording:${hash.slice(0, 12)}`,
    rawProviderUrlSha256: hash,
    accessPolicy: "requires_call_recording_permission",
    rawProviderUrlExposed: false
  };
}

function sanitizeTelephonyPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (key.toLowerCase().includes("recordingurl")) {
      if (typeof value === "string" && value.trim()) {
        sanitized[`${key}Sha256`] = sha256Hex(value.trim());
      }
      sanitized[`${key}Redacted`] = true;
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}

function verifySignedTelephonyWebhook(input: {
  providerKey: TelephonyProviderKey | string;
  webhookSecret?: string | null;
  raw: RawTelephonyWebhook;
}): TelephonyWebhookVerificationResult {
  const providerEventId = header(input.raw.headers, EVENT_ID_HEADER);
  const signature = header(input.raw.headers, SIGNATURE_HEADER);

  if (!input.webhookSecret) {
    return {
      status: "not_configured",
      providerKey: input.providerKey,
      providerEventId,
      signatureHeader: signature,
      message: "Telephony webhook secret is not configured."
    };
  }

  if (!signature) {
    return {
      status: "missing_signature",
      providerKey: input.providerKey,
      providerEventId,
      signatureHeader: null,
      message: `Telephony webhook signature header ${SIGNATURE_HEADER} is missing.`
    };
  }

  const expected = signTelephonyWebhook(input.raw.rawBody, input.webhookSecret);
  const verified = timingSafeHexEqual(expected, signature);

  return {
    status: verified ? "verified" : "invalid_signature",
    providerKey: input.providerKey,
    providerEventId,
    signatureHeader: signature,
    message: verified ? "Telephony webhook signature verified." : "Telephony webhook signature mismatch."
  };
}

function parseWebhookBody(rawBody: string): Record<string, unknown> {
  const trimmed = rawBody.trim();
  if (!trimmed) {
    throw new TelephonyProviderError({
      providerKey: "telephony",
      status: "verification_failed",
      message: "Telephony webhook body is empty."
    });
  }

  if (trimmed.startsWith("{")) {
    try {
      return objectRecord(JSON.parse(trimmed), "telephony webhook payload");
    } catch (error) {
      if (error instanceof TelephonyProviderError) throw error;
      throw new TelephonyProviderError({
        providerKey: "telephony",
        status: "verification_failed",
        message: "Telephony webhook JSON body is invalid."
      });
    }
  }

  const params = new URLSearchParams(trimmed);
  const entries = [...params.entries()];
  if (entries.length === 0) {
    throw new TelephonyProviderError({
      providerKey: "telephony",
      status: "verification_failed",
      message: "Telephony webhook body must be JSON or URL-encoded form data."
    });
  }

  return Object.fromEntries(entries);
}

function firstValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return undefined;
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TelephonyProviderError({
      providerKey: "telephony",
      status: "verification_failed",
      message: `${label} must be a JSON object.`
    });
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TelephonyProviderError({
      providerKey: "telephony",
      status: "verification_failed",
      message: `${field} must be a non-empty string.`
    });
  }
  return value.trim();
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCallStatus(value: string | null): TelephonyCallStatus {
  const normalized = value?.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "queued") return "queued";
  if (normalized === "in_progress" || normalized === "inprogress") return "in_progress";
  if (normalized === "completed") return "completed";
  if (normalized === "failed") return "failed";
  if (normalized === "busy") return "busy";
  if (normalized === "no_answer" || normalized === "noanswer") return "no_answer";
  if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
  return "unknown";
}

function normalizeCallDirection(value: string | null): TelephonyCallDirection {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "inbound" || normalized === "incoming") return "inbound";
  if (normalized?.startsWith("outbound")) return "outbound";
  return "unknown";
}

function nullableDateTime(value: unknown): string | null {
  const parsed = nullableString(value);
  if (!parsed) return null;
  return dateTimeToIsoOrNull(parsed);
}

function dateTimeToIso(value: string | null, fallback: string): string {
  if (!value) {
    return new Date(fallback).toISOString();
  }
  return dateTimeToIsoOrNull(value) ?? new Date(fallback).toISOString();
}

function dateTimeToIsoOrNull(value: string): string | null {
  const isoLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(isoLike);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function numberMaybe(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function header(headers: Record<string, string | undefined>, name: string): string | null {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName && value) return value;
  }
  return null;
}

function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

function sha256Hex(message: string): string {
  return createHash("sha256").update(message).digest("hex");
}

function timingSafeHexEqual(expectedHex: string, receivedHex: string): boolean {
  if (!/^[a-f0-9]+$/i.test(receivedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const received = Buffer.from(receivedHex, "hex");
  if (expected.byteLength !== received.byteLength) return false;
  return timingSafeEqual(expected, received);
}
