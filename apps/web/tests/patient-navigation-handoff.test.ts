import { afterEach, describe, expect, it } from "vitest";

import {
  clearPatientNavigationHandoff,
  patientNavigationHandoffMatchesIdentity,
  readPatientNavigationHandoff,
  rememberPatientNavigation
} from "@/lib/patient-navigation-handoff";

describe("patient navigation handoff", () => {
  afterEach(() => clearPatientNavigationHandoff());

  it("keeps the selected patient in memory without browser storage or URL state", () => {
    expect(readPatientNavigationHandoff()).toBeNull();
    expect(rememberPatientNavigation("tenant-1", "clinic-1", "user-1", "patient-1")).toEqual({
      clinicId: "clinic-1",
      patientId: "patient-1",
      tenantId: "tenant-1",
      userId: "user-1"
    });
    expect(readPatientNavigationHandoff()).toEqual({
      clinicId: "clinic-1",
      patientId: "patient-1",
      tenantId: "tenant-1",
      userId: "user-1"
    });
  });

  it("rejects an empty scoped handoff", () => {
    expect(() => rememberPatientNavigation("tenant-1", "clinic-1", "user-1", " ")).toThrow(
      "Tenant, clinic, user, and patient identifiers are required"
    );
  });

  it("binds an in-memory handoff to the tenant, clinic, and signed-in user", () => {
    const handoff = rememberPatientNavigation("tenant-1", "clinic-1", "user-1", "patient-1");

    expect(patientNavigationHandoffMatchesIdentity(handoff, "tenant-1", "clinic-1", "user-1")).toBe(
      true
    );
    expect(patientNavigationHandoffMatchesIdentity(handoff, "tenant-1", "clinic-1", "user-2")).toBe(
      false
    );
    expect(patientNavigationHandoffMatchesIdentity(handoff, "tenant-2", "clinic-1", "user-1")).toBe(
      false
    );
  });
});
