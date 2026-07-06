export type ActorType = "user" | "system" | "integration" | "ai";
export type AuditRiskLevel = "low" | "medium" | "high" | "critical";
export type AuditCategory =
  | "security"
  | "administration"
  | "phi_access"
  | "clinical"
  | "billing"
  | "integration"
  | "privacy";

export interface AuditActor {
  type: ActorType;
  id: string;
}

export interface AuditClassification {
  action: string;
  category: AuditCategory;
  riskLevel: AuditRiskLevel;
  phiInvolved: boolean;
  requiresPatientId: boolean;
}
