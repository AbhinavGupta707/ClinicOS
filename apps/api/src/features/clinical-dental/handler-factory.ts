import { CP13_CLINICAL_DENTAL_OPERATION_IDS } from "../cp13-operation-ownership.ts";
import { createClinicalHandlers } from "./clinical-handlers.ts";
import { createDentalHandlers } from "./dental-handlers.ts";
import { createMediaHandlers } from "./media-handlers.ts";
import type { ClinicalDentalHandlerDependencies, ClinicalDentalHandlerMap } from "./types.ts";

export function createClinicalDentalHandlerMap(
  dependencies: ClinicalDentalHandlerDependencies
): ClinicalDentalHandlerMap {
  const clinical = createClinicalHandlers(dependencies);
  const dental = createDentalHandlers(dependencies);
  const media = createMediaHandlers(dependencies);
  const handlers = {
    listPatientConsents: clinical.listPatientConsents,
    createPatientConsent: clinical.createPatientConsent,
    revokePatientConsent: clinical.revokePatientConsent,
    createEncounter: clinical.createEncounter,
    getEncounter: clinical.getEncounter,
    startEncounter: clinical.startEncounter,
    saveEncounterClinicalNoteDraft: clinical.saveEncounterClinicalNoteDraft,
    signEncounterClinicalNote: clinical.signEncounterClinicalNote,
    amendEncounterClinicalNote: clinical.amendEncounterClinicalNote,
    createEncounterPrescription: clinical.createEncounterPrescription,
    signPrescription: clinical.signPrescription,
    getPatientDentalChart: dental.getPatientDentalChart,
    createPatientDentalFinding: dental.createPatientDentalFinding,
    createEncounterDentalFinding: dental.createEncounterDentalFinding,
    updateDentalFinding: dental.updateDentalFinding,
    listDentalFindingHistory: dental.listDentalFindingHistory,
    createDentalChartSnapshot: dental.createDentalChartSnapshot,
    requestMediaUploadUrl: media.requestMediaUploadUrl,
    receiveMediaUploadContent: media.receiveMediaUploadContent,
    completeMediaUpload: media.completeMediaUpload,
    listPatientMediaAssets: media.listPatientMediaAssets,
    createSignedMediaAccess: media.createSignedMediaAccess
  } satisfies ClinicalDentalHandlerMap;

  const registered = Object.keys(handlers).sort();
  const expected = [...CP13_CLINICAL_DENTAL_OPERATION_IDS].sort();
  if (
    registered.length !== expected.length ||
    registered.some((id, index) => id !== expected[index])
  ) {
    throw new Error(
      "Clinical/dental handler registration does not match the frozen CP13 ownership map."
    );
  }
  return Object.freeze(handlers);
}
