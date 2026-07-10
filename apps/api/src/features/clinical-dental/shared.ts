import { roleSlugsForScope } from "@clinic-os/auth";
import {
  buildConsentEnforcementState,
  type ConsentEnforcementState,
  type DentalChartSnapshotFinding,
  type DomainEventType,
  type MediaType,
  type UUID
} from "@clinic-os/domain";
import { createAuditEvent, type KnownAuditAction } from "@clinic-os/security";
import { evaluateClinicalConsent, type ClinicalConsentWorkflow } from "@clinic-os/domain";
import { ApiError } from "../../errors.ts";
import type { ClinicFeatureExecutionContext, ClinicFeatureOperationRequest } from "../contracts.ts";
import type { ClinicalDentalOperationId, ClinicalDentalHandlerDependencies } from "./types.ts";

export type ClinicalDentalRequest<TOperationId extends ClinicalDentalOperationId> =
  ClinicFeatureOperationRequest<TOperationId>;

export type ParsedJsonObject = Readonly<Record<string, unknown>>;

export function parsedBody<T extends ParsedJsonObject>(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>
): T {
  const body = request.parsed.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || body instanceof Uint8Array) {
    throw configuration("Parsed JSON body was unavailable for the selected operation.");
  }
  return body as T;
}

export function parsedBinaryBody(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>
): Uint8Array {
  const body = request.parsed.body;
  if (!(body instanceof Uint8Array)) {
    throw configuration("Parsed binary body was unavailable for the media content operation.");
  }
  return body;
}

export function parsedPathId(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>,
  name: string
): UUID {
  const path = request.parsed.path;
  if (!path || typeof path !== "object" || Array.isArray(path)) {
    throw configuration("Parsed path parameters were unavailable.");
  }
  const value = (path as Record<string, unknown>)[name];
  if (typeof value !== "string" || value.length === 0) {
    throw configuration(`Parsed path parameter ${name} was unavailable.`);
  }
  return value as UUID;
}

export function parsedQueryInteger(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>,
  name: string
): number | undefined {
  const query = request.parsed.query;
  if (!query || typeof query !== "object" || Array.isArray(query)) return undefined;
  const value = (query as Record<string, unknown>)[name];
  return typeof value === "number" ? value : undefined;
}

export function requestIdempotencyKey(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>
): string | null {
  const headers = request.parsed.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
  const value = (headers as Record<string, unknown>)["idempotency-key"];
  return typeof value === "string" ? value : null;
}

export async function assertPatientExists(
  dependencies: ClinicalDentalHandlerDependencies,
  context: ClinicFeatureExecutionContext,
  patientId: UUID
): Promise<void> {
  const authority = relationshipAuthority(dependencies);
  if (!(await authority.patientExists(context, patientId))) {
    throw notFound("Patient not found.", { patient_id: patientId });
  }
}

export async function assertEncounterRelationships(
  dependencies: ClinicalDentalHandlerDependencies,
  context: ClinicFeatureExecutionContext,
  input: Readonly<{
    patientId: UUID;
    appointmentId?: UUID | null;
    providerUserId: UUID;
  }>
): Promise<void> {
  await assertPatientExists(dependencies, context, input.patientId);
  const authority = relationshipAuthority(dependencies);
  if (!(await authority.providerCanOwnEncounter(context, input.providerUserId))) {
    throw validation("Encounter provider must be an active doctor in the selected clinic.", {
      provider_user_id: input.providerUserId
    });
  }
  if (
    input.appointmentId &&
    !(await authority.appointmentBelongsToPatient(context, {
      appointmentId: input.appointmentId,
      patientId: input.patientId
    }))
  ) {
    throw validation("Appointment does not belong to the encounter patient.", {
      appointment_id: input.appointmentId,
      patient_id: input.patientId
    });
  }
}

export async function assertDentalFindingPatient(
  dependencies: ClinicalDentalHandlerDependencies,
  context: ClinicFeatureExecutionContext,
  dentalFindingId: UUID,
  patientId: UUID
): Promise<void> {
  if (
    !(await relationshipAuthority(dependencies).dentalFindingBelongsToPatient(context, {
      dentalFindingId,
      patientId
    }))
  ) {
    throw validation("Dental finding does not belong to the media patient.", {
      dental_finding_id: dentalFindingId,
      patient_id: patientId
    });
  }
}

export async function consentState(
  context: ClinicFeatureExecutionContext,
  patientId: UUID
): Promise<ConsentEnforcementState> {
  const consents = await context.repositories.clinicalCare.listPatientConsents(patientId);
  return buildConsentEnforcementState(patientId, consents, context.clock.now().toISOString());
}

export async function requireClinicalConsent(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>,
  context: ClinicFeatureExecutionContext,
  patientId: UUID,
  workflow: ClinicalConsentWorkflow,
  options: { readonly mediaType?: MediaType } = {}
): Promise<ConsentEnforcementState> {
  const state = await consentState(context, patientId);
  const decision = evaluateClinicalConsent(state, workflow, options);

  await appendAudit(request, context, "consent.enforcement.checked", {
    patientId,
    resourceType: "consent",
    resourceId: patientId,
    metadata: {
      workflow,
      allowed: decision.allowed,
      reason: decision.reason,
      activePurposes: state.activePurposes,
      revokedPurposes: state.revokedPurposes
    }
  });

  if (!decision.allowed) {
    throw conflict("Active purpose-specific consent is required for this clinical action.", {
      workflow,
      reason: decision.reason
    });
  }
  return state;
}

