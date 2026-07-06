import { describe, expect, it } from "vitest";

import { normalizeMePayload } from "@/lib/me";

describe("/me contract normalization", () => {
  it("accepts the checkpoint identity contract", () => {
    const result = normalizeMePayload({
      clinic: {
        id: "clinic_1",
        name: "A clinic",
        timezone: "Asia/Kolkata"
      },
      permissions: ["shell.read"],
      roles: ["assistant"],
      tenant: {
        id: "tenant_1",
        name: "Tenant"
      },
      user: {
        displayName: "Assistant",
        email: "assistant@example.test",
        id: "user_1"
      }
    });

    expect(result).toMatchObject({
      clinic: {
        id: "clinic_1",
        timezone: "Asia/Kolkata"
      },
      roles: ["assistant"],
      source: "api"
    });
  });

  it("rejects payloads that do not identify a clinic role", () => {
    const result = normalizeMePayload({
      clinic: { id: "clinic_1", name: "A clinic" },
      roles: [],
      tenant: { id: "tenant_1", name: "Tenant" },
      user: { displayName: "Assistant", id: "user_1" }
    });

    expect(result).toMatchObject({
      code: "CONTRACT_MISMATCH"
    });
  });
});
