import { afterEach, expect, test } from "vitest";
import {
  activateClinicalNoteScope,
  clearUnsavedClinicalNotes,
  forgetUnsavedClinicalNote,
  readUnsavedClinicalNote,
  rememberUnsavedClinicalNote,
  unsavedEncounterForPatient
} from "../lib/unsaved-clinical-notes";

afterEach(clearUnsavedClinicalNotes);
const draft = {
  patientId: "patient-a",
  encounterId: "visit-a",
  rowVersion: 3,
  content: { assessment: "Synthetic unsaved examination" },
  ready: true,
  amendmentReason: ""
};

test("tab recovery is isolated by identity, patient and encounter and retains the original version", () => {
  activateClinicalNoteScope("tenant:clinic:doctor");
  rememberUnsavedClinicalNote("tenant:clinic:doctor", draft);
  expect(readUnsavedClinicalNote("tenant:clinic:doctor", "patient-a", "visit-a")).toEqual(draft);
  expect(readUnsavedClinicalNote("other", "patient-a", "visit-a")).toBeUndefined();
  expect(readUnsavedClinicalNote("tenant:clinic:doctor", "other", "visit-a")).toBeUndefined();
  expect(readUnsavedClinicalNote("tenant:clinic:doctor", "patient-a", "other")).toBeUndefined();
  expect(unsavedEncounterForPatient("tenant:clinic:doctor", "patient-a")).toBe("visit-a");
  activateClinicalNoteScope("tenant:clinic:other-doctor");
  activateClinicalNoteScope("tenant:clinic:doctor");
  expect(readUnsavedClinicalNote("tenant:clinic:doctor", "patient-a", "visit-a")).toBeUndefined();
});

test("save/discard removes only its note; signout clears all notes and rejects late writes", () => {
  activateClinicalNoteScope("scope");
  rememberUnsavedClinicalNote("scope", draft);
  rememberUnsavedClinicalNote("scope", { ...draft, encounterId: "visit-b" });
  forgetUnsavedClinicalNote("scope", "patient-a", "visit-a");
  expect(readUnsavedClinicalNote("scope", "patient-a", "visit-a")).toBeUndefined();
  expect(unsavedEncounterForPatient("scope", "patient-a")).toBe("visit-b");
  clearUnsavedClinicalNotes();
  rememberUnsavedClinicalNote("scope", draft);
  activateClinicalNoteScope("scope");
  expect(unsavedEncounterForPatient("scope", "patient-a")).toBeUndefined();
});
