import { describe, expect, it } from "vitest";

import {
  applyFixtureAmendNote,
  applyFixtureCaptureConsent,
  applyFixtureRevokeConsent,
  applyFixtureSaveNoteDraft,
  applyFixtureSavePrescriptionDraft,
  applyFixtureSignNote,
  applyFixtureSignPrescription,
  applyFixtureStartEncounter,
  applyFixtureSubmitIntake,
  canSignClinicalArtifacts,
  classifyCp3EndpointFailures,
  createFixtureCp3WorkflowData,
  summarizeAiAudioReadiness,
  type NoteSections
} from "@/lib/cp3-workflow";
import { getSurface, getVisibleSurfaces } from "@/lib/navigation";

const readyNoteSections: NoteSections = {
  diagnosis: "Synthetic reversible pulpitis",
  examination: "Synthetic examination findings recorded",
  history: "Synthetic fixture history",
  investigations: "Synthetic vitality testing",
  treatmentPerformed: "Synthetic desensitizing care",
  treatmentPlan: "Review and definitive treatment if symptoms persist"
};

describe("CP3 frontend workflow", () => {
  it("activates doctor and assistant clinical workflow surfaces", () => {
    const assistantActive = getVisibleSurfaces(["assistant"])
      .filter((surface) => surface.availability === "active")
      .map((surface) => surface.id);

    expect(assistantActive).toEqual(
      expect.arrayContaining(["patient-profile", "intake", "consent", "returning-prep", "encounter"])
    );
    expect(getSurface("encounter").requiredApis).toContain(
      "POST /v1/encounters/{encounterId}/clinical-note/sign"
    );
  });

  it("classifies missing CP3 endpoint registration before runtime debugging", () => {
    const problem = classifyCp3EndpointFailures([
      {
        endpoint: "HTTP /v1/clinical-workflows/cp3",
        message: "Not found",
        status: 404
      }
    ]);

    expect(problem).toMatchObject({
      code: "CP3_ENDPOINT_NOT_REGISTERED"
    });
  });

  it("keeps AI/audio readiness blocked until consent is recorded and blocks again on revoke", () => {
    const data = createFixtureCp3WorkflowData("2026-07-07");
    const newPatient = data.patients.find((patient) => patient.id === "newClinicalPatient")!;

    expect(summarizeAiAudioReadiness(newPatient)).toMatchObject({
      allowed: false,
      label: "Blocked"
    });

    const granted = applyFixtureCaptureConsent(data, {
      actorRole: "assistant",
      method: "assistant_entry",
      patientId: newPatient.id,
      purpose: "ai_audio_capture"
    });
    const grantedPatient = granted.patients.find((patient) => patient.id === newPatient.id)!;

    expect(summarizeAiAudioReadiness(grantedPatient)).toMatchObject({
      allowed: true,
      label: "Consent recorded"
    });

    const revoked = applyFixtureRevokeConsent(granted, {
      actorRole: "assistant",
      patientId: newPatient.id,
      purpose: "ai_audio_capture",
      reason: "Patient declined future synthetic capture"
    });
    const revokedPatient = revoked.patients.find((patient) => patient.id === newPatient.id)!;

    expect(summarizeAiAudioReadiness(revokedPatient)).toMatchObject({
      allowed: false,
      label: "Revoked"
    });
  });

  it("allows assistant intake and note drafting but denies sign-off", () => {
    const data = createFixtureCp3WorkflowData("2026-07-07");
    const patientId = "newClinicalPatient";
    const encounterId = "newClinicalEncounter";
    const intake = applyFixtureSubmitIntake(data, {
      actorName: "assistant fixture user",
      actorRole: "assistant",
      fields: {
        allergies: "None",
        chiefComplaint: "Synthetic concern",
        currentMedications: "None",
        medicalConditions: "None"
      },
      mode: "assistant_paper_card",
      patientId
    });
    const started = applyFixtureStartEncounter(intake, encounterId);
    const drafted = applyFixtureSaveNoteDraft(started, {
      encounterId,
      sections: readyNoteSections
    });

    expect(drafted.patients.find((patient) => patient.id === patientId)?.intake.status).toBe(
      "completed"
    );
    expect(canSignClinicalArtifacts(["assistant"])).toBe(false);
    expect(() =>
      applyFixtureSignNote(drafted, {
        encounterId,
        roles: ["assistant"],
        signerName: "assistant fixture user"
      })
    ).toThrow("Doctor role is required");
  });

  it("signs notes as doctor, prevents overwrite, and records amendments as versions", () => {
    const data = createFixtureCp3WorkflowData("2026-07-07");
    const encounterId = "returningClinicalEncounter";
    const drafted = applyFixtureSaveNoteDraft(data, {
      encounterId,
      sections: readyNoteSections
    });
    const signed = applyFixtureSignNote(drafted, {
      encounterId,
      roles: ["doctor"],
      signerName: "doctor fixture user"
    });

    expect(
      signed.encounters.find((encounter) => encounter.id === encounterId)?.note.currentVersion
        .status
    ).toBe("signed");
    expect(() =>
      applyFixtureSaveNoteDraft(signed, {
        encounterId,
        sections: { ...readyNoteSections, diagnosis: "Overwrite attempt" }
      })
    ).toThrow("Signed clinical notes cannot be overwritten");

    const amended = applyFixtureAmendNote(signed, {
      amendmentReason: "Synthetic correction after review",
      encounterId,
      roles: ["doctor"],
      sections: { ...readyNoteSections, diagnosis: "Synthetic amended diagnosis" },
      signerName: "doctor fixture user"
    });
    const note = amended.encounters.find((encounter) => encounter.id === encounterId)!.note;

    expect(note.currentVersion.status).toBe("amended");
    expect(note.versions).toHaveLength(2);
    expect(
      amended.patients
        .find((patient) => patient.id === "returningClinicalPatient")
        ?.timeline.some((item) => item.kind === "clinical_note.amended")
    ).toBe(true);
  });

  it("requires doctor sign-off for prescriptions", () => {
    const data = createFixtureCp3WorkflowData("2026-07-07");
    const encounterId = "returningClinicalEncounter";
    const drafted = applyFixtureSavePrescriptionDraft(data, {
      encounterId,
      items: [
        {
          duration: "3 days",
          frequency: "Twice daily",
          id: "fixture-prescription-item",
          medicine: "Synthetic medicine",
          notes: "Synthetic fixture only"
        }
      ]
    });

    expect(() =>
      applyFixtureSignPrescription(drafted, {
        encounterId,
        roles: ["assistant"],
        signerName: "assistant fixture user"
      })
    ).toThrow("Doctor role is required");

    const signed = applyFixtureSignPrescription(drafted, {
      encounterId,
      roles: ["doctor"],
      signerName: "doctor fixture user"
    });

    expect(
      signed.encounters.find((encounter) => encounter.id === encounterId)?.prescription.status
    ).toBe("signed");
  });
});
