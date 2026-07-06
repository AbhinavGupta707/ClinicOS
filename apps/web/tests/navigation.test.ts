import { describe, expect, it } from "vitest";

import {
  canAccessSurface,
  getPrimarySurfaceId,
  getSurface,
  getVisibleSurfaces,
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
      activeCount: 4,
      registeredCount: expect.any(Number),
      unavailableCount: expect.any(Number)
    });
  });
});
