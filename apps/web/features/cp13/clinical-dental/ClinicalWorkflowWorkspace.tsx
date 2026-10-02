"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import type {
  ClinicOsApiClient,
  PublicJsonObject,
  VersionedPublicResource
} from "@clinic-os/api-client-generated";
import {
  readUnsavedClinicalNote,
  rememberUnsavedClinicalNote,
  forgetUnsavedClinicalNote,
  unsavedEncounterForPatient
} from "../../../lib/unsaved-clinical-notes";
import type { MeProfile } from "../../../lib/me";
import { PatientHistoryWorkspace } from "./PatientHistoryWorkspace";
import { ClinicalDentalWorkspace } from "./ClinicalDentalWorkspace";
import { useUnsavedNoteGuard } from "../shared/useUnsavedNoteGuard";
import { PatientSelector } from "../shared/PatientSelector";
import { WorkflowAction, useWorkflowAction } from "../shared/WorkflowAction";
import { clinicDisplayTime, etag, fieldText, record, valueList } from "../shared/workflow-values";
import {
  assertFdiTooth,
  intakeFields,
  intakeResponses,
  prescriptionMedications,
  printClinicalDocument,
  type IntakeField,
  type MedicationInput
} from "./clinical-workflow";

export interface ClinicalWorkflowWorkspaceProps {
  readonly client: ClinicOsApiClient;
  readonly profile: MeProfile;
  readonly surfaceId: string;
  readonly patientId: string | null;
  readonly onSelectPatient: (id: string) => void;
}

type ClinicalContext = ClinicalWorkflowWorkspaceProps & {
  readonly patientId: string;
  readonly patientName: string;
  readonly scope: string;
  readonly locked: boolean;
  readonly setNoteDirty: (dirty: boolean) => void;
  readonly allowNavigation: () => boolean;
  readonly mutate: <T>(
    run: (key: string) => Promise<T>,
    after?: (result: T) => Promise<void> | void
  ) => Promise<boolean>;
};

function can(profile: MeProfile, permission: string) {
  return profile.permissions.includes(permission);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The record could not be loaded.";
}

function useRemote<T>(load: () => Promise<T>, dependencies: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await load();
      if (generation.current === current) setData(result);
    } catch (cause) {
      if (generation.current === current) setError(errorMessage(cause));
      throw cause;
    } finally {
      if (generation.current === current) setLoading(false);
    }
    // The caller passes stable keys for every value captured by load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useEffect(() => {
    void refresh().catch(() => undefined);
    return () => {
      generation.current += 1;
    };
  }, [refresh]);
  return { data, error, loading, refresh };
}

function RemotePanel(props: {
  readonly title: string;
  readonly loading: boolean;
  readonly error: string;
  readonly children: ReactNode;
  readonly onRefresh: () => void;
}) {
  return (
    <section className="workspace-card" aria-busy={props.loading}>
      <header>
        <h2>{props.title}</h2>
        <button type="button" onClick={props.onRefresh}>
          Refresh
        </button>
      </header>
      {props.loading && !props.children ? <p>Loading…</p> : null}
      {props.error ? (
        <p role="alert">
          {props.error} {props.children ? "Previously loaded information is shown below." : ""}
        </p>
      ) : null}
      {props.children}
    </section>
  );
}

export function ClinicalWorkflowWorkspace(props: ClinicalWorkflowWorkspaceProps) {
  const scope = `${props.profile.tenant.id}:${props.profile.clinic.id}:${props.profile.user.id}`;
  const [revision, setRevision] = useState(0);
  const noteGuard = useUnsavedNoteGuard();
  const canReadPhi = can(props.profile, "patient.phi.read");
  const patient = useRemote(() => {
    if (!props.patientId) return Promise.reject(new Error("Select a patient."));
    return canReadPhi
      ? props.client.getPatient({ path: { patientId: props.patientId } })
      : props.client.getPatientDemographics({ path: { patientId: props.patientId } });
  }, [props.client, props.patientId, canReadPhi]);
  const selectedName = fieldText(patient.data?.patient, "fullName");
  const action = useWorkflowAction(
    scope,
    selectedName ? `patient ${selectedName}` : "the selected clinical patient"
  );
  const context: ClinicalContext | null =
    props.patientId && patient.data?.patient.id === props.patientId
      ? {
          ...props,
          patientId: props.patientId,
          patientName: selectedName,
          scope,
          locked: action.locked,
          mutate: action.execute,
          setNoteDirty: noteGuard.setNoteDirty,
          allowNavigation: noteGuard.allowNavigation
        }
      : null;

  return (
    <div className="clinical-workflow-workspace">
      <fieldset disabled={action.locked}>
        <PatientSelector
          client={props.client}
          patientId={props.patientId}
          onSelectPatient={(id) => {
            if (id === props.patientId || noteGuard.allowNavigation()) props.onSelectPatient(id);
          }}
        />
      </fieldset>
      {noteGuard.message ? <p role="alert">{noteGuard.message}</p> : null}
      <WorkflowAction
        message={action.message}
        pending={action.pending}
        pendingLabel={action.pendingLabel}
        busy={action.busy}
        onRecover={() =>
          void action.recover(async () => {
            await patient.refresh();
            setRevision((value) => value + 1);
          })
        }
      />
      {!props.patientId ? <p>Choose a patient to open the clinical workflow.</p> : null}
      {props.patientId && patient.loading && !context ? <p>Loading patient…</p> : null}
      {props.patientId && patient.error ? (
        <p role="alert">
          {patient.error}{" "}
          <button type="button" onClick={() => void patient.refresh().catch(() => undefined)}>
            Retry
          </button>
        </p>
      ) : null}
      {context ? (
        <Fragment key={`${context.patientId}:${revision}`}>
          <h1>{context.patientName || "Patient clinical record"}</h1>
          {props.surfaceId === "intake" ? <IntakePanel {...context} /> : null}
          {props.surfaceId === "consent" ? <ConsentPanel {...context} /> : null}
          {props.surfaceId === "returning-prep" || props.surfaceId === "patient-profile" ? (
            canReadPhi && can(props.profile, "clinical.note.read") ? (
              <PrepPanel {...context} />
            ) : (
              <p>Clinical preparation and timeline require clinical record access.</p>
            )
          ) : null}
          {props.surfaceId === "encounter" ? (
            can(props.profile, "clinical.note.read") ? (
              <EncounterPanel {...context} />
            ) : (
              <p>This account cannot open clinical visits.</p>
            )
          ) : null}
          {props.surfaceId === "dental-media" &&
          canReadPhi &&
          can(props.profile, "dental.chart.read") ? (
            <>
              <DentalPanel {...context} />
              {can(props.profile, "media.read") || can(props.profile, "media.write") ? (
                <ClinicalDentalWorkspace client={props.client} patientId={context.patientId} />
              ) : null}
            </>
          ) : props.surfaceId === "dental-media" ? (
            <p>This account cannot open the dental record.</p>
          ) : null}
        </Fragment>
      ) : null}
    </div>
  );
}

