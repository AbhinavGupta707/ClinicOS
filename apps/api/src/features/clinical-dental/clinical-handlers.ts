import {
  assertEncounterTransition,
  assertPrescriptionMedicationList,
  hasClinicalNoteContent,
  type ClinicalNoteContent,
  type ConsentCaptureMethod,
  type ConsentPurpose,
  type PrescriptionMedication,
  type UUID
} from "@clinic-os/domain";
import type { ClinicFeatureExecutionContext } from "../contracts.ts";
import {
  appendAudit,
  appendMutationEvidence,
  assertDoctorSignature,
  assertEncounterRelationships,
  assertPatientExists,
  conflict,
  consentState,
  created,
  notFound,
  ok,
  parsedBody,
  parsedPathId,
  requireClinicalConsent,
  validation,
  type ClinicalDentalRequest,
  type ParsedJsonObject
} from "./shared.ts";
import type { ClinicalDentalHandlerDependencies } from "./types.ts";

interface CreateConsentBody extends ParsedJsonObject {
  readonly purpose: ConsentPurpose;
  readonly templateCode: string;
  readonly templateVersion: number;
  readonly captureMethod?: ConsentCaptureMethod;
  readonly grantedByName?: string | null;
  readonly relationshipToPatient?: string | null;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, unknown>>;
}

interface RevokeConsentBody extends ParsedJsonObject {
  readonly reason: string;
}

interface CreateEncounterBody extends ParsedJsonObject {
  readonly patientId: UUID;
  readonly appointmentId?: UUID | null;
  readonly providerUserId: UUID;
  readonly reason?: string | null;
  readonly medicalHistorySnapshot?: Readonly<Record<string, unknown>>;
}

interface ClinicalNoteBody extends ParsedJsonObject {
  readonly content: ClinicalNoteContent;
  readonly readyForSign?: boolean;
}

interface AmendClinicalNoteBody extends ParsedJsonObject {
  readonly content: ClinicalNoteContent;
  readonly amendmentReason: string;
}

interface CreatePrescriptionBody extends ParsedJsonObject {
  readonly medications: readonly PrescriptionMedication[];
  readonly notes?: string | null;
}

