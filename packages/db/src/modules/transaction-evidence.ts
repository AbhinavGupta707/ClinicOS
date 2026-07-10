import type { PersistableAuditEvent } from "../postgres.ts";
import type {
  AuditEventSink,
  ClinicOperationsRepository,
  OutboxEventInput,
  RepositoryScope
} from "../repositories.ts";
import {
  bindScopedRepositoryPort,
  type RepositoryPortTransactionLease
} from "./core/scoped-repository-port.ts";

export const TRANSACTION_EVIDENCE_OPERATIONS = [
  "appendOutboxEvent"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type RequestAuditEventInput = Omit<
  PersistableAuditEvent,
  "tenantId" | "clinicId" | "actorType" | "actorId"
>;

export interface TransactionEvidencePort {
  appendAuditEvent(event: RequestAuditEventInput): Promise<void>;
  appendOutboxEvent(event: OutboxEventInput): Promise<void>;
}

/** @internal Constructed only inside the clinic module unit of work. */
export function bindTransactionEvidence(
  repository: ClinicOperationsRepository,
  auditSink: AuditEventSink<PersistableAuditEvent>,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): TransactionEvidencePort {
  const outbox = bindScopedRepositoryPort(
    repository,
    scope,
    TRANSACTION_EVIDENCE_OPERATIONS,
    lease
  );

  return Object.freeze({
    appendAuditEvent(event: RequestAuditEventInput): Promise<void> {
      return lease.execute(() =>
        auditSink.appendAuditEvent({
          ...event,
          tenantId: scope.tenantId,
          clinicId: scope.clinicId,
          actorType: "user",
          actorId: scope.actorUserId
        })
      );
    },
    appendOutboxEvent(event: OutboxEventInput): Promise<void> {
      return outbox.appendOutboxEvent(event);
    }
  });
}
