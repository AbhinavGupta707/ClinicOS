import type { UUID } from "@clinic-os/domain";
import type { VerifiedKeycloakIdentity } from "./repositories.ts";

export interface TenantRlsContext {
  tenantId: UUID;
  clinicId?: UUID | null;
  userId?: UUID | null;
}

export interface SqlStatement {
  sql: string;
  values: readonly string[];
}

export function buildSetLocalIdentityRlsStatements(
  identity: VerifiedKeycloakIdentity
): SqlStatement[] {
  assertVerifiedKeycloakIdentity(identity);
  return [
    // Bootstrap cannot inherit an unrelated tenant scope from a transaction-bound caller.
    { sql: "select set_config('app.tenant_id', $1, true)", values: [""] },
    { sql: "select set_config('app.clinic_id', $1, true)", values: [""] },
    { sql: "select set_config('app.user_id', $1, true)", values: [""] },
    {
      sql: "select set_config('app.identity_issuer', $1, true)",
      values: [identity.issuer]
    },
    {
      sql: "select set_config('app.identity_subject', $1, true)",
      values: [identity.subject]
    }
  ];
}

export function assertVerifiedKeycloakIdentity(identity: VerifiedKeycloakIdentity): void {
  const invalid = () =>
    new Error("Identity lookup requires a bounded verified issuer and subject.");
  if (
    !identity ||
    typeof identity.issuer !== "string" ||
    typeof identity.subject !== "string" ||
    identity.issuer.length < 1 ||
    identity.issuer.length > 2048 ||
    identity.subject.length < 1 ||
    identity.subject.length > 255 ||
    /[\u0000-\u0020\u007f]/u.test(identity.issuer) ||
    /[\u0000-\u001f\u007f]/u.test(identity.subject) ||
    !identity.subject.trim()
  )
    throw invalid();
  let issuer: URL;
  try {
    issuer = new URL(identity.issuer);
  } catch {
    throw invalid();
  }
  if (
    !["https:", "http:"].includes(issuer.protocol) ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  )
    throw invalid();
  // Preserve exact issuer/subject spelling. URL normalization or case folding changes identity.
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
