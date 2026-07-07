import {
  CONSENT_CAPTURE_METHODS,
  CONSENT_PURPOSES,
  CP3_CLINICAL_EVENT_TYPES,
  CP3_EVENT_TYPES,
  ENCOUNTER_STATUSES,
  INTAKE_FORM_TYPES,
  INTAKE_SUBMISSION_SOURCES,
  PRESCRIPTION_STATUSES,
  createDomainEventEnvelope,
  type ClinicalNoteContent,
  type ConsentCaptureMethod,
  type ConsentEnforcementState,
  type ConsentPurpose,
  type Cp3EventType,
  type DomainEventAggregate,
  type DomainEventEnvelope,
  type EncounterStatus,
  type EventProvenanceSource,
  type IntakeFormType,
  type IntakeSubmissionSource,
  type PrescriptionMedication,
  type PrescriptionStatus
} from "@clinic-os/domain";
import type { AuditActor } from "@clinic-os/domain";
import {
  addOptional,
  asRecord,
  ensureAllowedKeys,
  optionalBoolean,
  optionalRecord,
  optionalString,
  parseCp3EventType,
  parseEventProvenanceSource,
  parseMutationContext,
  parseWithIssues,
  requiredEnum,
  requiredNumber,
  requiredString,
  type ContractValidationIssue,
  type ContractParseResult,
  type MutationRequestContext
} from "./validation.ts";

export {
  CONSENT_CAPTURE_METHODS,
  CONSENT_PURPOSES,
  CP3_CLINICAL_EVENT_TYPES,
  CP3_EVENT_TYPES,
  ENCOUNTER_STATUSES,
  INTAKE_FORM_TYPES,
  INTAKE_SUBMISSION_SOURCES,
  PRESCRIPTION_STATUSES
};

export type {
  ClinicalNoteContent,
  ConsentCaptureMethod,
  ConsentEnforcementState,
  ConsentPurpose,
  Cp3EventType,
  DomainEventEnvelope,
  EncounterStatus,
  EventProvenanceSource,
  IntakeFormType,
  IntakeSubmissionSource,
  PrescriptionMedication,
  PrescriptionStatus
};

export interface IntakeFormTemplateCreateRequest extends MutationRequestContext {
  template: {
    code: string;
    displayName: string;
    formType: IntakeFormType;
    version: number;
    schema: Record<string, unknown>;
    active?: boolean;
  };
}

export interface IntakeFormSubmissionRequest extends MutationRequestContext {
  patientId: string;
  formResponse: {
    templateId: string;
    source: IntakeSubmissionSource;
    responses: Record<string, unknown>;
    medicalHistorySnapshot?: Record<string, unknown>;
    provenance: EventProvenanceSource;
  };
}

export interface ConsentCreateRequest extends MutationRequestContext {
  patientId: string;
  consent: {
    purpose: ConsentPurpose;
    templateCode: string;
    templateVersion: number;
    captureMethod: ConsentCaptureMethod;
    grantedByName?: string;
    relationshipToPatient?: string;
    evidence?: Record<string, unknown>;
    provenance: EventProvenanceSource;
  };
}

export interface ConsentRevokeRequest extends MutationRequestContext {
  patientId: string;
  consentId: string;
  reason: string;
}

export interface EncounterCreateRequest extends MutationRequestContext {
  encounter: {
    patientId: string;
    appointmentId?: string;
    providerUserId: string;
    reason?: string;
    medicalHistorySnapshot?: Record<string, unknown>;
  };
}

export interface ClinicalNoteDraftSaveRequest extends MutationRequestContext {
  encounterId: string;
  content: ClinicalNoteContent;
  readyForSign?: boolean;
}

export interface ClinicalNoteAmendRequest extends MutationRequestContext {
  encounterId: string;
  content: ClinicalNoteContent;
  amendmentReason: string;
}

export interface PrescriptionCreateRequest extends MutationRequestContext {
  encounterId: string;
  medications: PrescriptionMedication[];
  notes?: string;
}

export interface PrescriptionSignRequest extends MutationRequestContext {
  prescriptionId: string;
}

export interface Cp3EventInput<TPayload extends Record<string, unknown>> {
  eventId?: string;
  eventType: Cp3EventType;
  tenantId: string;
  clinicId: string;
  actor: AuditActor;
  occurredAt?: string;
  idempotencyKey?: string;
  correlationId: string;
  source: EventProvenanceSource;
  aggregate?: DomainEventAggregate;
  patientId?: string;
  payload: TPayload;
}

export function createCp3EventEnvelope<TPayload extends Record<string, unknown>>(
  input: Cp3EventInput<TPayload>
): DomainEventEnvelope<TPayload, Cp3EventType> {
  return createDomainEventEnvelope(input);
}

