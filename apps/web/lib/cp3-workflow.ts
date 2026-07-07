import type { ClinicRole } from "./roles";

export type Cp3WorkflowSource = "api" | "cp3_fixture";

export type PatientKind = "new" | "returning";

export type IntakeMode = "assistant_paper_card" | "digital";

export type IntakeStatus = "completed" | "not_started";

export type ConsentPurpose =
  | "ai_audio_capture"
  | "photo_capture"
  | "treatment_registration"
  | "whatsapp_communication";

export type ConsentStatus = "granted" | "not_recorded" | "revoked";

export type EncounterStatus =
  | "amended"
  | "checked_in"
  | "drafting"
  | "encounter_started"
  | "ready_for_sign"
  | "scheduled"
  | "signed";

export type ClinicalNoteStatus = "amended" | "draft" | "ready_for_sign" | "signed";

export type PrescriptionStatus = "draft" | "signed";

export interface TimelineItem {
  at: string;
  detail: string;
  id: string;
  kind:
    | "clinical_note.amended"
    | "clinical_note.draft_created"
    | "clinical_note.signed"
    | "consent.created"
    | "consent.revoked"
    | "encounter.started"
    | "form_response.submitted"
    | "patient.created"
    | "prescription.signed"
    | "visit.completed";
  title: string;
}

export interface IntakeResponse {
  completedAt?: string;
  fields: {
    allergies: string;
    chiefComplaint: string;
    currentMedications: string;
    medicalConditions: string;
  };
  id: string;
  mode: IntakeMode;
  provenance?: {
    actorRole: ClinicRole;
    capturedBy: string;
  };
  templateId?: string;
  status: IntakeStatus;
}

export interface ConsentRecord {
  capturedAt?: string;
  id: string;
  provenance?: {
    actorRole: ClinicRole;
    method: "assistant_entry" | "digital_signature";
    note?: string;
  };
  purpose: ConsentPurpose;
  revokedAt?: string;
  revokedReason?: string;
  status: ConsentStatus;
}

export interface PrepSummary {
  medicalHistoryChanges: string[];
  openTreatmentPlans: string[];
  pendingDues: string;
  pendingLabCases: string[];
  priorMedia: string[];
  priorVisits: string[];
  recallContext: string;
  visitReason: string;
}

export interface NoteSections {
  diagnosis: string;
  examination: string;
  history: string;
  investigations: string;
  treatmentPerformed: string;
  treatmentPlan: string;
}

export interface NoteVersion {
  amendedAt?: string;
  amendmentReason?: string;
  id: string;
  sections: NoteSections;
  signedAt?: string;
  signedBy?: string;
  status: ClinicalNoteStatus;
  version: number;
}

export interface ClinicalNote {
  currentVersion: NoteVersion;
  id: string;
  versions: NoteVersion[];
}

export interface PrescriptionItem {
  duration: string;
  frequency: string;
  id: string;
  medicine: string;
  notes: string;
}

export interface Prescription {
  id: string;
  items: PrescriptionItem[];
  signedAt?: string;
  signedBy?: string;
  status: PrescriptionStatus;
}

export interface EncounterSummary {
  appointmentId: string;
  chair: string;
  id: string;
  note: ClinicalNote;
  patientId: string;
  prescription: Prescription;
  providerName: string;
  scheduledAt: string;
  status: EncounterStatus;
}

export interface PatientProfile {
  appointment: {
    id: string;
    providerName: string;
    scheduledAt: string;
    status: "checked_in" | "confirmed" | "in_consult";
    visitType: string;
  };
  consents: ConsentRecord[];
  displayName: string;
  id: string;
  intake: IntakeResponse;
  kind: PatientKind;
  phone: string;
  prep: PrepSummary;
  riskFlags: string[];
  timeline: TimelineItem[];
}

export interface Cp3WorkflowData {
  api?: {
    environment?: string;
    requestIds: string[];
  };
  encounters: EncounterSummary[];
  patients: PatientProfile[];
  source: Cp3WorkflowSource;
  today: string;
}

