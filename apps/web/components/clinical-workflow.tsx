"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  ClipboardPenLine,
  FilePenLine,
  FileSignature,
  Loader2,
  LockKeyhole,
  PlugZap,
  RefreshCw,
  Save,
  ShieldCheck,
  Stethoscope,
  UserRoundCheck,
  UsersRound
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  CONSENT_LABELS,
  CP3_REQUIRED_ENDPOINTS,
  ENCOUNTER_STATUS_LABELS,
  applyFixtureAmendNote,
  applyFixtureCaptureConsent,
  applyFixtureRevokeConsent,
  applyFixtureSaveNoteDraft,
  applyFixtureSavePrescriptionDraft,
  applyFixtureSignNote,
  applyFixtureSignPrescription,
  applyFixtureStartEncounter,
  applyFixtureSubmitIntake,
  amendLiveNote,
  canSignClinicalArtifacts,
  captureLiveConsent,
  loadCp3Workflow,
  revokeLiveConsent,
  saveLiveNoteDraft,
  saveLivePrescriptionDraft,
  signLiveNote,
  signLivePrescription,
  startLiveEncounter,
  submitLiveIntake,
  summarizeAiAudioReadiness,
  type ConsentPurpose,
  type Cp3WorkflowData,
  type Cp3WorkflowLoadState,
  type Cp3WorkflowProblem,
  type EncounterSummary,
  type IntakeMode,
  type IntakeSubmitInput,
  type NoteSections,
  type PatientProfile,
  type PrescriptionItem
} from "@/lib/cp3-workflow";
import type { MeProfile } from "@/lib/me";
import type { ClinicRole } from "@/lib/roles";
import { ROLE_LABELS } from "@/lib/roles";

interface ClinicalWorkflowProps {
  activeSurfaceId: string;
  profile: MeProfile;
  setActiveSurfaceId: (surfaceId: string) => void;
}

type LoadState = Cp3WorkflowLoadState | { status: "loading" };

type ActionMessage = {
  tone: "error" | "info" | "success";
  text: string;
};

type ClinicalMode = "consent" | "encounter" | "intake" | "prep" | "profile";

const WORKFLOW_MODES: Array<{
  icon: LucideIcon;
  label: string;
  mode: ClinicalMode;
  surfaceId: string;
}> = [
  { icon: UsersRound, label: "Profile", mode: "profile", surfaceId: "patient-profile" },
  { icon: ClipboardPenLine, label: "Intake", mode: "intake", surfaceId: "intake" },
  { icon: ShieldCheck, label: "Consent", mode: "consent", surfaceId: "consent" },
  { icon: UserRoundCheck, label: "Prep", mode: "prep", surfaceId: "returning-prep" },
  { icon: Stethoscope, label: "Encounter", mode: "encounter", surfaceId: "encounter" }
];

const SURFACE_TO_MODE = new Map(WORKFLOW_MODES.map((item) => [item.surfaceId, item.mode]));
const cp3WorkflowSurfaceIds = new Set(WORKFLOW_MODES.map((item) => item.surfaceId));

const CONSENT_PURPOSES: ConsentPurpose[] = [
  "treatment_registration",
  "photo_capture",
  "whatsapp_communication",
  "ai_audio_capture"
];

const NOTE_SECTION_LABELS: Record<keyof NoteSections, string> = {
  diagnosis: "Diagnosis",
  examination: "Examination",
  history: "History",
  investigations: "Investigations",
  treatmentPerformed: "Treatment performed",
  treatmentPlan: "Treatment plan"
};

const NOTE_SECTION_KEYS = Object.keys(NOTE_SECTION_LABELS) as Array<keyof NoteSections>;

export function isCp3WorkflowSurface(surfaceId: string) {
  return cp3WorkflowSurfaceIds.has(surfaceId);
}