function IntakePanel(props: ClinicalContext) {
  const [historyCursor, setHistoryCursor] = useState<string | undefined>();
  const history = useRemote(
    () =>
      props.client.listPatientIntakeHistory({
        path: { patientId: props.patientId },
        query: { cursor: historyCursor, limit: 20 }
      }),
    [props.client, props.patientId, historyCursor]
  );
  const templates = useRemote(() => props.client.listIntakeFormTemplates(), [props.client]);
  const [templateId, setTemplateId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState("");
  const [message, setMessage] = useState("");
  const active =
    templates.data?.templates.filter(
      (item) =>
        item.active === true &&
        (item.formType === "patient_intake" || item.formType === "medical_history")
    ) ?? [];
  const selected = active.find((item) => fieldText(item, "id") === templateId) ?? null;
  let fields: readonly IntakeField[] = [];
  let schemaError = "";
  if (selected)
    try {
      fields = intakeFields(selected);
    } catch (error) {
      schemaError = errorMessage(error);
    }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      const responses = intakeResponses(fields, values);
      if (!evidence.trim()) throw new Error("Record where the approved paper card is held.");
      setMessage("");
      const success = await props.mutate((key) =>
        props.client.submitPatientIntakeForm({
          path: { patientId: props.patientId },
          headers: { "idempotency-key": key },
          body: {
            templateId,
            source: "assistant_paper_card",
            responses,
            medicalHistorySnapshot:
              fieldText(selected, "formType") === "medical_history" ? responses : undefined,
            provenance: {
              paperRecordLocation: evidence.trim(),
              capturedByUserId: props.profile.user.id
            }
          }
        })
      );
      if (success) {
        setMessage(
          "Intake response recorded. Review the patient prep summary for the latest history."
        );
        setValues({});
        setEvidence("");
        await history.refresh().catch(() => undefined);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <RemotePanel
      title="Intake and medical history"
      loading={templates.loading}
      error={templates.error}
      onRefresh={() => void templates.refresh().catch(() => undefined)}
    >
      {!can(props.profile, "intake.write") ? (
        <p>This account cannot record intake responses.</p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <label>
            Approved form template
            <select
              value={templateId}
              onChange={(event) => {
                setTemplateId(event.target.value);
                setValues({});
              }}
              required
            >
              <option value="">Choose an active template</option>
              {active.map((item) => (
                <option key={fieldText(item, "id")} value={fieldText(item, "id")}>
                  {fieldText(item, "displayName") || fieldText(item, "code")} · v
                  {String(item.version ?? "?")}
                </option>
              ))}
            </select>
          </label>
          {active.length === 0 && !templates.loading ? (
            <p>No active supported intake templates are configured.</p>
          ) : null}
          <p>Transcribe from the clinic’s approved paper card and retain the original record.</p>
          <label>
            Paper record location or reference
            <input
              value={evidence}
              onChange={(event) => setEvidence(event.target.value)}
              required
            />
          </label>
          {schemaError ? (
            <p role="alert">{schemaError}</p>
          ) : (
            fields.map((field) => (
              <label key={field.key}>
                {field.label}
                {field.kind === "choice" ? (
                  <select
                    value={values[field.key] ?? ""}
                    required={field.required}
                    onChange={(event) =>
                      setValues((previous) => ({ ...previous, [field.key]: event.target.value }))
                    }
                  >
                    <option value="">Choose</option>
                    {field.choices.map((choice) => (
                      <option key={choice} value={choice}>
                        {choice}
                      </option>
                    ))}
                  </select>
                ) : field.kind === "boolean" ? (
                  <select
                    value={values[field.key] ?? ""}
                    required={field.required}
                    onChange={(event) =>
                      setValues((previous) => ({ ...previous, [field.key]: event.target.value }))
                    }
                  >
                    <option value="">Choose</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : field.kind === "number" ? (
                  <input
                    type="number"
                    value={values[field.key] ?? ""}
                    required={field.required}
                    onChange={(event) =>
                      setValues((previous) => ({ ...previous, [field.key]: event.target.value }))
                    }
                  />
                ) : (
                  <textarea
                    value={values[field.key] ?? ""}
                    required={field.required}
                    onChange={(event) =>
                      setValues((previous) => ({ ...previous, [field.key]: event.target.value }))
                    }
                  />
                )}
              </label>
            ))
          )}
          {message ? <p role="status">{message}</p> : null}
          <button type="submit" disabled={!selected || !!schemaError || props.locked}>
            Record response
          </button>
        </form>
      )}
      <h3>Saved intake history</h3>
      {history.error ? (
        <p role="alert">
          {history.error}{" "}
          <button type="button" onClick={() => void history.refresh().catch(() => undefined)}>
            Retry history
          </button>
        </p>
      ) : null}
      {history.loading ? <p>Loading history…</p> : null}
      {history.data?.submissions.map((item) => (
        <details key={fieldText(item, "id")}>
          <summary>
            {clinicDisplayTime(
              fieldText(item, "submittedAt") || fieldText(item, "createdAt"),
              props.profile.clinic.timezone || "UTC"
            )}{" "}
            · {fieldText(item, "source")} · template version {String(item.templateVersion ?? "")}
          </summary>
          <dl>
            {Object.entries(record(item.responses)).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
      {historyCursor ? (
        <button type="button" onClick={() => setHistoryCursor(undefined)}>
          Latest intake history
        </button>
      ) : null}
      {history.data?.nextCursor ? (
        <button type="button" onClick={() => setHistoryCursor(history.data!.nextCursor!)}>
          Older intake history
        </button>
      ) : null}
    </RemotePanel>
  );
}

const CONSENT_PURPOSES = [
  "treatment_registration",
  "privacy_notice",
  "whatsapp_communication",
  "marketing_recall",
  "ai_audio_capture",
  "raw_audio_retention",
  "photo_capture",
  "photo_sharing",
  "abdm_abha",
  "procedure_treatment",
  "clinical_data_exchange"
] as const;

function ConsentPanel(props: ClinicalContext) {
  const consents = useRemote(
    () => props.client.listPatientConsents({ path: { patientId: props.patientId } }),
    [props.client, props.patientId]
  );
  const [purpose, setPurpose] =
    useState<(typeof CONSENT_PURPOSES)[number]>("treatment_registration");
  const [templateCode, setTemplateCode] = useState("");
  const [templateVersion, setTemplateVersion] = useState("");
  const [method, setMethod] = useState<"assistant_paper_card" | "clinic_staff" | "imported_record">(
    "assistant_paper_card"
  );
  const [grantedBy, setGrantedBy] = useState("");
  const [relationship, setRelationship] = useState("");
  const [evidenceLocation, setEvidenceLocation] = useState("");
  const [evidenceDate, setEvidenceDate] = useState("");
  const [attested, setAttested] = useState(false);
  const [revokeId, setRevokeId] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [message, setMessage] = useState("");
  const timeZone = props.profile.clinic.timezone || "UTC";

  async function capture(event: FormEvent) {
    event.preventDefault();
    if (!attested) {
      setMessage("Confirm that the approved consent was actually obtained.");
      return;
    }
    const version = Number(templateVersion);
    if (!Number.isSafeInteger(version) || version < 1) {
      setMessage("Enter a valid approved template version.");
      return;
    }
    if (!evidenceLocation.trim() || !evidenceDate) {
      setMessage("Evidence reference and date are required.");
      return;
    }
    setMessage("");
    const success = await props.mutate(
      (key) =>
        props.client.createPatientConsent({
          path: { patientId: props.patientId },
          headers: { "idempotency-key": key },
          body: {
            purpose,
            templateCode: templateCode.trim(),
            templateVersion: version,
            captureMethod: method,
            grantedByName: grantedBy.trim() || undefined,
            relationshipToPatient: relationship.trim() || undefined,
            evidence: { recordLocation: evidenceLocation.trim(), recordedOn: evidenceDate },
            provenance: { capturedByUserId: props.profile.user.id, source: method }
          }
        }),
      async () => {
        await consents.refresh();
      }
    );
    if (success) {
      setMessage("Consent evidence recorded.");
      setAttested(false);
      setEvidenceLocation("");
    }
  }

  async function revoke(event: FormEvent) {
    event.preventDefault();
    if (!revokeId || !revokeReason.trim()) return;
    setMessage("");
    const success = await props.mutate(
      (key) =>
        props.client.revokePatientConsent({
          path: { patientId: props.patientId, consentId: revokeId },
          headers: { "idempotency-key": key },
          body: { reason: revokeReason.trim() }
        }),
      async () => {
        await consents.refresh();
      }
    );
    if (success) {
      setRevokeId("");
      setRevokeReason("");
      setMessage("Consent revoked.");
    }
  }

  return (
    <RemotePanel
      title="Consent record"
      loading={consents.loading}
      error={consents.error}
      onRefresh={() => void consents.refresh().catch(() => undefined)}
    >
      <p>
        Record an approved consent already obtained from the patient. This screen does not present
        or replace the clinic’s consent text.
      </p>
      {consents.data ? (
        <>
          <p>
            Enforcement:{" "}
            {fieldText(consents.data.enforcementState, "status") || "See individual purposes below"}
          </p>
          {consents.data.consents.length ? (
            <ul>
              {consents.data.consents.map((item, index) => (
                <li key={fieldText(item, "id") || index}>
                  <strong>{fieldText(item, "purpose").replaceAll("_", " ")}</strong> ·{" "}
                  {fieldText(item, "status") || "recorded"}
                  {fieldText(item, "templateCode")
                    ? ` · ${fieldText(item, "templateCode")} v${String(item.templateVersion ?? "?")}`
                    : ""}
                  {fieldText(item, "createdAt")
                    ? ` · ${clinicDisplayTime(fieldText(item, "createdAt"), timeZone)}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>No consent records found.</p>
          )}
        </>
      ) : null}
      {can(props.profile, "intake.write") ? (
        <>
          <form onSubmit={(event) => void capture(event)}>
            <h3>Record obtained consent</h3>
            <label>
              Purpose{" "}
              <select
                value={purpose}
                onChange={(event) => setPurpose(event.target.value as typeof purpose)}
              >
                {CONSENT_PURPOSES.map((item) => (
                  <option key={item} value={item}>
                    {item.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Approved template code{" "}
              <input
                value={templateCode}
                onChange={(event) => setTemplateCode(event.target.value)}
                required
              />
            </label>
            <label>
              Approved template version{" "}
              <input
                type="number"
                min="1"
                step="1"
                value={templateVersion}
                onChange={(event) => setTemplateVersion(event.target.value)}
                required
              />
            </label>
            <label>
              Capture method{" "}
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value as typeof method)}
              >
                <option value="assistant_paper_card">Paper card transcribed by assistant</option>
                <option value="clinic_staff">Clinic staff recorded consent</option>
                <option value="imported_record">Imported signed record</option>
              </select>
            </label>
            <label>
              Person who granted consent{" "}
              <input
                value={grantedBy}
                onChange={(event) => setGrantedBy(event.target.value)}
                required
              />
            </label>
            <label>
              Relationship to patient, if representative{" "}
              <input
                value={relationship}
                onChange={(event) => setRelationship(event.target.value)}
              />
            </label>
            <label>
              Signed evidence location or reference{" "}
              <input
                value={evidenceLocation}
                onChange={(event) => setEvidenceLocation(event.target.value)}
                required
              />
            </label>
            <label>
              Date on the evidence{" "}
              <input
                type="date"
                value={evidenceDate}
                onChange={(event) => setEvidenceDate(event.target.value)}
                required
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={attested}
                onChange={(event) => setAttested(event.target.checked)}
              />{" "}
              I checked that this exact approved template and version was presented and consent was
              obtained.
            </label>
            <button type="submit" disabled={props.locked || !attested}>
              Record consent evidence
            </button>
          </form>
          <form onSubmit={(event) => void revoke(event)}>
            <h3>Revoke consent</h3>
            <label>
              Consent record{" "}
              <select
                value={revokeId}
                onChange={(event) => setRevokeId(event.target.value)}
                required
              >
                <option value="">Choose a record</option>
                {consents.data?.consents
                  .filter((item) => fieldText(item, "status") !== "revoked")
                  .map((item) => (
                    <option key={fieldText(item, "id")} value={fieldText(item, "id")}>
                      {fieldText(item, "purpose").replaceAll("_", " ")} ·{" "}
                      {fieldText(item, "templateCode")}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Reason{" "}
              <textarea
                value={revokeReason}
                onChange={(event) => setRevokeReason(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={props.locked || !revokeId || !revokeReason.trim()}>
              Revoke selected consent
            </button>
          </form>
        </>
      ) : (
        <p>This account cannot record or revoke consent.</p>
      )}
      {message ? <p role="status">{message}</p> : null}
    </RemotePanel>
  );
}

function PrepPanel(props: ClinicalContext) {
  return (
    <PatientHistoryWorkspace
      client={props.client}
      profile={props.profile}
      patientId={props.patientId}
    />
  );
}

const NOTE_SECTIONS = [
  ["chiefComplaint", "Chief complaint"],
  ["history", "History"],
  ["examination", "Examination"],
  ["investigations", "Investigations"],
  ["diagnosis", "Diagnosis"],
  ["treatmentPlan", "Treatment plan"],
  ["treatmentPerformed", "Treatment performed"],
  ["followUpInstructions", "Follow-up instructions"]
] as const;
type NoteKey = (typeof NOTE_SECTIONS)[number][0];
type NoteContent = Partial<Record<NoteKey, string>>;

function noteContent(value: unknown): NoteContent {
  const source = record(value);
  return Object.fromEntries(
    NOTE_SECTIONS.map(([key]) => [key, fieldText(source, key)])
  ) as NoteContent;
}

function EncounterPanel(props: ClinicalContext) {
  const encounters = useRemote(
    () =>
      props.client.listPatientEncounters({
        path: { patientId: props.patientId },
        query: { limit: 50 }
      }),
    [props.client, props.patientId]
  );
  const doctors = useRemote(() => props.client.listClinicDoctors(), [props.client]);
  const today = useRemote(() => props.client.getMorningDashboard(), [props.client]);
  const [encounterRows, setEncounterRows] = useState<readonly VersionedPublicResource[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(
    () => unsavedEncounterForPatient(props.scope, props.patientId) ?? ""
  );
  const [moreError, setMoreError] = useState("");
  const [providerId, setProviderId] = useState("");
  const [appointmentId, setAppointmentId] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const timeZone = props.profile.clinic.timezone || "UTC";
  useEffect(() => {
    setEncounterRows(encounters.data?.encounters ?? []);
    setCursor(encounters.data?.nextCursor ?? null);
  }, [encounters.data]);
  useEffect(() => {
    setSelectedId(unsavedEncounterForPatient(props.scope, props.patientId) ?? "");
    setProviderId("");
    setAppointmentId("");
  }, [props.scope, props.patientId]);

  const doctorOptions =
    doctors.data?.clinicDoctors
      .map((item) => ({
        id: fieldText(item, "providerUserId"),
        name: fieldText(item, "displayName")
      }))
      .filter((item) => item.id && item.name) ?? [];
  const dayAppointments =
    today.data?.dashboard.clinicDayAppointments.filter(
      (item) =>
        item.patientId === props.patientId &&
        !["cancelled", "no_show", "completed"].includes(item.status)
    ) ?? [];

  async function loadMore() {
    if (!cursor) return;
    try {
      setMoreError("");
      const response = await props.client.listPatientEncounters({
        path: { patientId: props.patientId },
        query: { cursor, limit: 50 }
      });
      setEncounterRows((previous) => [
        ...previous,
        ...response.encounters.filter((item) => !previous.some((old) => old.id === item.id))
      ]);
      setCursor(response.nextCursor);
    } catch (error) {
      setMoreError(errorMessage(error));
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!props.allowNavigation()) return;
    if (!doctorOptions.some((item) => item.id === providerId)) {
      setMessage("Choose a listed clinic doctor.");
      return;
    }
    const appointment = dayAppointments.find((item) => item.id === appointmentId);
    if (appointmentId && (!appointment || appointment.providerUserId !== providerId)) {
      setMessage("The selected appointment must belong to this patient and doctor.");
      return;
    }
    setMessage("");
    const success = await props.mutate(
      (key) =>
        props.client.createEncounter({
          headers: { "idempotency-key": key },
          body: {
            patientId: props.patientId,
            providerUserId: providerId,
            appointmentId: appointment?.id,
            reason: reason.trim() || undefined
          }
        }),
      async (response) => {
        setSelectedId(response.encounter.id);
        await encounters.refresh();
      }
    );
    if (success) {
      setReason("");
      setMessage("Visit created. Start it when the patient is ready for consultation.");
    }
  }

  return (
    <>
      <RemotePanel
        title="Visits"
        loading={encounters.loading}
        error={encounters.error}
        onRefresh={() => void encounters.refresh().catch(() => undefined)}
      >
        {encounterRows.length ? (
          <ul>
            {encounterRows.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={selectedId === item.id ? "true" : undefined}
                  onClick={() => {
                    if (item.id === selectedId || props.allowNavigation()) setSelectedId(item.id);
                  }}
                >
                  {clinicDisplayTime(
                    fieldText(item, "createdAt") || fieldText(item, "updatedAt"),
                    timeZone
                  )}{" "}
                  · {fieldText(item, "status").replaceAll("_", " ")}
                  {fieldText(item, "reason") ? ` · ${fieldText(item, "reason")}` : ""}
                </button>
              </li>
            ))}
          </ul>
        ) : !encounters.loading ? (
          <p>No visits are recorded for this patient.</p>
        ) : null}
        {cursor ? (
          <button type="button" onClick={() => void loadMore()}>
            Load older visits
          </button>
        ) : null}
        {moreError ? <p role="alert">{moreError}</p> : null}
      </RemotePanel>
      {can(props.profile, "clinical.note.write") ? (
        <section className="workspace-card">
          <h2>Create visit</h2>
          <form onSubmit={(event) => void create(event)}>
            <label>
              Assigned doctor{" "}
              <select
                value={providerId}
                onChange={(event) => {
                  setProviderId(event.target.value);
                  setAppointmentId("");
                }}
                required
              >
                <option value="">Choose a clinic doctor</option>
                {doctorOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {doctors.error ? <p role="alert">Doctor list unavailable: {doctors.error}</p> : null}
            <label>
              Today’s appointment, if linked{" "}
              <select
                value={appointmentId}
                onChange={(event) => setAppointmentId(event.target.value)}
              >
                <option value="">No linked appointment</option>
                {dayAppointments
                  .filter((item) => !providerId || item.providerUserId === providerId)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {clinicDisplayTime(item.startAt, timeZone)} · {item.providerName} ·{" "}
                      {item.status.replaceAll("_", " ")}
                    </option>
                  ))}
              </select>
            </label>
            {today.data?.dashboard.appointmentsTruncated ? (
              <p>
                Today’s schedule is truncated; an appointment may be absent. Create an unlinked
                visit or open it through the schedule.
              </p>
            ) : null}
            {today.error ? (
              <p>Today’s appointments could not be listed; an unlinked visit is available.</p>
            ) : null}
            <label>
              Reason for visit{" "}
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <button type="submit" disabled={props.locked || !providerId}>
              Create visit
            </button>
          </form>
          {message ? <p role="status">{message}</p> : null}
        </section>
      ) : null}
      {selectedId ? (
        <VisitEditor
          key={`${props.patientId}:${selectedId}`}
          {...props}
          encounterId={selectedId}
          providerOptions={doctorOptions}
          onChanged={encounters.refresh}
        />
      ) : null}
    </>
  );
}

function VisitEditor(
  props: ClinicalContext & {
    readonly encounterId: string;
    readonly providerOptions: readonly { id: string; name: string }[];
    readonly onChanged: () => Promise<void>;
  }
) {
  const detail = useRemote(
    () => props.client.getEncounter({ path: { encounterId: props.encounterId } }),
    [props.client, props.encounterId]
  );
  const prescriptions = useRemote(
    () =>
      props.client.listEncounterPrescriptions({
        path: { encounterId: props.encounterId },
        query: { limit: 50 }
      }),
    [props.client, props.encounterId]
  );
  const [medicationRows, setMedicationRows] = useState<readonly PublicJsonObject[]>([]);
  const [prescriptionCursor, setPrescriptionCursor] = useState<string | null>(null);
  const [prescriptionError, setPrescriptionError] = useState("");
  useEffect(() => {
    setMedicationRows(prescriptions.data?.prescriptions ?? []);
    setPrescriptionCursor(prescriptions.data?.nextCursor ?? null);
  }, [prescriptions.data]);
  const encounter = detail.data?.encounter;
  if (encounter && fieldText(encounter, "patientId") !== props.patientId) {
    return <p role="alert">This visit does not belong to the selected patient.</p>;
  }
  const providerName =
    props.providerOptions.find((item) => item.id === fieldText(encounter, "providerUserId"))
      ?.name || "Name unavailable in active staff directory";
  const assignedDoctor =
    props.profile.roles.includes("doctor") &&
    props.profile.user.id === fieldText(encounter, "providerUserId");
  const status = fieldText(encounter, "status");
  const canSign = assignedDoctor && can(props.profile, "clinical.note.sign");

  async function change(run: (key: string) => Promise<unknown>) {
    await props.mutate(run, async () => {
      await detail.refresh();
      await props.onChanged();
    });
  }

  async function loadMorePrescriptions() {
    if (!prescriptionCursor) return;
    try {
      setPrescriptionError("");
      const response = await props.client.listEncounterPrescriptions({
        path: { encounterId: props.encounterId },
        query: { cursor: prescriptionCursor, limit: 50 }
      });
      setMedicationRows((previous) => [
        ...previous,
        ...response.prescriptions.filter(
          (item) => !previous.some((old) => fieldText(old, "id") === fieldText(item, "id"))
        )
      ]);
      setPrescriptionCursor(response.nextCursor);
    } catch (error) {
      setPrescriptionError(errorMessage(error));
    }
  }

  return (
    <RemotePanel
      title="Selected visit"
      loading={detail.loading}
      error={detail.error}
      onRefresh={() => void detail.refresh().catch(() => undefined)}
    >
      {encounter ? (
        <>
          <p>
            Status: <strong>{status.replaceAll("_", " ")}</strong> · Assigned to {providerName}
          </p>
          {status === "scheduled" && can(props.profile, "clinical.note.write") ? (
            <button
              type="button"
              disabled={props.locked || !assignedDoctor}
              onClick={() =>
                void change((key) =>
                  props.client.startEncounter({
                    path: { encounterId: props.encounterId },
                    headers: { "idempotency-key": key }
                  })
                )
              }
            >
              Start consultation
            </button>
          ) : null}
          {status === "scheduled" && !assignedDoctor ? (
            <p>Only the assigned doctor can start this consultation here.</p>
          ) : null}
          {can(props.profile, "clinical.note.read") ? (
            <NoteEditor
              {...props}
              encounter={encounter}
              noteVersions={detail.data?.noteVersions ?? []}
              onChanged={detail.refresh}
              canSign={canSign}
              providerName={providerName}
            />
          ) : null}
          {can(props.profile, "prescription.write") ? (
            <PrescriptionEditor
              {...props}
              encounter={encounter}
              prescriptions={medicationRows}
              onChanged={async () => {
                await prescriptions.refresh();
                await detail.refresh();
              }}
              canSign={assignedDoctor && can(props.profile, "prescription.sign")}
              providerName={providerName}
            />
          ) : null}
          {prescriptions.error ? <p role="alert">Prescriptions: {prescriptions.error}</p> : null}
          {prescriptionCursor ? (
            <button type="button" onClick={() => void loadMorePrescriptions()}>
              Load older prescriptions
            </button>
          ) : null}
          {prescriptionError ? <p role="alert">{prescriptionError}</p> : null}
          {["signed", "amended"].includes(status) && canSign ? (
            <button
              type="button"
              disabled={props.locked}
              onClick={() =>
                void change((key) =>
                  props.client.closeEncounter({
                    path: { encounterId: props.encounterId },
                    headers: { "idempotency-key": key, "if-match": etag(encounter) }
                  })
                )
              }
            >
              Finish visit and complete linked appointment
            </button>
          ) : null}
          {status === "closed" ? (
            <p>Visit finished. Signed records remain available below.</p>
          ) : null}
        </>
      ) : !detail.loading ? (
        <p>Choose another visit or retry.</p>
      ) : null}
    </RemotePanel>
  );
}

function NoteEditor(
  props: ClinicalContext & {
    readonly encounter: VersionedPublicResource;
    readonly noteVersions: readonly PublicJsonObject[];
    readonly onChanged: () => Promise<void>;
    readonly canSign: boolean;
    readonly providerName: string;
  }
) {
  const draft = props.noteVersions.find((item) => fieldText(item, "status") === "draft");
  const signed = useMemo(
    () =>
      props.noteVersions.filter((item) =>
        ["signed", "amended"].includes(fieldText(item, "status"))
      ),
    [props.noteVersions]
  );
  const [recovered] = useState(() =>
    readUnsavedClinicalNote(props.scope, props.patientId, props.encounter.id)
  );
  const [content, setContent] = useState<NoteContent>(() => recovered?.content ?? {});
  const [dirty, setDirty] = useState(Boolean(recovered));
  const [baseVersion, setBaseVersion] = useState(
    recovered?.rowVersion ?? props.encounter.rowVersion
  );
  const [ready, setReady] = useState(recovered?.ready ?? false);
  const [reviewedId, setReviewedId] = useState("");
  const [amendReason, setAmendReason] = useState(recovered?.amendmentReason ?? "");
  const [selectedSignedId, setSelectedSignedId] = useState("");
  const [message, setMessage] = useState("");
  const status = fieldText(props.encounter, "status");
  const latestSigned =
    signed.find((item) => fieldText(item, "id") === selectedSignedId) ?? signed[0];
  const editable =
    can(props.profile, "clinical.note.write") &&
    !["signed", "amended", "closed", "cancelled"].includes(status);
  const amendable = props.canSign && signed.length > 0;
  const timeZone = props.profile.clinic.timezone || "UTC";

  useEffect(() => {
    if (!dirty) {
      setContent(noteContent(draft?.content ?? signed[0]?.content));
      setReady(status === "ready_for_sign");
      setBaseVersion(props.encounter.rowVersion);
    }
  }, [draft, signed, dirty, status, props.encounter.rowVersion]);
  useEffect(() => {
    setReviewedId("");
  }, [draft?.id, props.encounter.rowVersion]);
  const staleDraft = dirty && baseVersion !== props.encounter.rowVersion;
  useEffect(() => {
    if (dirty)
      rememberUnsavedClinicalNote(props.scope, {
        patientId: props.patientId,
        encounterId: props.encounter.id,
        rowVersion: baseVersion,
        content,
        ready,
        amendmentReason: amendReason
      });
    else forgetUnsavedClinicalNote(props.scope, props.patientId, props.encounter.id);
  }, [
    dirty,
    content,
    ready,
    amendReason,
    baseVersion,
    props.scope,
    props.patientId,
    props.encounter.id
  ]);
  const reportDirty = props.setNoteDirty;
  useEffect(() => {
    reportDirty(dirty);
    return () => reportDirty(false);
  }, [dirty, reportDirty]);

  function discard() {
    setContent(noteContent(draft?.content ?? signed[0]?.content));
    setReady(status === "ready_for_sign");
    setAmendReason("");
    setReviewedId("");
    setDirty(false);
    setMessage("Unsaved changes discarded. The saved record is unchanged.");
  }

  function currentContent() {
    const normalized = Object.fromEntries(
      NOTE_SECTIONS.map(([key]) => [key, content[key]?.trim() || ""]).filter(
        ([, value]) => value !== ""
      )
    );
    if (!Object.values(normalized).some(Boolean))
      throw new Error("Enter at least one note section.");
    return normalized;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (staleDraft) return;
    try {
      const body = { content: currentContent(), readyForSign: ready };
      setMessage("");
      const success = await props.mutate(
        (key) =>
          props.client.saveEncounterClinicalNoteDraft({
            path: { encounterId: props.encounter.id },
            headers: { "idempotency-key": key, "if-match": etag(props.encounter) },
            body
          }),
        async () => {
          setDirty(false);
          await props.onChanged();
        }
      );
      if (success)
        setMessage(
          ready ? "Draft saved as ready for the assigned doctor to review." : "Draft saved."
        );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function sign() {
    if (!draft || reviewedId !== fieldText(draft, "id") || dirty) return;
    const success = await props.mutate(
      (key) =>
        props.client.signEncounterClinicalNote({
          path: { encounterId: props.encounter.id },
          headers: { "idempotency-key": key, "if-match": etag(props.encounter) }
        }),
      props.onChanged
    );
    if (success) {
      setReviewedId("");
      setMessage("Clinical note signed.");
    }
  }

  async function amend(event: FormEvent) {
    event.preventDefault();
    if (staleDraft || !amendReason.trim()) return;
    try {
      const body = { content: currentContent(), amendmentReason: amendReason.trim() };
      setMessage("");
      const success = await props.mutate(
        (key) =>
          props.client.amendEncounterClinicalNote({
            path: { encounterId: props.encounter.id },
            headers: { "idempotency-key": key, "if-match": etag(props.encounter) },
            body
          }),
        async () => {
          setDirty(false);
          await props.onChanged();
        }
      );
      if (success) {
        setAmendReason("");
        setMessage("Signed correction appended; the earlier version remains in the record.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  function printNote(note: PublicJsonObject) {
    if (!["signed", "amended"].includes(fieldText(note, "status")) || !fieldText(note, "signedAt"))
      return;
    const noteFields = record(note.content);
    try {
      printClinicalDocument("Signed clinical note", [
        `Clinic: ${props.profile.clinic.name}`,
        `Patient: ${props.patientName}`,
        `Assigned provider: ${props.providerName}`,
        `Signed by: ${fieldText(note, "signedByDisplayName") || "Name unavailable"} (staff record ${fieldText(note, "signedByUserId")})`,
        `Signed: ${clinicDisplayTime(fieldText(note, "signedAt"), timeZone)}`,
        `Version: ${String(note.versionNumber ?? "unknown")} (${fieldText(note, "status")})`,
        ...NOTE_SECTIONS.map(([key, label]) => `${label}: ${fieldText(noteFields, key) || "—"}`),
        ...(fieldText(note, "amendmentReason")
          ? [`Correction reason: ${fieldText(note, "amendmentReason")}`]
          : [])
      ]);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <section aria-label="Clinical note">
      <h3>Clinical note</h3>
      {recovered && dirty ? (
        <p role="status">Your unsaved note was recovered in this tab. Review it before saving.</p>
      ) : null}
      {staleDraft ? (
        <p role="alert">
          The saved visit changed while this note was being edited. Your text is retained below.
          Review the latest saved record and preserve any needed text before discarding these
          changes and starting a fresh draft.
        </p>
      ) : null}
      {dirty ? <p role="status">Unsaved note changes. Save before navigating or signing.</p> : null}
      {dirty ? (
        <button type="button" disabled={props.locked} onClick={discard}>
          Discard unsaved note changes
        </button>
      ) : null}
      {editable || amendable ? (
        <form onSubmit={(event) => void (editable ? save(event) : amend(event))}>
          {NOTE_SECTIONS.map(([key, label]) => (
            <label key={key}>
              {label}
              <textarea
                disabled={props.locked}
                value={content[key] ?? ""}
                onChange={(event) => {
                  setContent((previous) => ({ ...previous, [key]: event.target.value }));
                  setDirty(true);
                  setReviewedId("");
                }}
              />
            </label>
          ))}
          {editable ? (
            <>
              <label>
                <input
                  type="checkbox"
                  disabled={props.locked || fieldText(props.encounter, "status") === "scheduled"}
                  checked={ready}
                  onChange={(event) => {
                    setReady(event.target.checked);
                    setDirty(true);
                    setReviewedId("");
                  }}
                />{" "}
                Ready for assigned doctor to review and sign
              </label>
              <button type="submit" disabled={props.locked || staleDraft}>
                Save note draft
              </button>
            </>
          ) : (
            <>
              <p>This appends a signed correction and keeps the earlier signed version.</p>
              <label>
                Reason for correction{" "}
                <textarea
                  disabled={props.locked}
                  value={amendReason}
                  onChange={(event) => {
                    setAmendReason(event.target.value);
                    setDirty(true);
                  }}
                  required
                />
              </label>
              <button type="submit" disabled={props.locked || staleDraft || !amendReason.trim()}>
                Sign correction
              </button>
            </>
          )}
        </form>
      ) : null}
      {draft ? (
        <div>
          <p>
            Draft version {String(draft.versionNumber ?? "?")} ·{" "}
            {status === "ready_for_sign" ? "ready for review" : "not yet marked ready"}. This is not
            a signed record.
          </p>
          {props.canSign && status === "ready_for_sign" ? (
            <>
              <label>
                <input
                  type="checkbox"
                  disabled={props.locked}
                  checked={reviewedId === fieldText(draft, "id")}
                  onChange={(event) =>
                    setReviewedId(event.target.checked ? fieldText(draft, "id") : "")
                  }
                />
                I reviewed this exact draft version {String(draft.versionNumber ?? "?")} and will
                sign it.
              </label>
              <button
                type="button"
                disabled={props.locked || dirty || reviewedId !== fieldText(draft, "id")}
                onClick={() => void sign()}
              >
                Sign reviewed note
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {signed.length ? (
        <div>
          <label>
            Signed version{" "}
            <select
              value={fieldText(latestSigned, "id")}
              onChange={(event) => setSelectedSignedId(event.target.value)}
            >
              {signed.map((item) => (
                <option key={fieldText(item, "id")} value={fieldText(item, "id")}>
                  Version {String(item.versionNumber ?? "?")} · {fieldText(item, "status")} ·{" "}
                  {clinicDisplayTime(fieldText(item, "signedAt"), timeZone)}
                </option>
              ))}
            </select>
          </label>
          {latestSigned ? (
            <>
              <dl>
                {NOTE_SECTIONS.map(([key, label]) => (
                  <div key={key}>
                    <dt>{label}</dt>
                    <dd>{fieldText(record(latestSigned.content), key) || "—"}</dd>
                  </div>
                ))}
              </dl>
              <button type="button" onClick={() => printNote(latestSigned)}>
                Print selected signed version
              </button>
            </>
          ) : null}
        </div>
      ) : (
        <p>No signed clinical note yet.</p>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

const EMPTY_MEDICATION: MedicationInput = {
  name: "",
  strength: "",
  route: "",
  frequency: "",
  duration: "",
  instructions: ""
};
const MEDICATION_FIELDS = [
  ["name", "Medication"],
  ["strength", "Strength"],
  ["route", "Route"],
  ["frequency", "Frequency"],
  ["duration", "Duration"],
  ["instructions", "Instructions"]
] as const;

function PrescriptionEditor(
  props: ClinicalContext & {
    readonly encounter: VersionedPublicResource;
    readonly prescriptions: readonly PublicJsonObject[];
    readonly onChanged: () => Promise<void>;
    readonly canSign: boolean;
    readonly providerName: string;
  }
) {
  const [medications, setMedications] = useState<MedicationInput[]>([{ ...EMPTY_MEDICATION }]);
  const [notes, setNotes] = useState("");
  const [reviewedId, setReviewedId] = useState("");
  const [message, setMessage] = useState("");
  const status = fieldText(props.encounter, "status");
  const timeZone = props.profile.clinic.timezone || "UTC";
  const draftable = !["scheduled", "closed", "cancelled"].includes(status);

  async function create(event: FormEvent) {
    event.preventDefault();
    try {
      const rows = prescriptionMedications(medications);
      const success = await props.mutate(
        (key) =>
          props.client.createEncounterPrescription({
            path: { encounterId: props.encounter.id },
            headers: { "idempotency-key": key },
            body: { medications: rows, notes: notes.trim() || undefined }
          }),
        props.onChanged
      );
      if (success) {
        setMedications([{ ...EMPTY_MEDICATION }]);
        setNotes("");
        setMessage("Prescription draft saved. A doctor must review and sign it.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function sign(prescription: PublicJsonObject) {
    const id = fieldText(prescription, "id");
    if (reviewedId !== id || fieldText(prescription, "status") !== "draft") return;
    const success = await props.mutate(
      (key) =>
        props.client.signPrescription({
          path: { prescriptionId: id },
          headers: { "idempotency-key": key }
        }),
      props.onChanged
    );
    if (success) {
      setReviewedId("");
      setMessage("Prescription signed.");
    }
  }

  function printPrescription(prescription: PublicJsonObject) {
    if (fieldText(prescription, "status") !== "signed" || !fieldText(prescription, "signedAt"))
      return;
    const rows = valueList(prescription.medications).map(record);
    try {
      printClinicalDocument("Signed prescription", [
        `Clinic: ${props.profile.clinic.name}`,
        `Patient: ${props.patientName}`,
        `Signing doctor: ${fieldText(prescription, "signedByDisplayName") || "Name unavailable; see the signing staff record below"}`,
        `Signed by staff record: ${fieldText(prescription, "signedByUserId")}`,
        `Signed: ${clinicDisplayTime(fieldText(prescription, "signedAt"), timeZone)}`,
        `Prescription version: ${fieldText(prescription, "versionNumber") || "Signed original"}`,
        ...rows.map(
          (row, index) =>
            `${index + 1}. ${fieldText(row, "name")} ${fieldText(row, "strength")} · ${fieldText(row, "route")} · ${fieldText(row, "frequency")} for ${fieldText(row, "duration")}${fieldText(row, "instructions") ? ` · ${fieldText(row, "instructions")}` : ""}`
        ),
        ...(fieldText(prescription, "notes") ? [`Notes: ${fieldText(prescription, "notes")}`] : [])
      ]);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <section aria-label="Prescriptions">
      <h3>Prescriptions</h3>
      {props.prescriptions.length ? (
        <ul>
          {props.prescriptions.map((item, index) => {
            const id = fieldText(item, "id");
            const signed = fieldText(item, "status") === "signed";
            return (
              <li key={id || index}>
                <strong>{signed ? "Signed" : "Draft, not valid for dispensing"}</strong>
                {fieldText(item, "createdAt")
                  ? ` · ${clinicDisplayTime(fieldText(item, "createdAt"), timeZone)}`
                  : ""}
                <ol>
                  {valueList(item.medications).map((medication, medIndex) => {
                    const row = record(medication);
                    return (
                      <li key={medIndex}>
                        {fieldText(row, "name")} {fieldText(row, "strength")} ·{" "}
                        {fieldText(row, "frequency")} for {fieldText(row, "duration")}
                      </li>
                    );
                  })}
                </ol>
                {signed ? (
                  <button type="button" onClick={() => printPrescription(item)}>
                    Print signed prescription
                  </button>
                ) : props.canSign && draftable ? (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={reviewedId === id}
                        onChange={(event) => setReviewedId(event.target.checked ? id : "")}
                      />{" "}
                      I reviewed every medication in this draft.
                    </label>
                    <button
                      type="button"
                      disabled={props.locked || reviewedId !== id}
                      onClick={() => void sign(item)}
                    >
                      Sign prescription
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No prescriptions found for this visit.</p>
      )}
      {draftable ? (
        <form onSubmit={(event) => void create(event)}>
          <h4>New prescription draft</h4>
          {medications.map((row, index) => (
            <fieldset key={index}>
              <legend>Medication {index + 1}</legend>
              {MEDICATION_FIELDS.map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    value={row[key]}
                    required={key === "name" || key === "frequency" || key === "duration"}
                    onChange={(event) =>
                      setMedications((previous) =>
                        previous.map((entry, rowIndex) =>
                          rowIndex === index ? { ...entry, [key]: event.target.value } : entry
                        )
                      )
                    }
                  />
                </label>
              ))}
              {medications.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    setMedications((previous) =>
                      previous.filter((_, rowIndex) => rowIndex !== index)
                    )
                  }
                >
                  Remove medication
                </button>
              ) : null}
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() => setMedications((previous) => [...previous, { ...EMPTY_MEDICATION }])}
          >
            Add medication
          </button>
          <label>
            Additional prescription notes{" "}
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <button type="submit" disabled={props.locked}>
            Save prescription draft
          </button>
        </form>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}

const FINDING_TYPES = [
  "caries",
  "cervical_erosion",
  "restoration",
  "crown",
  "missing",
  "mobility",
  "rct",
  "periodontal_note",
  "watch_item"
] as const;
const TOOTH_SURFACES = ["distal", "occlusal", "buccal", "lingual", "mesial", "cervical"] as const;
const FINDING_STATUSES = ["active", "watch", "treated", "historical", "entered_in_error"] as const;

function DentalPanel(props: ClinicalContext) {
  const chart = useRemote(
    () => props.client.getPatientDentalChart({ path: { patientId: props.patientId } }),
    [props.client, props.patientId]
  );
  const [visitPages, setVisitPages] = useState<(string | undefined)[]>([undefined]);
  const visitCursor = visitPages.at(-1);
  const encounters = useRemote(
    () =>
      props.client.listPatientEncounters({
        path: { patientId: props.patientId },
        query: { limit: 100, cursor: visitCursor }
      }),
    [props.client, props.patientId, visitCursor]
  );
  const [tooth, setTooth] = useState("");
  const [surface, setSurface] = useState<(typeof TOOTH_SURFACES)[number] | "">("");
  const [findingType, setFindingType] = useState<(typeof FINDING_TYPES)[number]>("caries");
  const [notes, setNotes] = useState("");
  const [encounterId, setEncounterId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedTooth, setSelectedTooth] = useState("");
  const [selectedSurface, setSelectedSurface] = useState("");
  const [selectedType, setSelectedType] = useState<(typeof FINDING_TYPES)[number]>("caries");
  const [selectedNotes, setSelectedNotes] = useState("");
  const [status, setStatus] = useState<(typeof FINDING_STATUSES)[number]>("active");
  const [reviewStatus, setReviewStatus] = useState<"needs_review" | "reviewed">("needs_review");
  const [changeReason, setChangeReason] = useState("");
  const [snapshotReason, setSnapshotReason] = useState("");
  const [message, setMessage] = useState("");
  const selected = chart.data?.findings.find((item) => item.id === selectedId);
  const timeZone = props.profile.clinic.timezone || "UTC";

  async function add(event: FormEvent) {
    event.preventDefault();
    try {
      const toothNumber = assertFdiTooth(tooth);
      const success = await props.mutate(
        (key) =>
          props.client.createPatientDentalFinding({
            path: { patientId: props.patientId },
            headers: { "idempotency-key": key },
            body: {
              toothNumber,
              findingType,
              surface: surface || undefined,
              notes: notes.trim() || undefined,
              encounterId: encounterId || undefined,
              source: "manual",
              reviewStatus: "needs_review"
            }
          }),
        chart.refresh
      );
      if (success) {
        setTooth("");
        setNotes("");
        setMessage("Dental finding recorded.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function update(event: FormEvent) {
    event.preventDefault();
    if (!selected || !changeReason.trim()) return;
    try {
      const toothNumber = assertFdiTooth(selectedTooth);
      const success = await props.mutate(
        (key) =>
          props.client.updateDentalFinding({
            path: { findingId: selected.id },
            headers: { "idempotency-key": key, "if-match": etag(selected) },
            body: {
              toothNumber,
              findingType: selectedType,
              surface: selectedSurface || null,
              notes: selectedNotes.trim() || null,
              status,
              reviewStatus,
              changeReason: changeReason.trim()
            }
          }),
        chart.refresh
      );
      if (success) {
        setChangeReason("");
        setMessage("Finding updated with history.");
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function snapshot(event: FormEvent) {
    event.preventDefault();
    const success = await props.mutate(
      (key) =>
        props.client.createDentalChartSnapshot({
          path: { patientId: props.patientId },
          headers: { "idempotency-key": key },
          body: {
            reason: snapshotReason.trim() || undefined,
            encounterId: encounterId || undefined,
            provenance: { capturedByUserId: props.profile.user.id }
          }
        }),
      chart.refresh
    );
    if (success) {
      setSnapshotReason("");
      setMessage("Dental chart snapshot recorded.");
    }
  }

  return (
    <RemotePanel
      title="Dental chart"
      loading={chart.loading}
      error={chart.error}
      onRefresh={() => void chart.refresh().catch(() => undefined)}
    >
      <p>FDI numbering is used for permanent and primary teeth.</p>
      {chart.data ? (
        <>
          {chart.data.findings.length ? (
            <ul>
              {chart.data.findings.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={selectedId === item.id ? "true" : undefined}
                    onClick={() => {
                      setSelectedId(item.id);
                      setSelectedTooth(fieldText(item, "toothNumber"));
                      setSelectedSurface(fieldText(item, "surface"));
                      setSelectedType(
                        FINDING_TYPES.find((value) => value === fieldText(item, "findingType")) ??
                          "caries"
                      );
                      setSelectedNotes(fieldText(item, "notes"));
                      setStatus(
                        FINDING_STATUSES.find((value) => value === fieldText(item, "status")) ??
                          "active"
                      );
                      setReviewStatus(
                        fieldText(item, "reviewStatus") === "reviewed" ? "reviewed" : "needs_review"
                      );
                    }}
                  >
                    Tooth {fieldText(item, "toothNumber")} ·{" "}
                    {fieldText(item, "findingType").replaceAll("_", " ")} ·{" "}
                    {fieldText(item, "status")}
                  </button>
                  {fieldText(item, "notes") ? <p>{fieldText(item, "notes")}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>No dental findings recorded.</p>
          )}
          <p>{chart.data.snapshots.length} chart snapshots recorded.</p>
        </>
      ) : null}
      {can(props.profile, "dental.chart.write") ? (
        <>
          <label>
            Related visit, if applicable{" "}
            <select value={encounterId} onChange={(event) => setEncounterId(event.target.value)}>
              <option value="">No linked visit</option>
              {encounters.data?.encounters.map((item) => (
                <option key={item.id} value={item.id}>
                  {clinicDisplayTime(fieldText(item, "createdAt"), timeZone)} ·{" "}
                  {fieldText(item, "status").replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <div className="workflow-toolbar">
            <button
              type="button"
              disabled={props.locked || encounters.loading || visitPages.length < 2}
              onClick={() => {
                setEncounterId("");
                setVisitPages(visitPages.slice(0, -1));
              }}
            >
              Newer visits
            </button>
            <button
              type="button"
              disabled={props.locked || encounters.loading || !encounters.data?.nextCursor}
              onClick={() => {
                setEncounterId("");
                setVisitPages([...visitPages, encounters.data?.nextCursor ?? undefined]);
              }}
            >
              Older visits
            </button>
          </div>
          <form onSubmit={(event) => void add(event)}>
            <h3>Add finding</h3>
            <label>
              FDI tooth number{" "}
              <input
                inputMode="numeric"
                maxLength={2}
                value={tooth}
                onChange={(event) => setTooth(event.target.value)}
                required
                placeholder="e.g. 16"
              />
            </label>
            <label>
              Surface{" "}
              <select
                value={surface}
                onChange={(event) => setSurface(event.target.value as typeof surface)}
              >
                <option value="">Whole tooth or unspecified</option>
                {TOOTH_SURFACES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Finding{" "}
              <select
                value={findingType}
                onChange={(event) => setFindingType(event.target.value as typeof findingType)}
              >
                {FINDING_TYPES.map((item) => (
                  <option key={item} value={item}>
                    {item.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Clinical notes{" "}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </label>
            <button type="submit" disabled={props.locked}>
              Record finding
            </button>
          </form>
          {selected ? (
            <form onSubmit={(event) => void update(event)}>
              <h3>Review selected finding on tooth {fieldText(selected, "toothNumber")}</h3>
              <label>
                FDI tooth number{" "}
                <input
                  inputMode="numeric"
                  maxLength={2}
                  value={selectedTooth}
                  onChange={(event) => setSelectedTooth(event.target.value)}
                  required
                />
              </label>
              <label>
                Surface{" "}
                <select
                  value={selectedSurface}
                  onChange={(event) => setSelectedSurface(event.target.value)}
                >
                  <option value="">Whole tooth or unspecified</option>
                  {TOOTH_SURFACES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Finding{" "}
                <select
                  value={selectedType}
                  onChange={(event) => setSelectedType(event.target.value as typeof selectedType)}
                >
                  {FINDING_TYPES.map((item) => (
                    <option key={item} value={item}>
                      {item.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Clinical notes{" "}
                <textarea
                  value={selectedNotes}
                  onChange={(event) => setSelectedNotes(event.target.value)}
                />
              </label>
              <label>
                Status{" "}
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as typeof status)}
                >
                  {FINDING_STATUSES.map((item) => (
                    <option key={item} value={item}>
                      {item.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review status{" "}
                <select
                  value={reviewStatus}
                  onChange={(event) => setReviewStatus(event.target.value as typeof reviewStatus)}
                >
                  <option value="needs_review">Needs review</option>
                  <option value="reviewed">Reviewed</option>
                </select>
              </label>
              <label>
                Reason for change{" "}
                <textarea
                  value={changeReason}
                  onChange={(event) => setChangeReason(event.target.value)}
                  required
                />
              </label>
              <button type="submit" disabled={props.locked || !changeReason.trim()}>
                Save finding change
              </button>
            </form>
          ) : null}
        </>
      ) : null}
      {can(props.profile, "dental.chart.snapshot") ? (
        <form onSubmit={(event) => void snapshot(event)}>
          <h3>Record chart snapshot</h3>
          <label>
            Snapshot reason{" "}
            <input
              value={snapshotReason}
              onChange={(event) => setSnapshotReason(event.target.value)}
            />
          </label>
          <button type="submit" disabled={props.locked}>
            Save snapshot
          </button>
        </form>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </RemotePanel>
  );
}