export type Cp3WorkflowProblemCode =
  | "AUTH_REQUIRED"
  | "CONTRACT_MISMATCH"
  | "CP3_ENDPOINT_NOT_REGISTERED"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface Cp3EndpointIssue {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export interface Cp3WorkflowProblem {
  code: Cp3WorkflowProblemCode;
  detail?: string;
  endpoints: Cp3EndpointIssue[];
  message: string;
}

export type Cp3WorkflowLoadState =
  | { data: Cp3WorkflowData; status: "ready" }
  | { problem: Cp3WorkflowProblem; status: "unauthenticated" | "unavailable" };

export interface IntakeSubmitInput {
  actorName: string;
  actorRole: ClinicRole;
  fields: IntakeResponse["fields"];
  mode: IntakeMode;
  patientId: string;
  templateId?: string;
}

export interface ConsentCaptureInput {
  actorRole: ClinicRole;
  method: "assistant_entry" | "digital_signature";
  patientId: string;
  purpose: ConsentPurpose;
}

export interface ConsentRevokeInput {
  actorRole: ClinicRole;
  consentId?: string;
  patientId: string;
  purpose: ConsentPurpose;
  reason: string;
}

export interface NoteDraftInput {
  encounterId: string;
  sections: NoteSections;
}

export interface NoteSignInput {
  encounterId: string;
  roles: ClinicRole[];
  signerName: string;
}

export interface NoteAmendInput {
  amendmentReason: string;
  encounterId: string;
  roles: ClinicRole[];
  sections: NoteSections;
  signerName: string;
}

export interface PrescriptionDraftInput {
  encounterId: string;
  items: PrescriptionItem[];
}

export interface PrescriptionSignInput {
  encounterId: string;
  prescriptionId: string;
  roles: ClinicRole[];
  signerName: string;
}

interface EndpointResponse {
  endpoint: string;
  payload: unknown;
  requestId?: string;
  status: number;
}

interface EndpointFailure {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export const CP3_REQUIRED_ENDPOINTS = [
  "GET /v1/clinical-workflows/cp3?date=",
  "POST /v1/patients/{patientId}/form-responses",
  "POST /v1/patients/{patientId}/consents",
  "POST /v1/patients/{patientId}/consents/{consentId}/revoke",
  "GET /v1/patients/{patientId}/prep-summary",
  "POST /v1/encounters/{encounterId}/start",
  "PATCH /v1/encounters/{encounterId}",
  "POST /v1/encounters/{encounterId}/sign-note",
  "POST /v1/encounters/{encounterId}/amend-note",
  "POST /v1/encounters/{encounterId}/prescriptions",
  "POST /v1/prescriptions/{prescriptionId}/sign"
] as const;

export const CONSENT_LABELS: Record<ConsentPurpose, string> = {
  ai_audio_capture: "AI/audio capture",
  photo_capture: "Photo capture",
  treatment_registration: "Treatment registration",
  whatsapp_communication: "WhatsApp communication"
};

export const ENCOUNTER_STATUS_LABELS: Record<EncounterStatus, string> = {
  amended: "Amended",
  checked_in: "Checked in",
  drafting: "Drafting",
  encounter_started: "Started",
  ready_for_sign: "Ready for sign",
  scheduled: "Scheduled",
  signed: "Signed"
};

const FIXTURE_ENVIRONMENTS = new Set(["development", "dev", "local", "test"]);
const CONSENT_PURPOSES: ConsentPurpose[] = [
  "treatment_registration",
  "photo_capture",
  "whatsapp_communication",
  "ai_audio_capture"
];

let fixtureIdCounter = 0;

export function getTodayInputValue(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isCp3FixtureAllowed() {
  const fixtureRequested = process.env.NEXT_PUBLIC_CLINIC_OS_USE_CP3_WORKFLOW_FIXTURE === "true";
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;

  return fixtureRequested && FIXTURE_ENVIRONMENTS.has(environment);
}

export function canSignClinicalArtifacts(roles: ClinicRole[]) {
  return roles.includes("doctor");
}

export function getConsent(
  patient: PatientProfile,
  purpose: ConsentPurpose
): ConsentRecord | null {
  return patient.consents.find((consent) => consent.purpose === purpose) ?? null;
}

export function summarizeAiAudioReadiness(patient: PatientProfile) {
  const consent = getConsent(patient, "ai_audio_capture");

  if (!consent || consent.status === "not_recorded") {
    return {
      allowed: false,
      label: "Blocked",
      reason: "AI/audio consent is not recorded."
    };
  }

  if (consent.status === "revoked") {
    return {
      allowed: false,
      label: "Revoked",
      reason: consent.revokedReason ?? "AI/audio consent was revoked."
    };
  }

  return {
    allowed: true,
    label: "Consent recorded",
    reason: "Future AI/audio controls may check this readiness state."
  };
}

export function assertCanSign(roles: ClinicRole[]) {
  if (!canSignClinicalArtifacts(roles)) {
    throw new Error("Doctor role is required for clinical sign-off.");
  }
}

export function createFixtureCp3WorkflowData(today = getTodayInputValue()): Cp3WorkflowData {
  const returningPatientId = "returningClinicalPatient";
  const newPatientId = "newClinicalPatient";
  const returningEncounterId = "returningClinicalEncounter";
  const newEncounterId = "newClinicalEncounter";

  const returningPatient: PatientProfile = {
    appointment: {
      id: "returningClinicalAppointment",
      providerName: "Dr Synthetic Rao",
      scheduledAt: `${today}T04:30:00.000Z`,
      status: "checked_in",
      visitType: "Review consultation"
    },
    consents: createConsentSet({
      ai_audio_capture: "granted",
      photo_capture: "granted",
      treatment_registration: "granted",
      whatsapp_communication: "granted"
    }),
    displayName: "Riya Synthetic",
    id: returningPatientId,
    intake: {
      completedAt: `${today}T03:55:00.000Z`,
      fields: {
        allergies: "No known synthetic allergies",
        chiefComplaint: "Returning review for sensitivity noted in fixture history",
        currentMedications: "None recorded in synthetic fixture",
        medicalConditions: "No changes reported"
      },
      id: "returningIntake",
      mode: "assistant_paper_card",
      provenance: {
        actorRole: "assistant",
        capturedBy: "assistant fixture user"
      },
      templateId: "returningMedicalHistoryTemplate",
      status: "completed"
    },
    kind: "returning",
    phone: "+919900001001",
    prep: {
      medicalHistoryChanges: ["No new medical history changes in today's intake"],
      openTreatmentPlans: ["Synthetic restoration plan awaiting doctor review"],
      pendingDues: "No pending dues in synthetic fixture",
      pendingLabCases: ["No active lab case for today"],
      priorMedia: ["Prior radiograph reference is listed; CP4 owns media viewing"],
      priorVisits: ["2026-01-08: synthetic consultation note signed"],
      recallContext: "Six-month recall due next cycle",
      visitReason: "Sensitivity review"
    },
    riskFlags: ["Returning patient", "Prior note available"],
    timeline: [
      timelineItem(
        "patient.created",
        "Patient shell created",
        "Synthetic returning patient created from CP2 source attribution.",
        "2026-01-08T03:40:00.000Z"
      ),
      timelineItem(
        "visit.completed",
        "Prior visit completed",
        "Synthetic signed note available for prep review.",
        "2026-01-08T05:30:00.000Z"
      ),
      timelineItem(
        "form_response.submitted",
        "Intake completed",
        "Assistant-entered paper history card captured for today's visit.",
        `${today}T03:55:00.000Z`
      )
    ]
  };

  const newPatient: PatientProfile = {
    appointment: {
      id: "newClinicalAppointment",
      providerName: "Dr Synthetic Rao",
      scheduledAt: `${today}T05:15:00.000Z`,
      status: "checked_in",
      visitType: "New patient consultation"
    },
    consents: createConsentSet({
      ai_audio_capture: "not_recorded",
      photo_capture: "not_recorded",
      treatment_registration: "not_recorded",
      whatsapp_communication: "not_recorded"
    }),
    displayName: "Ira Synthetic",
    id: newPatientId,
    intake: {
      fields: {
        allergies: "",
        chiefComplaint: "Synthetic new patient concern entered for local testing",
        currentMedications: "",
        medicalConditions: ""
      },
      id: "newPatientIntake",
      mode: "digital",
      templateId: "newPatientIntakeTemplate",
      status: "not_started"
    },
    kind: "new",
    phone: "+919900001002",
    prep: {
      medicalHistoryChanges: ["New patient intake pending"],
      openTreatmentPlans: ["No treatment plan exists before encounter"],
      pendingDues: "No ledger history for synthetic new patient",
      pendingLabCases: ["No lab case exists before encounter"],
      priorMedia: ["No prior media in ClinicOS"],
      priorVisits: ["No prior visit in ClinicOS"],
      recallContext: "No recall context yet",
      visitReason: "New patient consultation"
    },
    riskFlags: ["New patient", "Consent pending"],
    timeline: [
      timelineItem(
        "patient.created",
        "Patient shell created",
        "Synthetic new patient shell created from CP2 local flow.",
        `${today}T03:24:00.000Z`
      )
    ]
  };

  return {
    api: {
      environment: "local synthetic CP3 fixture",
      requestIds: ["fixture-cp3-workflow"]
    },
    encounters: [
      createFixtureEncounter({
        appointmentId: returningPatient.appointment.id,
        encounterId: returningEncounterId,
        patientId: returningPatientId,
        scheduledAt: returningPatient.appointment.scheduledAt,
        status: "checked_in"
      }),
      createFixtureEncounter({
        appointmentId: newPatient.appointment.id,
        encounterId: newEncounterId,
        patientId: newPatientId,
        scheduledAt: newPatient.appointment.scheduledAt,
        status: "checked_in"
      })
    ],
    patients: [newPatient, returningPatient],
    source: "cp3_fixture",
    today
  };
}

export async function loadCp3Workflow(
  signal?: AbortSignal,
  today = getTodayInputValue()
): Promise<Cp3WorkflowLoadState> {
  if (isCp3FixtureAllowed()) {
    return {
      data: createFixtureCp3WorkflowData(today),
      status: "ready"
    };
  }

  try {
    const workflow = await fetchEndpoint("/v1/clinical-workflows/cp3", { date: today }, signal);
    const normalized = normalizeCp3WorkflowPayload(workflow.payload, today, workflow.requestId);

    if ("code" in normalized) {
      return {
        problem: normalized,
        status: "unavailable"
      };
    }

    return {
      data: normalized,
      status: "ready"
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    if (isEndpointFailure(error)) {
      const problem = classifyCp3EndpointFailures([error]);

      return {
        problem,
        status: problem.code === "AUTH_REQUIRED" ? "unauthenticated" : "unavailable"
      };
    }

    return {
      problem: {
        code: "NETWORK_UNAVAILABLE",
        detail: error instanceof Error ? error.message : undefined,
        endpoints: CP3_REQUIRED_ENDPOINTS.map((endpoint) => ({
          endpoint,
          message: "The endpoint could not be reached from the web app."
        })),
        message: "The CP3 workflow API could not be reached."
      },
      status: "unavailable"
    };
  }
}

export async function submitLiveIntake(input: IntakeSubmitInput, signal?: AbortSignal) {
  if (!input.templateId) {
    throw new Error("Live intake submission requires a templateId from the CP3 workflow loader.");
  }

  return postEndpoint(
    `/v1/patients/${encodeURIComponent(input.patientId)}/form-responses`,
    {
      templateId: input.templateId,
      source: input.mode,
      responses: input.fields,
      medicalHistorySnapshot: {
        allergies: input.fields.allergies,
        currentMedications: input.fields.currentMedications,
        medicalConditions: input.fields.medicalConditions
      },
      provenance: {
        kind: input.mode === "assistant_paper_card" ? "manual_entry" : "patient_message",
        capturedBy: input.actorName,
        actorRole: input.actorRole
      }
    },
    signal
  );
}

export async function captureLiveConsent(input: ConsentCaptureInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/patients/${encodeURIComponent(input.patientId)}/consents`,
    {
      purpose: input.purpose,
      templateCode: `${input.purpose}-v1`,
      templateVersion: 1,
      captureMethod: input.method === "digital_signature" ? "digital_patient" : "clinic_staff",
      provenance: { kind: "manual_entry", actorRole: input.actorRole }
    },
    signal
  );
}

export async function revokeLiveConsent(input: ConsentRevokeInput, signal?: AbortSignal) {
  if (!input.consentId) {
    throw new Error("Live consent revocation requires a consentId from the CP3 workflow loader.");
  }

  return postEndpoint(
    `/v1/patients/${encodeURIComponent(input.patientId)}/consents/${input.consentId}/revoke`,
    { reason: input.reason },
    signal
  );
}

export async function startLiveEncounter(encounterId: string, signal?: AbortSignal) {
  return postEndpoint(`/v1/encounters/${encodeURIComponent(encounterId)}/start`, {}, signal);
}

export async function saveLiveNoteDraft(input: NoteDraftInput, signal?: AbortSignal) {
  return patchEndpoint(
    `/v1/encounters/${encodeURIComponent(input.encounterId)}`,
    { content: input.sections, readyForSign: true },
    signal
  );
}

export async function signLiveNote(input: NoteSignInput, signal?: AbortSignal) {
  assertCanSign(input.roles);

  return postEndpoint(
    `/v1/encounters/${encodeURIComponent(input.encounterId)}/sign-note`,
    { signerName: input.signerName },
    signal
  );
}

export async function amendLiveNote(input: NoteAmendInput, signal?: AbortSignal) {
  assertCanSign(input.roles);

  return postEndpoint(
    `/v1/encounters/${encodeURIComponent(input.encounterId)}/amend-note`,
    {
      amendmentReason: input.amendmentReason,
      content: input.sections,
      signerName: input.signerName
    },
    signal
  );
}

export async function saveLivePrescriptionDraft(
  input: PrescriptionDraftInput,
  signal?: AbortSignal
) {
  return postEndpoint(
    `/v1/encounters/${encodeURIComponent(input.encounterId)}/prescriptions`,
    {
      medications: input.items.map((item) => ({
        name: item.medicine,
        frequency: item.frequency,
        duration: item.duration,
        instructions: item.notes
      }))
    },
    signal
  );
}

export async function signLivePrescription(input: PrescriptionSignInput, signal?: AbortSignal) {
  assertCanSign(input.roles);

  return postEndpoint(
    `/v1/prescriptions/${encodeURIComponent(input.prescriptionId)}/sign`,
    { signerName: input.signerName },
    signal
  );
}

export function applyFixtureSubmitIntake(data: Cp3WorkflowData, input: IntakeSubmitInput) {
  const completedAt = new Date().toISOString();

  return updatePatient(data, input.patientId, (patient) => ({
    ...patient,
    intake: {
      ...patient.intake,
      completedAt,
      fields: input.fields,
      mode: input.mode,
      provenance: {
        actorRole: input.actorRole,
        capturedBy: input.actorName
      },
      status: "completed"
    },
    timeline: prependTimeline(
      patient.timeline,
      "form_response.submitted",
      "Intake completed",
      input.mode === "digital"
        ? "Digital intake response submitted."
        : "Assistant-entered paper card response submitted.",
      completedAt
    )
  }));
}

export function applyFixtureCaptureConsent(data: Cp3WorkflowData, input: ConsentCaptureInput) {
  const capturedAt = new Date().toISOString();

  return updatePatient(data, input.patientId, (patient) => ({
    ...patient,
    consents: upsertConsent(patient.consents, {
      capturedAt,
      id: `fixture-consent-${input.purpose}`,
      provenance: {
        actorRole: input.actorRole,
        method: input.method
      },
      purpose: input.purpose,
      status: "granted"
    }),
    timeline: prependTimeline(
      patient.timeline,
      "consent.created",
      `${CONSENT_LABELS[input.purpose]} consent recorded`,
      "Consent status is available for downstream enforcement.",
      capturedAt
    )
  }));
}

export function applyFixtureRevokeConsent(data: Cp3WorkflowData, input: ConsentRevokeInput) {
  const revokedAt = new Date().toISOString();

  return updatePatient(data, input.patientId, (patient) => ({
    ...patient,
    consents: upsertConsent(patient.consents, {
      ...(getConsent(patient, input.purpose) ?? {
        id: `fixture-consent-${input.purpose}`,
        purpose: input.purpose
      }),
      provenance: {
        actorRole: input.actorRole,
        method: "assistant_entry"
      },
      revokedAt,
      revokedReason: input.reason.trim() || "Revoked in local CP3 fixture",
      status: "revoked"
    }),
    timeline: prependTimeline(
      patient.timeline,
      "consent.revoked",
      `${CONSENT_LABELS[input.purpose]} consent revoked`,
      input.reason.trim() || "Consent revoked in local CP3 fixture.",
      revokedAt
    )
  }));
}

export function applyFixtureStartEncounter(data: Cp3WorkflowData, encounterId: string) {
  const startedAt = new Date().toISOString();
  const encounter = data.encounters.find((item) => item.id === encounterId);

  if (!encounter) {
    return data;
  }

  return updateEncounter(
    updatePatient(data, encounter.patientId, (patient) => ({
      ...patient,
      appointment: {
        ...patient.appointment,
        status: "in_consult"
      },
      timeline: prependTimeline(
        patient.timeline,
        "encounter.started",
        "Encounter started",
        "Clinical encounter moved from check-in to in-consult state.",
        startedAt
      )
    })),
    encounterId,
    (item) => ({
      ...item,
      status: "encounter_started"
    })
  );
}

export function applyFixtureSaveNoteDraft(data: Cp3WorkflowData, input: NoteDraftInput) {
  const encounter = data.encounters.find((item) => item.id === input.encounterId);

  if (!encounter || isSignedNote(encounter.note)) {
    throw new Error("Signed clinical notes cannot be overwritten.");
  }

  const draftedAt = new Date().toISOString();
  const nextVersion: NoteVersion = {
    ...encounter.note.currentVersion,
    sections: input.sections,
    status: "ready_for_sign"
  };

  return updateEncounter(
    updatePatient(data, encounter.patientId, (patient) => ({
      ...patient,
      timeline: prependTimeline(
        patient.timeline,
        "clinical_note.draft_created",
        "Clinical note draft ready",
        "Draft sections saved for doctor sign-off.",
        draftedAt
      )
    })),
    input.encounterId,
    (item) => ({
      ...item,
      note: {
        ...item.note,
        currentVersion: nextVersion,
        versions: [nextVersion]
      },
      status: "ready_for_sign"
    })
  );
}

export function applyFixtureSignNote(data: Cp3WorkflowData, input: NoteSignInput) {
  assertCanSign(input.roles);

  const encounter = data.encounters.find((item) => item.id === input.encounterId);

  if (!encounter) {
    return data;
  }

  if (encounter.note.currentVersion.status === "signed") {
    return data;
  }

  const signedAt = new Date().toISOString();
  const signedVersion: NoteVersion = {
    ...encounter.note.currentVersion,
    signedAt,
    signedBy: input.signerName,
    status: "signed"
  };

  return updateEncounter(
    updatePatient(data, encounter.patientId, (patient) => ({
      ...patient,
      timeline: prependTimeline(
        patient.timeline,
        "clinical_note.signed",
        "Clinical note signed",
        `Signed by ${input.signerName}.`,
        signedAt
      )
    })),
    input.encounterId,
    (item) => ({
      ...item,
      note: {
        ...item.note,
        currentVersion: signedVersion,
        versions: [signedVersion]
      },
      status: "signed"
    })
  );
}

export function applyFixtureAmendNote(data: Cp3WorkflowData, input: NoteAmendInput) {
  assertCanSign(input.roles);

  const encounter = data.encounters.find((item) => item.id === input.encounterId);

  if (!encounter || !isSignedNote(encounter.note)) {
    throw new Error("A signed clinical note is required before amendment.");
  }

  const amendedAt = new Date().toISOString();
  const current = encounter.note.currentVersion;
  const amendment: NoteVersion = {
    amendedAt,
    amendmentReason: input.amendmentReason,
    id: nextFixtureId("note-version"),
    sections: input.sections,
    signedAt: amendedAt,
    signedBy: input.signerName,
    status: "amended",
    version: current.version + 1
  };

  return updateEncounter(
    updatePatient(data, encounter.patientId, (patient) => ({
      ...patient,
      timeline: prependTimeline(
        patient.timeline,
        "clinical_note.amended",
        "Clinical note amended",
        input.amendmentReason,
        amendedAt
      )
    })),
    input.encounterId,
    (item) => ({
      ...item,
      note: {
        ...item.note,
        currentVersion: amendment,
        versions: [...item.note.versions, amendment]
      },
      status: "amended"
    })
  );
}

export function applyFixtureSavePrescriptionDraft(
  data: Cp3WorkflowData,
  input: PrescriptionDraftInput
) {
  const encounter = data.encounters.find((item) => item.id === input.encounterId);

  if (!encounter) {
    return data;
  }

  if (encounter.prescription.status === "signed") {
    throw new Error("Signed prescriptions cannot be overwritten.");
  }

  return updateEncounter(data, input.encounterId, (item) => ({
    ...item,
    prescription: {
      ...item.prescription,
      items: input.items,
      status: "draft"
    }
  }));
}

export function applyFixtureSignPrescription(data: Cp3WorkflowData, input: PrescriptionSignInput) {
  assertCanSign(input.roles);

  const encounter = data.encounters.find((item) => item.id === input.encounterId);

  if (!encounter) {
    return data;
  }

  const signedAt = new Date().toISOString();

  return updateEncounter(
    updatePatient(data, encounter.patientId, (patient) => ({
      ...patient,
      timeline: prependTimeline(
        patient.timeline,
        "prescription.signed",
        "Prescription signed",
        `Prescription signed by ${input.signerName}.`,
        signedAt
      )
    })),
    input.encounterId,
    (item) => ({
      ...item,
      prescription: {
        ...item.prescription,
        signedAt,
        signedBy: input.signerName,
        status: "signed"
      }
    })
  );
}

export function classifyCp3EndpointFailures(failures: Cp3EndpointIssue[]): Cp3WorkflowProblem {
  const hasAuthFailure = failures.some(
    (failure) => failure.status === 401 || failure.status === 403
  );
  const hasMissingEndpoint = failures.some((failure) => failure.status === 404);
  const hasServerFailure = failures.some((failure) => failure.status && failure.status >= 500);

  if (hasAuthFailure) {
    return {
      code: "AUTH_REQUIRED",
      endpoints: failures,
      message: "Sign in through the configured identity provider before opening CP3 workflows."
    };
  }

  if (hasMissingEndpoint) {
    return {
      code: "CP3_ENDPOINT_NOT_REGISTERED",
      endpoints: failures,
      message: "One or more CP3 workflow endpoints are not registered in this environment."
    };
  }

  if (hasServerFailure) {
    return {
      code: "SERVER_ERROR",
      endpoints: failures,
      message: "The ClinicOS API is reachable but could not load the CP3 workflow."
    };
  }

  return {
    code: "UNKNOWN",
    endpoints: failures,
    message: "The CP3 workflow API returned an unexpected response."
  };
}

function createFixtureEncounter({
  appointmentId,
  encounterId,
  patientId,
  scheduledAt,
  status
}: {
  appointmentId: string;
  encounterId: string;
  patientId: string;
  scheduledAt: string;
  status: EncounterStatus;
}): EncounterSummary {
  const noteVersion: NoteVersion = {
    id: `${encounterId}-note-v1`,
    sections: emptyNoteSections(),
    status: "draft",
    version: 1
  };

  return {
    appointmentId,
    chair: "Chair 1",
    id: encounterId,
    note: {
      currentVersion: noteVersion,
      id: `${encounterId}-note`,
      versions: [noteVersion]
    },
    patientId,
    prescription: {
      id: `${encounterId}-prescription`,
      items: [
        {
          duration: "3 days",
          frequency: "Twice daily",
          id: `${encounterId}-prescription-item-1`,
          medicine: "Synthetic medication entry",
          notes: "Synthetic local fixture only"
        }
      ],
      status: "draft"
    },
    providerName: "Dr Synthetic Rao",
    scheduledAt,
    status
  };
}

function createConsentSet(statuses: Record<ConsentPurpose, ConsentStatus>): ConsentRecord[] {
  return CONSENT_PURPOSES.map((purpose) => ({
    capturedAt: statuses[purpose] === "granted" ? "2026-07-07T03:50:00.000Z" : undefined,
    id: `fixture-consent-${purpose}`,
    provenance:
      statuses[purpose] === "granted"
        ? {
            actorRole: "assistant",
            method: "assistant_entry"
          }
        : undefined,
    purpose,
    status: statuses[purpose]
  }));
}

function emptyNoteSections(): NoteSections {
  return {
    diagnosis: "",
    examination: "",
    history: "",
    investigations: "",
    treatmentPerformed: "",
    treatmentPlan: ""
  };
}

function isSignedNote(note: ClinicalNote) {
  return note.currentVersion.status === "signed" || note.currentVersion.status === "amended";
}

function timelineItem(
  kind: TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
): TimelineItem {
  return {
    at,
    detail,
    id: `${kind}-${at}`,
    kind,
    title
  };
}

function prependTimeline(
  items: TimelineItem[],
  kind: TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
) {
  return [timelineItem(kind, title, detail, at), ...items].sort(
    (first, second) => Date.parse(second.at) - Date.parse(first.at)
  );
}

function upsertConsent(consents: ConsentRecord[], nextConsent: ConsentRecord) {
  const next = consents.filter((consent) => consent.purpose !== nextConsent.purpose);

  return [...next, nextConsent].sort(
    (first, second) => CONSENT_PURPOSES.indexOf(first.purpose) - CONSENT_PURPOSES.indexOf(second.purpose)
  );
}

function updatePatient(
  data: Cp3WorkflowData,
  patientId: string,
  updater: (patient: PatientProfile) => PatientProfile
): Cp3WorkflowData {
  return {
    ...data,
    patients: data.patients.map((patient) => (patient.id === patientId ? updater(patient) : patient))
  };
}

function updateEncounter(
  data: Cp3WorkflowData,
  encounterId: string,
  updater: (encounter: EncounterSummary) => EncounterSummary
): Cp3WorkflowData {
  return {
    ...data,
    encounters: data.encounters.map((encounter) =>
      encounter.id === encounterId ? updater(encounter) : encounter
    )
  };
}

function nextFixtureId(prefix: string) {
  fixtureIdCounter += 1;

  return `${prefix}-${fixtureIdCounter}`;
}

function normalizeCp3WorkflowPayload(
  payload: unknown,
  today: string,
  requestId?: string
): Cp3WorkflowData | Cp3WorkflowProblem {
  if (!isRecord(payload)) {
    return {
      code: "CONTRACT_MISMATCH",
      endpoints: CP3_REQUIRED_ENDPOINTS.map((endpoint) => ({
        endpoint,
        message: "The endpoint returned a non-object payload."
      })),
      message: "The CP3 workflow endpoint is reachable but does not match the expected contract."
    };
  }

  const patients = Array.isArray(payload.patients) ? payload.patients : null;
  const encounters = Array.isArray(payload.encounters) ? payload.encounters : null;

  if (!patients || !encounters) {
    return {
      code: "CONTRACT_MISMATCH",
      detail: "Expected patients[] and encounters[] in the CP3 workflow payload.",
      endpoints: CP3_REQUIRED_ENDPOINTS.map((endpoint) => ({
        endpoint,
        message: "Contract mismatch"
      })),
      message: "The CP3 workflow endpoint is reachable but missing required workflow data."
    };
  }

  return {
    api: {
      environment: "api",
      requestIds: requestId ? [requestId] : []
    },
    encounters: encounters.filter(isEncounterSummary),
    patients: patients.filter(isPatientProfile),
    source: "api",
    today
  };
}

function getWorkflowApiBaseUrl() {
  return process.env.NEXT_PUBLIC_CLINIC_OS_API_BASE_URL ?? "";
}

function buildWorkflowUrl(path: string, params?: Record<string, string>) {
  const baseUrl = getWorkflowApiBaseUrl().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`, getBrowserOrigin());

  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function getBrowserOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost";
}

async function fetchEndpoint(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<EndpointResponse> {
  const response = await fetch(buildWorkflowUrl(path, params), {
    credentials: "include",
    headers: {
      Accept: "application/json"
    },
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse(path, response, payload);
  }

  return {
    endpoint: `GET ${path}`,
    payload,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

async function postEndpoint(path: string, body: unknown, signal?: AbortSignal) {
  return writeEndpoint("POST", path, body, signal);
}

async function patchEndpoint(path: string, body: unknown, signal?: AbortSignal) {
  return writeEndpoint("PATCH", path, body, signal);
}

async function writeEndpoint(
  method: "PATCH" | "POST",
  path: string,
  body: unknown,
  signal?: AbortSignal
) {
  const response = await fetch(buildWorkflowUrl(path), {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": `web-cp3-${crypto.randomUUID()}`
    },
    method,
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse(path, response, payload);
  }

  return payload;
}

async function parseJsonSafely(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json() as Promise<unknown>;
}

function endpointFailureFromResponse(
  path: string,
  response: Response,
  payload: unknown
): EndpointFailure {
  return {
    endpoint: `${response.status === 0 ? "FETCH" : "HTTP"} ${path}`,
    message: readErrorMessage(payload) ?? `HTTP ${response.status}`,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

function getRequestId(response: Response, payload: unknown) {
  if (isRecord(payload)) {
    const topLevel = readString(payload, [
      "request_id",
      "requestId",
      "correlation_id",
      "correlationId"
    ]);
    const error = isRecord(payload.error) ? payload.error : null;
    const nested = error
      ? readString(error, ["request_id", "requestId", "correlation_id", "correlationId"])
      : null;

    return topLevel ?? nested ?? response.headers.get("x-request-id") ?? undefined;
  }

  return response.headers.get("x-request-id") ?? undefined;
}

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const error = payload.error;

  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return null;
}

function isEndpointFailure(value: unknown): value is EndpointFailure {
  return typeof value === "object" && value !== null && "endpoint" in value && "message" in value;
}

function isPatientProfile(value: unknown): value is PatientProfile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    Array.isArray(value.consents) &&
    Array.isArray(value.timeline)
  );
}

function isEncounterSummary(value: unknown): value is EncounterSummary {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    isRecord(value.note) &&
    isRecord(value.prescription)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}
