import type {
  CreateDentalFindingInput,
  DentalFindingReviewStatus,
  DentalFindingSource,
  DentalFindingStatus,
  DentalFindingType,
  DentalSurface,
  UUID
} from "@clinic-os/domain";
import { applyDentalFindingWritePolicy } from "../../../../../packages/domain/src/cp13/clinical-dental/index.ts";
import type { ClinicFeatureExecutionContext } from "../contracts.ts";
import {
  actorIsDoctor,
  appendAudit,
  appendMutationEvidence,
  assertPatientExists,
  conflict,
  created,
  notFound,
  ok,
  parsedBody,
  parsedPathId,
  publicDentalChart,
  publicDentalChartSnapshot,
  publicDentalFinding,
  publicDentalFindingHistory,
  requireClinicalConsent,
  validation,
  type ClinicalDentalRequest,
  type ParsedJsonObject
} from "./shared.ts";
import type { ClinicalDentalHandlerDependencies } from "./types.ts";

interface DentalFindingBody extends ParsedJsonObject {
  readonly encounterId?: UUID | null;
  readonly toothNumber: string;
  readonly surface?: DentalSurface | null;
  readonly findingType: DentalFindingType;
  readonly severity?: string | null;
  readonly status?: DentalFindingStatus;
  readonly reviewStatus?: DentalFindingReviewStatus;
  readonly source?: DentalFindingSource;
  readonly confidence?: number | null;
  readonly notes?: string | null;
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly treatmentReference?: Readonly<Record<string, unknown>>;
}

interface UpdateDentalFindingBody extends ParsedJsonObject {
  readonly encounterId?: UUID | null;
  readonly toothNumber?: string;
  readonly surface?: string | null;
  readonly findingType?: string;
  readonly severity?: string | null;
  readonly status?: DentalFindingStatus;
  readonly reviewStatus?: DentalFindingReviewStatus;
  readonly source?: DentalFindingSource;
  readonly confidence?: number | null;
  readonly notes?: string | null;
  readonly provenance?: Readonly<Record<string, unknown>>;
  readonly treatmentReference?: Readonly<Record<string, unknown>>;
  readonly changeReason: string;
}

interface DentalSnapshotBody extends ParsedJsonObject {
  readonly encounterId?: UUID | null;
  readonly reason?: string | null;
  readonly provenance?: Readonly<Record<string, unknown>>;
}

