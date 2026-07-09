import type { EventProvenanceSource } from "./events.ts";
import type { UUID } from "./ids.ts";
import type { LeadSource } from "./lead.ts";
import { normalizePhone } from "./patient.ts";

export const ACQUISITION_SOURCE_TYPES = [
  "phone",
  "whatsapp",
  "google",
  "practo",
  "manual",
  "referral",
  "walk_in",
  "website",
  "instagram",
  "recall_campaign"
] as const;
export type AcquisitionSourceType = (typeof ACQUISITION_SOURCE_TYPES)[number];

export const SOURCE_CAPTURE_METHODS = [
  "manual_entry",
  "provider_webhook",
  "clinic_approved_import",
  "system_generated"
] as const;
export type SourceCaptureMethod = (typeof SOURCE_CAPTURE_METHODS)[number];

export const CONVERSION_SOURCE_STAGES = [
  "lead",
  "appointment",
  "encounter",
  "treatment_plan",
  "invoice",
  "payment",
  "analytics"
] as const;
export type ConversionSourceStage = (typeof CONVERSION_SOURCE_STAGES)[number];

export interface AttributionCaptureActor {
  readonly type: "user" | "integration" | "system";
  readonly id: UUID | string | null;
  readonly displayName: string | null;
}

export interface SourceAttributionInput {
  readonly sourceType: string;
  readonly sourceDetail?: Record<string, unknown> | string | null;
  readonly externalSystemId?: string | null;
  readonly externalReference?: string | null;
  readonly campaign?: string | null;
  readonly utmSource?: string | null;
  readonly utmMedium?: string | null;
  readonly utmCampaign?: string | null;
  readonly capturedByActor?: AttributionCaptureActor | null;
  readonly capturedByUserId?: UUID | string | null;
  readonly capturedAt?: string | Date | null;
  readonly captureMethod?: SourceCaptureMethod | null;
  readonly confidence?: number | null;
  readonly metadata?: Record<string, unknown> | null;
}

export interface SourceAttribution {
  readonly schemaVersion: "1.0";
  readonly sourceType: AcquisitionSourceType;
  readonly sourceDetail: Record<string, unknown>;
  readonly externalSystemId: string | null;
  readonly externalReference: string | null;
  readonly campaign: string | null;
  readonly utmSource: string | null;
  readonly utmMedium: string | null;
  readonly utmCampaign: string | null;
  readonly capturedBy: AttributionCaptureActor;
  readonly capturedAt: string;
  readonly captureMethod: SourceCaptureMethod;
  readonly confidence: number;
  readonly metadata: Record<string, unknown>;
}

export interface ManualSourceAttributionInput
  extends Omit<SourceAttributionInput, "capturedByActor" | "capturedByUserId" | "captureMethod"> {
  readonly capturedByUserId: UUID | string;
  readonly capturedAt: string | Date;
}

export interface ConversionSourceTrailEntry {
  readonly fromStage: ConversionSourceStage;
  readonly fromRecordId: UUID | string | null;
  readonly toStage: ConversionSourceStage;
  readonly toRecordId: UUID | string | null;
  readonly preservedAt: string;
  readonly sourceType: AcquisitionSourceType;
  readonly externalReference: string | null;
}

export interface ConversionSourceSnapshot {
  readonly schemaVersion: "1.0";
  readonly stage: ConversionSourceStage;
  readonly recordId: UUID | string | null;
  readonly patientId: UUID | string | null;
  readonly sourceAttribution: SourceAttribution;
  readonly firstTouch: SourceAttribution;
  readonly bookingTouch: SourceAttribution | null;
  readonly inheritedFrom: {
    readonly stage: ConversionSourceStage;
    readonly recordId: UUID | string | null;
  } | null;
  readonly preservedAt: string;
  readonly preservationTrail: readonly ConversionSourceTrailEntry[];
  readonly metadata: Record<string, unknown>;
}

export interface CreateConversionSourceSnapshotInput {
  readonly stage: ConversionSourceStage;
  readonly recordId: UUID | string | null;
  readonly patientId?: UUID | string | null;
  readonly sourceAttribution: SourceAttribution | SourceAttributionInput;
  readonly preservedAt: string | Date;
  readonly metadata?: Record<string, unknown> | null;
}

export interface PreserveConversionSourceInput {
  readonly from: ConversionSourceSnapshot | SourceAttribution | SourceAttributionInput;
  readonly toStage: ConversionSourceStage;
  readonly toRecordId: UUID | string | null;
  readonly patientId?: UUID | string | null;
  readonly preservedAt: string | Date;
  readonly bookingTouch?: SourceAttribution | SourceAttributionInput | null;
  readonly metadata?: Record<string, unknown> | null;
}

