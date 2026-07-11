import {
  CP14_APPLICATION_RESOURCE_POLICIES,
  buildSensitiveApiHeaders,
  type ApplicationResourcePolicy
} from "@clinic-os/security";

export const IDENTITY_SESSION_EDGE_RESOURCE_POLICIES: Readonly<
  Record<
    "token_validation" | "session_revocation" | "jml" | "break_glass",
    ApplicationResourcePolicy
  >
> = Object.freeze({
  token_validation: CP14_APPLICATION_RESOURCE_POLICIES.session,
  session_revocation: CP14_APPLICATION_RESOURCE_POLICIES.privileged,
  jml: CP14_APPLICATION_RESOURCE_POLICIES.privileged,
  break_glass: CP14_APPLICATION_RESOURCE_POLICIES.privileged
});

export const IDENTITY_SESSION_EDGE_RESPONSE_HEADERS = buildSensitiveApiHeaders();
