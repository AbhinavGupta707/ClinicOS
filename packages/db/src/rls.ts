import type { UUID } from "@clinic-os/domain";

export interface TenantRlsContext {
  tenantId: UUID;
  clinicId?: UUID | null;
  userId?: UUID | null;
}

export interface SqlStatement {
  sql: string;
  values: readonly string[];
}

export function buildSetLocalIdentityRlsStatements(subject: string): SqlStatement[] {
  if (!subject.trim()) {
    throw new Error("Identity RLS context requires a non-empty verified subject.");
  }
  return [
    {
      sql: "select set_config('app.identity_subject', $1, true)",
      values: [subject]
    }
  ];
}

export function buildSetLocalRlsStatements(context: TenantRlsContext): SqlStatement[] {
  return [
    {
      sql: "select set_config('app.tenant_id', $1, true)",
      values: [context.tenantId]
    },
    {
      sql: "select set_config('app.clinic_id', $1, true)",
      values: [context.clinicId ?? ""]
    },
    {
      sql: "select set_config('app.user_id', $1, true)",
      values: [context.userId ?? ""]
    }
  ];
}

export function assertTenantRlsContext(context: TenantRlsContext): void {
  if (!context.tenantId) {
    throw new Error("RLS tenant context requires tenantId.");
  }
}