export function parseIntakeFormTemplateCreateRequest(
  input: unknown
): ContractParseResult<IntakeFormTemplateCreateRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "template"],
      "$",
      issues
    );
    const templateRecord = asRecord(record.template, "$.template", issues) ?? {};
    ensureAllowedKeys(
      templateRecord,
      ["code", "displayName", "formType", "version", "schema", "active"],
      "$.template",
      issues
    );

    const template: IntakeFormTemplateCreateRequest["template"] = {
      code: requiredString(templateRecord, "code", "$.template", issues),
      displayName: requiredString(templateRecord, "displayName", "$.template", issues),
      formType: requiredEnum(templateRecord, "formType", "$.template", INTAKE_FORM_TYPES, issues),
      version: requiredNumber(templateRecord, "version", "$.template", issues, {
        integer: true,
        min: 1
      }),
      schema: optionalRecord(templateRecord, "schema", "$.template", issues) ?? {}
    };

    addOptional(template, "active", optionalBoolean(templateRecord, "active", "$.template", issues));

    return { ...parseMutationContext(record, "$", issues), template };
  });
}

export function parseIntakeFormSubmissionRequest(
  input: unknown
): ContractParseResult<IntakeFormSubmissionRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      [
        "tenantId",
        "clinicId",
        "actor",
        "correlationId",
        "requestId",
        "idempotencyKey",
        "patientId",
        "formResponse"
      ],
      "$",
      issues
    );
    const formRecord = asRecord(record.formResponse, "$.formResponse", issues) ?? {};
    ensureAllowedKeys(
      formRecord,
      ["templateId", "source", "responses", "medicalHistorySnapshot", "provenance"],
      "$.formResponse",
      issues
    );

    const provenanceRecord = asRecord(formRecord.provenance, "$.formResponse.provenance", issues) ?? {};
    const formResponse: IntakeFormSubmissionRequest["formResponse"] = {
      templateId: requiredString(formRecord, "templateId", "$.formResponse", issues, { uuid: true }),
      source: requiredEnum(formRecord, "source", "$.formResponse", INTAKE_SUBMISSION_SOURCES, issues),
      responses: optionalRecord(formRecord, "responses", "$.formResponse", issues) ?? {},
      provenance: parseEventProvenanceSource(provenanceRecord, "$.formResponse.provenance", issues)
    };

    addOptional(
      formResponse,
      "medicalHistorySnapshot",
      optionalRecord(formRecord, "medicalHistorySnapshot", "$.formResponse", issues)
    );

    return {
      ...parseMutationContext(record, "$", issues),
      patientId: requiredString(record, "patientId", "$", issues, { uuid: true }),
      formResponse
    };
  });
}

export function parseConsentCreateRequest(input: unknown): ContractParseResult<ConsentCreateRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "patientId", "consent"],
      "$",
      issues
    );
    const consentRecord = asRecord(record.consent, "$.consent", issues) ?? {};
    ensureAllowedKeys(
      consentRecord,
      [
        "purpose",
        "templateCode",
        "templateVersion",
        "captureMethod",
        "grantedByName",
        "relationshipToPatient",
        "evidence",
        "provenance"
      ],
      "$.consent",
      issues
    );

    const provenanceRecord = asRecord(consentRecord.provenance, "$.consent.provenance", issues) ?? {};
    const consent: ConsentCreateRequest["consent"] = {
      purpose: requiredEnum(consentRecord, "purpose", "$.consent", CONSENT_PURPOSES, issues),
      templateCode: requiredString(consentRecord, "templateCode", "$.consent", issues),
      templateVersion: requiredNumber(consentRecord, "templateVersion", "$.consent", issues, {
        integer: true,
        min: 1
      }),
      captureMethod: requiredEnum(
        consentRecord,
        "captureMethod",
        "$.consent",
        CONSENT_CAPTURE_METHODS,
        issues
      ),
      provenance: parseEventProvenanceSource(provenanceRecord, "$.consent.provenance", issues)
    };

    addOptional(consent, "grantedByName", optionalString(consentRecord, "grantedByName", "$.consent", issues));
    addOptional(
      consent,
      "relationshipToPatient",
      optionalString(consentRecord, "relationshipToPatient", "$.consent", issues)
    );
    addOptional(consent, "evidence", optionalRecord(consentRecord, "evidence", "$.consent", issues));

    return {
      ...parseMutationContext(record, "$", issues),
      patientId: requiredString(record, "patientId", "$", issues, { uuid: true }),
      consent
    };
  });
}