export interface ManualMissedCallCaptureInput {
  readonly tenantId: UUID | string;
  readonly clinicId: UUID | string;
  readonly patientId?: UUID | string | null;
  readonly leadId?: UUID | string | null;
  readonly callerNumber: string;
  readonly calledNumber: string;
  readonly occurredAt: string | Date;
  readonly capturedAt: string | Date;
  readonly capturedByUserId: UUID | string;
  readonly notes?: string | null;
  readonly callbackDueAt?: string | Date | null;
  readonly campaign?: string | null;
  readonly externalReference?: string | null;
  readonly sourceAttribution?: SourceAttribution | SourceAttributionInput | null;
}

export interface ManualMissedCallCaptureEvidence {
  readonly schemaVersion: "1.0";
  readonly captureMethod: "manual_missed_call_entry";
  readonly tenantId: UUID | string;
  readonly clinicId: UUID | string;
  readonly patientId: UUID | string | null;
  readonly leadId: UUID | string | null;
  readonly callerNumber: string;
  readonly normalizedCallerNumber: string;
  readonly calledNumber: string;
  readonly normalizedCalledNumber: string;
  readonly occurredAt: string;
  readonly capturedAt: string;
  readonly capturedByUserId: UUID | string;
  readonly notes: string | null;
  readonly callbackDueAt: string | null;
  readonly sourceAttribution: SourceAttribution;
  readonly recording: {
    readonly availability: "not_available";
    readonly accessPolicy: "no_recording";
  };
  readonly auditMetadata: {
    readonly requiresAuditEvent: true;
    readonly suggestedEventType: "call.missed";
    readonly suggestedTaskType: "missed_call";
    readonly phiInvolved: true;
  };
}

const sourceTypeAliases: Readonly<Record<string, AcquisitionSourceType>> = {
  call: "phone",
  calls: "phone",
  missed_call: "phone",
  missedcall: "phone",
  phone_call: "phone",
  telephone: "phone",
  whatsapp_cloud: "whatsapp",
  wa: "whatsapp",
  google_business: "google",
  google_business_profile: "google",
  gbp: "google",
  practo_prime: "practo",
  practo_profile: "practo",
  manual_entry: "manual",
  front_desk: "manual",
  walkin: "walk_in",
  walk_in: "walk_in",
  "walk-in": "walk_in",
  in_person: "walk_in",
  recall: "recall_campaign"
};

export function normalizeAcquisitionSourceType(value: string): AcquisitionSourceType {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  const alias = sourceTypeAliases[normalized] ?? sourceTypeAliases[value.trim().toLowerCase()];
  if (alias) return alias;

  if ((ACQUISITION_SOURCE_TYPES as readonly string[]).includes(normalized)) {
    return normalized as AcquisitionSourceType;
  }

  throw new Error(`Unsupported acquisition source type: ${value}.`);
}

export function normalizeSourceAttribution(input: SourceAttributionInput): SourceAttribution {
  const sourceType = normalizeAcquisitionSourceType(input.sourceType);
  const captureMethod = input.captureMethod ?? defaultCaptureMethod(sourceType);

  return {
    schemaVersion: "1.0",
    sourceType,
    sourceDetail: normalizeSourceDetail(input.sourceDetail),
    externalSystemId: nonEmptyString(input.externalSystemId) ?? defaultExternalSystemId(sourceType),
    externalReference: nonEmptyString(input.externalReference),
    campaign: nonEmptyString(input.campaign) ?? nonEmptyString(input.utmCampaign),
    utmSource: nonEmptyString(input.utmSource),
    utmMedium: nonEmptyString(input.utmMedium),
    utmCampaign: nonEmptyString(input.utmCampaign),
    capturedBy: normalizeCapturedBy(input, captureMethod),
    capturedAt: toIsoString(input.capturedAt ?? new Date(), "capturedAt"),
    captureMethod,
    confidence: normalizeConfidence(input.confidence, captureMethod),
    metadata: cloneRecord(input.metadata)
  };
}

export function createManualSourceAttribution(input: ManualSourceAttributionInput): SourceAttribution {
  const capturedByUserId = requiredString(input.capturedByUserId, "capturedByUserId");

  return normalizeSourceAttribution({
    ...input,
    capturedByActor: {
      type: "user",
      id: capturedByUserId,
      displayName: null
    },
    captureMethod: "manual_entry",
    confidence: input.confidence ?? 1
  });
}

