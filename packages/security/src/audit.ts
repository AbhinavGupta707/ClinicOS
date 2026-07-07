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
  "patient.created": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "patient.updated": {
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
  "patient.timeline.viewed": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lead.created": {
    category: "integration",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: false
  },
  "lead.matched_to_patient": {
    category: "phi_access",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lead.converted_to_appointment": {
    category: "phi_access",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "attribution.touch.created": {
    category: "integration",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: false
  },
  "appointment.created": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "appointment.updated": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "appointment.confirmed": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "appointment.no_show": {
    category: "phi_access",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "patient.checked_in": {
    category: "phi_access",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "queue.entry_created": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "appointment.confirmation_requested": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "queue.entry_updated": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "form_response.submitted": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "consent.created": {
    category: "privacy",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "consent.revoked": {
    category: "privacy",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "consent.enforcement.checked": {
    category: "privacy",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "encounter.created": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "encounter.started": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "encounter.completed": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "clinical_note.draft_created": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "clinical_prep.viewed": {
    category: "clinical",
    riskLevel: "high",
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
  "clinical_note.signed": {
    category: "clinical",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "clinical_note.amended": {
    category: "clinical",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "prescription.draft_created": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "prescription.signed": {
    category: "clinical",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "instruction.print_requested": {
    category: "clinical",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "instruction.send_requested": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "media.viewed": {
    category: "phi_access",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "media.upload_requested": {
    category: "phi_access",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "media.upload_completed": {
    category: "phi_access",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "dental_chart.viewed": {
    category: "phi_access",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "dental_finding.created": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "dental_finding.updated": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "dental_chart.snapshot_created": {
    category: "clinical",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "pricebook.procedure_catalog.viewed": {
    category: "billing",
    riskLevel: "low",
    phiInvolved: false,
    requiresPatientId: false
  },
  "treatment_plan.created": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "treatment_plan.updated": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "treatment_plan.accepted": {
    category: "clinical",
    riskLevel: "critical",
    phiInvolved: true,
    requiresPatientId: true
  },
  "procedure.completed": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "invoice.created": {
    category: "billing",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "invoice.viewed": {
    category: "billing",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "payment.requested": {
    category: "billing",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "payment.recorded": {
    category: "billing",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "payment.succeeded": {
    category: "billing",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "payment.failed": {
    category: "billing",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "payment.manually_recorded": {
    category: "billing",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "payment.reconciliation_required": {
    category: "billing",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "receipt.generated": {
    category: "billing",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "billing.payment.changed": {
    category: "billing",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "payment.provider.unavailable": {
    category: "integration",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "owner_dashboard.viewed": {
    category: "administration",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "integration.credential.changed": {
    category: "integration",
    riskLevel: "critical",
    phiInvolved: false,
    requiresPatientId: false
  },
  "task.created": {
    category: "administration",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: false
  },
  "task.status_changed": {
    category: "administration",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: false
  },
  "task.completed": {
    category: "administration",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: false
  },
  "task.due": {
    category: "administration",
    riskLevel: "low",
    phiInvolved: true,
    requiresPatientId: false
  },
  "recall.rule_created": {
    category: "administration",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "recall.due": {
    category: "clinical",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lab_vendor.created": {
    category: "operations",
    riskLevel: "low",
    phiInvolved: false,
    requiresPatientId: false
  },
  "recall.sent": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lab_slip.generated": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "recall.action_recorded": {
    category: "clinical",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "recall.completed": {
    category: "clinical",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: true
  },
  "sop_template.created": {
    category: "administration",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "sop_schedule.created": {
    category: "administration",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "sop_run.created": {
    category: "administration",
    riskLevel: "low",
    phiInvolved: false,
    requiresPatientId: false
  },
  "lab_case.created": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lab_case.sent": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lab_case.received": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lab_case.returned": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lab_case.completed": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lab_case.cancelled": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lab_case.status_changed": {
    category: "clinical",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: true
  },
  "lab_reconciliation.created": {
    category: "operations",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: false
  },
  "inventory_category.created": {
    category: "operations",
    riskLevel: "low",
    phiInvolved: false,
    requiresPatientId: false
  },
  "sop_run.updated": {
    category: "administration",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "inventory_item.created": {
    category: "operations",
    riskLevel: "low",
    phiInvolved: false,
    requiresPatientId: false
  },
  "inventory_stock.adjusted": {
    category: "operations",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "sop_run.completed": {
    category: "administration",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "inventory_check.created": {
    category: "operations",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "inventory_check.completed": {
    category: "operations",
    riskLevel: "high",
    phiInvolved: false,
    requiresPatientId: false
  },
  "inventory.low_stock_detected": {
    category: "operations",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "inventory.procurement_suggested": {
    category: "operations",
    riskLevel: "medium",
    phiInvolved: false,
    requiresPatientId: false
  },
  "incident.created": {
    category: "quality",
    riskLevel: "high",
    phiInvolved: true,
    requiresPatientId: false
  },
  "corrective_action.created": {
    category: "quality",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: false
  },
  "corrective_action.status_changed": {
    category: "quality",
    riskLevel: "medium",
    phiInvolved: true,
    requiresPatientId: false
  },
  "corrective_action.completed": {
    category: "quality",
    riskLevel: "high",
    phiInvolved: true,
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
