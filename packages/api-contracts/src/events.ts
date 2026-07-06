import {
  CP2_APPOINTMENT_EVENT_TYPES,
  CP2_DASHBOARD_TASK_EVENT_TYPES,
  CP2_EVENT_TYPES,
  CP2_LEAD_EVENT_TYPES,
  CP2_PATIENT_EVENT_TYPES,
  createDomainEventEnvelope,
  type Cp2EventType,
  type DomainEventAggregate,
  type DomainEventEnvelope,
  type EventProvenanceSource
} from "@clinic-os/domain";
import type { AuditActor } from "@clinic-os/domain";
import {
  asRecord,
  ensureAllowedKeys,
  optionalString,
  parseCp2EventType,
  parseEventProvenanceSource,
  parseWithIssues,
  requiredString,
  type ContractParseResult
} from "./validation.ts";

export {
  CP2_APPOINTMENT_EVENT_TYPES,
  CP2_DASHBOARD_TASK_EVENT_TYPES,
  CP2_EVENT_TYPES,
  CP2_LEAD_EVENT_TYPES,
  CP2_PATIENT_EVENT_TYPES
};

export type { Cp2EventType, DomainEventEnvelope, EventProvenanceSource };

export interface Cp2EventInput<TPayload extends Record<string, unknown>> {
  eventId?: string;
  eventType: Cp2EventType;
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

export function createCp2EventEnvelope<TPayload extends Record<string, unknown>>(
  input: Cp2EventInput<TPayload>
): DomainEventEnvelope<TPayload, Cp2EventType> {
  return createDomainEventEnvelope(input);
}

export function parseCp2EventEnvelope(
  input: unknown
): ContractParseResult<DomainEventEnvelope<Record<string, unknown>, Cp2EventType>> {
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

    const eventType = parseCp2EventType(record, "eventType", "$", issues) as Cp2EventType;
    const actorRecord = asRecord(record.actor, "$.actor", issues) ?? {};
    ensureAllowedKeys(actorRecord, ["type", "id"], "$.actor", issues);

    const actorType = requiredString(actorRecord, "type", "$.actor", issues);
    if (!["user", "system", "integration", "ai"].includes(actorType)) {
      issues.push({ path: "$.actor.type", message: "Expected a valid actor type." });
    }

    const actorId = optionalString(actorRecord, "id", "$.actor", issues);
    const sourceRecord = asRecord(record.source, "$.source", issues) ?? {};
    const payload = asRecord(record.payload, "$.payload", issues) ?? {};
    const aggregateRecord = record.aggregate
      ? asRecord(record.aggregate, "$.aggregate", issues)
      : undefined;
    let aggregate: DomainEventAggregate | undefined;

    if (aggregateRecord) {
      ensureAllowedKeys(aggregateRecord, ["type", "id"], "$.aggregate", issues);
      const aggregateType = requiredString(aggregateRecord, "type", "$.aggregate", issues);
      if (
        ![
          "lead",
          "patient",
          "appointment",
          "queue_entry",
          "task",
          "attribution_touch"
        ].includes(aggregateType)
      ) {
        issues.push({ path: "$.aggregate.type", message: "Expected a valid aggregate type." });
      }
      aggregate = {
        type: aggregateType as DomainEventAggregate["type"],
        id: requiredString(aggregateRecord, "id", "$.aggregate", issues)
      };
    }

    if (record.schemaVersion !== "1.0") {
      issues.push({ path: "$.schemaVersion", message: "Expected schemaVersion 1.0." });
    }

    const envelope: DomainEventEnvelope<Record<string, unknown>, Cp2EventType> = {
      eventId: requiredString(record, "eventId", "$", issues, { uuid: true }),
      eventType,
      schemaVersion: "1.0",
      tenantId: requiredString(record, "tenantId", "$", issues, { uuid: true }),
      clinicId: requiredString(record, "clinicId", "$", issues, { uuid: true }),
      actor: {
        type: actorType as AuditActor["type"],
        id: actorId ?? "system"
      },
      occurredAt: requiredString(record, "occurredAt", "$", issues, { isoDateTime: true }),
      correlationId: requiredString(record, "correlationId", "$", issues),
      source: parseEventProvenanceSource(sourceRecord, "$.source", issues),
      payload
    };

    const idempotencyKey = optionalString(record, "idempotencyKey", "$", issues);
    const patientId = optionalString(record, "patientId", "$", issues, { uuid: true });

    return {
      ...envelope,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      ...(aggregate ? { aggregate } : {}),
      ...(patientId ? { patientId } : {})
    };
  });
}