export function parseConsentRevokeRequest(input: unknown): ContractParseResult<ConsentRevokeRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "patientId", "consentId", "reason"],
      "$",
      issues
    );

    return {
      ...parseMutationContext(record, "$", issues),
      patientId: requiredString(record, "patientId", "$", issues, { uuid: true }),
      consentId: requiredString(record, "consentId", "$", issues, { uuid: true }),
      reason: requiredString(record, "reason", "$", issues)
    };
  });
}

export function parseEncounterCreateRequest(input: unknown): ContractParseResult<EncounterCreateRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "encounter"],
      "$",
      issues
    );
    const encounterRecord = asRecord(record.encounter, "$.encounter", issues) ?? {};
    ensureAllowedKeys(
      encounterRecord,
      ["patientId", "appointmentId", "providerUserId", "reason", "medicalHistorySnapshot"],
      "$.encounter",
      issues
    );
    const encounter: EncounterCreateRequest["encounter"] = {
      patientId: requiredString(encounterRecord, "patientId", "$.encounter", issues, { uuid: true }),
      providerUserId: requiredString(encounterRecord, "providerUserId", "$.encounter", issues, { uuid: true })
    };

    addOptional(
      encounter,
      "appointmentId",
      optionalString(encounterRecord, "appointmentId", "$.encounter", issues, { uuid: true })
    );
    addOptional(encounter, "reason", optionalString(encounterRecord, "reason", "$.encounter", issues));
    addOptional(
      encounter,
      "medicalHistorySnapshot",
      optionalRecord(encounterRecord, "medicalHistorySnapshot", "$.encounter", issues)
    );

    return { ...parseMutationContext(record, "$", issues), encounter };
  });
}

export function parseClinicalNoteDraftSaveRequest(
  input: unknown
): ContractParseResult<ClinicalNoteDraftSaveRequest> {
  return parseClinicalNoteRequest(input, "draft") as ContractParseResult<ClinicalNoteDraftSaveRequest>;
}

export function parseClinicalNoteAmendRequest(
  input: unknown
): ContractParseResult<ClinicalNoteAmendRequest> {
  return parseClinicalNoteRequest(input, "amend") as ContractParseResult<ClinicalNoteAmendRequest>;
}

export function parsePrescriptionCreateRequest(
  input: unknown
): ContractParseResult<PrescriptionCreateRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "encounterId", "medications", "notes"],
      "$",
      issues
    );
    const medications = parseMedications(record.medications, "$.medications", issues);
    const request: PrescriptionCreateRequest = {
      ...parseMutationContext(record, "$", issues),
      encounterId: requiredString(record, "encounterId", "$", issues, { uuid: true }),
      medications
    };

    addOptional(request, "notes", optionalString(record, "notes", "$", issues));
    return request;
  });
}

export function parsePrescriptionSignRequest(input: unknown): ContractParseResult<PrescriptionSignRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "prescriptionId"],
      "$",
      issues
    );

    return {
      ...parseMutationContext(record, "$", issues),
      prescriptionId: requiredString(record, "prescriptionId", "$", issues, { uuid: true })
    };
  });
}

export function parseCp3EventEnvelope(
  input: unknown
): ContractParseResult<DomainEventEnvelope<Record<string, unknown>, Cp3EventType>> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      [
        "eventId",
        "eventType",
        "schemaVersion",
        "tenantId",
        "clinicId",
        "actor",
        "occurredAt",
        "idempotencyKey",
        "correlationId",
        "source",
        "aggregate",
        "patientId",
        "payload"
      ],
      "$",
      issues
    );
    const actorRecord = asRecord(record.actor, "$.actor", issues) ?? {};
    ensureAllowedKeys(actorRecord, ["type", "id"], "$.actor", issues);
    const sourceRecord = asRecord(record.source, "$.source", issues) ?? {};

    if (record.schemaVersion !== "1.0") {
      issues.push({ path: "$.schemaVersion", message: "Expected schemaVersion 1.0." });
    }

    const envelope: DomainEventEnvelope<Record<string, unknown>, Cp3EventType> = {
      eventId: requiredString(record, "eventId", "$", issues, { uuid: true }),
      eventType: parseCp3EventType(record, "eventType", "$", issues) as Cp3EventType,
      schemaVersion: "1.0",
      tenantId: requiredString(record, "tenantId", "$", issues, { uuid: true }),
      clinicId: requiredString(record, "clinicId", "$", issues, { uuid: true }),
      actor: {
        type: requiredEnum(actorRecord, "type", "$.actor", ["user", "system", "integration", "ai"] as const, issues),
        id: optionalString(actorRecord, "id", "$.actor", issues) ?? "system"
      },
      occurredAt: requiredString(record, "occurredAt", "$", issues, { isoDateTime: true }),
      correlationId: requiredString(record, "correlationId", "$", issues),
      source: parseEventProvenanceSource(sourceRecord, "$.source", issues),
      payload: asRecord(record.payload, "$.payload", issues) ?? {}
    };

    const idempotencyKey = optionalString(record, "idempotencyKey", "$", issues);
    const patientId = optionalString(record, "patientId", "$", issues, { uuid: true });
    const aggregateRecord = record.aggregate ? asRecord(record.aggregate, "$.aggregate", issues) : undefined;

    return {
      ...envelope,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(patientId ? { patientId } : {}),
      ...(aggregateRecord ? { aggregate: parseAggregate(aggregateRecord, issues) } : {})
    };
  });
}

