export type Cp14AuthAvailability =
  | {
      status: "unconfigured";
      title: "Secure sign-in unavailable";
      detail: string;
      loginAllowed: false;
    }
  | {
      status: "ready";
      title: "Secure sign-in ready";
      detail: string;
      loginAllowed: true;
    }
  | {
      status: "reauthentication_required";
      title: "Sign in again";
      detail: string;
      loginAllowed: true;
    };

export function buildCp14AuthAvailability(input: {
  registrationState:
    | "absent"
    | "registered"
    | "configured"
    | "sandbox_verified"
    | "production_verified"
    | "degraded"
    | "disabled";
  runtimeBound: boolean;
  sessionStatus: "none" | "active" | "expired" | "revoked";
}): Cp14AuthAvailability {
  if (
    !input.runtimeBound ||
    ["absent", "registered", "disabled", "degraded"].includes(input.registrationState)
  ) {
    return {
      status: "unconfigured",
      title: "Secure sign-in unavailable",
      detail:
        "ClinicOS identity is not fully registered, bound, and healthy. No fixture or browser token fallback is available.",
      loginAllowed: false
    };
  }
  if (["expired", "revoked"].includes(input.sessionStatus)) {
    return {
      status: "reauthentication_required",
      title: "Sign in again",
      detail:
        "Your secure session expired or was revoked after an access change. Sign in again to re-establish verified clinic access.",
      loginAllowed: true
    };
  }
  return {
    status: "ready",
    title: "Secure sign-in ready",
    detail:
      "Authorization Code + PKCE and the server-managed HttpOnly session are available for this environment.",
    loginAllowed: true
  };
}