export function sourceAttributionToLeadSource(attribution: Pick<SourceAttribution, "sourceType">): LeadSource {
  switch (attribution.sourceType) {
    case "walk_in":
      return "walkin";
    case "recall_campaign":
      return "recall_campaign";
    case "phone":
    case "whatsapp":
    case "google":
    case "practo":
    case "manual":
    case "referral":
    case "website":
    case "instagram":
      return attribution.sourceType;
  }
}

export function sourceAttributionToEventSource(attribution: SourceAttribution): EventProvenanceSource {
  const kind = eventSourceKindFor(attribution);
  const providerKey = providerKeyFor(attribution);
  const source: EventProvenanceSource = {
    kind,
    capturedAt: attribution.capturedAt
  };

  if (providerKey) source.providerKey = providerKey;
  if (attribution.externalReference) source.externalRef = attribution.externalReference;
  if (attribution.campaign) source.campaign = attribution.campaign;
  if (attribution.sourceType === "referral") {
    const referralSource = stringFromDetail(attribution.sourceDetail, "referrer");
    if (referralSource) source.referralSource = referralSource;
  }

  return source;
}

export function createConversionSourceSnapshot(
  input: CreateConversionSourceSnapshotInput
): ConversionSourceSnapshot {
  const sourceAttribution = asSourceAttribution(input.sourceAttribution);
  const preservedAt = toIsoString(input.preservedAt, "preservedAt");

  return {
    schemaVersion: "1.0",
    stage: input.stage,
    recordId: input.recordId,
    patientId: input.patientId ?? null,
    sourceAttribution,
    firstTouch: sourceAttribution,
    bookingTouch: input.stage === "appointment" ? sourceAttribution : null,
    inheritedFrom: null,
    preservedAt,
    preservationTrail: [],
    metadata: cloneRecord(input.metadata)
  };
}

export function preserveConversionSource(input: PreserveConversionSourceInput): ConversionSourceSnapshot {
  const preservedAt = toIsoString(input.preservedAt, "preservedAt");
  const previous = isConversionSourceSnapshot(input.from) ? input.from : null;
  const sourceAttribution = previous
    ? previous.sourceAttribution
    : asSourceAttribution(input.from as SourceAttributionInput | SourceAttribution);
  const bookingTouch =
    input.bookingTouch === null
      ? null
      : input.bookingTouch
        ? asSourceAttribution(input.bookingTouch)
        : previous?.bookingTouch ?? (input.toStage === "appointment" ? sourceAttribution : null);

  const fromStage = previous?.stage ?? input.toStage;
  const fromRecordId = previous?.recordId ?? null;
  const trailEntry: ConversionSourceTrailEntry = {
    fromStage,
    fromRecordId,
    toStage: input.toStage,
    toRecordId: input.toRecordId,
    preservedAt,
    sourceType: sourceAttribution.sourceType,
    externalReference: sourceAttribution.externalReference
  };

  return {
    schemaVersion: "1.0",
    stage: input.toStage,
    recordId: input.toRecordId,
    patientId: input.patientId ?? previous?.patientId ?? null,
    sourceAttribution,
    firstTouch: previous?.firstTouch ?? sourceAttribution,
    bookingTouch,
    inheritedFrom: {
      stage: fromStage,
      recordId: fromRecordId
    },
    preservedAt,
    preservationTrail: [...(previous?.preservationTrail ?? []), trailEntry],
    metadata: {
      ...(previous?.metadata ?? {}),
      ...cloneRecord(input.metadata)
    }
  };
}

export function createManualMissedCallCaptureEvidence(
  input: ManualMissedCallCaptureInput
): ManualMissedCallCaptureEvidence {
  const capturedByUserId = requiredString(input.capturedByUserId, "capturedByUserId");
  const normalizedCallerNumber = normalizePhone(requiredString(input.callerNumber, "callerNumber"));
  const normalizedCalledNumber = normalizePhone(requiredString(input.calledNumber, "calledNumber"));
  const occurredAt = toIsoString(input.occurredAt, "occurredAt");
  const capturedAt = toIsoString(input.capturedAt, "capturedAt");
  const callbackDueAt = input.callbackDueAt ? toIsoString(input.callbackDueAt, "callbackDueAt") : null;
  const sourceAttribution = input.sourceAttribution
    ? asSourceAttribution(input.sourceAttribution)
    : createManualSourceAttribution({
        sourceType: "phone",
        sourceDetail: {
          entryType: "manual_missed_call",
          callerNumber: normalizedCallerNumber,
          calledNumber: normalizedCalledNumber
        },
        externalReference: input.externalReference,
        campaign: input.campaign,
        capturedByUserId,
        capturedAt,
        confidence: 1
      });

  if (sourceAttribution.sourceType !== "phone") {
    throw new Error("Manual missed-call entries must use phone source attribution.");
  }

  return {
    schemaVersion: "1.0",
    captureMethod: "manual_missed_call_entry",
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    patientId: input.patientId ?? null,
    leadId: input.leadId ?? null,
    callerNumber: input.callerNumber,
    normalizedCallerNumber,
    calledNumber: input.calledNumber,
    normalizedCalledNumber,
    occurredAt,
    capturedAt,
    capturedByUserId,
    notes: nonEmptyString(input.notes),
    callbackDueAt,
    sourceAttribution,
    recording: {
      availability: "not_available",
      accessPolicy: "no_recording"
    },
    auditMetadata: {
      requiresAuditEvent: true,
      suggestedEventType: "call.missed",
      suggestedTaskType: "missed_call",
      phiInvolved: true
    }
  };
}

