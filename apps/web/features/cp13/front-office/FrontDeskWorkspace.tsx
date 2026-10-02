"use client";

import type { ClinicOsApiClient, CreatePatientRequest } from "@clinic-os/api-client-generated";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import type { MeProfile } from "@/lib/me";
import { WeekCalendar } from "./WeekCalendar";
import { clinicLocalDate } from "../runtime-helpers";
import { FrontOfficeDayPanel, FrontOfficePatientSearchPanel } from "./components";
import {
  classifyFrontOfficeLoadFailure,
  searchFrontOfficePatients,
  type FrontOfficeDayData,
  type FrontOfficeLoadState,
  type FrontOfficePatientSearchData,
  type FrontOfficePatientSearchResult
} from "./loaders";
import {
  clinicDateTime,
  clinicDateTimeToInstant,
  createFrontDeskCommand,
  frontDeskCommandForScope,
  loadBookingConfiguration,
  mutationProblem,
  type BookingConfiguration
} from "./front-desk";

type Appointment = FrontOfficeDayData["dashboard"]["clinicDayAppointments"][number];
type QueueSelection = { kind: "queue"; id: string; version: number; status: string; name: string };
type Selection =
  | QueueSelection
  | { kind: "book" }
  | { kind: "reschedule"; appointment: Appointment }
  | { kind: "confirmed" | "cancelled" | "no_show" | "check_in"; appointment: Appointment };
const SOURCE_OPTIONS = [
  "manual",
  "walkin",
  "call",
  "whatsapp",
  "practo",
  "google",
  "referral"
] as const;