export function createDentalHandlers(dependencies: ClinicalDentalHandlerDependencies) {
  return {
    getPatientDentalChart: async (
      request: ClinicalDentalRequest<"getPatientDentalChart">,
      context: ClinicFeatureExecutionContext
    ) => {
      const patientId = parsedPathId(request, "patientId");
      await assertPatientExists(dependencies, context, patientId);
      const view = await context.repositories.dentalTreatment.getDentalChart(patientId);
      if (!view) throw notFound("Dental chart not found.", { patient_id: patientId });
      const history = await Promise.all(
        view.findings.map(async (finding) => ({
          findingId: finding.id,
          entries: (
            await context.repositories.dentalTreatment.listDentalFindingHistory(finding.id)
          ).map(publicDentalFindingHistory)
        }))
      );
      await appendAudit(request, context, "dental_chart.viewed", {
        patientId,
        resourceType: "dental_chart",
        resourceId: view.chart.id,
        metadata: {
          findingCount: view.findings.length,
          snapshotCount: view.snapshots.length,
          numberingSystem: view.chart.numberingSystem
        }
      });
      return ok({
        dentalChart: publicDentalChart(view.chart),
        findings: view.findings.map(publicDentalFinding),
        history,
        snapshots: view.snapshots.map(publicDentalChartSnapshot)
      });
    },

    createPatientDentalFinding: async (
      request: ClinicalDentalRequest<"createPatientDentalFinding">,
      context: ClinicFeatureExecutionContext
    ) => {
      const patientId = parsedPathId(request, "patientId");
      const input = parsedBody<DentalFindingBody>(request);
      await assertPatientExists(dependencies, context, patientId);
      await requireClinicalConsent(request, context, patientId, "dental_finding_write");
      await assertEncounterPatient(context, input.encounterId, patientId);
      const normalized = normalizeCreateInput(input, actorIsDoctor(request));
      const result = await context.repositories.dentalTreatment.createDentalFinding(
        patientId,
        normalized
      );
      if (!result) {
        throw validation("Dental finding patient or encounter association is invalid.", {
          patient_id: patientId,
          encounter_id: input.encounterId ?? null
        });
      }
      await appendDentalMutationEvidence(request, context, result, "created");
      return created({
        finding: publicDentalFinding(result.finding),
        history: publicDentalFindingHistory(result.history)
      });
    },

    createEncounterDentalFinding: async (
      request: ClinicalDentalRequest<"createEncounterDentalFinding">,
      context: ClinicFeatureExecutionContext
    ) => {
      const encounterId = parsedPathId(request, "encounterId");
      const input = parsedBody<DentalFindingBody>(request);
      if (input.encounterId && input.encounterId !== encounterId) {
        throw validation("Body encounter does not match the encounter route.", {
          encounter_id: encounterId,
          body_encounter_id: input.encounterId
        });
      }
      const encounter = await context.repositories.clinicalCare.findEncounterById(encounterId);
      if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
      if (["closed", "cancelled"].includes(encounter.status)) {
        throw conflict("Dental findings cannot be added to a closed encounter.", {
          encounter_id: encounterId,
          status: encounter.status
        });
      }
      await requireClinicalConsent(request, context, encounter.patientId, "dental_finding_write");
      const normalized = normalizeCreateInput({ ...input, encounterId }, actorIsDoctor(request));
      const result = await context.repositories.dentalTreatment.createDentalFinding(
        encounter.patientId,
        normalized
      );
      if (!result) {
        throw conflict("Dental finding could not be attached to this encounter.", {
          encounter_id: encounterId
        });
      }
      await appendDentalMutationEvidence(request, context, result, "created");
      return created({
        finding: publicDentalFinding(result.finding),
        history: publicDentalFindingHistory(result.history)
      });
    },

    updateDentalFinding: async (
      request: ClinicalDentalRequest<"updateDentalFinding">,
      context: ClinicFeatureExecutionContext
    ) => {
      const findingId = parsedPathId(request, "findingId");
      const input = parsedBody<UpdateDentalFindingBody>(request);
      const history =
        await context.repositories.dentalTreatment.listDentalFindingHistory(findingId);
      const current = history[0]?.afterState;
      if (!current) {
        throw notFound("Dental finding not found.", { dental_finding_id: findingId });
      }
      if (!input.changeReason.trim()) {
        throw validation("Dental finding updates require a change reason.", {
          field: "changeReason"
        });
      }
      await requireClinicalConsent(request, context, history[0].patientId, "dental_finding_write");
      await assertEncounterPatient(context, input.encounterId, history[0].patientId);
      const policy = applyDentalFindingWritePolicy(
        {
          toothNumber: input.toothNumber ?? current.toothNumber,
          surface: input.surface === undefined ? current.surface : input.surface,
          findingType: input.findingType ?? current.findingType,
          status: input.status ?? current.status,
          reviewStatus: input.reviewStatus ?? current.reviewStatus,
          source: input.source ?? current.source
        },
        {
          actorIsDoctor: actorIsDoctor(request),
          currentSource: current.source,
          currentReviewStatus: current.reviewStatus
        }
      );
      const result = await context.repositories.dentalTreatment.updateDentalFinding(findingId, {
        encounterId: input.encounterId,
        toothNumber: policy.toothNumber,
        surface: policy.surface,
        findingType: policy.findingType,
        severity: input.severity,
        status: policy.status,
        reviewStatus: policy.reviewStatus,
        source: policy.source,
        confidence: input.confidence,
        notes: input.notes,
        provenance: input.provenance ? { ...input.provenance } : undefined,
        treatmentReference: input.treatmentReference ? { ...input.treatmentReference } : undefined,
        changeReason: input.changeReason
      });
      if (!result) {
        throw conflict("Dental finding association changed before the update could commit.", {
          dental_finding_id: findingId
        });
      }
      await appendDentalMutationEvidence(request, context, result, "updated");
      return ok({
        finding: publicDentalFinding(result.finding),
        history: publicDentalFindingHistory(result.history)
      });
    },

    listDentalFindingHistory: async (
      request: ClinicalDentalRequest<"listDentalFindingHistory">,
      context: ClinicFeatureExecutionContext
    ) => {
      const findingId = parsedPathId(request, "findingId");
      const history =
        await context.repositories.dentalTreatment.listDentalFindingHistory(findingId);
      if (history.length === 0) {
        throw notFound("Dental finding not found.", { dental_finding_id: findingId });
      }
      await appendAudit(request, context, "dental_chart.viewed", {
        patientId: history[0].patientId,
        resourceType: "dental_finding",
        resourceId: findingId,
        metadata: { historyCount: history.length }
      });
      return ok({ history: history.map(publicDentalFindingHistory) });
    },

    createDentalChartSnapshot: async (
      request: ClinicalDentalRequest<"createDentalChartSnapshot">,
      context: ClinicFeatureExecutionContext
    ) => {
      const patientId = parsedPathId(request, "patientId");
      const input = parsedBody<DentalSnapshotBody>(request);
      await assertPatientExists(dependencies, context, patientId);
      await requireClinicalConsent(request, context, patientId, "dental_snapshot");
      await assertEncounterPatient(context, input.encounterId, patientId);
      const snapshot = await context.repositories.dentalTreatment.createDentalChartSnapshot(
        patientId,
        {
          encounterId: input.encounterId,
          reason: input.reason,
          provenance: input.provenance ? { ...input.provenance } : {}
        }
      );
      if (!snapshot) {
        throw notFound("Patient or dental chart context not found.", {
          patient_id: patientId
        });
      }
      await appendMutationEvidence(request, context, {
        auditAction: "dental_chart.snapshot_created",
        eventType: "dental.chart.snapshot_created",
        aggregateType: "dental_chart_snapshot",
        aggregateId: snapshot.id,
        patientId: snapshot.patientId,
        auditMetadata: {
          encounterId: snapshot.encounterId,
          snapshotVersion: snapshot.snapshotVersion,
          findingCount: snapshot.chartState.findingCount
        },
        eventPayload: {
          snapshotId: snapshot.id,
          patientId: snapshot.patientId,
          encounterId: snapshot.encounterId,
          snapshotVersion: snapshot.snapshotVersion,
          findingCount: snapshot.chartState.findingCount
        }
      });
      return created({ snapshot: publicDentalChartSnapshot(snapshot) });
    }
  } as const;
}