function defaultCaptureMethod(sourceType: AcquisitionSourceType): SourceCaptureMethod {
  if (sourceType === "manual" || sourceType === "walk_in" || sourceType === "referral") {
    return "manual_entry";
  }
  return "provider_webhook";
}

function normalizeCapturedBy(
  input: SourceAttributionInput,
  captureMethod: SourceCaptureMethod
): AttributionCaptureActor {
  if (input.capturedByActor) {
    return {
      type: input.capturedByActor.type,
      id: input.capturedByActor.id ?? null,
      displayName: input.capturedByActor.displayName ?? null
    };
  }

  if (input.capturedByUserId) {
    return {
      type: "user",
      id: input.capturedByUserId,
      displayName: null
    };
  }

  return {
    type: captureMethod === "provider_webhook" ? "integration" : "system",
    id: null,
    displayName: null
  };
}

function normalizeSourceDetail(value: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (typeof value === "string") {
    const detail = value.trim();
    return detail ? { label: detail } : {};
  }

  return cloneRecord(value);
}

function normalizeConfidence(value: number | null | undefined, captureMethod: SourceCaptureMethod): number {
  if (value === null || value === undefined) {
    if (captureMethod === "manual_entry") return 1;
    if (captureMethod === "provider_webhook") return 0.95;
    if (captureMethod === "clinic_approved_import") return 0.8;
    return 0.6;
  }

  if (!Number.isFinite(value)) {
    throw new Error("Source attribution confidence must be a finite number.");
  }

  return Math.max(0, Math.min(1, value));
}

function eventSourceKindFor(attribution: SourceAttribution): EventProvenanceSource["kind"] {
  if (attribution.captureMethod === "clinic_approved_import") return "manual_import";
  if (attribution.captureMethod === "provider_webhook") return "external_system";

  switch (attribution.sourceType) {
    case "phone":
      return "phone_call";
    case "whatsapp":
      return "patient_message";
    case "walk_in":
      return "walk_in";
    case "referral":
      return "referral";
    case "google":
    case "practo":
    case "website":
    case "instagram":
    case "manual":
    case "recall_campaign":
      return "manual_entry";
  }
}

function providerKeyFor(attribution: SourceAttribution): string | undefined {
  if (attribution.externalSystemId) return attribution.externalSystemId;

  switch (attribution.sourceType) {
    case "google":
      return "google_business";
    case "practo":
      return "practo";
    case "whatsapp":
      return "whatsapp";
    case "phone":
      return "telephony";
    case "website":
    case "instagram":
    case "manual":
    case "referral":
    case "walk_in":
    case "recall_campaign":
      return undefined;
  }
}

function defaultExternalSystemId(sourceType: AcquisitionSourceType): string | null {
  if (sourceType === "google") return "google_business_profile";
  if (sourceType === "practo") return "practo";
  return null;
}

function asSourceAttribution(input: SourceAttribution | SourceAttributionInput): SourceAttribution {
  if (isSourceAttribution(input)) return input;
  return normalizeSourceAttribution(input);
}

function isSourceAttribution(input: SourceAttribution | SourceAttributionInput): input is SourceAttribution {
  return "schemaVersion" in input && input.schemaVersion === "1.0";
}

function isConversionSourceSnapshot(
  input: PreserveConversionSourceInput["from"]
): input is ConversionSourceSnapshot {
  return "schemaVersion" in input && "stage" in input && "sourceAttribution" in input;
}

function cloneRecord(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) return {};
  return { ...value };
}

function stringFromDetail(detail: Record<string, unknown>, field: string): string | undefined {
  const value = detail[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nonEmptyString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredString(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  return trimmed;
}

function toIsoString(value: string | Date, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    throw new Error(`${field} must be a valid date-time.`);
  }
  return date.toISOString();
}
