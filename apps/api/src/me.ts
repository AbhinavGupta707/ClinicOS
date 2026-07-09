import {
  buildAccessContext,
  buildMeResponse,
  principalFromVerifiedKeycloakClaims,
  type KeycloakAccessTokenClaims,
  type KeycloakValidationOptions,
  type MeResponse
} from "@clinic-os/auth";
import type { IdentityRepository } from "@clinic-os/db";
import { createAuditEvent, type AuditEventRecord } from "@clinic-os/security";
import { ApiError } from "./errors.ts";

export type { MeResponse } from "@clinic-os/auth";

export interface MeRequestContext {
  requestId: string;
  verifiedKeycloakClaims: KeycloakAccessTokenClaims | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface MeHandlerDependencies {
  keycloak: KeycloakValidationOptions;
  identityRepository: IdentityRepository;
  auditSink?: {
    appendAuditEvent(event: AuditEventRecord): Promise<void>;
  };
}

export interface ApiSuccess<T> {
  status: number;
  body: T;
}

export async function getMe(
  request: MeRequestContext,
  dependencies: MeHandlerDependencies
): Promise<ApiSuccess<MeResponse>> {
  if (!request.verifiedKeycloakClaims) {
    throw new ApiError(401, "UNAUTHENTICATED", "Authentication is required.");
  }

  const principal = principalFromVerifiedKeycloakClaims(request.verifiedKeycloakClaims, dependencies.keycloak);
  const snapshot = await dependencies.identityRepository.findAccessByKeycloakSubject(principal.subject);

  if (!snapshot) {
    throw new ApiError(403, "PERMISSION_DENIED", "Authenticated identity is not registered for ClinicOS.", {
      reason: "identity_not_registered"
    });
  }

  const context = buildAccessContext({
    principal,
    tenant: snapshot.tenant,
    user: snapshot.user,
    memberships: snapshot.memberships,
    clinicAssignments: snapshot.clinicAssignments,
    roleAssignments: snapshot.roleAssignments
  });

  if (dependencies.auditSink) {
    await dependencies.auditSink.appendAuditEvent(
      createAuditEvent({
        tenantId: snapshot.tenant.id,
        clinicId: null,
        actor: { type: "user", id: snapshot.user.id },
        action: "auth.session.resolved",
        resourceType: "user",
        resourceId: snapshot.user.id,
        ipAddress: request.ipAddress ?? null,
        userAgent: request.userAgent ?? null,
        correlationId: request.requestId
      })
    );
  }

  return {
    status: 200,
    body: buildMeResponse(context, snapshot.clinics)
  };
}
