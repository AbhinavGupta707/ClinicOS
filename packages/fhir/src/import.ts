import { digestClinicOsJson, type ClinicOsSha256Digest } from "./canonical.ts";
import { clinicalSummaryPatientIdentifiers } from "./document-validation.ts";
import type { FhirBundle, FhirIdentifier, FhirMedicationRequest } from "./types.ts";

export type PatientMatchFailure =
  | "ambiguous_exact_match"
  | "missing_exact_match"
  | "patient_version_conflict"
  | "target_patient_mismatch";

export type EncounterMatchFailure =
  | "ambiguous_exact_encounter_match"
  | "encounter_version_conflict"
  | "missing_exact_encounter_match"
  | "target_encounter_mismatch";

export type ClinicalSummaryImportMatchFailure = PatientMatchFailure | EncounterMatchFailure;

export interface AuthorizedPatientMatchCandidate {
  readonly clinicId: string;
  readonly identifiers: readonly FhirIdentifier[];
  readonly patientId: string;
  readonly rowVersion: number;
  readonly tenantId: string;
}

export interface AuthorizedEncounterMatchCandidate {
  readonly clinicId: string;
  readonly encounterId: string;
  readonly identifiers: readonly FhirIdentifier[];
  readonly patientId: string;
  readonly rowVersion: number;
  readonly tenantId: string;
}

export type ExactPatientMatchDecision =
  | {
      readonly kind: "matched";
      readonly candidate: AuthorizedPatientMatchCandidate;
      readonly matchedIdentifiers: readonly FhirIdentifier[];
    }
  | {
      readonly kind: "quarantine";
      readonly reason: PatientMatchFailure;
      readonly candidateCount: number;
    };

export type ExactEncounterMatchDecision =
  | {
      readonly kind: "matched";
      readonly candidate: AuthorizedEncounterMatchCandidate;
      readonly matchedIdentifier: FhirIdentifier;
    }
  | {
      readonly kind: "quarantine";
      readonly reason: EncounterMatchFailure;
      readonly candidateCount: number;
    };

export interface MinimizedClinicalSummaryImport {
  readonly bundleDigest: ClinicOsSha256Digest;
  readonly bundleId: string;
  readonly composition: {
    readonly date: string;
    readonly id: string;
    readonly status: "amended" | "final";
    readonly title: string;
  };
  readonly encounter: {
    readonly id: string;
    readonly identifier: FhirIdentifier;
    readonly version: number;
  };
  readonly medicationRequests: readonly {
    readonly authoredOn: string | null;
    readonly dosageText: string;
    readonly id: string;
    readonly medicationText: string;
    readonly prescriptionIdentifier: FhirIdentifier;
  }[];
  readonly patientIdentifiers: readonly FhirIdentifier[];
  readonly sourceDocumentReferenceIds: readonly string[];
}

export function decideExactAuthorizedPatientMatch(input: {
  readonly candidates: readonly AuthorizedPatientMatchCandidate[];
  readonly expectedPatientVersion: number;
  readonly identifiers: readonly FhirIdentifier[];
  readonly scope: {
    readonly clinicId: string;
    readonly patientId: string;
    readonly tenantId: string;
  };
}): ExactPatientMatchDecision {
  if (!Number.isSafeInteger(input.expectedPatientVersion) || input.expectedPatientVersion < 1) {
    throw new Error("expectedPatientVersion must be a positive safe integer.");
  }
  const authorizedIdentifiers = input.identifiers.filter(
    (identifier) => Boolean(identifier.system?.trim()) && Boolean(identifier.value.trim())
  );
  if (authorizedIdentifiers.length === 0) {
    return { kind: "quarantine", reason: "missing_exact_match", candidateCount: 0 };
  }
  const exact = input.candidates.filter(
    (candidate) =>
      candidate.tenantId === input.scope.tenantId &&
      candidate.clinicId === input.scope.clinicId &&
      authorizedIdentifiers.some((incoming) =>
        candidate.identifiers.some(
          (known) => known.system === incoming.system && known.value === incoming.value
        )
      )
  );
  if (exact.length === 0) {
    return { kind: "quarantine", reason: "missing_exact_match", candidateCount: 0 };
  }
  if (exact.length > 1) {
    return {
      kind: "quarantine",
      reason: "ambiguous_exact_match",
      candidateCount: exact.length
    };
  }
  const candidate = exact[0]!;
  if (candidate.patientId !== input.scope.patientId) {
    return { kind: "quarantine", reason: "target_patient_mismatch", candidateCount: 1 };
  }
  if (candidate.rowVersion !== input.expectedPatientVersion) {
    return { kind: "quarantine", reason: "patient_version_conflict", candidateCount: 1 };
  }
  return {
    kind: "matched",
    candidate,
    matchedIdentifiers: authorizedIdentifiers.filter((incoming) =>
      candidate.identifiers.some(
        (known) => known.system === incoming.system && known.value === incoming.value
      )
    )
  };
}

