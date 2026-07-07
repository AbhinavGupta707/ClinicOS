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
      activeCount: 15,
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
      expect.arrayContaining([
        "patient-profile",
        "intake",
        "consent",
        "returning-prep",
        "encounter"
      ])
    );
    expect(accountantVisible).not.toContain("encounter");
    expect(accountantVisible).not.toContain("patient-profile");
  });

  it("resolves the QA clinical route alias to the CP3 encounter workflow", () => {
    expect(hasSurface("clinical")).toBe(true);
    expect(resolveSurfaceId("clinical")).toBe("encounter");
  });

  it("activates CP4 dental media workflow without exposing it to accounting", () => {
    const assistantActive = getVisibleSurfaces(["assistant"])
      .filter((surface) => surface.availability === "active")
      .map((surface) => surface.id);
    const accountantVisible = getVisibleSurfaces(["accountant"]).map((surface) => surface.id);

    expect(assistantActive).toContain("dental-media");
    expect(accountantVisible).not.toContain("dental-media");
    expect(canAccessSurface(getSurface("dental-media"), ["accountant"])).toBe(false);
    expect(hasSurface("odontogram")).toBe(true);
    expect(resolveSurfaceId("dental")).toBe("dental-media");
  });

  it("activates CP5 checkout and accounting surfaces without clinical PHI navigation", () => {
    const assistantActive = getVisibleSurfaces(["assistant"])
      .filter((surface) => surface.availability === "active")
      .map((surface) => surface.id);
    const doctorVisible = getVisibleSurfaces(["doctor"]).map((surface) => surface.id);
    const accountantActive = getVisibleSurfaces(["accountant"])
      .filter((surface) => surface.availability === "active")
      .map((surface) => surface.id);

    expect(assistantActive).toContain("checkout");
    expect(doctorVisible).toContain("checkout");
    expect(accountantActive).toEqual(expect.arrayContaining(["accounting", "checkout"]));
    expect(accountantActive).not.toContain("encounter");
    expect(accountantActive).not.toContain("dental-media");
    expect(hasSurface("billing")).toBe(true);
    expect(resolveSurfaceId("payments")).toBe("checkout");
  });

  it("activates CP6 operations surfaces with owner-only analytics boundaries", () => {
    const assistantActive = getVisibleSurfaces(["assistant"])
      .filter((surface) => surface.availability === "active")
      .map((surface) => surface.id);
    const ownerActive = getVisibleSurfaces(["owner"])
      .filter((surface) => surface.availability === "active")
      .map((surface) => surface.id);
    const accountantVisible = getVisibleSurfaces(["accountant"]).map((surface) => surface.id);

    expect(assistantActive).toEqual(expect.arrayContaining(["tasks", "lab", "operations"]));
    expect(ownerActive).toEqual(
      expect.arrayContaining(["tasks", "lab", "operations", "owner-control"])
    );
    expect(accountantVisible).not.toContain("tasks");
    expect(accountantVisible).not.toContain("lab");
    expect(accountantVisible).not.toContain("operations");
    expect(accountantVisible).not.toContain("owner-control");
    expect(hasSurface("recalls")).toBe(true);
    expect(resolveSurfaceId("continuity")).toBe("tasks");
  });

  it("activates CP7 integration ops without exposing replay or migration to non-owner roles", () => {
    const assistantActive = getVisibleSurfaces(["assistant"])
      .filter((surface) => surface.availability === "active")
      .map((surface) => surface.id);
    const ownerActive = getVisibleSurfaces(["owner"])
      .filter((surface) => surface.availability === "active")
      .map((surface) => surface.id);
    const accountantVisible = getVisibleSurfaces(["accountant"]).map((surface) => surface.id);

    expect(assistantActive).toContain("integrations");
    expect(assistantActive).not.toContain("event-replay");
    expect(assistantActive).not.toContain("migration-review");
    expect(ownerActive).toEqual(
      expect.arrayContaining(["integrations", "event-replay", "migration-review"])
    );
    expect(accountantVisible).not.toContain("integrations");
    expect(accountantVisible).not.toContain("event-replay");
    expect(accountantVisible).not.toContain("migration-review");
    expect(resolveSurfaceId("provider-health")).toBe("integrations");
    expect(resolveSurfaceId("dead-letter-replay")).toBe("event-replay");
    expect(resolveSurfaceId("imports")).toBe("migration-review");
  });
});
