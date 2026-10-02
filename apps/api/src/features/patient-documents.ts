import { permissionsForScope } from "@clinic-os/auth";
import {
  PatientDocumentConflict,
  PatientDocumentUnavailable,
  renderSavedPatientDocument
} from "@clinic-os/db";
import {
  renderPatientDocumentV1,
  type PatientDocumentKind,
  type PermissionKey,
  type UUID
} from "@clinic-os/domain";
import { createAuditEvent } from "@clinic-os/security";
import { ApiError } from "../errors.ts";
import {
  featureOutboxIdempotencyKey,
  type ClinicFeatureOperationRequest,
  type ClinicFeatureExecutionContext
} from "./contracts.ts";

const authority: Record<PatientDocumentKind, PermissionKey> = {
  prescription: "clinical.note.read",
  estimate: "billing.read",
  invoice: "billing.read",
  receipt: "billing.read",
  instruction: "patient_instruction.write",
  lab_slip: "lab.manage"
};
export async function handlePatientDocuments(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const path = request.parsed.path as {
    patientId: UUID;
    kind: PatientDocumentKind;
    sourceId: UUID;
    documentId?: UUID;
  };
  const { patientId, kind, sourceId } = path;
  const permissions = permissionsForScope(
    request.access.context,
    request.access.context.tenant.id,
    request.access.clinicId
  );
  if (
    !authority[kind] ||
    ![
      "patient.document.read",
      authority[kind],
      ...(["prescription", "lab_slip", "estimate"].includes(kind)
        ? ["patient.read", "patient.phi.read"]
        : []),
      ...(kind === "estimate" ? ["dental.chart.read"] : []),
      ...(kind === "instruction" ? ["patient.read"] : [])
    ].every((p) => permissions.includes(p as PermissionKey))
  )
    throw new ApiError(
      403,
      "PERMISSION_DENIED",
      "This document is outside the current clinic role."
    );
  const repo = context.repositories.clinicalCare;
  const audit = async (
    action: "patient.document.viewed" | "patient.document.generated",
    id: string,
    metadata: Record<string, unknown>
  ) => {
    const event = createAuditEvent({
      tenantId: request.access.context.tenant.id,
      clinicId: request.access.clinicId,
      actor: { type: "user", id: request.access.context.user.id },
      action,
      patientId,
      resourceType: "patient_document",
      resourceId: id,
      metadata,
      correlationId: request.metadata.requestId,
      ipAddress: request.metadata.ipAddress,
      userAgent: request.metadata.userAgent,
      occurredAt: context.clock.now()
    });
    const {
      tenantId: _tenant,
      clinicId: _clinic,
      actorType: _type,
      actorId: _actor,
      ...scoped
    } = event;
    await context.evidence.appendAuditEvent(scoped);
  };
  try {
    if (request.operationId === "issuePatientDocument") {
      const body = request.parsed.body as { expectedSourceDigest: string };
      const result = await repo.issuePatientDocument(
        patientId,
        kind,
        sourceId,
        body.expectedSourceDigest,
        context.clock.now()
      );
      if (!result)
        throw new ApiError(
          404,
          "NOT_FOUND",
          "Saved document source was not found for this patient."
        );
      const document = result.document;
      const metadata = {
        kind,
        sourceId,
        revision: document.revision,
        rendererVersion: document.rendererVersion,
        htmlDigest: document.htmlDigest
      };
      await audit(
        result.created ? "patient.document.generated" : "patient.document.viewed",
        document.id,
        metadata
      );
      if (result.created) {
        const eventType = "patient.document.generated" as const,
          aggregateId = document.id as UUID;
        await context.evidence.appendOutboxEvent({
          eventType,
          aggregateType: "patient_document",
          aggregateId,
          patientId,
          payload: metadata,
          idempotencyKey: featureOutboxIdempotencyKey(request, { eventType, aggregateId }),
          correlationId: request.metadata.requestId,
          occurredAt: context.clock.now().toISOString()
        });
      }
      return {
        status: result.created ? 201 : 200,
        body: { documentId: document.id, reused: !result.created }
      };
    }
    if (request.operationId === "getPatientDocument") {
      const document = await repo.getPatientDocument(patientId, kind, sourceId, path.documentId!);
      if (!document)
        throw new ApiError(
          404,
          "NOT_FOUND",
          "Generated copy was not found for this patient and source."
        );
      const current = await repo.preparePatientDocument(patientId, kind, sourceId);
      const html = renderSavedPatientDocument(document);
      await audit("patient.document.viewed", document.id, {
        kind,
        sourceId,
        revision: document.revision
      });
      return {
        status: 200,
        body: {
          document: {
            id: document.id,
            revision: document.revision,
            generatedAt: document.generatedAt,
            htmlDigest: document.htmlDigest,
            sourceDigest: document.sourceDigest,
            html,
            sourceChanged: current?.sourceDigest !== document.sourceDigest,
            unavailableReason:
              current?.unavailableReason ?? (current ? null : "Original source is unavailable.")
          }
        }
      };
    }
    const prepared = await repo.preparePatientDocument(patientId, kind, sourceId);
    const query = request.parsed.query as { cursor?: string };
    const page = await repo.listPatientDocuments(patientId, kind, sourceId, query.cursor);
    if (!prepared && !page.documents.length && !query.cursor)
      throw new ApiError(404, "NOT_FOUND", "Saved document source was not found for this patient.");
    await audit("patient.document.viewed", sourceId, {
      kind,
      sourceId,
      preview: true,
      count: page.documents.length
    });
    return {
      status: 200,
      body: {
        preview: prepared?.snapshot
          ? {
              sourceDigest: prepared.sourceDigest!,
              html: renderPatientDocumentV1(prepared.snapshot),
              sourceStatus: prepared.sourceStatus
            }
          : null,
        unavailableReason:
          prepared?.unavailableReason ?? (prepared ? null : "Original source is unavailable."),
        ...page
      }
    };
  } catch (error) {
    if (error instanceof PatientDocumentConflict)
      throw new ApiError(409, "CONFLICT", error.message);
    if (error instanceof PatientDocumentUnavailable)
      throw new ApiError(503, "DEPENDENCY_UNAVAILABLE", error.message);
    if (error instanceof RangeError) throw new ApiError(400, "VALIDATION_ERROR", error.message);
    throw error;
  }
}