export function decideExactAuthorizedEncounterMatch(input: {
  readonly candidates: readonly AuthorizedEncounterMatchCandidate[];
  readonly expectedEncounterVersion: number;
  readonly identifier: FhirIdentifier;
  readonly scope: {
    readonly clinicId: string;
    readonly patientId: string;
    readonly tenantId: string;
  };
}): ExactEncounterMatchDecision {
  if (!Number.isSafeInteger(input.expectedEncounterVersion) || input.expectedEncounterVersion < 1) {
    throw new Error("expectedEncounterVersion must be a positive safe integer.");
  }
  if (!input.identifier.system?.trim() || !input.identifier.value.trim()) {
    return { kind: "quarantine", reason: "missing_exact_encounter_match", candidateCount: 0 };
  }
  const exact = input.candidates.filter(
    (candidate) =>
      candidate.tenantId === input.scope.tenantId &&
      candidate.clinicId === input.scope.clinicId &&
      candidate.patientId === input.scope.patientId &&
      candidate.identifiers.some(
        (known) =>
          known.system === input.identifier.system && known.value === input.identifier.value
      )
  );
  if (exact.length === 0) {
    return { kind: "quarantine", reason: "missing_exact_encounter_match", candidateCount: 0 };
  }
  if (exact.length > 1) {
    return {
      kind: "quarantine",
      reason: "ambiguous_exact_encounter_match",
      candidateCount: exact.length
    };
  }
  const candidate = exact[0]!;
  if (candidate.encounterId !== input.identifier.value) {
    return { kind: "quarantine", reason: "target_encounter_mismatch", candidateCount: 1 };
  }
  if (candidate.rowVersion !== input.expectedEncounterVersion) {
    return { kind: "quarantine", reason: "encounter_version_conflict", candidateCount: 1 };
  }
  return {
    kind: "matched",
    candidate,
    matchedIdentifier: { ...input.identifier }
  };
}

export function minimizeClinicalSummaryImport(bundle: FhirBundle): MinimizedClinicalSummaryImport {
  const resources = bundle.entry.map((entry) => entry.resource);
  const composition = resources.find((resource) => resource.resourceType === "Composition");
  const encounter = resources.find((resource) => resource.resourceType === "Encounter");
  if (composition?.resourceType !== "Composition" || encounter?.resourceType !== "Encounter") {
    throw new Error("Validated clinical summary is missing Composition or Encounter.");
  }
  const encounterIdentifier = encounter.identifier?.find(
    (identifier) => Boolean(identifier.system) && Boolean(identifier.value)
  );
  const version = Number(encounter.meta.versionId);
  if (!encounterIdentifier || !Number.isSafeInteger(version) || version < 1) {
    throw new Error("Validated clinical summary encounter identity/version is missing.");
  }
  const medicationRequests = resources.filter(
    (resource): resource is FhirMedicationRequest => resource.resourceType === "MedicationRequest"
  );
  return {
    bundleDigest: digestClinicOsJson(bundle),
    bundleId: bundle.id,
    composition: {
      date: composition.date,
      id: composition.id,
      status: composition.status as "amended" | "final",
      title: composition.title
    },
    encounter: {
      id: encounter.id,
      identifier: { ...encounterIdentifier },
      version
    },
    medicationRequests: medicationRequests.map((request) => {
      const prescriptionIdentifier = request.identifier?.[0];
      if (!prescriptionIdentifier) {
        throw new Error("Validated MedicationRequest identifier is missing.");
      }
      return {
        authoredOn: request.authoredOn ?? null,
        dosageText: request.dosageInstruction?.[0]?.text ?? "",
        id: request.id,
        medicationText: request.medicationCodeableConcept.text ?? "",
        prescriptionIdentifier: { ...prescriptionIdentifier }
      };
    }),
    patientIdentifiers: clinicalSummaryPatientIdentifiers(bundle),
    sourceDocumentReferenceIds: resources
      .filter((resource) => resource.resourceType === "DocumentReference")
      .map((resource) => resource.id)
  };
}
