import { describe, expect, it } from "vitest";

import { normalizeMePayload } from "@/lib/me";

describe("/me contract normalization", () => {
  const runtimePayload = {
    user: { id: "user_1", displayName: "Owner", email: null, phone: null, status: "active" },
    tenant: { id: "tenant_1", slug: "tenant", displayName: "Tenant", status: "active" },
    clinics: [
      {
        id: "clinic_1",
        tenantId: "tenant_1",
        slug: "clinic",
        displayName: "A clinic",
        timezone: "Asia/Kolkata",
        roleSlugs: ["owner_admin"]
      }
    ],
    permissions: ["migration.manage"],
    keycloak: {
      subject: "subject_1",
      issuer: "https://identity.example.test/realms/clinic",
      roles: ["platform_admin"]
    }
  };

  it("uses the real API clinic membership and owner role, not token roles", () => {
    expect(normalizeMePayload(runtimePayload)).toMatchObject({
      clinic: { id: "clinic_1", name: "A clinic", timezone: "Asia/Kolkata" },
      tenant: { id: "tenant_1", name: "Tenant" },
      user: { id: "user_1", displayName: "Owner" },
      roles: ["owner"],
      permissions: ["migration.manage"],
      source: "api"
    });
  });

  it("does not guess a clinic or merge roles across multiple memberships", () => {
    expect(
      normalizeMePayload({
        ...runtimePayload,
        clinics: [
          runtimePayload.clinics[0],
          { ...runtimePayload.clinics[0], id: "clinic_2", roleSlugs: ["doctor"] }
        ]
      })
    ).toMatchObject({
      code: "CLINIC_SELECTION_REQUIRED"
    });
  });

  it("rejects a clinic belonging to another tenant", () => {
    expect(
      normalizeMePayload({
        ...runtimePayload,
        clinics: [{ ...runtimePayload.clinics[0], tenantId: "tenant_2" }]
      })
    ).toMatchObject({
      code: "CONTRACT_MISMATCH"
    });
  });

  it.each([[], [{ ...runtimePayload.clinics[0], roleSlugs: [] }], null])(
    "does not fall back to legacy or token authority when runtime memberships are unusable (%j)",
    (clinics) => {
      expect(
        normalizeMePayload({
          ...runtimePayload,
          clinics,
          clinic: { id: "clinic_1", name: "A clinic" },
          roles: ["owner"]
        })
      ).toMatchObject({
        code: "CONTRACT_MISMATCH"
      });
    }
  );

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
