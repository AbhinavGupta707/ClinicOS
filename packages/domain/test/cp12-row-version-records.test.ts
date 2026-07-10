import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const RECORD_SOURCES = Object.freeze({
  PatientRecord: "patient.ts",
  LeadRecord: "lead.ts",
  AppointmentRecord: "appointment.ts",
  QueueEntryRecord: "appointment.ts",
  EncounterRecord: "clinical.ts",
  DentalFindingRecord: "dental.ts",
  TreatmentPlanRecord: "billing.ts",
  TaskRecord: "continuity.ts",
  SopRunRecord: "continuity.ts",
  LabCaseRecord: "operations.ts",
  InventoryCheckRunRecord: "operations.ts",
  CorrectiveActionRecord: "operations.ts"
});

test("CP12 canonical versioned resource records require numeric rowVersion", () => {
  for (const [recordName, fileName] of Object.entries(RECORD_SOURCES)) {
    const source = readFileSync(new URL(`../src/${fileName}`, import.meta.url), "utf8");
    const definition = new RegExp(
      `export interface ${recordName} \\{(?<body>[\\s\\S]*?)\\n\\}`,
      "u"
    ).exec(source)?.groups?.body;

    assert.ok(definition, `${recordName} must remain a canonical exported interface`);
    assert.match(definition, /\n\s+rowVersion: number;/u, `${recordName}.rowVersion is required`);
    assert.doesNotMatch(
      definition,
      /rowVersion\s*\?:/u,
      `${recordName}.rowVersion cannot be optional`
    );
  }
});
