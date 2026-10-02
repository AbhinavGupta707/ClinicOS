import { CommunicationConflict, CommunicationNotFound } from "@clinic-os/db";
import type { CommunicationCommand, CommunicationState, UUID } from "@clinic-os/domain";
import { createAuditEvent } from "@clinic-os/security";
import { ApiError } from "../errors.ts";
import type { ClinicFeatureOperationHandler, ClinicFeatureHandlerMap } from "./contracts.ts";
import { COMMUNICATION_OPERATION_IDS } from "./cp13-operation-ownership.ts";

export function createCommunicationHandlers(dispatchEnabled = false) {
  return Object.fromEntries(
    COMMUNICATION_OPERATION_IDS.map((id) => [id, handler(dispatchEnabled)])
  ) as ClinicFeatureHandlerMap<(typeof COMMUNICATION_OPERATION_IDS)[number]>;
}
const handler =
  (dispatchEnabled: boolean): ClinicFeatureOperationHandler =>
  async (request, context) => {
    const q = request.parsed.query as {
      cursor?: string;
      status?: CommunicationState;
      beforeSequence?: number;
    };
    const p = request.parsed.path as { threadId?: string };
    const repo = context.repositories.clinicOperations;
    let body: unknown,
      resourceId = p.threadId ?? request.access.clinicId;
    try {
      switch (request.operationId) {
        case "listCommunicationAppointments":
          body = await repo.listCommunicationAppointments(
            p.threadId!,
            context.clock.now(),
            q.cursor
          );
          break;
        case "listCommunicationThreads":
          body = await repo.listCommunicationThreads(q);
          break;
        case "getCommunicationThread":
          body = await repo.getCommunicationThread(
            p.threadId!,
            context.clock.now(),
            q.beforeSequence === undefined ? undefined : Number(q.beforeSequence)
          );
          break;
        case "getCommunicationConfiguration":
          body = {
            ...(await repo.communicationConfiguration(context.clock.now(), q.cursor)),
            dispatchEnabled
          };
          break;
        case "previewCommunicationAppointment":
          if (!dispatchEnabled)
            throw new ApiError(
              503,
              "DEPENDENCY_UNAVAILABLE",
              "Official WhatsApp sending is not enabled in this environment."
            );
          body = await repo.previewCommunicationAppointment(
            request.parsed.body as { threadId: string; appointmentId: string; templateId: string },
            context.clock.now()
          );
          break;
        case "executeCommunicationCommand": {
          const command = request.parsed.body as CommunicationCommand;
          if (["approve", "sync_template"].includes(command.kind) && !dispatchEnabled)
            throw new ApiError(
              503,
              "DEPENDENCY_UNAVAILABLE",
              "Official WhatsApp sending is not enabled in this environment."
            );
          // Linking a contact is not authority to read or edit a clinical chart. These
          // routes only expose communication evidence under the existing message role.
          body = await repo.executeCommunicationCommand(command, context.clock.now());
          resourceId = (body as { id: string }).id;
          break;
        }
        default:
          throw new Error("Unregistered communication operation.");
      }
      const event = createAuditEvent({
        tenantId: request.access.context.tenant.id,
        clinicId: request.access.clinicId,
        actor: { type: "user", id: request.access.context.user.id },
        action:
          request.operationId === "executeCommunicationCommand"
            ? "communication.changed"
            : "communication.viewed",
        resourceType: "communication",
        resourceId: resourceId as UUID,
        metadata: {
          operation: request.operationId,
          ...(request.operationId === "executeCommunicationCommand"
            ? { command: (request.parsed.body as CommunicationCommand).kind }
            : {})
        },
        correlationId: request.metadata.requestId,
        ipAddress: request.metadata.ipAddress,
        userAgent: request.metadata.userAgent,
        occurredAt: context.clock.now()
      });
      const { tenantId: _t, clinicId: _c, actorId: _a, actorType: _at, ...scoped } = event;
      await context.evidence.appendAuditEvent(scoped);
      return { status: 200, body };
    } catch (error) {
      if (error instanceof CommunicationConflict)
        throw new ApiError(409, "CONFLICT", error.message);
      if (error instanceof CommunicationNotFound)
        throw new ApiError(404, "NOT_FOUND", error.message);
      if (error instanceof RangeError) throw new ApiError(400, "VALIDATION_ERROR", error.message);
      throw error;
    }
  };
