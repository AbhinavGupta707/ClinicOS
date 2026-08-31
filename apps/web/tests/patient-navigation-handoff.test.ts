import { afterEach, describe, expect, it } from "vitest";

import {
  clearPatientNavigationHandoff,
  readPatientNavigationHandoff,
  rememberPatientNavigation
} from "@/lib/patient-navigation-handoff";

describe("patient navigation handoff", () => {
  afterEach(() => clearPatientNavigationHandoff());

  it("keeps the selected patient in memory without browser storage or URL state", () => {
    expect(readPatientNavigationHandoff()).toBeNull();
    expect(rememberPatientNavigation("clinic-1", "patient-1")).toEqual({
      clinicId: "clinic-1",
      patientId: "patient-1"
    });
    expect(readPatientNavigationHandoff()).toEqual({
      clinicId: "clinic-1",
      patientId: "patient-1"
    });
  });

  it("rejects an empty scoped handoff", () => {
    expect(() => rememberPatientNavigation("clinic-1", " ")).toThrow(
      "Clinic and patient identifiers are required"
    );
  });
});
