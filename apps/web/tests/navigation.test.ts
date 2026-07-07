import { describe, expect, it } from "vitest";

import {
  canAccessSurface,
  getPrimarySurfaceId,
  getSurface,
  getVisibleSurfaces,
  hasSurface,
  resolveSurfaceId,
  summarizeSurfaceAccess
} from "@/lib/navigation";

describe("role-aware navigation", () => {
  it("keeps accountant out of clinical surfaces by default", () => {
    const visible = getVisibleSurfaces(["accountant"]).map((surface) => surface.id);

    expect(visible).toContain("accounting");
    expect(visible).toContain("checkout");
    expect(visible).not.toContain("encounter");
    expect(visible).not.toContain("dental-media");
    expect(canAccessSurface(getSurface("encounter"), ["accountant"])).toBe(false);
  });

  it("registers the assistant day-start operating surfaces", () => {
    const visible = getVisibleSurfaces(["assistant"]).map((surface) => surface.id);

    expect(visible).toEqual(
      expect.arrayContaining([
        "today",
        "lead-inbox",
        "appointments",
        "patients",
        "tasks",
        "operations"
      ])
    );
  });

  it("selects a role-specific primary surface", () => {
    expect(getPrimarySurfaceId(["doctor"])).toBe("appointments");
    expect(getPrimarySurfaceId(["owner"])).toBe("owner-control");
    expect(getPrimarySurfaceId(["accountant"])).toBe("accounting");
    expect(getPrimarySurfaceId(["platform_admin"])).toBe("platform-support");
  });

  it("reports active versus registered unavailable surfaces", () => {
    expect(summarizeSurfaceAccess(["assistant"])).toMatchObject({
      activeCount: 9,
      registeredCount: expect.any(Number),
      unavailableCount: expect.any(Number)
    });
  });

  it("activates CP3 clinical workflow surfaces without exposing them to accounting", () => {
    const assistantActive = getVisibleSurfaces(["assistant"])
      .filter((surface) => surface.availability === "active")
      .map((surface) => surface.id);
    const accountantVisible = getVisibleSurfaces(["accountant"]).map((surface) => surface.id);

    expect(assistantActive).toEqual(
      expect.arrayContaining(["patient-profile", "intake", "consent", "returning-prep", "encounter"])
    );
    expect(accountantVisible).not.toContain("encounter");
    expect(accountantVisible).not.toContain("patient-profile");
  });

  it("resolves the QA clinical route alias to the CP3 encounter workflow", () => {
    expect(hasSurface("clinical")).toBe(true);
    expect(resolveSurfaceId("clinical")).toBe("encounter");
  });
});
