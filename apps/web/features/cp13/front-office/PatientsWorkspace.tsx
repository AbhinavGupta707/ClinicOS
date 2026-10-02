"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ClinicOsApiError,
  type ClinicOsApiClient,
  type VersionedPublicResource,
  type PublicJsonObject,
  type CreatePatientRequest
} from "@clinic-os/api-client-generated";
import type { MeProfile } from "@/lib/me";
import { PatientSelector } from "../shared/PatientSelector";
import { WorkflowAction, useWorkflowAction } from "../shared/WorkflowAction";
import { WorkflowCard, useWorkflowData } from "../shared/WorkflowData";
import { etag, fieldText, record, valueList } from "../shared/workflow-values";
import { clinicLocalDate } from "../runtime-helpers";

type Props = {
  client: ClinicOsApiClient;
  profile: MeProfile;
  patientId: string | null;
  onSelectPatient: (id: string) => void;
  onOpenPatientProfile: (id: string) => void;
};
export function PatientsWorkspace(props: Props) {
  const [creating, setCreating] = useState(false);
  const action = useWorkflowAction(
    `${props.profile.tenant.id}:${props.profile.clinic.id}:${props.profile.user.id}`
  );
  const patient = useWorkflowData(
    () =>
      props.patientId
        ? props.client.getPatientDemographics({ path: { patientId: props.patientId } })
        : Promise.resolve(null),
    [props.client, props.patientId]
  );
  const saved = async (id: string) => {
    props.onSelectPatient(id);
    setCreating(false);
    if (id === props.patientId) await patient.refresh();
  };
  return (
    <div className="daily-workspace" data-testid="patient-management">
      <h1>Patients</h1>
      <fieldset disabled={action.locked}>
        <PatientSelector {...props} />
      </fieldset>
      <WorkflowAction
        {...action}
        onRecover={() =>
          void action.recover(async () => {
            await patient.refresh();
          })
        }
      />
      {props.profile.permissions.includes("patient.write") ? (
        <button type="button" disabled={action.locked} onClick={() => setCreating(!creating)}>
          {creating ? "Close registration" : "Register patient"}
        </button>
      ) : null}
      {creating ? (
        <WorkflowCard title="Register patient">
          <PatientForm {...props} key="new" action={action} onSaved={saved} />
        </WorkflowCard>
      ) : null}
      {!creating && props.patientId ? (
        <WorkflowCard
          title="Patient details"
          loading={patient.loading}
          error={patient.error}
          onRefresh={() => void patient.refresh().catch(() => undefined)}
        >
          {patient.data?.patient.id === props.patientId ? (
            <>
              <PatientForm
                {...props}
                key={`${patient.data.patient.id}:${patient.data.patient.rowVersion}`}
                patient={patient.data.patient}
                action={{ ...action, locked: action.locked || patient.loading || !!patient.error }}
                onSaved={saved}
              />
              <nav className="workflow-links" aria-label="Patient workflows">
                <Link href="/surface/appointments">Book a visit</Link>
                <Link href="/surface/checkout">Treatment and checkout</Link>
                {props.profile.permissions.includes("patient.phi.read") ? (
                  <>
                    <button
                      type="button"
                      onClick={() => props.onOpenPatientProfile(props.patientId!)}
                    >
                      Open clinical profile
                    </button>
                    <Link href="/surface/intake">Intake</Link>
                    <Link href="/surface/consent">Consent</Link>
                    <Link href="/surface/encounter">Consultation</Link>
                    <Link href="/surface/dental-media">Dental record</Link>
                  </>
                ) : null}
              </nav>
            </>
          ) : null}
        </WorkflowCard>
      ) : !creating ? (
        <p>Search by name or phone, or register a patient.</p>
      ) : null}
    </div>
  );
}
function PatientForm(
  props: Props & {
    patient?: VersionedPublicResource;
    action: ReturnType<typeof useWorkflowAction>;
    onSaved: (id: string) => Promise<void>;
  }
) {
  const [name, setName] = useState(fieldText(props.patient, "fullName")),
    [phone, setPhone] = useState(fieldText(props.patient, "phone")),
    [email, setEmail] = useState(fieldText(props.patient, "email")),
    [dob, setDob] = useState(fieldText(props.patient, "dateOfBirth")),
    [gender, setGender] = useState<CreatePatientRequest["body"]["gender"]>(
      (fieldText(props.patient, "gender") || "unknown") as CreatePatientRequest["body"]["gender"]
    );
  const [source, setSource] = useState<CreatePatientRequest["body"]["source"]>("manual"),
    [contactReason, setContactReason] = useState(""),
    [duplicates, setDuplicates] = useState<PublicJsonObject[]>([]),
    [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [error, setError] = useState("");
  const clearReview = () => {
    setDuplicates([]);
    setReason("");
    setReviewed(false);
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name.trim() || (phone && !/^\+[1-9][0-9]{7,14}$/.test(phone.trim()))) {
      setError(
        "Enter the patient's name and a phone with country code, or leave phone blank with a reason."
      );
      return;
    }
    if (duplicates.length && (!reviewed || reason.trim().length < 5)) {
      setError("Review every suggested match and record why this is a separate person.");
      return;
    }
    const body = {
      fullName: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      dateOfBirth: dob || null,
      gender,
      contactUnavailableReason: phone.trim() ? undefined : contactReason.trim(),
      duplicateReview: duplicates.length
        ? {
            patientIds: duplicates.map((d) => fieldText(record(d.patient), "id")),
            reason: reason.trim()
          }
        : undefined
    };
    await props.action.execute(
      async (key) => {
        try {
          return props.patient
            ? await props.client.updatePatient({
                path: { patientId: props.patient.id },
                headers: { "idempotency-key": key, "if-match": etag(props.patient) },
                body
              })
            : await props.client.createPatient({
                headers: { "idempotency-key": key },
                body: { ...body, source }
              });
        } catch (cause) {
          if (
            cause instanceof ClinicOsApiError &&
            cause.details.reason === "duplicate_review_required"
          ) {
            const preview = await props.client.previewPatientDuplicates({
              headers: { "idempotency-key": key },
              body: {
                fullName: body.fullName,
                phone: body.phone,
                excludePatientId: props.patient?.id
              }
            });
            setDuplicates(preview.suggestions.map(record));
            setReviewed(false);
          }
          throw cause;
        }
      },
      async (result) => props.onSaved(result.patient.id)
    );
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <fieldset
        disabled={props.action.locked || !props.profile.permissions.includes("patient.write")}
      >
        <legend>{props.patient ? "Edit demographics" : "Patient registration"}</legend>
        <div className="workflow-fields">
          <label>
            Full name
            <input
              required
              maxLength={200}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                clearReview();
              }}
              autoComplete="off"
            />
          </label>
          <label>
            Phone with country code
            <input
              type="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                clearReview();
              }}
              placeholder="+91…"
              autoComplete="off"
            />
          </label>
          {!phone.trim() ? (
            <label>
              Why no contact number is available
              <textarea
                required
                minLength={5}
                maxLength={500}
                value={contactReason}
                onChange={(event) => setContactReason(event.target.value)}
              />
            </label>
          ) : null}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </label>
          <label>
            Date of birth
            <input
              type="date"
              max={clinicLocalDate(new Date(), props.profile.clinic.timezone!)}
              value={dob}
              onChange={(event) => setDob(event.target.value)}
            />
          </label>
          <label>
            Gender
            <select
              value={gender}
              onChange={(event) => setGender(event.target.value as typeof gender)}
            >
              {["unknown", "female", "male", "other"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {!props.patient ? (
            <label>
              How the patient reached the clinic
              <select
                value={source}
                onChange={(event) => setSource(event.target.value as typeof source)}
              >
                {["manual", "walkin", "call", "whatsapp", "practo", "google", "referral"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  )
                )}
              </select>
            </label>
          ) : null}
        </div>
        <p>
          A shared family phone does not mean two people should be merged. Leave unknown details
          blank; messaging stays unavailable without a valid contact and consent.
        </p>
        {duplicates.length ? (
          <section aria-label="Review possible duplicate patients">
            <h3>Review possible matches</h3>
            <ul>
              {duplicates.map((item, index) => {
                const patient = record(item.patient);
                return (
                  <li key={index}>
                    <button type="button" onClick={() => props.onSaved(fieldText(patient, "id"))}>
                      {fieldText(patient, "fullName")} · {fieldText(patient, "phone") || "No phone"}
                    </button>{" "}
                    · {valueList(item.reasons).join(", ").replaceAll("_", " ")}
                  </li>
                );
              })}
            </ul>
            <label>
              Reason this is a separate person
              <textarea
                minLength={5}
                maxLength={500}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              I checked every match and confirmed these are different people.
            </label>
          </section>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit">{props.patient ? "Save demographics" : "Create patient"}</button>
      </fieldset>
    </form>
  );
}