export function createClinicalHandlers(dependencies: ClinicalDentalHandlerDependencies) {
  return {
    listPatientConsents: async (
      request: ClinicalDentalRequest<"listPatientConsents">,
      context: ClinicFeatureExecutionContext
    ) => {
      const patientId = parsedPathId(request, "patientId");
      await assertPatientExists(dependencies, context, patientId);
      const consents = await context.repositories.clinicalCare.listPatientConsents(patientId);
      const enforcementState = await consentState(context, patientId);

      await appendAudit(request, context, "consent.enforcement.checked", {
        patientId,
        resourceType: "consent",
        resourceId: patientId,
        metadata: {
          activePurposes: enforcementState.activePurposes,
          revokedPurposes: enforcementState.revokedPurposes
        }
      });
      return ok({ consents, enforcementState });
    },

    createPatientConsent: async (
      request: ClinicalDentalRequest<"createPatientConsent">,
      context: ClinicFeatureExecutionContext
    ) => {
      const patientId = parsedPathId(request, "patientId");
      const input = parsedBody<CreateConsentBody>(request);
      await assertPatientExists(dependencies, context, patientId);
      const existing = await context.repositories.clinicalCare.listPatientConsents(patientId);
      const active = existing.find(
        (consent) => consent.purpose === input.purpose && consent.status === "active"
      );
      if (active) {
        throw conflict("An active consent already exists for this purpose.", {
          consent_id: active.id,
          purpose: input.purpose
        });
      }

      let consent;
      try {
        consent = await context.repositories.clinicalCare.createConsent({
          patientId,
          purpose: input.purpose,
          templateCode: input.templateCode,
          templateVersion: input.templateVersion,
          captureMethod: input.captureMethod ?? "clinic_staff",
          grantedByName: input.grantedByName,
          relationshipToPatient: input.relationshipToPatient,
          evidence: { ...input.evidence },
          provenance: { ...input.provenance }
        });
      } catch (error) {
        if (databaseErrorCode(error) === "23505") {
          throw conflict("An active consent already exists for this purpose.", {
            purpose: input.purpose
          });
        }
        throw error;
      }
      const enforcementState = await consentState(context, patientId);
      await appendMutationEvidence(request, context, {
        auditAction: "consent.created",
        eventType: "consent.created",
        aggregateType: "consent",
        aggregateId: consent.id,
        patientId,
        auditMetadata: { purpose: consent.purpose, captureMethod: consent.captureMethod },
        eventPayload: {
          consentId: consent.id,
          patientId,
          purpose: consent.purpose,
          treatmentAllowed: enforcementState.treatmentAllowed
        }
      });
      return created({ consent, enforcementState });
    },

    revokePatientConsent: async (
      request: ClinicalDentalRequest<"revokePatientConsent">,
      context: ClinicFeatureExecutionContext
    ) => {
      const patientId = parsedPathId(request, "patientId");
      const consentId = parsedPathId(request, "consentId");
      const input = parsedBody<RevokeConsentBody>(request);
      await assertPatientExists(dependencies, context, patientId);
      const existing = (
        await context.repositories.clinicalCare.listPatientConsents(patientId)
      ).find((consent) => consent.id === consentId);
      if (!existing) throw notFound("Consent not found.", { consent_id: consentId });
      if (existing.status !== "active") {
        throw conflict("Consent is already revoked.", { consent_id: consentId });
      }
      const consent = await context.repositories.clinicalCare.revokeConsent(consentId, {
        revocationReason: input.reason
      });
      if (!consent) throw conflict("Consent is no longer active.", { consent_id: consentId });

      const enforcementState = await consentState(context, patientId);
      await appendMutationEvidence(request, context, {
        auditAction: "consent.revoked",
        eventType: "consent.revoked",
        aggregateType: "consent",
        aggregateId: consent.id,
        patientId,
        auditMetadata: {
          purpose: consent.purpose,
          treatmentAllowed: enforcementState.treatmentAllowed
        },
        eventPayload: {
          consentId: consent.id,
          patientId,
          purpose: consent.purpose,
          treatmentAllowed: enforcementState.treatmentAllowed
        }
      });
      return ok({ consent, enforcementState });
    },

    createEncounter: async (
      request: ClinicalDentalRequest<"createEncounter">,
      context: ClinicFeatureExecutionContext
    ) => {
      const input = parsedBody<CreateEncounterBody>(request);
      await assertEncounterRelationships(dependencies, context, input);
      await requireClinicalConsent(request, context, input.patientId, "encounter_create");
      const encounter = await context.repositories.clinicalCare.createEncounter({
        patientId: input.patientId,
        appointmentId: input.appointmentId,
        providerUserId: input.providerUserId,
        reason: input.reason,
        medicalHistorySnapshot: input.medicalHistorySnapshot
          ? { ...input.medicalHistorySnapshot }
          : {}
      });
      await appendMutationEvidence(request, context, {
        auditAction: "encounter.created",
        eventType: "encounter.created",
        aggregateType: "encounter",
        aggregateId: encounter.id,
        patientId: encounter.patientId,
        auditMetadata: {
          appointmentId: encounter.appointmentId,
          providerUserId: encounter.providerUserId
        },
        eventPayload: {
          encounterId: encounter.id,
          patientId: encounter.patientId,
          status: encounter.status
        }
      });
      return created({ encounter });
    },

    getEncounter: async (
      request: ClinicalDentalRequest<"getEncounter">,
      context: ClinicFeatureExecutionContext
    ) => {
      const encounterId = parsedPathId(request, "encounterId");
      const encounter = await context.repositories.clinicalCare.findEncounterById(encounterId);
      if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
      const noteVersions =
        await context.repositories.clinicalCare.listClinicalNoteVersions(encounterId);
      await appendAudit(request, context, "clinical_prep.viewed", {
        patientId: encounter.patientId,
        resourceType: "encounter",
        resourceId: encounter.id,
        metadata: { noteVersionCount: noteVersions.length }
      });
      return ok({ encounter, noteVersions });
    },

    startEncounter: async (
      request: ClinicalDentalRequest<"startEncounter">,
      context: ClinicFeatureExecutionContext
    ) => {
      const encounterId = parsedPathId(request, "encounterId");
      const existing = await context.repositories.clinicalCare.findEncounterById(encounterId);
      if (!existing) throw notFound("Encounter not found.", { encounter_id: encounterId });
      await requireClinicalConsent(request, context, existing.patientId, "encounter_start");
      try {
        assertEncounterTransition(existing.status, "drafting");
      } catch (error) {
        throw conflict(errorMessage(error, "Invalid encounter transition."), {
          encounter_id: encounterId,
          from_status: existing.status,
          to_status: "drafting"
        });
      }
      const encounter = await context.repositories.clinicalCare.transitionEncounter(
        encounterId,
        "drafting",
        "encounter_started"
      );
      if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
      await appendMutationEvidence(request, context, {
        auditAction: "encounter.started",
        eventType: "encounter.started",
        aggregateType: "encounter",
        aggregateId: encounter.id,
        patientId: encounter.patientId,
        auditMetadata: { appointmentId: encounter.appointmentId },
        eventPayload: {
          encounterId: encounter.id,
          patientId: encounter.patientId,
          status: encounter.status
        }
      });
      return ok({ encounter });
    },

    saveEncounterClinicalNoteDraft: async (
      request: ClinicalDentalRequest<"saveEncounterClinicalNoteDraft">,
      context: ClinicFeatureExecutionContext
    ) => {
      const encounterId = parsedPathId(request, "encounterId");
      const input = parsedBody<ClinicalNoteBody>(request);
      const encounter = await context.repositories.clinicalCare.findEncounterById(encounterId);
      if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
      await requireClinicalConsent(request, context, encounter.patientId, "clinical_note_draft");
      if (["signed", "amended", "closed", "cancelled"].includes(encounter.status)) {
        throw conflict("Signed or closed encounters cannot be edited through the draft endpoint.", {
          encounter_id: encounterId,
          status: encounter.status
        });
      }
      if (!hasClinicalNoteContent(input.content)) {
        throw validation("Clinical note draft requires at least one note section.", {
          field: "content"
        });
      }
      const note = await context.repositories.clinicalCare.saveClinicalNoteDraft(encounterId, {
        content: input.content,
        readyForSign: input.readyForSign
      });
      if (!note) {
        throw conflict("Clinical note draft could not be saved for this encounter state.", {
          encounter_id: encounterId,
          status: encounter.status
        });
      }
      const updatedEncounter =
        await context.repositories.clinicalCare.findEncounterById(encounterId);
      if (!updatedEncounter) {
        throw new Error("Encounter could not be reloaded after saving the clinical note draft.");
      }
      await appendMutationEvidence(request, context, {
        auditAction: "clinical_note.draft_created",
        eventType: "clinical_note.draft_created",
        aggregateType: "clinical_note",
        aggregateId: note.id,
        patientId: encounter.patientId,
        auditMetadata: { encounterId, readyForSign: input.readyForSign === true },
        eventPayload: {
          encounterId,
          noteVersionId: note.id,
          versionNumber: note.versionNumber
        }
      });
      return ok({ encounter: updatedEncounter, note });
    },

    signEncounterClinicalNote: async (
      request: ClinicalDentalRequest<"signEncounterClinicalNote">,
      context: ClinicFeatureExecutionContext
    ) => {
      assertDoctorSignature(request, "clinical.note.sign");
      const encounterId = parsedPathId(request, "encounterId");
      const encounter = await context.repositories.clinicalCare.findEncounterById(encounterId);
      if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
      await requireClinicalConsent(request, context, encounter.patientId, "clinical_note_sign");
      const draft = (
        await context.repositories.clinicalCare.listClinicalNoteVersions(encounterId)
      ).find((note) => note.status === "draft");
      if (!draft || !hasClinicalNoteContent(draft.content)) {
        throw validation("Encounter does not have a signable clinical note draft.", {
          encounter_id: encounterId
        });
      }
      const result = await context.repositories.clinicalCare.signClinicalNote(encounterId);
      if (!result) {
        throw conflict("Encounter no longer has a signable clinical note draft.", {
          encounter_id: encounterId
        });
      }
      await appendMutationEvidence(request, context, {
        auditAction: "clinical_note.signed",
        eventType: "clinical_note.signed",
        aggregateType: "clinical_note",
        aggregateId: result.note.id,
        patientId: result.note.patientId,
        auditMetadata: { encounterId, versionNumber: result.note.versionNumber },
        eventPayload: {
          encounterId,
          noteVersionId: result.note.id,
          versionNumber: result.note.versionNumber
        }
      });
      return ok(result);
    },

    amendEncounterClinicalNote: async (
      request: ClinicalDentalRequest<"amendEncounterClinicalNote">,
      context: ClinicFeatureExecutionContext
    ) => {
      assertDoctorSignature(request, "clinical.note.sign");
      const encounterId = parsedPathId(request, "encounterId");
      const input = parsedBody<AmendClinicalNoteBody>(request);
      const encounter = await context.repositories.clinicalCare.findEncounterById(encounterId);
      if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
      if (!hasClinicalNoteContent(input.content) || !input.amendmentReason.trim()) {
        throw validation("Clinical note amendment requires content and an amendment reason.", {
          field: !input.amendmentReason.trim() ? "amendmentReason" : "content"
        });
      }
      // A signed record remains correctable after consent revocation; this operation appends an
      // immutable linked version and never authorizes new treatment or destructive overwrite.
      const result = await context.repositories.clinicalCare.amendClinicalNote(encounterId, {
        content: input.content,
        amendmentReason: input.amendmentReason
      });
      if (!result) {
        throw conflict("Encounter does not have a signed note to amend.", {
          encounter_id: encounterId
        });
      }
      await appendMutationEvidence(request, context, {
        auditAction: "clinical_note.amended",
        eventType: "clinical_note.amended",
        aggregateType: "clinical_note",
        aggregateId: result.note.id,
        patientId: result.note.patientId,
        auditMetadata: {
          encounterId,
          versionNumber: result.note.versionNumber,
          amendedFromVersionId: result.amendedFrom.id,
          correctionAfterConsentRevocationAllowed: true
        },
        eventPayload: {
          encounterId,
          noteVersionId: result.note.id,
          amendedFromVersionId: result.amendedFrom.id,
          versionNumber: result.note.versionNumber
        }
      });
      return ok(result);
    },

    createEncounterPrescription: async (
      request: ClinicalDentalRequest<"createEncounterPrescription">,
      context: ClinicFeatureExecutionContext
    ) => {
      const encounterId = parsedPathId(request, "encounterId");
      const input = parsedBody<CreatePrescriptionBody>(request);
      const encounter = await context.repositories.clinicalCare.findEncounterById(encounterId);
      if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
      await requireClinicalConsent(request, context, encounter.patientId, "prescription_draft");
      if (["scheduled", "closed", "cancelled"].includes(encounter.status)) {
        throw conflict("Prescription drafting is not allowed in this encounter state.", {
          encounter_id: encounterId,
          status: encounter.status
        });
      }
      try {
        assertPrescriptionMedicationList(input.medications);
      } catch (error) {
        throw validation(errorMessage(error, "Invalid prescription medications."), {
          field: "medications"
        });
      }
      const prescription = await context.repositories.clinicalCare.createPrescription(encounterId, {
        medications: [...input.medications],
        notes: input.notes
      });
      if (!prescription) throw notFound("Encounter not found.", { encounter_id: encounterId });
      await appendMutationEvidence(request, context, {
        auditAction: "prescription.draft_created",
        eventType: "prescription.draft_created",
        aggregateType: "prescription",
        aggregateId: prescription.id,
        patientId: prescription.patientId,
        auditMetadata: {
          encounterId,
          medicationCount: prescription.medications.length
        },
        eventPayload: {
          prescriptionId: prescription.id,
          encounterId,
          patientId: prescription.patientId,
          medicationCount: prescription.medications.length
        }
      });
      return created({ prescription });
    },

    signPrescription: async (
      request: ClinicalDentalRequest<"signPrescription">,
      context: ClinicFeatureExecutionContext
    ) => {
      assertDoctorSignature(request, "prescription.sign");
      const prescriptionId = parsedPathId(request, "prescriptionId");
      const existing = await context.repositories.clinicalCare.findPrescriptionById(prescriptionId);
      if (!existing) {
        throw notFound("Prescription not found.", { prescription_id: prescriptionId });
      }
      await requireClinicalConsent(request, context, existing.patientId, "prescription_sign");
      if (existing.status !== "draft") {
        throw conflict("Prescription is already signed.", { prescription_id: prescriptionId });
      }
      try {
        assertPrescriptionMedicationList(existing.medications);
      } catch (error) {
        throw validation(errorMessage(error, "Prescription is not signable."), {
          prescription_id: prescriptionId
        });
      }
      const prescription = await context.repositories.clinicalCare.signPrescription(prescriptionId);
      if (!prescription) {
        throw conflict("Prescription is no longer signable.", {
          prescription_id: prescriptionId
        });
      }
      await appendMutationEvidence(request, context, {
        auditAction: "prescription.signed",
        eventType: "prescription.signed",
        aggregateType: "prescription",
        aggregateId: prescription.id,
        patientId: prescription.patientId,
        auditMetadata: {
          encounterId: prescription.encounterId,
          medicationCount: prescription.medications.length
        },
        eventPayload: {
          prescriptionId: prescription.id,
          encounterId: prescription.encounterId,
          patientId: prescription.patientId,
          medicationCount: prescription.medications.length
        }
      });
      return ok({ prescription });
    }
  } as const;
}

function databaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
