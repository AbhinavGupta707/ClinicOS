import { describe, expect, it } from "vitest";
import { buildCp14AuthAvailability } from "../features/cp14-auth/auth-state";

describe("CP14 auth availability", () => {
  it("keeps absent, unbound, degraded, and disabled identity honestly unavailable", () => {
    for (const registrationState of ["absent", "registered", "degraded", "disabled"] as const) {
      expect(
        buildCp14AuthAvailability({
          registrationState,
          runtimeBound: registrationState !== "absent",
          sessionStatus: "none"
        })
      ).toMatchObject({ status: "unconfigured", loginAllowed: false });
    }
  });

  it("distinguishes a verified runtime from revoked/expired reauthentication", () => {
    expect(
      buildCp14AuthAvailability({
        registrationState: "sandbox_verified",
        runtimeBound: true,
        sessionStatus: "active"
      })
    ).toMatchObject({ status: "ready", loginAllowed: true });
    expect(
      buildCp14AuthAvailability({
        registrationState: "production_verified",
        runtimeBound: true,
        sessionStatus: "revoked"
      })
    ).toMatchObject({ status: "reauthentication_required", loginAllowed: true });
  });
});