export function ClinicalWorkflow({
  activeSurfaceId,
  profile,
  setActiveSurfaceId
}: ClinicalWorkflowProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const [intakeMode, setIntakeMode] = useState<IntakeMode>("digital");
  const [intakeFields, setIntakeFields] = useState<IntakeSubmitInput["fields"]>({
    allergies: "",
    chiefComplaint: "",
    currentMedications: "",
    medicalConditions: ""
  });
  const [revokeReason, setRevokeReason] = useState("Patient withdrew consent for future capture.");
  const [noteSections, setNoteSections] = useState<NoteSections>(emptyNoteSections());
  const [amendmentReason, setAmendmentReason] = useState("");
  const [amendmentSections, setAmendmentSections] = useState<NoteSections>(emptyNoteSections());
  const [prescriptionItems, setPrescriptionItems] = useState<PrescriptionItem[]>([
    emptyPrescriptionItem()
  ]);

  const mode = SURFACE_TO_MODE.get(activeSurfaceId) ?? "encounter";
  const canSign = canSignClinicalArtifacts(profile.roles);
  const actorRole = getClinicalActorRole(profile.roles);

  const reloadWorkflow = () => {
    const controller = new AbortController();

    setLoadState({ status: "loading" });
    void loadCp3Workflow(controller.signal).then(setLoadState);

    return controller;
  };

  useEffect(() => {
    const controller = reloadWorkflow();

    return () => controller.abort();
  }, []);

  const data = loadState.status === "ready" ? loadState.data : null;
  const selectedPatient = useMemo(() => {
    if (!data) {
      return null;
    }

    return data.patients.find((patient) => patient.id === selectedPatientId) ?? data.patients[0]!;
  }, [data, selectedPatientId]);
  const selectedEncounter = useMemo(() => {
    if (!data || !selectedPatient) {
      return null;
    }

    return data.encounters.find((encounter) => encounter.patientId === selectedPatient.id) ?? null;
  }, [data, selectedPatient]);

  useEffect(() => {
    if (!selectedPatientId && selectedPatient) {
      setSelectedPatientId(selectedPatient.id);
    }
  }, [selectedPatient, selectedPatientId]);

  useEffect(() => {
    if (!selectedPatient) {
      return;
    }

    setIntakeMode(selectedPatient.intake.mode);
    setIntakeFields(selectedPatient.intake.fields);
  }, [selectedPatient]);

  useEffect(() => {
    if (!selectedEncounter) {
      return;
    }

    setNoteSections(selectedEncounter.note.currentVersion.sections);
    setAmendmentSections(selectedEncounter.note.currentVersion.sections);
    setPrescriptionItems(
      selectedEncounter.prescription.items.length > 0
        ? selectedEncounter.prescription.items
        : [emptyPrescriptionItem()]
    );
  }, [selectedEncounter]);

  const setReadyData = (nextData: Cp3WorkflowData) => {
    setLoadState({
      data: nextData,
      status: "ready"
    });
  };

  const handleActionError = (error: unknown, fallback: string) => {
    setActionMessage({
      text: formatActionError(error, fallback),
      tone: "error"
    });
  };

  const handleSubmitIntake = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data || !selectedPatient) {
      return;
    }

    if (!intakeFields.chiefComplaint.trim()) {
      setActionMessage({
        text: "Chief complaint is required before intake can be completed.",
        tone: "error"
      });
      return;
    }

    setActionBusy("submit-intake");

    try {
      const input: IntakeSubmitInput = {
        actorName: profile.user.displayName,
        actorRole,
        fields: intakeFields,
        mode: intakeMode,
        patientId: selectedPatient.id,
        templateId: selectedPatient.intake.templateId
      };

      if (data.source === "cp3_fixture") {
        setReadyData(applyFixtureSubmitIntake(data, input));
        setActionMessage({ text: "Synthetic intake response completed.", tone: "success" });
      } else {
        await submitLiveIntake(input);
        reloadWorkflow();
        setActionMessage({
          text: "Intake response submitted to the CP3 API boundary.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Intake submission failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCaptureConsent = async (purpose: ConsentPurpose) => {
    if (!data || !selectedPatient) {
      return;
    }

    setActionBusy(`capture-${purpose}`);

    try {
      const input = {
        actorRole,
        method: "assistant_entry" as const,
        patientId: selectedPatient.id,
        purpose
      };

      if (data.source === "cp3_fixture") {
        setReadyData(applyFixtureCaptureConsent(data, input));
        setActionMessage({
          text: `${CONSENT_LABELS[purpose]} consent recorded in synthetic fixture mode.`,
          tone: "success"
        });
      } else {
        await captureLiveConsent(input);
        reloadWorkflow();
        setActionMessage({
          text: `${CONSENT_LABELS[purpose]} consent submitted to the CP3 API boundary.`,
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Consent capture failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleRevokeConsent = async (purpose: ConsentPurpose) => {
    if (!data || !selectedPatient) {
      return;
    }

    setActionBusy(`revoke-${purpose}`);

    try {
      const consent = selectedPatient.consents.find((item) => item.purpose === purpose);
      const input = {
        actorRole,
        consentId: consent?.id,
        patientId: selectedPatient.id,
        purpose,
        reason: revokeReason
      };

      if (data.source === "cp3_fixture") {
        setReadyData(applyFixtureRevokeConsent(data, input));
        setActionMessage({
          text: `${CONSENT_LABELS[purpose]} consent revoked.`,
          tone: "success"
        });
      } else {
        await revokeLiveConsent(input);
        reloadWorkflow();
        setActionMessage({
          text: `${CONSENT_LABELS[purpose]} consent revocation sent to the CP3 API boundary.`,
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Consent revocation failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleStartEncounter = async () => {
    if (!data || !selectedEncounter) {
      return;
    }

    setActionBusy("start-encounter");

    try {
      if (data.source === "cp3_fixture") {
        setReadyData(applyFixtureStartEncounter(data, selectedEncounter.id));
        setActionMessage({ text: "Synthetic encounter started.", tone: "success" });
      } else {
        await startLiveEncounter(selectedEncounter.id);
        reloadWorkflow();
        setActionMessage({ text: "Encounter start sent to the CP3 API boundary.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Encounter start failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleSaveNoteDraft = async () => {
    if (!data || !selectedEncounter) {
      return;
    }

    setActionBusy("save-note");

    try {
      const input = {
        encounterId: selectedEncounter.id,
        sections: noteSections
      };

      if (data.source === "cp3_fixture") {
        setReadyData(applyFixtureSaveNoteDraft(data, input));
        setActionMessage({
          text: "Synthetic clinical note draft marked ready for doctor sign-off.",
          tone: "success"
        });
      } else {
        await saveLiveNoteDraft(input);
        reloadWorkflow();
        setActionMessage({ text: "Clinical note draft saved through CP3 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Clinical note draft save failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleSignNote = async () => {
    if (!data || !selectedEncounter) {
      return;
    }

    setActionBusy("sign-note");

    try {
      const input = {
        encounterId: selectedEncounter.id,
        roles: profile.roles,
        signerName: profile.user.displayName
      };

      if (data.source === "cp3_fixture") {
        setReadyData(applyFixtureSignNote(data, input));
        setActionMessage({ text: "Clinical note signed in synthetic fixture mode.", tone: "success" });
      } else {
        await signLiveNote(input);
        reloadWorkflow();
        setActionMessage({ text: "Clinical note sign request sent to CP3 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Clinical note sign failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleAmendNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data || !selectedEncounter) {
      return;
    }

    if (!amendmentReason.trim()) {
      setActionMessage({
        text: "Amendment reason is required for signed note changes.",
        tone: "error"
      });
      return;
    }

    setActionBusy("amend-note");

    try {
      const input = {
        amendmentReason,
        encounterId: selectedEncounter.id,
        roles: profile.roles,
        sections: amendmentSections,
        signerName: profile.user.displayName
      };

      if (data.source === "cp3_fixture") {
        setReadyData(applyFixtureAmendNote(data, input));
        setAmendmentReason("");
        setActionMessage({ text: "Signed note amendment recorded.", tone: "success" });
      } else {
        await amendLiveNote(input);
        reloadWorkflow();
        setActionMessage({ text: "Note amendment sent to CP3 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Clinical note amendment failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleSavePrescriptionDraft = async () => {
    if (!data || !selectedEncounter) {
      return;
    }

    setActionBusy("save-prescription");

    try {
      const input = {
        encounterId: selectedEncounter.id,
        items: prescriptionItems
      };

      if (data.source === "cp3_fixture") {
        setReadyData(applyFixtureSavePrescriptionDraft(data, input));
        setActionMessage({ text: "Prescription draft saved.", tone: "success" });
      } else {
        await saveLivePrescriptionDraft(input);
        reloadWorkflow();
        setActionMessage({ text: "Prescription draft saved through CP3 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Prescription draft save failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleSignPrescription = async () => {
    if (!data || !selectedEncounter) {
      return;
    }

    setActionBusy("sign-prescription");

    try {
      const input = {
        encounterId: selectedEncounter.id,
        prescriptionId: selectedEncounter.prescription.id,
        roles: profile.roles,
        signerName: profile.user.displayName
      };

      if (data.source === "cp3_fixture") {
        setReadyData(applyFixtureSignPrescription(data, input));
        setActionMessage({ text: "Prescription signed in synthetic fixture mode.", tone: "success" });
      } else {
        await signLivePrescription(input);
        reloadWorkflow();
        setActionMessage({ text: "Prescription sign request sent to CP3 API.", tone: "success" });
      }
    } catch (error) {
      handleActionError(error, "Prescription sign failed.");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div data-testid="cp3-clinical-workspace">
      <div className="surface-stack cp3-workflow" data-testid="cp3-workflow">
        <section className="surface-hero surface-hero--clinical" aria-labelledby="cp3-title">
          <div>
            <p className="eyebrow">Clinical workflow</p>
            <h1 id="cp3-title">{selectedPatient?.displayName ?? profile.clinic.name}</h1>
            <p className="hero-subline">
              Intake, consent, prep, encounter notes, and prescription sign-off for{" "}
              {profile.roles.map((role) => ROLE_LABELS[role]).join(", ")}.
            </p>
          </div>
          <div className="hero-status" aria-label="Workflow API mode">
            <span
              className={
                data?.source === "cp3_fixture"
                  ? "status-dot status-dot--warn"
                  : "status-dot status-dot--ok"
              }
            />
            <span>{data?.source === "cp3_fixture" ? "Local fixture" : "Live boundary"}</span>
          </div>
        </section>

        {loadState.status === "loading" ? (
          <WorkflowLoading />
        ) : loadState.status === "ready" && selectedPatient && selectedEncounter ? (
          <>
            {loadState.data.source === "cp3_fixture" ? (
              <section
                className="inline-alert"
                aria-label="Synthetic CP3 workflow fixture"
                data-testid="cp3-fixture-alert"
              >
                <AlertCircle size={18} aria-hidden="true" />
                <div>
                  <strong>Local synthetic CP3 fixture mode</strong>
                  <span>
                    Non-PHI workflow data is running behind the typed CP3 provider boundary.
                  </span>
                </div>
              </section>
            ) : null}

            {actionMessage ? (
              <section
                className={`inline-alert inline-alert--${actionMessage.tone}`}
                aria-live="polite"
              >
                {actionMessage.tone === "success" ? (
                  <CheckCircle2 size={18} aria-hidden="true" />
                ) : (
                  <AlertCircle size={18} aria-hidden="true" />
                )}
                <div>
                  <strong>
                    {actionMessage.tone === "error" ? "Action failed" : "Workflow update"}
                  </strong>
                  <span>{actionMessage.text}</span>
                </div>
              </section>
            ) : null}

            <PatientSwitcher
              data={loadState.data}
              onSelectPatient={setSelectedPatientId}
              selectedPatientId={selectedPatient.id}
            />

            <WorkflowTabs
              mode={mode}
              setActiveSurfaceId={setActiveSurfaceId}
            />

            {mode === "profile" ? (
              <ProfilePanel encounter={selectedEncounter} patient={selectedPatient} />
            ) : null}

            {mode === "intake" ? (
              <IntakePanel
                actionBusy={actionBusy}
                intakeFields={intakeFields}
                intakeMode={intakeMode}
                onFieldChange={setIntakeFields}
                onIntakeModeChange={setIntakeMode}
                onSubmitIntake={handleSubmitIntake}
                patient={selectedPatient}
              />
            ) : null}

            {mode === "consent" ? (
              <ConsentPanel
                actionBusy={actionBusy}
                onCaptureConsent={handleCaptureConsent}
                onRevokeConsent={handleRevokeConsent}
                onRevokeReasonChange={setRevokeReason}
                patient={selectedPatient}
                revokeReason={revokeReason}
              />
            ) : null}

            {mode === "prep" ? <PrepPanel patient={selectedPatient} /> : null}

            {mode === "encounter" ? (
              <EncounterPanel
                actionBusy={actionBusy}
                amendmentReason={amendmentReason}
                amendmentSections={amendmentSections}
                canSign={canSign}
                encounter={selectedEncounter}
                noteSections={noteSections}
                onAmendmentReasonChange={setAmendmentReason}
                onAmendmentSectionChange={setAmendmentSections}
                onNoteSectionChange={setNoteSections}
                onSaveNoteDraft={handleSaveNoteDraft}
                onSavePrescriptionDraft={handleSavePrescriptionDraft}
                onSignNote={handleSignNote}
                onSignPrescription={handleSignPrescription}
                onStartEncounter={handleStartEncounter}
                onSubmitAmendment={handleAmendNote}
                patient={selectedPatient}
                prescriptionItems={prescriptionItems}
                setPrescriptionItems={setPrescriptionItems}
              />
            ) : null}
          </>
        ) : loadState.status === "ready" ? (
          <EmptyState text="No CP3 patient workflow data is available." />
        ) : (
          <WorkflowUnavailable onRetry={reloadWorkflow} problem={loadState.problem} />
        )}
      </div>
    </div>
  );
}

function PatientSwitcher({
  data,
  onSelectPatient,
  selectedPatientId
}: {
  data: Cp3WorkflowData;
  onSelectPatient: (patientId: string) => void;
  selectedPatientId: string;
}) {
  return (
    <section
      className="patient-switcher"
      aria-label="CP3 patient selector"
      data-testid="cp3-patient-selector"
    >
      {data.patients.map((patient) => {
        const encounter = data.encounters.find((item) => item.patientId === patient.id);
        const active = patient.id === selectedPatientId;

        return (
          <button
            aria-pressed={active}
            className={active ? "patient-switch patient-switch--active" : "patient-switch"}
            data-testid={`cp3-select-${getQaPatientKey(patient)}`}
            key={patient.id}
            onClick={() => onSelectPatient(patient.id)}
            type="button"
          >
            <strong>{patient.displayName}</strong>
            <span>
              {patient.kind === "new" ? "New" : "Returning"} ·{" "}
              {encounter ? ENCOUNTER_STATUS_LABELS[encounter.status] : "No encounter"}
            </span>
          </button>
        );
      })}
    </section>
  );
}

function WorkflowTabs({
  mode,
  setActiveSurfaceId
}: {
  mode: ClinicalMode;
  setActiveSurfaceId: (surfaceId: string) => void;
}) {
  return (
    <div className="workflow-tabs" role="tablist" aria-label="CP3 clinical workflow surfaces">
      {WORKFLOW_MODES.map((item) => {
        const Icon = item.icon;
        const active = mode === item.mode;

        return (
          <button
            aria-selected={active}
            className={active ? "workflow-tab workflow-tab--active" : "workflow-tab"}
            key={item.surfaceId}
            onClick={() => setActiveSurfaceId(item.surfaceId)}
            role="tab"
            type="button"
          >
            <Icon size={16} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProfilePanel({
  encounter,
  patient
}: {
  encounter: EncounterSummary;
  patient: PatientProfile;
}) {
  const readiness = summarizeAiAudioReadiness(patient);

  return (
    <div className="workflow-grid workflow-grid--split">
      <section className="work-panel" aria-labelledby="patient-profile-title">
        <div className="panel-heading">
          <div>
            <h2 id="patient-profile-title">Patient profile</h2>
            <p>Visit context, risk flags, current intake, and clinical state.</p>
          </div>
          <span className={`state-pill state-pill--${encounter.status}`}>
            {ENCOUNTER_STATUS_LABELS[encounter.status]}
          </span>
        </div>
        <div className="detail-strip detail-strip--four">
          <div>
            <span>Kind</span>
            <strong>{patient.kind === "new" ? "New" : "Returning"}</strong>
          </div>
          <div>
            <span>Phone</span>
            <strong>{patient.phone}</strong>
          </div>
          <div>
            <span>Provider</span>
            <strong>{patient.appointment.providerName}</strong>
          </div>
          <div>
            <span>Visit</span>
            <strong>{patient.appointment.visitType}</strong>
          </div>
        </div>
        <div className="subsection">
          <h3>Readiness</h3>
          <div className="readiness-grid readiness-grid--clinical">
            <ReadinessMetric label="Intake" value={patient.intake.status} />
            <ReadinessMetric label="AI/audio" value={readiness.label} />
            <ReadinessMetric label="Note" value={encounter.note.currentVersion.status} />
          </div>
          <div
            className={
              readiness.allowed
                ? "readiness-gate readiness-gate--ready"
                : "readiness-gate readiness-gate--blocked"
            }
            data-testid={
              readiness.allowed
                ? "cp3-ai-audio-readiness-consented"
                : "cp3-ai-audio-readiness-blocked"
            }
          >
            {readiness.allowed ? (
              <ShieldCheck size={18} aria-hidden="true" />
            ) : (
              <Ban size={18} aria-hidden="true" />
            )}
            <span>{readiness.reason}</span>
            <Button disabled size="sm" variant="secondary">
              AI/audio controls unavailable
            </Button>
          </div>
        </div>
      </section>

      <section className="work-panel" aria-labelledby="patient-timeline-title">
        <div className="panel-heading">
          <div>
            <h2 id="patient-timeline-title">Timeline</h2>
            <p>Chronological CP3 clinical events and consent changes.</p>
          </div>
        </div>
        <TimelineList patient={patient} />
      </section>
    </div>
  );
}

function IntakePanel({
  actionBusy,
  intakeFields,
  intakeMode,
  onFieldChange,
  onIntakeModeChange,
  onSubmitIntake,
  patient
}: {
  actionBusy: string | null;
  intakeFields: IntakeSubmitInput["fields"];
  intakeMode: IntakeMode;
  onFieldChange: (fields: IntakeSubmitInput["fields"]) => void;
  onIntakeModeChange: (mode: IntakeMode) => void;
  onSubmitIntake: (event: FormEvent<HTMLFormElement>) => void;
  patient: PatientProfile;
}) {
  return (
    <section className="work-panel" aria-labelledby="intake-title">
      <div className="panel-heading">
        <div>
          <h2 id="intake-title">Intake entry</h2>
          <p>Digital response or assistant-entered paper history card.</p>
        </div>
        <span className="state-pill">{patient.intake.status === "completed" ? "Complete" : "Open"}</span>
      </div>
      <form
        className="clinical-form"
        data-testid={`cp3-${getQaPatientSlug(patient)}-intake-form`}
        onSubmit={onSubmitIntake}
      >
        <div className="segmented-control segmented-control--fit" aria-label="Intake mode">
          <button
            aria-pressed={intakeMode === "digital"}
            className={intakeMode === "digital" ? "segment segment--active" : "segment"}
            onClick={() => onIntakeModeChange("digital")}
            type="button"
          >
            Digital
          </button>
          <button
            aria-pressed={intakeMode === "assistant_paper_card"}
            className={intakeMode === "assistant_paper_card" ? "segment segment--active" : "segment"}
            onClick={() => onIntakeModeChange("assistant_paper_card")}
            type="button"
          >
            Paper card
          </button>
        </div>
        <label>
          <span>Chief complaint</span>
          <textarea
            value={intakeFields.chiefComplaint}
            onChange={(event) =>
              onFieldChange({ ...intakeFields, chiefComplaint: event.target.value })
            }
          />
        </label>
        <label>
          <span>Medical conditions</span>
          <textarea
            value={intakeFields.medicalConditions}
            onChange={(event) =>
              onFieldChange({ ...intakeFields, medicalConditions: event.target.value })
            }
          />
        </label>
        <label>
          <span>Current medications</span>
          <textarea
            value={intakeFields.currentMedications}
            onChange={(event) =>
              onFieldChange({ ...intakeFields, currentMedications: event.target.value })
            }
          />
        </label>
        <label>
          <span>Allergies</span>
          <textarea
            value={intakeFields.allergies}
            onChange={(event) => onFieldChange({ ...intakeFields, allergies: event.target.value })}
          />
        </label>
        <Button
          data-testid="cp3-submit-intake"
          disabled={actionBusy === "submit-intake"}
          icon={<ClipboardCheck size={16} />}
          type="submit"
          variant="primary"
        >
          Complete intake
        </Button>
      </form>
    </section>
  );
}

function ConsentPanel({
  actionBusy,
  onCaptureConsent,
  onRevokeConsent,
  onRevokeReasonChange,
  patient,
  revokeReason
}: {
  actionBusy: string | null;
  onCaptureConsent: (purpose: ConsentPurpose) => void;
  onRevokeConsent: (purpose: ConsentPurpose) => void;
  onRevokeReasonChange: (reason: string) => void;
  patient: PatientProfile;
  revokeReason: string;
}) {
  const readiness = summarizeAiAudioReadiness(patient);

  return (
    <div className="workflow-grid workflow-grid--split">
      <section className="work-panel" aria-labelledby="consent-title">
        <div className="panel-heading">
          <div>
            <h2 id="consent-title">Consent records</h2>
            <p>Treatment, media, communication, and AI/audio purposes.</p>
          </div>
        </div>
        <div className="consent-list">
          {CONSENT_PURPOSES.map((purpose) => {
            const consent = patient.consents.find((item) => item.purpose === purpose);
            const status = consent?.status ?? "not_recorded";

            return (
              <div className="consent-row" key={purpose}>
                <div>
                  <strong>{CONSENT_LABELS[purpose]}</strong>
                  <span data-testid={`cp3-consent-${purpose}-status`}>
                    {formatConsentStatus(status)}
                  </span>
                </div>
                <div className="action-row">
                  <Button
                    data-testid={`cp3-capture-consent-${purpose}`}
                    disabled={actionBusy === `capture-${purpose}` || status === "granted"}
                    onClick={() => onCaptureConsent(purpose)}
                    size="sm"
                    variant="secondary"
                  >
                    Record
                  </Button>
                  <Button
                    data-testid={`cp3-revoke-consent-${purpose}`}
                    disabled={actionBusy === `revoke-${purpose}` || status === "revoked"}
                    icon={<Ban size={15} />}
                    onClick={() => onRevokeConsent(purpose)}
                    size="sm"
                    variant="danger"
                  >
                    Revoke
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="work-panel" aria-labelledby="consent-enforcement-title">
        <div className="panel-heading">
          <div>
            <h2 id="consent-enforcement-title">Enforcement hooks</h2>
            <p>Future capture controls read this consent readiness state.</p>
          </div>
        </div>
        <label className="clinical-field">
          <span>Revocation reason</span>
          <textarea
            value={revokeReason}
            onChange={(event) => onRevokeReasonChange(event.target.value)}
          />
        </label>
        <div
          className={
            readiness.allowed
              ? "readiness-gate readiness-gate--ready"
              : "readiness-gate readiness-gate--blocked"
          }
          data-testid={
            readiness.allowed
              ? "cp3-ai-audio-readiness-consented"
              : "cp3-ai-audio-readiness-blocked"
          }
        >
          {readiness.allowed ? (
            <ShieldCheck size={18} aria-hidden="true" />
          ) : (
            <Ban size={18} aria-hidden="true" />
          )}
          <span>{readiness.reason}</span>
          <Button disabled size="sm" variant="secondary">
            AI/audio readiness disabled
          </Button>
        </div>
      </section>
    </div>
  );
}

function PrepPanel({ patient }: { patient: PatientProfile }) {
  return (
    <section
      className="work-panel"
      aria-labelledby="prep-title"
      data-testid={`cp3-${getQaPatientSlug(patient)}-prep`}
    >
      <div className="panel-heading">
        <div>
          <h2 id="prep-title">Doctor prep summary</h2>
          <p>{patient.prep.visitReason}</p>
        </div>
        <span className="state-pill">{patient.kind === "returning" ? "Returning" : "New"}</span>
      </div>
      <div className="prep-grid">
        <PrepList title="Prior visits" items={patient.prep.priorVisits} />
        <PrepList title="Prior media" items={patient.prep.priorMedia} />
        <PrepList title="Medical changes" items={patient.prep.medicalHistoryChanges} />
        <PrepList title="Open plans" items={patient.prep.openTreatmentPlans} />
        <PrepList title="Lab cases" items={patient.prep.pendingLabCases} />
        <PrepList title="Recall" items={[patient.prep.recallContext]} />
      </div>
    </section>
  );
}

function EncounterPanel({
  actionBusy,
  amendmentReason,
  amendmentSections,
  canSign,
  encounter,
  noteSections,
  onAmendmentReasonChange,
  onAmendmentSectionChange,
  onNoteSectionChange,
  onSaveNoteDraft,
  onSavePrescriptionDraft,
  onSignNote,
  onSignPrescription,
  onStartEncounter,
  onSubmitAmendment,
  patient,
  prescriptionItems,
  setPrescriptionItems
}: {
  actionBusy: string | null;
  amendmentReason: string;
  amendmentSections: NoteSections;
  canSign: boolean;
  encounter: EncounterSummary;
  noteSections: NoteSections;
  onAmendmentReasonChange: (reason: string) => void;
  onAmendmentSectionChange: (sections: NoteSections) => void;
  onNoteSectionChange: (sections: NoteSections) => void;
  onSaveNoteDraft: () => void;
  onSavePrescriptionDraft: () => void;
  onSignNote: () => void;
  onSignPrescription: () => void;
  onStartEncounter: () => void;
  onSubmitAmendment: (event: FormEvent<HTMLFormElement>) => void;
  patient: PatientProfile;
  prescriptionItems: PrescriptionItem[];
  setPrescriptionItems: (items: PrescriptionItem[]) => void;
}) {
  const noteSigned =
    encounter.note.currentVersion.status === "signed" ||
    encounter.note.currentVersion.status === "amended";
  const prescriptionSigned = encounter.prescription.status === "signed";
  const encounterKey = getQaEncounterKey(encounter);

  return (
    <div className="workflow-grid workflow-grid--encounter">
      <section className="work-panel" aria-labelledby="encounter-state-title">
        <div className="panel-heading">
          <div>
            <h2 id="encounter-state-title">Encounter workspace</h2>
            <p>
              {patient.displayName} · {ENCOUNTER_STATUS_LABELS[encounter.status]}
            </p>
          </div>
          <Button
            data-testid={`cp3-start-encounter-${encounterKey}`}
            disabled={
              actionBusy === "start-encounter" ||
              !["checked_in", "scheduled"].includes(encounter.status)
            }
            icon={<Stethoscope size={16} />}
            onClick={onStartEncounter}
            size="sm"
            variant="primary"
          >
            Start
          </Button>
        </div>
        <div className="detail-strip detail-strip--four">
          <div>
            <span>Status</span>
            <strong>{ENCOUNTER_STATUS_LABELS[encounter.status]}</strong>
          </div>
          <div>
            <span>Provider</span>
            <strong>{encounter.providerName}</strong>
          </div>
          <div>
            <span>Chair</span>
            <strong>{encounter.chair}</strong>
          </div>
          <div>
            <span>Note v</span>
            <strong>{encounter.note.currentVersion.version}</strong>
          </div>
        </div>
      </section>

      <section className="work-panel" aria-labelledby="clinical-note-title">
        <div className="panel-heading">
          <div>
            <h2 id="clinical-note-title">Clinical note</h2>
            <p>History, examination, investigations, diagnosis, plan, and work performed.</p>
          </div>
          {noteSigned ? (
            <span className="state-pill state-pill--with_doctor" data-testid="cp3-note-signed-immutable">
              Immutable
            </span>
          ) : (
            <span className="state-pill">{encounter.note.currentVersion.status}</span>
          )}
        </div>
        <NoteSectionEditor
          noteSections={noteSections}
          onNoteSectionChange={onNoteSectionChange}
          readOnly={noteSigned}
        />
        <div className="action-row">
          <Button
            data-testid="cp3-save-note-draft"
            disabled={actionBusy === "save-note" || noteSigned}
            icon={<Save size={16} />}
            onClick={onSaveNoteDraft}
            variant="secondary"
          >
            Save draft
          </Button>
          {canSign ? (
            <span className="action-alias" data-testid={`cp3-sign-note-${encounterKey}`}>
              <Button
                data-testid="cp3-sign-note"
                disabled={
                  actionBusy === "sign-note" ||
                  noteSigned ||
                  encounter.note.currentVersion.status === "draft"
                }
                icon={<FileSignature size={16} />}
                onClick={onSignNote}
                variant="primary"
              >
                Sign note
              </Button>
            </span>
          ) : (
            <span className="action-alias" data-testid={`cp3-sign-note-denied-${encounterKey}`}>
              <Button
                data-testid="cp3-sign-note-denied"
                disabled
                icon={<LockKeyhole size={16} />}
                variant="secondary"
              >
                Doctor sign-off required
              </Button>
            </span>
          )}
        </div>

        {noteSigned ? (
          <form className="amendment-panel" onSubmit={onSubmitAmendment}>
            <div className="panel-heading panel-heading--compact">
              <div>
                <h3>Amend signed note</h3>
                <p>Amendments preserve the signed version history.</p>
              </div>
            </div>
            <label className="clinical-field">
              <span>Reason</span>
              <input
                value={amendmentReason}
                onChange={(event) => onAmendmentReasonChange(event.target.value)}
              />
            </label>
            <NoteSectionEditor
              noteSections={amendmentSections}
              onNoteSectionChange={onAmendmentSectionChange}
            />
            {canSign ? (
              <Button
                data-testid="cp3-amend-note"
                disabled={actionBusy === "amend-note"}
                icon={<FilePenLine size={16} />}
                type="submit"
                variant="primary"
              >
                Sign amendment
              </Button>
            ) : (
              <Button disabled icon={<LockKeyhole size={16} />} variant="secondary">
                Doctor amendment required
              </Button>
            )}
          </form>
        ) : null}
      </section>

      <section className="work-panel" aria-labelledby="prescription-title">
        <div className="panel-heading">
          <div>
            <h2 id="prescription-title">Prescription</h2>
            <p>Assistant may draft; doctor signature is required before completion.</p>
          </div>
          <span className="state-pill">{encounter.prescription.status}</span>
        </div>
        <PrescriptionEditor
          items={prescriptionItems}
          onChange={setPrescriptionItems}
          readOnly={prescriptionSigned}
        />
        <div className="action-row">
          <Button
            data-testid="cp3-save-prescription-draft"
            disabled={actionBusy === "save-prescription" || prescriptionSigned}
            icon={<Save size={16} />}
            onClick={onSavePrescriptionDraft}
            variant="secondary"
          >
            Save prescription
          </Button>
          {canSign ? (
            <span
              className="action-alias"
              data-testid={`cp3-sign-prescription-${encounterKey}`}
            >
              <Button
                data-testid="cp3-sign-prescription"
                disabled={actionBusy === "sign-prescription" || prescriptionSigned}
                icon={<FileSignature size={16} />}
                onClick={onSignPrescription}
                variant="primary"
              >
                Sign prescription
              </Button>
            </span>
          ) : (
            <span
              className="action-alias"
              data-testid={`cp3-sign-prescription-denied-${encounterKey}`}
            >
              <Button
                data-testid="cp3-sign-prescription-denied"
                disabled
                icon={<LockKeyhole size={16} />}
                variant="secondary"
              >
                Doctor signature required
              </Button>
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

function NoteSectionEditor({
  noteSections,
  onNoteSectionChange,
  readOnly
}: {
  noteSections: NoteSections;
  onNoteSectionChange: (sections: NoteSections) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="note-section-grid">
      {NOTE_SECTION_KEYS.map((key) => (
        <label className="clinical-field" key={key}>
          <span>{NOTE_SECTION_LABELS[key]}</span>
          <textarea
            readOnly={readOnly}
            value={noteSections[key]}
            onChange={(event) => onNoteSectionChange({ ...noteSections, [key]: event.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

function PrescriptionEditor({
  items,
  onChange,
  readOnly
}: {
  items: PrescriptionItem[];
  onChange: (items: PrescriptionItem[]) => void;
  readOnly?: boolean;
}) {
  const item = items[0] ?? emptyPrescriptionItem();

  const updateItem = (nextItem: PrescriptionItem) => {
    onChange([nextItem]);
  };

  return (
    <div className="prescription-grid">
      <label className="clinical-field">
        <span>Medicine</span>
        <input
          readOnly={readOnly}
          value={item.medicine}
          onChange={(event) => updateItem({ ...item, medicine: event.target.value })}
        />
      </label>
      <label className="clinical-field">
        <span>Frequency</span>
        <input
          readOnly={readOnly}
          value={item.frequency}
          onChange={(event) => updateItem({ ...item, frequency: event.target.value })}
        />
      </label>
      <label className="clinical-field">
        <span>Duration</span>
        <input
          readOnly={readOnly}
          value={item.duration}
          onChange={(event) => updateItem({ ...item, duration: event.target.value })}
        />
      </label>
      <label className="clinical-field clinical-field--wide">
        <span>Notes</span>
        <input
          readOnly={readOnly}
          value={item.notes}
          onChange={(event) => updateItem({ ...item, notes: event.target.value })}
        />
      </label>
    </div>
  );
}

function TimelineList({ patient }: { patient: PatientProfile }) {
  return (
    <div className="timeline-list" data-testid="cp3-timeline">
      {patient.timeline.map((item) => (
        <div className="timeline-item" key={item.id}>
          <time dateTime={item.at}>{formatDateTime(item.at)}</time>
          <div>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
            <code>{item.kind}</code>
          </div>
        </div>
      ))}
    </div>
  );
}

function PrepList({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="prep-list">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ReadinessMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="readiness-metric">
      <CheckCircle2 size={18} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkflowLoading() {
  return (
    <section className="work-panel" aria-busy="true" aria-live="polite">
      <div className="loading-row">
        <Loader2 size={18} aria-hidden="true" />
        <span>Loading CP3 workflow API state</span>
      </div>
      <div className="skeleton-line skeleton-line--short" />
      <div className="skeleton-line" />
      <div className="skeleton-grid">
        <div />
        <div />
        <div />
      </div>
    </section>
  );
}

function WorkflowUnavailable({
  onRetry,
  problem
}: {
  onRetry: () => void;
  problem: Cp3WorkflowProblem;
}) {
  return (
    <section className="work-panel" aria-labelledby="cp3-unavailable-title">
      <div className="empty-state empty-state--large">
        <PlugZap size={28} aria-hidden="true" />
        <p className="state-kicker">CP3 API boundary unavailable</p>
        <h2 id="cp3-unavailable-title">{problem.message}</h2>
        {problem.detail ? <p>{problem.detail}</p> : null}
      </div>
      <div className="endpoint-table" role="table" aria-label="Required CP3 endpoints">
        <div className="endpoint-row endpoint-row--head" role="row">
          <span role="columnheader">Endpoint</span>
          <span role="columnheader">State</span>
        </div>
        {problem.endpoints.length > 0
          ? problem.endpoints.map((endpoint) => (
              <div
                className="endpoint-row"
                key={`${endpoint.endpoint}-${endpoint.status ?? "x"}`}
                role="row"
              >
                <span role="cell">{endpoint.endpoint}</span>
                <span role="cell">
                  {endpoint.status ? `${endpoint.status}: ${endpoint.message}` : endpoint.message}
                </span>
              </div>
            ))
          : CP3_REQUIRED_ENDPOINTS.map((endpoint) => (
              <div className="endpoint-row" key={endpoint} role="row">
                <span role="cell">{endpoint}</span>
                <span role="cell">Not loaded</span>
              </div>
            ))}
      </div>
      <div className="surface-actions">
        <Button icon={<RefreshCw size={16} />} onClick={onRetry} variant="secondary">
          Retry workflow API
        </Button>
      </div>
    </section>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <Stethoscope size={18} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
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

function emptyPrescriptionItem(): PrescriptionItem {
  return {
    duration: "",
    frequency: "",
    id: "draft-prescription-item",
    medicine: "",
    notes: ""
  };
}

function getClinicalActorRole(roles: ClinicRole[]): ClinicRole {
  for (const role of ["doctor", "assistant", "receptionist", "owner"] satisfies ClinicRole[]) {
    if (roles.includes(role)) {
      return role;
    }
  }

  return roles[0] ?? "assistant";
}

function getQaPatientKey(patient: PatientProfile) {
  return patient.id === "newClinicalPatient" ? "newPatient" : "returningPatient";
}

function getQaPatientSlug(patient: PatientProfile) {
  return patient.id === "newClinicalPatient" ? "new-patient" : "returning-patient";
}

function getQaEncounterKey(encounter: EncounterSummary) {
  return encounter.id === "newClinicalEncounter" ? "newPatientEncounter" : "returningPatientEncounter";
}

function formatConsentStatus(status: string) {
  if (status === "granted") {
    return "Granted";
  }

  if (status === "revoked") {
    return "Revoked";
  }

  return "Not recorded";
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time pending";
  }

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short"
  }).format(date);
}

function formatActionError(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === "string") {
      return `${fallback} ${message}`;
    }
  }

  if (error instanceof Error) {
    return `${fallback} ${error.message}`;
  }

  return fallback;
}
