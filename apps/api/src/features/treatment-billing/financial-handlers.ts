import { FinancialConflict } from "@clinic-os/db";
import { roleSlugsForScope } from "@clinic-os/auth";
import type { FinancialCommandInput, UUID } from "@clinic-os/domain";
import { createAuditEvent } from "@clinic-os/security";
import { ApiError } from "../../errors.ts";
import { featureOutboxIdempotencyKey, type ClinicFeatureOperationHandler } from "../contracts.ts";
export const handleFinancialOperation: ClinicFeatureOperationHandler = async (request, context) => {
  const path = request.parsed.path as Record<string, string>,
    query = request.parsed.query as Record<string, string>;
  const input = request.parsed.body as unknown as FinancialCommandInput;
  let body: unknown,
    resourceId = request.access.clinicId,
    patientId: UUID | null = null;
  const mutation = request.operationId === "executeFinancialCommand";
  try {
    if (mutation) {
      const roles = roleSlugsForScope(
        request.access.context,
        request.access.context.tenant.id,
        request.access.clinicId
      );
      if (
        !["advance_received", "advance_allocated"].includes(input.kind) &&
        !roles.some((r) => r === "owner_admin" || r === "accountant")
      )
        throw new ApiError(
          403,
          "PERMISSION_DENIED",
          "An owner or accountant must approve financial corrections and expenses."
        );
      const entry = await context.repositories.billing.executeFinancialCommand(input);
      resourceId = entry.id as UUID;
      patientId = (entry.patientId ?? null) as UUID | null;
      body = { entry };
      await context.evidence.appendOutboxEvent({
        eventType: "financial.entry.recorded",
        aggregateType: "financial_entry",
        aggregateId: resourceId,
        payload: { entryId: resourceId, kind: input.kind },
        idempotencyKey: featureOutboxIdempotencyKey(request, {
          eventType: "financial.entry.recorded",
          aggregateId: resourceId
        }),
        occurredAt: context.clock.now().toISOString(),
        patientId,
        correlationId: request.metadata.requestId
      });
    } else if (request.operationId === "getFinancialAccount") {
      patientId = path.patientId as UUID;
      resourceId = patientId;
      body = {
        account: await context.repositories.billing.getFinancialAccount(
          patientId,
          query.cursor,
          query.advanceCursor
        )
      };
    } else
      body = {
        day: await context.repositories.billing.getFinancialDay(
          query.date ?? "",
          query.entryCursor,
          query.dueCursor
        )
      };
  } catch (error) {
    if (error instanceof FinancialConflict) throw new ApiError(409, "CONFLICT", error.message);
    if (error instanceof RangeError) throw new ApiError(400, "VALIDATION_ERROR", error.message);
    if (error && typeof error === "object" && "code" in error && error.code === "23505")
      throw new ApiError(
        409,
        "CONFLICT",
        "That financial reference or invoice line has already been recorded. Review the saved evidence."
      );
    throw error;
  }
  const audit = createAuditEvent({
    tenantId: request.access.context.tenant.id,
    clinicId: request.access.clinicId,
    actor: { type: "user", id: request.access.context.user.id },
    action: mutation ? "financial.entry.recorded" : "workflow.records.viewed",
    resourceType: "financial_account",
    resourceId,
    patientId,
    metadata: {
      operation: request.operationId,
      ...(mutation ? { kind: input.kind, entryId: resourceId } : {})
    },
    occurredAt: context.clock.now(),
    correlationId: request.metadata.requestId
  });
  const { tenantId: _t, clinicId: _c, actorType: _at, actorId: _ai, ...entry } = audit;
  await context.evidence.appendAuditEvent(entry);
  return { status: mutation ? 201 : 200, body };
};