function normalizeCreateInput(
  input: Readonly<DentalFindingBody>,
  isDoctor: boolean
): CreateDentalFindingInput {
  const policy = applyDentalFindingWritePolicy(input, { actorIsDoctor: isDoctor });
  if (!policy.toothNumber || !policy.findingType) {
    throw validation("Dental finding requires FDI tooth number and finding type.");
  }
  return {
    encounterId: input.encounterId,
    toothNumber: policy.toothNumber,
    surface: policy.surface,
    findingType: policy.findingType,
    severity: input.severity,
    status: policy.status,
    reviewStatus: policy.reviewStatus,
    source: policy.source,
    confidence: input.confidence,
    notes: input.notes,
    provenance: input.provenance ? { ...input.provenance } : {},
    treatmentReference: input.treatmentReference ? { ...input.treatmentReference } : {}
  };
}

async function assertEncounterPatient(
  context: ClinicFeatureExecutionContext,
  encounterId: UUID | null | undefined,
  patientId: UUID
): Promise<void> {
  if (!encounterId) return;
  const encounter = await context.repositories.clinicalCare.findEncounterById(encounterId);
  if (!encounter || encounter.patientId !== patientId) {
    throw validation("Encounter does not belong to the selected patient.", {
      encounter_id: encounterId,
      patient_id: patientId
    });
  }
}

async function appendDentalMutationEvidence(
  request:
    | ClinicalDentalRequest<"createPatientDentalFinding">
    | ClinicalDentalRequest<"createEncounterDentalFinding">
    | ClinicalDentalRequest<"updateDentalFinding">,
  context: ClinicFeatureExecutionContext,
  result: Awaited<
    ReturnType<
      ClinicFeatureExecutionContext["repositories"]["dentalTreatment"]["createDentalFinding"]
    >
  > & {},
  kind: "created" | "updated"
): Promise<void> {
  if (!result) throw new Error("Dental mutation evidence requires a committed finding result.");
  await appendMutationEvidence(request, context, {
    auditAction: kind === "created" ? "dental_finding.created" : "dental_finding.updated",
    eventType: kind === "created" ? "dental.finding.created" : "dental.finding.updated",
    aggregateType: "dental_finding",
    aggregateId: result.finding.id,
    patientId: result.finding.patientId,
    auditMetadata: {
      encounterId: result.finding.encounterId,
      toothNumber: result.finding.toothNumber,
      surface: result.finding.surface,
      findingType: result.finding.findingType,
      reviewStatus: result.finding.reviewStatus,
      source: result.finding.source
    },
    eventPayload: {
      findingId: result.finding.id,
      patientId: result.finding.patientId,
      encounterId: result.finding.encounterId,
      toothNumber: result.finding.toothNumber,
      surface: result.finding.surface,
      findingType: result.finding.findingType,
      reviewStatus: result.finding.reviewStatus,
      source: result.finding.source
    }
  });
}