export function actorIsDoctor(request: ClinicalDentalRequest<ClinicalDentalOperationId>): boolean {
  return roleSlugsForScope(
    request.access.context,
    request.access.context.tenant.id,
    request.access.clinicId
  ).includes("doctor");
}

export function assertDoctorSignature(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>,
  permission: "clinical.note.sign" | "prescription.sign"
): void {
  if (!actorIsDoctor(request)) {
    throw new ApiError(403, "PERMISSION_DENIED", "Only doctors can sign clinical records.", {
      required_permission: permission,
      required_role: "doctor"
    });
  }
}

export function assertAssignedEncounterProvider(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>,
  encounter: Readonly<{ providerUserId: UUID }>
): void {
  if (encounter.providerUserId !== request.access.context.user.id) {
    throw new ApiError(
      403,
      "PERMISSION_DENIED",
      "Only the assigned encounter provider can sign or amend this clinical record.",
      {
        reason: "assigned_encounter_provider_required",
        delegation_supported: false
      }
    );
  }
}

export async function appendAudit(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>,
  context: ClinicFeatureExecutionContext,
  action: KnownAuditAction,
  input: Readonly<{
    patientId?: UUID | null;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Readonly<Record<string, unknown>>;
  }>
): Promise<void> {
  const event = createAuditEvent({
    tenantId: request.access.context.tenant.id,
    clinicId: request.access.clinicId,
    actor: { type: "user", id: request.access.context.user.id },
    action,
    patientId: input.patientId ?? null,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata ? { ...input.metadata } : {},
    ipAddress: request.metadata.ipAddress,
    userAgent: request.metadata.userAgent,
    correlationId: request.metadata.requestId,
    occurredAt: context.clock.now()
  });
  const {
    tenantId: _tenantId,
    clinicId: _clinicId,
    actorType: _actorType,
    actorId: _actorId,
    ...transactionEvent
  } = event;
  await context.evidence.appendAuditEvent(transactionEvent);
}

export async function appendMutationEvidence(
  request: ClinicalDentalRequest<ClinicalDentalOperationId>,
  context: ClinicFeatureExecutionContext,
  input: Readonly<{
    auditAction: KnownAuditAction;
    eventType: DomainEventType;
    aggregateType: string;
    aggregateId: UUID;
    patientId: UUID;
    auditMetadata?: Readonly<Record<string, unknown>>;
    eventPayload: Readonly<Record<string, unknown>>;
  }>
): Promise<void> {
  const requestKey = requestIdempotencyKey(request);
  await appendAudit(request, context, input.auditAction, {
    patientId: input.patientId,
    resourceType: input.aggregateType,
    resourceId: input.aggregateId,
    metadata: input.auditMetadata
  });
  await context.evidence.appendOutboxEvent({
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    patientId: input.patientId,
    idempotencyKey: requestKey
      ? [
          request.access.context.tenant.id,
          request.access.clinicId,
          request.access.context.user.id,
          request.operationId,
          requestKey
        ].join(":")
      : null,
    correlationId: request.metadata.requestId,
    payload: { ...input.eventPayload },
    occurredAt: context.clock.now().toISOString()
  });
}

export function publicDentalNumberingSystem(value: string): string {
  return value.toUpperCase();
}

export function publicDentalChart<T extends { numberingSystem: string }>(chart: T) {
  const numberingSystem = publicDentalNumberingSystem(chart.numberingSystem);
  return { ...chart, numberingSystem, notation: numberingSystem };
}

export function publicDentalFinding<T extends { numberingSystem: string; surface?: string | null }>(
  finding: T
) {
  return {
    ...finding,
    numberingSystem: publicDentalNumberingSystem(finding.numberingSystem),
    surfaces: finding.surface ? [finding.surface] : []
  };
}

export function publicDentalFindingHistory<
  T extends {
    beforeState: DentalChartSnapshotFinding | null;
    afterState: DentalChartSnapshotFinding;
  }
>(history: T) {
  return {
    ...history,
    beforeState: history.beforeState ? publicDentalSnapshotFinding(history.beforeState) : null,
    afterState: publicDentalSnapshotFinding(history.afterState)
  };
}

export function publicDentalChartSnapshot<
  T extends { chartState: { numberingSystem: string; findings: DentalChartSnapshotFinding[] } }
>(snapshot: T) {
  return {
    ...snapshot,
    chartState: {
      ...snapshot.chartState,
      numberingSystem: publicDentalNumberingSystem(snapshot.chartState.numberingSystem),
      findings: snapshot.chartState.findings.map(publicDentalSnapshotFinding)
    }
  };
}

export function ok(body: unknown) {
  return { status: 200, body } as const;
}

export function created(body: unknown) {
  return { status: 201, body } as const;
}

export function notFound(message: string, details: Record<string, unknown>): ApiError {
  return new ApiError(404, "NOT_FOUND", message, details);
}

export function validation(message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", message, details);
}

export function conflict(message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(409, "CONFLICT", message, details);
}

export function configuration(message: string): ApiError {
  return new ApiError(503, "CONFIGURATION_ERROR", message);
}

function relationshipAuthority(dependencies: ClinicalDentalHandlerDependencies) {
  if (!dependencies.relationshipAuthority) {
    throw configuration(
      "Clinical relationship authority is not configured for this ClinicOS runtime."
    );
  }
  return dependencies.relationshipAuthority;
}

function publicDentalSnapshotFinding<T extends DentalChartSnapshotFinding>(finding: T) {
  return {
    ...finding,
    numberingSystem: publicDentalNumberingSystem(finding.numberingSystem),
    surfaces: finding.surface ? [finding.surface] : []
  };
}