const CommandContext = createContext<ReturnType<typeof createFrontDeskCommand> | null>(null);
function useCommand() {
  const sharedCommand = useContext(CommandContext);
  if (!sharedCommand) throw new Error("Front desk command context is missing.");
  const command = useRef(sharedCommand);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; uncertain: boolean } | null>(null);
  async function run(action: (key: string) => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await command.current.execute(action);
    } catch (error) {
      setProblem(mutationProblem(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { run, busy, problem, locked: busy || Boolean(problem?.uncertain) };
}

interface FrontDeskProps {
  client: ClinicOsApiClient;
  profile: MeProfile;
  onOpenPatient: (id: string) => void;
}
export function FrontDeskWorkspace(props: FrontDeskProps) {
  const scope = [props.profile.tenant.id, props.profile.clinic.id, props.profile.user.id].join(":");
  const command = useMemo(() => frontDeskCommandForScope(scope), [scope]);
  const [recover, setRecover] = useState(() => command.hasPending());
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) {
      if (command.hasPending()) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [command]);
  return (
    <CommandContext.Provider value={command}>
      {recover ? (
        <section className="front-desk__card" aria-label="Recover front desk save">
          <h1>Resolve the previous save</h1>
          <p>
            A front-desk request has no confirmed outcome yet. Recover that request before making
            another booking. Recovery uses the original operation key.
          </p>
          {message ? <p role="alert">{message}</p> : null}
          <button
            disabled={recovering}
            onClick={() => {
              const recovery = command.recover();
              if (!recovery) {
                setMessage(
                  "The previous request has finished. Review the refreshed schedule or search for the patient before proceeding."
                );
                setRecover(false);
                return;
              }
              setRecovering(true);
              void recovery
                .then(() => {
                  setMessage(
                    "Previous save recovered. Review the schedule or search for the patient before proceeding."
                  );
                  setRecover(false);
                })
                .catch((error) => {
                  setMessage(mutationProblem(error).message);
                  if (!command.hasPending()) setRecover(false);
                })
                .finally(() => setRecovering(false));
            }}
            type="button"
          >
            {recovering ? "Recovering…" : "Recover previous save"}
          </button>
        </section>
      ) : (
        <>
          {message ? (
            <p role="status" className="front-desk__notice">
              {message}
            </p>
          ) : null}
          <FrontDeskBody {...props} />
        </>
      )}
    </CommandContext.Provider>
  );
}
function FrontDeskBody(props: FrontDeskProps) {
  const timeZone = props.profile.clinic.timezone;
  const today = safeClinicDay(timeZone);
  const [date, setDate] = useState(today ?? "");
  const [week, setWeek] = useState(false);
  const [day, setDay] = useState<FrontOfficeLoadState<FrontOfficeDayData>>({ status: "loading" });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [notice, setNotice] = useState("");
  const request = useRef({ value: 0 });
  const load = useCallback(async () => {
    const generation = ++request.current.value;
    if (!date || !timeZone) return;
    setDay({ status: "loading" });
    try {
      const { dashboard } = await props.client.getMorningDashboard({ query: { date } });
      if (generation !== request.current.value) return;
      setDay({
        status: "ready",
        refreshedAt: new Date().toISOString(),
        data: {
          dashboard,
          queue: dashboard.queue,
          leads: dashboard.openLeads,
          intakeTemplates: []
        }
      });
    } catch (error) {
      if (generation === request.current.value) setDay(classifyFrontOfficeLoadFailure(error));
    }
  }, [date, props.client, timeZone]);
  useEffect(() => {
    const counter = request.current;
    void load();
    return () => {
      counter.value++;
    };
  }, [load]);
  // Passive refresh pauses during a review/mutation. Every mutation still uses
  // the reviewed row version, so another desk cannot silently overwrite it.
  useEffect(() => {
    if (selection) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load, selection]);
  const canSchedule = props.profile.permissions.includes("schedule.write");
  const canQueue = props.profile.permissions.includes("queue.manage");
  const canRegister = props.profile.permissions.includes("patient.write");
  async function saved(message: string, nextDate?: string) {
    setNotice(message);
    setSelection(null);
    if (nextDate && nextDate !== date) setDate(nextDate);
    else await load();
  }
  if (!timeZone || !today)
    return (
      <section role="alert" className="cp13-action-card">
        The clinic timezone is unavailable. Scheduling is disabled until clinic configuration is
        corrected.
      </section>
    );
  return (
    <section className="cp13-runtime front-desk" data-testid="front-desk-workspace">
      <div className="front-desk__toolbar">
        <label>
          Schedule date
          <input
            type="date"
            value={date}
            disabled={Boolean(selection)}
            onChange={(event) => {
              if (event.target.value) {
                setDate(event.target.value);
                setNotice("");
              }
            }}
          />
        </label>
        <button type="button" disabled={Boolean(selection)} onClick={() => setDate(today)}>
          Today
        </button>
        <span>Clinic time · {timeZone}</span>
        <button
          type="button"
          disabled={Boolean(selection)}
          aria-pressed={week}
          onClick={() => setWeek(!week)}
        >
          {week ? "Close week view" : "Week view"}
        </button>
        {canSchedule ? (
          <button
            type="button"
            className="button-link button-link--primary"
            disabled={Boolean(selection)}
            onClick={() => {
              setNotice("");
              setSelection({ kind: "book" });
            }}
          >
            Book appointment
          </button>
        ) : null}
      </div>
      {week ? (
        <WeekCalendar
          client={props.client}
          date={date}
          timeZone={timeZone}
          disabled={Boolean(selection)}
          onChooseDay={(next) => {
            setDate(next);
            setWeek(false);
          }}
        />
      ) : null}
      <p className="front-desk__hint">
        The schedule refreshes every 30 seconds while visible. Check-in and calling a patient are
        staff-recorded actions. Messaging delivery is separate.
      </p>
      {notice ? (
        <p role="status" className="front-desk__notice">
          {notice}
        </p>
      ) : null}
      {selection ? (
        selection.kind === "queue" ? (
          <QueueAction
            client={props.client}
            {...selection}
            onClose={() => setSelection(null)}
            onSaved={() => saved("Queue updated.")}
          />
        ) : selection.kind === "book" || selection.kind === "reschedule" ? (
          <BookingEditor
            key={selection.kind === "book" ? "new" : selection.appointment.id}
            client={props.client}
            timeZone={timeZone}
            date={date}
            canRegister={canRegister}
            appointment={selection.kind === "reschedule" ? selection.appointment : undefined}
            onClose={() => setSelection(null)}
            onSaved={saved}
          />
        ) : (
          <AppointmentAction
            client={props.client}
            selection={selection}
            onClose={() => setSelection(null)}
            onSaved={saved}
          />
        )
      ) : null}
      <FrontOfficeDayPanel
        canOpenPatient={props.profile.permissions.includes("patient.phi.read")}
        state={day}
        onRefresh={load}
        timeZone={timeZone}
        heading={date === today ? undefined : "Appointments"}
        onOpenPatient={props.onOpenPatient}
        renderActions={(appointment) => (
          <>
            {canSchedule && ["requested", "booked", "confirmed"].includes(appointment.status) ? (
              <>
                <button
                  type="button"
                  disabled={Boolean(selection)}
                  onClick={() => setSelection({ kind: "reschedule", appointment })}
                >
                  Reschedule
                </button>
                {appointment.status !== "confirmed" ? (
                  <button
                    type="button"
                    disabled={Boolean(selection)}
                    onClick={() => setSelection({ kind: "confirmed", appointment })}
                  >
                    Record confirmation
                  </button>
                ) : null}
                {["booked", "confirmed"].includes(appointment.status) &&
                Date.parse(appointment.endAt) <= Date.now() ? (
                  <button
                    type="button"
                    disabled={Boolean(selection)}
                    onClick={() => setSelection({ kind: "no_show", appointment })}
                  >
                    Mark no-show
                  </button>
                ) : null}
              </>
            ) : null}
            {canSchedule &&
            ["requested", "booked", "confirmed", "checked_in"].includes(appointment.status) ? (
              <button
                type="button"
                disabled={Boolean(selection)}
                onClick={() => setSelection({ kind: "cancelled", appointment })}
              >
                Cancel appointment
              </button>
            ) : null}
            {canQueue && date === today && ["booked", "confirmed"].includes(appointment.status) ? (
              <button
                type="button"
                disabled={Boolean(selection)}
                onClick={() => setSelection({ kind: "check_in", appointment })}
              >
                Check in
              </button>
            ) : null}
          </>
        )}
      />
      {canQueue && day.status === "ready" && date === today ? (
        <section className="front-desk__card" aria-label="Reception queue">
          <h2>Reception queue</h2>
          <p>
            Call a waiting patient when the team is ready. Starting or completing a consultation
            belongs to the clinical workflow.
          </p>
          {day.data.queue.filter((entry) => ["waiting", "called"].includes(String(entry.status)))
            .length === 0 ? (
            <p>No waiting or called patients in the loaded queue.</p>
          ) : null}
          {day.data.queue
            .filter((entry) => ["waiting", "called"].includes(String(entry.status)))
            .map((entry) => {
              const appointment = day.data.dashboard.clinicDayAppointments.find(
                (item) => item.id === entry.appointmentId
              );
              return (
                <div key={String(entry.id)} className="front-desk__queue-row">
                  <span>
                    <strong>
                      {appointment?.patientName ?? "Patient outside the loaded schedule"}
                    </strong>{" "}
                    · {String(entry.status)}
                  </span>
                  <button
                    type="button"
                    disabled={Boolean(selection) || appointment?.status !== "checked_in"}
                    onClick={() =>
                      setSelection({
                        kind: "queue",
                        id: String(entry.id),
                        version: Number(entry.rowVersion),
                        status: String(entry.status),
                        name: appointment?.patientName ?? ""
                      })
                    }
                  >
                    {entry.status === "waiting" ? "Call patient" : "Return to waiting"}
                  </button>
                </div>
              );
            })}
        </section>
      ) : null}
      {day.status !== "ready" && day.status !== "loading" ? (
        <button type="button" onClick={() => void load()}>
          Retry schedule
        </button>
      ) : null}
    </section>
  );
}

function BookingEditor(props: {
  client: ClinicOsApiClient;
  date: string;
  timeZone: string;
  canRegister: boolean;
  appointment?: Appointment;
  onClose: () => void;
  onSaved: (message: string, date?: string) => Promise<void>;
}) {
  const appointment = props.appointment;
  const [config, setConfig] = useState<BookingConfiguration | null>(null);
  const [configError, setConfigError] = useState("");
  const [configAttempt, setConfigAttempt] = useState(0);
  const [patient, setPatient] = useState<FrontOfficePatientSearchResult | null>(
    appointment
      ? {
          id: appointment.patientId,
          fullName: appointment.patientName,
          phone: appointment.patientPhone,
          source: appointment.source
        }
      : null
  );
  const [queryState, setQueryState] = useState<
    FrontOfficeLoadState<FrontOfficePatientSearchData> | { status: "idle" }
  >({ status: "idle" });
  const searchGeneration = useRef({ value: 0 });
  const [register, setRegister] = useState(false);
  const [registrationLocked, setRegistrationLocked] = useState(false);
  const [doctor, setDoctor] = useState(appointment?.providerUserId ?? "");
  const [type, setType] = useState(appointment?.appointmentTypeId ?? "");
  const [chair, setChair] = useState(appointment?.chairId ?? "");
  const [localTime, setLocalTime] = useState(
    appointment ? clinicDateTime(appointment.startAt, props.timeZone) : `${props.date}T09:00`
  );
  const [duration, setDuration] = useState(
    appointment
      ? String((Date.parse(appointment.endAt) - Date.parse(appointment.startAt)) / 60000)
      : "30"
  );
  const [source, setSource] = useState<(typeof SOURCE_OPTIONS)[number]>("manual");
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [validation, setValidation] = useState("");
  const command = useCommand();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const counter = searchGeneration.current;
    heading.current?.focus();
    return () => {
      counter.value++;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setConfig(null);
    setConfigError("");
    void loadBookingConfiguration(props.client)
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch(() => {
        if (active)
          setConfigError(
            "Scheduling configuration could not be loaded. Retry or ask the clinic administrator to check access and setup."
          );
      });
    return () => {
      active = false;
    };
  }, [props.client, configAttempt]);
  async function search(query: string) {
    const generation = ++searchGeneration.current.value;
    setQueryState({ status: "loading" });
    const result = await searchFrontOfficePatients(props.client, query);
    if (generation === searchGeneration.current.value) setQueryState(result);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidation("");
    if (!patient || !reviewed || !config) return;
    let startAt: string;
    try {
      startAt = clinicDateTimeToInstant(localTime, props.timeZone);
    } catch (error) {
      setValidation(error instanceof Error ? error.message : "Invalid appointment time.");
      return;
    }
    const durationMinutes = Number(duration);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720) {
      setValidation("Duration must be 5–720 whole minutes.");
      return;
    }
    const schedule = {
      providerUserId: doctor,
      appointmentTypeId: type,
      chairId: chair || null,
      startAt,
      durationMinutes
    };
    await command.run(async (key) => {
      if (appointment)
        await props.client.updateAppointment({
          path: { appointmentId: appointment.id },
          headers: { "idempotency-key": key, "if-match": `"rv-${appointment.rowVersion}"` },
          body: { schedule, changeReason: reason.trim() }
        });
      else
        await props.client.createAppointment({
          headers: { "idempotency-key": key },
          body: {
            ...schedule,
            patientId: patient.id,
            source,
            status: "booked",
            reason: reason.trim() || null
          }
        });
      await props.onSaved(
        appointment
          ? "Appointment rescheduled. Confirm the new time with the patient."
          : "Appointment booked. A confirmation request was recorded; this does not mean a message was delivered.",
        localTime.slice(0, 10)
      );
    });
  }
  return (
    <section
      className="front-desk__card"
      aria-label={appointment ? "Reschedule appointment" : "Book appointment"}
    >
      <h2 tabIndex={-1} ref={heading}>
        {appointment ? "Reschedule appointment" : "Book an appointment"}
      </h2>
      {configError ? (
        <p role="alert">
          {configError}{" "}
          <button type="button" onClick={() => setConfigAttempt((value) => value + 1)}>
            Retry configuration
          </button>
        </p>
      ) : !config ? (
        <p role="status">Loading clinic doctors, visit types and chairs…</p>
      ) : null}
      {config && (!config.doctors.length || !config.types.length) ? (
        <p role="alert">
          Booking is unavailable until the clinic has an active doctor and visit type. Ask the
          clinic administrator to complete setup.
        </p>
      ) : null}
      {!appointment && !patient ? (
        <>
          <fieldset disabled={registrationLocked}>
            <FrontOfficePatientSearchPanel
              state={queryState}
              selectedPatientId={null}
              onSearch={search}
              onSelect={(id) => {
                if (!registrationLocked && queryState.status === "ready") {
                  setPatient(queryState.data.patients.find((item) => item.id === id) ?? null);
                  setRegister(false);
                }
              }}
            />
          </fieldset>
          {queryState.status === "ready" && queryState.data.patients.length === 25 ? (
            <p>Showing up to 25 matches. Refine the name or phone to find the right person.</p>
          ) : null}
          {props.canRegister ? (
            <button
              type="button"
              disabled={registrationLocked}
              onClick={() => setRegister(!register)}
            >
              {register ? "Close registration" : "Register a new patient"}
            </button>
          ) : null}
          {register ? (
            <PatientRegistration
              client={props.client}
              onLock={setRegistrationLocked}
              onCreated={(value) => {
                searchGeneration.current.value++;
                setPatient(value);
                setRegister(false);
              }}
            />
          ) : null}
        </>
      ) : null}
      {patient ? (
        <p className="front-desk__identity">
          <strong>{patient.fullName}</strong> · {patient.phone ?? "No phone recorded"}
          {!appointment ? (
            <button
              type="button"
              disabled={command.locked}
              onClick={() => {
                setPatient(null);
                setReviewed(false);
              }}
            >
              Choose another patient
            </button>
          ) : null}
        </p>
      ) : null}
      <form onSubmit={submit}>
        <fieldset
          disabled={
            command.locked || !patient || !config || !config.doctors.length || !config.types.length
          }
        >
          <legend>Appointment details · {props.timeZone}</legend>
          <div className="front-desk__fields">
            <label>
              Doctor
              <select
                aria-label="Doctor"
                required
                value={doctor}
                onChange={(event) => {
                  setDoctor(event.target.value);
                  setReviewed(false);
                }}
              >
                <option value="">Choose doctor</option>
                {config?.doctors.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Visit type
              <select
                aria-label="Visit type"
                required
                value={type}
                onChange={(event) => {
                  setType(event.target.value);
                  setDuration(
                    String(
                      config?.types.find((item) => item.id === event.target.value)
                        ?.durationMinutes ?? 30
                    )
                  );
                  setReviewed(false);
                }}
              >
                <option value="">Choose visit type</option>
                {config?.types.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Chair
              <select
                aria-label="Chair"
                value={chair}
                onChange={(event) => {
                  setChair(event.target.value);
                  setReviewed(false);
                }}
              >
                <option value="">Not assigned</option>
                {config?.chairs.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start date and time
              <input
                required
                type="datetime-local"
                value={localTime}
                onChange={(event) => {
                  setLocalTime(event.target.value);
                  setReviewed(false);
                }}
              />
            </label>
            <label>
              Duration (minutes)
              <input
                required
                type="number"
                min={5}
                max={720}
                step={1}
                value={duration}
                onChange={(event) => {
                  setDuration(event.target.value);
                  setReviewed(false);
                }}
              />
            </label>
            {!appointment ? (
              <label>
                Booking source
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value as typeof source)}
                >
                  {SOURCE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              {appointment ? "Reason for rescheduling" : "Visit reason (optional)"}
              <input
                required={Boolean(appointment)}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          <p>
            Working hours and provider/chair overlaps are checked when saved.{" "}
            {appointment
              ? "A previously confirmed appointment returns to booked."
              : "Selecting Practo records attribution only; it does not send a booking to Practo."}
          </p>
          <label className="front-desk__check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            I checked the patient, clinic time, doctor and duration.
          </label>
        </fieldset>
        {validation ? <p role="alert">{validation}</p> : null}
        <CommandProblem command={command} />
        <div className="front-desk__actions">
          <button
            type="submit"
            className="button-link button-link--primary"
            disabled={command.busy || !patient || !reviewed || !config}
          >
            {command.busy
              ? "Saving…"
              : command.problem?.uncertain
                ? "Retry same request"
                : appointment
                  ? "Save new appointment time"
                  : "Confirm booking"}
          </button>
          <button
            type="button"
            disabled={command.locked || registrationLocked}
            onClick={props.onClose}
          >
            Close editor
          </button>
        </div>
      </form>
    </section>
  );
}

function PatientRegistration(props: {
  client: ClinicOsApiClient;
  onLock: (locked: boolean) => void;
  onCreated: (patient: FrontOfficePatientSearchResult) => void;
}) {
  const command = useCommand();
  const { onLock } = props;
  useEffect(() => {
    onLock(command.locked);
    return () => onLock(false);
  }, [command.locked, onLock]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body: CreatePatientRequest["body"] = {
      fullName: String(data.get("fullName")).trim(),
      phone: String(data.get("phone")).trim(),
      source: "manual"
    };
    await command.run(async (key) => {
      const { patient } = await props.client.createPatient({
        body,
        headers: { "idempotency-key": key }
      });
      props.onCreated({
        id: patient.id,
        fullName: body.fullName,
        phone: body.phone,
        source: body.source
      });
    });
  }
  return (
    <form onSubmit={submit} className="front-desk__card" aria-label="Register patient">
      <h3>Register patient</h3>
      <p>
        Search first. Potential duplicates must be resolved before another record is created. No
        existing patient is merged automatically.
      </p>
      <fieldset disabled={command.locked} className="front-desk__fields">
        <label>
          Patient name
          <input name="fullName" required maxLength={200} autoComplete="off" />
        </label>
        <label>
          Phone with country code
          <input
            name="phone"
            type="tel"
            required
            pattern="\+[1-9][0-9]{7,14}"
            placeholder="+91…"
            autoComplete="off"
          />
        </label>
      </fieldset>
      <CommandProblem command={command} />
      <button type="submit" disabled={command.busy}>
        {command.busy
          ? "Registering…"
          : command.problem?.uncertain
            ? "Retry same registration"
            : "Create patient"}
      </button>
    </form>
  );
}

function AppointmentAction(props: {
  client: ClinicOsApiClient;
  selection: Exclude<
    Selection,
    QueueSelection | { kind: "book" } | { kind: "reschedule"; appointment: Appointment }
  >;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const command = useCommand();
  const [reason, setReason] = useState("");
  const { appointment, kind } = props.selection;
  const labels = {
    confirmed: "Record confirmation",
    cancelled: "Cancel appointment",
    no_show: "Mark no-show",
    check_in: "Check in"
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await command.run(async (key) => {
      if (kind === "check_in")
        await props.client.checkInAppointment({
          path: { appointmentId: appointment.id },
          headers: { "idempotency-key": key }
        });
      else
        await props.client.updateAppointment({
          path: { appointmentId: appointment.id },
          headers: { "idempotency-key": key, "if-match": `"rv-${appointment.rowVersion}"` },
          body: { status: kind, ...(reason.trim() ? { changeReason: reason.trim() } : {}) }
        });
      await props.onSaved(
        kind === "check_in"
          ? "Patient checked in and added to the queue."
          : `Appointment ${kind.replaceAll("_", " ")}.`
      );
    });
  }
  return (
    <form className="front-desk__card" onSubmit={submit} aria-label={labels[kind]}>
      <h2>{labels[kind]}</h2>
      <p>
        <strong>{appointment.patientName}</strong> · {appointment.appointmentTypeName} ·{" "}
        {appointment.providerName}
      </p>
      <p>
        {kind === "confirmed"
          ? "Record this only after the patient has confirmed. This action does not send a message."
          : kind === "check_in"
            ? "Confirm that this patient has arrived at the clinic."
            : "This changes the schedule. Review the patient and appointment before saving."}
      </p>
      {kind === "cancelled" || kind === "no_show" ? (
        <label>
          Reason
          <input
            required
            maxLength={500}
            value={reason}
            disabled={command.locked}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      ) : null}
      <CommandProblem command={command} />
      <div className="front-desk__actions">
        <button type="submit" disabled={command.busy}>
          {command.busy
            ? "Saving…"
            : command.problem?.uncertain
              ? "Retry same request"
              : `Confirm: ${labels[kind].toLowerCase()}`}
        </button>
        <button type="button" disabled={command.locked} onClick={props.onClose}>
          Keep unchanged
        </button>
      </div>
    </form>
  );
}

function QueueAction(props: {
  client: ClinicOsApiClient;
  id: string;
  version: number;
  status: string;
  name: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const command = useCommand();
  return (
    <section className="front-desk__card" aria-label="Update reception queue">
      <h2>{props.status === "waiting" ? "Call patient" : "Return to waiting"}</h2>
      <p>
        <strong>{props.name}</strong> · {props.status}
      </p>
      <button
        type="button"
        disabled={command.busy || !Number.isInteger(props.version)}
        onClick={() =>
          void command.run(async (key) => {
            await props.client.updateQueueEntry({
              path: { queueEntryId: props.id },
              headers: { "idempotency-key": key, "if-match": `"rv-${props.version}"` },
              body: { status: props.status === "waiting" ? "called" : "waiting" }
            });
            await props.onSaved();
          })
        }
      >
        {command.busy
          ? "Saving…"
          : command.problem?.uncertain
            ? "Retry same request"
            : props.status === "waiting"
              ? "Call patient"
              : "Return to waiting"}
      </button>
      <button type="button" disabled={command.locked} onClick={props.onClose}>
        Keep unchanged
      </button>
      <CommandProblem command={command} />
    </section>
  );
}
function CommandProblem({ command }: { command: ReturnType<typeof useCommand> }) {
  return command.problem ? <p role="alert">{command.problem.message}</p> : null;
}
function safeClinicDay(timeZone?: string) {
  try {
    return timeZone ? clinicLocalDate(new Date(), timeZone) : null;
  } catch {
    return null;
  }
}
