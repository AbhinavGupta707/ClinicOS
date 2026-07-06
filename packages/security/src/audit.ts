import { randomUUID } from "node:crypto";
import type { AuditActor, AuditCategory, AuditClassification, AuditRiskLevel, UUID } from "@clinic-os/domain";

export const AUDIT_ACTION_CLASSIFICATIONS = {
  "auth.login.succeeded": {
    category: "security",
    riskLevel: "low",
    phiInvolved: false,
    requiresPatientId: false
  },
  "auth.login.failed": {
    category: "security",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "auth.session.resolved": {
    category: "security",
    riskLevel: "low",
    phiInvolved: false,
    requiresPatientId: false
  },
  "patient.record.viewed": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "patient.record.created": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "patient.record.updated": {
    category: "phi_access",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "patient.record.exported": {
    category: "privacy",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "role.permission.changed": {
    category: "administration",
    riskLevel: "high",
    phiInvolved: false,
    requiresPatientId: false
  },
  "break_glass.requested": {
    category: "security",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "break_glass.approved": {
    category: "security",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "clinical.note.signed": {
    category: "clinical",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "prescription.signed": {
    category: "clinical",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "media.viewed": {
    category: "phi_access",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "billing.payment.changed": {
    category: "billing",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "integration.credential.changed": {
    category: "integration",
    riskLevel: "critical",
    phiInvolved: false,
    requiresPatientId: false
  }
} as const;

export type KnownAuditAction = keyof typeof AUDIT_ACTION_CLASSIFICATIONS;

export interface CreateAuditEventInput {
  id?: UUID;
  tenantId: UUID;
  clinicId?: UUID | null;
  actor: AuditActor;
  action: KnownAuditAction;
  resourceType?: string | null;
  resourceId?: string | null;
  patientId?: UUID | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  occurredAt?: Date;
}

export interface AuditEventRecord {
  id: string;
  tenantId: UUID;
  clinicId: UUID | null;
  actorType: AuditActor["type"];
  actorId: string;
  action: KnownAuditAction;
  category: AuditCategory;
  riskLevel: AuditRiskLevel;
  phiInvolved: boolean;
  resourceType: string | null;
  resourceId: string | null;
  patientId: UUID | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
  occurredAt: string;
}

export function classifyAuditAction(action: KnownAuditAction): AuditClassification {
  const classification = AUDIT_ACTION_CLASSIFICATIONS[action];

  return {
    action,
    category: classification.category,
    riskLevel: classification.riskLevel,
    phiInvolved: classification.phiInvolved,
    requiresPatientId: classification.requiresPatientId
  };
}

export function createAuditEvent(input: CreateAuditEventInput): AuditEventRecord {
  const classification = classifyAuditAction(input.action);

  if (classification.requiresPatientId && !input.patientId) {
    throw new Error(`Audit action ${input.action} requires patientId.`);
  }

  return {
    id: input.id ?? randomUUID(),
    tenantId: input.tenantId,
    clinicId: input.clinicId ?? null,
    actorType: input.actor.type,
    actorId: input.actor.id,
    action: input.action,
    category: classification.category,
    riskLevel: classification.riskLevel,
    phiInvolved: classification.phiInvolved,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    patientId: input.patientId ?? null,
    metadata: input.metadata ?? {},
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
    correlationId: input.correlationId ?? null,
    occurredAt: (input.occurredAt ?? new Date()).toISOString()
  };
}
