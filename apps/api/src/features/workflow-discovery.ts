import { buildPatientDuplicateSuggestions } from "@clinic-os/domain";
import {
  ClinicSetupConflict,
  type ClinicSetupKind,
  type ClinicSetupInput,
  type ClinicAccessInput
} from "@clinic-os/db";
import type { UUID } from "@clinic-os/domain";
import { createAuditEvent } from "@clinic-os/security";
import type { WorkflowPageFilter } from "@clinic-os/db";
import { ApiError } from "../errors.ts";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureOperationRequest,
  ClinicFeatureHandlerMap
} from "./contracts.ts";
import { DAILY_WORKFLOW_DISCOVERY_OPERATION_IDS } from "./cp13-operation-ownership.ts";

type Operation = (typeof DAILY_WORKFLOW_DISCOVERY_OPERATION_IDS)[number];

export function createWorkflowDiscoveryHandlers(): ClinicFeatureHandlerMap<Operation> {
  return Object.freeze(
    Object.fromEntries(DAILY_WORKFLOW_DISCOVERY_OPERATION_IDS.map((id) => [id, discover]))
  ) as ClinicFeatureHandlerMap<Operation>;
}
async function discover(
  request: ClinicFeatureOperationRequest<Operation>,
  context: ClinicFeatureExecutionContext
) {
  const path = request.parsed.path as Record<string, string>;
  const query = request.parsed.query as WorkflowPageFilter;
  const patientId = path.patientId as UUID | undefined;
  const encounterId = path.encounterId as UUID | undefined;
  const r = context.repositories;
  if (patientId && !(await r.patientAdministration.findPatientById(patientId)))
    throw new ApiError(404, "NOT_FOUND", "Patient not found.");
  if (encounterId && !(await r.clinicalCare.findEncounterById(encounterId)))
    throw new ApiError(404, "NOT_FOUND", "Encounter not found.");
  let body: unknown;
  try {
    switch (request.operationId) {
      case "previewPatientDuplicates": {
        const input = request.parsed.body as {
          fullName: string;
          phone: string | null;
          excludePatientId?: UUID;
        };
        const candidates = await r.patientAdministration.findPatientDuplicateCandidates({
          fullName: input.fullName,
          phone: input.phone ?? ""
        });
        body = {
          suggestions: buildPatientDuplicateSuggestions(
            { fullName: input.fullName, phone: input.phone ?? "" },
            candidates.filter((p) => p.id !== input.excludePatientId)
          )
        };
        break;
      }
      case "listClinicAccess": {
        const page = await r.clinicOperations.listClinicAccess(query);
        body = { staff: page.records, nextCursor: page.nextCursor };
        break;
      }
      case "saveClinicAccess":
        body = {
          staff: await r.clinicOperations.saveClinicAccess(
            request.parsed.body as unknown as ClinicAccessInput
          )
        };
        break;
      case "listClinicSetup": {
        const page = await r.clinicOperations.listClinicSetup(path.kind as ClinicSetupKind, query);
        body = { records: page.records, nextCursor: page.nextCursor };
        break;
      }
      case "saveClinicSetup":
        body = {
          record: await r.clinicOperations.saveClinicSetup(
            path.kind as ClinicSetupKind,
            request.parsed.body as unknown as ClinicSetupInput
          )
        };
        break;
      case "listPatientIntakeHistory": {
        const page = await r.clinicalCare.listPatientIntakeHistory(patientId!, query);
        body = { submissions: page.records, nextCursor: page.nextCursor };
        break;
      }
      case "listLabReconciliations": {
        const page = await r.clinicOperations.listLabReconciliations(query);
        body = { reconciliations: page.records, nextCursor: page.nextCursor };
        break;
      }
      case "listPatientInstructions": {
        const page = await r.clinicalCare.listPatientInstructions(patientId!, query);
        body = { instructions: page.records, nextCursor: page.nextCursor };
        break;
      }
      case "searchBillingPatients":
        body = {
          patients: await r.billing.searchBillingPatients(
            String((request.parsed.query as Record<string, unknown>).query ?? "")
          )
        };
        break;
      case "getPatientDemographics": {
        const p = (await r.patientAdministration.findPatientById(patientId!))!;
        body = {
          patient: {
            id: p.id,
            rowVersion: p.rowVersion,
            fullName: p.fullName,
            phone: p.phone,
            email: p.email,
            dateOfBirth: p.dateOfBirth,
            gender: p.gender,
            source: p.source,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt
          }
        };
        break;
      }
      case "listClinicStaff":
        body = { staff: await r.scheduling.listClinicStaff() };
        break;
      case "listPatientEncounters": {
        const page = await r.clinicalCare.listPatientEncounters(patientId!, query);
        body = {
          encounters: page.records.map((e) => ({
            id: e.id,
            rowVersion: e.rowVersion,
            patientId: e.patientId,
            appointmentId: e.appointmentId,
            providerUserId: e.providerUserId,
            status: e.status,
            reason: e.reason,
            createdAt: e.createdAt,
            startedAt: e.startedAt,
            closedAt: e.closedAt
          })),
          nextCursor: page.nextCursor
        };
        break;
      }
      case "listEncounterPrescriptions": {
        const page = await r.clinicalCare.listEncounterPrescriptions(encounterId!, query);
        body = { prescriptions: page.records, nextCursor: page.nextCursor };
        break;
      }
      case "listPatientTreatmentPlans": {
        const page = await r.dentalTreatment.listPatientTreatmentPlans(patientId!, query);
        body = {
          treatmentPlans: page.records.map((detail) => ({
            ...detail.treatmentPlan,
            phases: detail.phases
          })),
          nextCursor: page.nextCursor
        };
        break;
      }
      case "listPatientInvoices": {
        const page = await r.billing.listPatientInvoices(patientId!, query);
        body = {
          invoices: page.records.map(({ invoice: i }) => ({
            id: i.id,
            invoiceNumber: i.invoiceNumber,
            status: i.status,
            paymentStatus: i.paymentStatus,
            totalMinor: i.totalMinor,
            paidMinor: i.paidMinor,
            balanceMinor: i.balanceMinor,
            currency: i.currency,
            issuedAt: i.issuedAt,
            createdAt: i.createdAt
          })),
          nextCursor: page.nextCursor
        };
        break;
      }
      case "listUninvoicedPatientProcedures": {
        const page = await r.billing.listUninvoicedPatientProcedures(patientId!, query);
        body = {
          procedures: page.records.map((p) => ({
            id: p.id,
            status: p.status,
            invoiceId: p.invoiceId,
            patientId: p.patientId,
            encounterId: p.encounterId,
            treatmentPlanId: p.treatmentPlanId,
            pricebookProcedureId: p.pricebookProcedureId,
            quantity: p.quantity,
            unitPriceMinor: p.unitPriceMinor,
            taxMinor: p.taxMinor,
            totalMinor: p.totalMinor,
            performedAt: p.performedAt
          })),
          nextCursor: page.nextCursor
        };
        break;
      }
      case "listSopTemplates": {
        const page = await r.continuity.listSopTemplates(query);
        body = {
          templates: page.records.map((d) => ({ ...d.template, items: d.items })),
          nextCursor: page.nextCursor
        };
        break;
      }
      case "listSopSchedules": {
        const page = await r.continuity.listSopSchedules(query);
        body = { schedules: page.records, nextCursor: page.nextCursor };
        break;
      }
      case "listInventoryCheckRuns": {
        const page = await r.clinicOperations.listInventoryCheckRuns(query);
        body = { runs: page.records, nextCursor: page.nextCursor };
        break;
      }
    }
  } catch (error) {
    if (error instanceof ClinicSetupConflict) throw new ApiError(409, "CONFLICT", error.message);
    if (error && typeof error === "object" && "code" in error && error.code === "23505")
      throw new ApiError(
        409,
        "CONFLICT",
        "That stable code is already used in this clinic. Refresh and edit the existing entry."
      );
    if (error instanceof RangeError) throw new ApiError(400, "VALIDATION_ERROR", error.message);
    throw error;
  }
  const event = createAuditEvent({
    tenantId: request.access.context.tenant.id,
    clinicId: request.access.clinicId,
    actor: { type: "user", id: request.access.context.user.id },
    action:
      request.operationId === "saveClinicAccess"
        ? "role.permission.changed"
        : request.operationId === "saveClinicSetup"
          ? "clinic.configuration.changed"
          : "workflow.records.viewed",
    patientId: patientId ?? null,
    resourceType:
      request.operationId === "saveClinicAccess"
        ? "clinic_access"
        : request.operationId === "saveClinicSetup"
          ? "clinic_configuration"
          : "workflow_list",
    resourceId:
      (body as { record?: { id: UUID }; staff?: { id?: UUID } })?.record?.id ??
      (!Array.isArray((body as { staff?: unknown }).staff)
        ? (body as { staff?: { id: UUID } }).staff?.id
        : undefined) ??
      patientId ??
      encounterId ??
      request.access.clinicId,
    metadata: {
      operation: request.operationId,
      section: path.kind ?? null,
      ...(request.operationId === "saveClinicSetup"
        ? {
            expectedVersion:
              (request.parsed.body as { expectedVersion?: number }).expectedVersion ?? null,
            savedConfiguration: (body as { record: unknown }).record
          }
        : {}),
      ...(request.operationId === "saveClinicAccess"
        ? {
            expectedAuthorityVersion: (request.parsed.body as { expectedAuthorityVersion: string })
              .expectedAuthorityVersion,
            savedAccess: (body as { staff: unknown }).staff
          }
        : {})
    },
    ipAddress: request.metadata.ipAddress,
    userAgent: request.metadata.userAgent,
    correlationId: request.metadata.requestId,
    occurredAt: context.clock.now()
  });
  const {
    tenantId: _tenant,
    clinicId: _clinic,
    actorType: _actorType,
    actorId: _actorId,
    ...entry
  } = event;
  await context.evidence.appendAuditEvent(entry);
  return { status: 200, body };
}