function parseClinicalNoteRequest(
  input: unknown,
  mode: "draft" | "amend"
): ContractParseResult<ClinicalNoteDraftSaveRequest | ClinicalNoteAmendRequest> {
  return parseWithIssues(input, (record, issues) => {
    const allowedKeys =
      mode === "draft"
        ? ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "encounterId", "content", "readyForSign"]
        : ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "encounterId", "content", "amendmentReason"];
    ensureAllowedKeys(record, allowedKeys, "$", issues);
    const contentRecord = asRecord(record.content, "$.content", issues) ?? {};
    const content = parseClinicalNoteContent(contentRecord, "$.content", issues);
    const base = {
      ...parseMutationContext(record, "$", issues),
      encounterId: requiredString(record, "encounterId", "$", issues, { uuid: true }),
      content
    };

    if (mode === "draft") {
      const request: ClinicalNoteDraftSaveRequest = base;
      addOptional(request, "readyForSign", optionalBoolean(record, "readyForSign", "$", issues));
      return request;
    }

    return {
      ...base,
      amendmentReason: requiredString(record, "amendmentReason", "$", issues)
    };
  });
}

function parseClinicalNoteContent(
  record: Record<string, unknown>,
  path: string,
  issues: ContractValidationIssue[]
): ClinicalNoteContent {
  ensureAllowedKeys(
    record,
    [
      "chiefComplaint",
      "history",
      "examination",
      "investigations",
      "diagnosis",
      "treatmentPlan",
      "treatmentPerformed",
      "followUpInstructions",
      "additionalSections"
    ],
    path,
    issues
  );
  const content: ClinicalNoteContent = {};

  addOptional(content, "chiefComplaint", optionalString(record, "chiefComplaint", path, issues));
  addOptional(content, "history", optionalString(record, "history", path, issues));
  addOptional(content, "examination", optionalString(record, "examination", path, issues));
  addOptional(content, "investigations", optionalString(record, "investigations", path, issues));
  addOptional(content, "diagnosis", optionalString(record, "diagnosis", path, issues));
  addOptional(content, "treatmentPlan", optionalString(record, "treatmentPlan", path, issues));
  addOptional(content, "treatmentPerformed", optionalString(record, "treatmentPerformed", path, issues));
  addOptional(content, "followUpInstructions", optionalString(record, "followUpInstructions", path, issues));
  addOptional(content, "additionalSections", optionalRecord(record, "additionalSections", path, issues));

  return content;
}

function parseMedications(
  value: unknown,
  path: string,
  issues: ContractValidationIssue[]
): PrescriptionMedication[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected an array." });
    return [];
  }

  if (value.length === 0) {
    issues.push({ path, message: "Prescription requires at least one medication." });
  }

  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = asRecord(item, itemPath, issues) ?? {};
    ensureAllowedKeys(
      record,
      ["name", "strength", "route", "frequency", "duration", "instructions"],
      itemPath,
      issues
    );
    const medication: PrescriptionMedication = {
      name: requiredString(record, "name", itemPath, issues),
      frequency: requiredString(record, "frequency", itemPath, issues),
      duration: requiredString(record, "duration", itemPath, issues)
    };

    addOptional(medication, "strength", optionalString(record, "strength", itemPath, issues));
    addOptional(medication, "route", optionalString(record, "route", itemPath, issues));
    addOptional(medication, "instructions", optionalString(record, "instructions", itemPath, issues));
    return medication;
  });
}

function parseAggregate(
  record: Record<string, unknown>,
  issues: ContractValidationIssue[]
): DomainEventAggregate {
  ensureAllowedKeys(record, ["type", "id"], "$.aggregate", issues);
  const type = requiredEnum(
    record,
    "type",
    "$.aggregate",
    [
      "lead",
      "patient",
      "appointment",
      "queue_entry",
      "task",
      "attribution_touch",
      "form_response",
      "consent",
      "encounter",
      "clinical_note",
      "prescription"
    ] as const,
    issues
  );
  return { type, id: requiredString(record, "id", "$.aggregate", issues) };
}
