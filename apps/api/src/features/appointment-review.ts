import { AppointmentObservationConflict } from "@clinic-os/db";
import type { UUID } from "@clinic-os/domain";
import { createAuditEvent } from "@clinic-os/security";
import { ApiError } from "../errors.ts";
import type { ClinicFeatureOperationHandler, ClinicFeatureHandlerMap } from "./contracts.ts";
import { createReviewedSourceAppointment } from "./front-office/index.ts";
import { APPOINTMENT_REVIEW_OPERATION_IDS } from "./cp13-operation-ownership.ts";
export function createAppointmentReviewHandlers() {
  return Object.fromEntries(
    APPOINTMENT_REVIEW_OPERATION_IDS.map((id) => [id, handle])
  ) as ClinicFeatureHandlerMap<(typeof APPOINTMENT_REVIEW_OPERATION_IDS)[number]>;
}
const handle: ClinicFeatureOperationHandler = async (request, context) => {
  const p = request.parsed.path as Record<string, string>,
    q = request.parsed.query as Record<string, string>,
    input = request.parsed.body as Record<string, unknown>;
  const r = context.repositories.dataIntegrations;
  let body: unknown,
    resourceId = (p.importId ?? request.access.clinicId) as UUID;
  try {
    switch (request.operationId) {
      case "createAppointmentImport":
        body = {
          import: await r.createAppointmentImport(
            input as unknown as Parameters<typeof r.createAppointmentImport>[0]
          )
        };
        resourceId = (body as { import: { id: UUID } }).import.id;
        break;
      case "listAppointmentImports":
        body = await r.listAppointmentImports(q.cursor);
        break;
      case "getAppointmentImport":
        body = await r.getAppointmentImport(
          p.importId,
          q.offset === undefined ? 0 : Number(q.offset)
        );
        break;
      case "stageAppointmentObservations":
        body = {
          receipt: await r.stageAppointmentObservations(
            p.importId,
            input as unknown as Parameters<typeof r.stageAppointmentObservations>[1]
          )
        };
        break;
      case "sealAppointmentImport":
        body = { import: await r.sealAppointmentImport(p.importId) };
        break;
      case "reviewAppointmentObservation": {
        const row = await r.lockAppointmentObservation(p.importId, p.rowId);
        resourceId = p.rowId as UUID;
        const decision = String(input.decision),
          reason = String(input.reason ?? "");
        let appointmentId: UUID | undefined;
        if (!reason.trim()) throw new ApiError(400, "VALIDATION_ERROR", "Give a review reason.");
        if (decision === "create") {
          if (input.confirmedDetails !== true)
            throw new ApiError(
              400,
              "VALIDATION_ERROR",
              "Confirm patient identity, clinic timezone and planned booking details."
            );
          const evidence = row.sourceData as Record<string, unknown>;
          if (evidence.status !== "Scheduled")
            throw new ApiError(
              409,
              "CONFLICT",
              "Cancelled source evidence cannot create an active booking. Retain history or review a link instead."
            );
          const booking = input.booking as Record<string, unknown>;
          if (!booking)
            throw new ApiError(400, "VALIDATION_ERROR", "Reviewed booking details are required.");
          if (Date.parse(String(booking?.startAt)) < context.clock.now().getTime())
            throw new ApiError(
              409,
              "CONFLICT",
              "Past observations remain history. This handoff creates upcoming bookings only."
            );
          const output = await createReviewedSourceAppointment(
            {
              ...request,
              parsed: {
                ...request.parsed,
                body: {
                  ...booking,
                  source: "practo",
                  status: "booked",
                  reason: "Reviewed source appointment"
                }
              }
            },
            context
          );
          appointmentId = (output.body as { appointment: { id: UUID } }).appointment.id;
        } else if (decision === "link") {
          if (input.confirmedDetails !== true)
            throw new ApiError(
              400,
              "VALIDATION_ERROR",
              "Confirm the existing booking represents this observation."
            );
          const appointment = await context.repositories.scheduling.findAppointmentById(
            input.appointmentId as UUID
          );
          if (!appointment || appointment.patientId !== input.patientId)
            throw new ApiError(
              409,
              "CONFLICT",
              "Choose an existing appointment belonging to the reviewed patient."
            );
          appointmentId = appointment.id;
        }
        body = {
          observation: await r.decideAppointmentObservation(p.importId, p.rowId, {
            decision,
            reason,
            appointmentId
          })
        };
        break;
      }
      default:
        throw new Error("Unregistered appointment review action.");
    }
  } catch (error) {
    if (error instanceof AppointmentObservationConflict)
      throw new ApiError(409, "CONFLICT", error.message);
    if (error instanceof RangeError) throw new ApiError(400, "VALIDATION_ERROR", error.message);
    throw error;
  }
  const audit = createAuditEvent({
    tenantId: request.access.context.tenant.id,
    clinicId: request.access.clinicId,
    actor: { type: "user", id: request.access.context.user.id },
    action:
      request.operationId.startsWith("get") || request.operationId.startsWith("list")
        ? "workflow.records.viewed"
        : "migration.observation.recorded",
    resourceType: "appointment_source_review",
    resourceId,
    metadata: {
      operation: request.operationId,
      importId: p.importId ?? null,
      decision: input?.decision ?? null
    },
    occurredAt: context.clock.now(),
    correlationId: request.metadata.requestId
  });
  const { tenantId: _t, clinicId: _c, actorType: _at, actorId: _ai, ...entry } = audit;
  await context.evidence.appendAuditEvent(entry);
  return { status: request.operationId === "createAppointmentImport" ? 201 : 200, body };
};
