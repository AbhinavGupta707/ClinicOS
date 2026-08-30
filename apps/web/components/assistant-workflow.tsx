"use client";

import { Button } from "@clinic-os/ui";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Inbox,
  Loader2,
  PlugZap,
  RefreshCw,
  Search,
  Stethoscope,
  UserPlus,
  UsersRound
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  APPOINTMENT_STATUS_LABELS,
  CONFIRMATION_LABELS,
  CP2_REQUIRED_ENDPOINTS,
  LEAD_STATUS_LABELS,
  QUEUE_STATE_LABELS,
  SOURCE_LABELS,
  applyFixtureCheckInAppointment,
  applyFixtureCreateLead,
  applyFixtureConfirmAppointment,
  applyFixtureConvertLeadToAppointment,
  applyFixtureCreatePatient,
  applyFixtureMatchLead,
  checkInLiveAppointment,
  confirmLiveAppointment,
  convertLiveLeadToAppointment,
  createLiveLead,
  createLivePatient,
  duplicateSuggestionDisplayText,
  findDuplicateSuggestions,
  formatPatientKind,
  getTodayInputValue,
  loadCp2Workflow,
  matchLiveLeadToPatient,
  searchLivePatients,
  sourceLabel,
  summarizeDashboard,
  type AppointmentCreateInput,
  type AppointmentSummary,
  type Cp2WorkflowData,
  type Cp2WorkflowLoadState,
  type DuplicateSuggestion,
  type LeadCreateInput,
  type LeadStatus,
  type LeadSummary,
  type PatientCreateInput,
  type PatientSummary,
  type WorkflowProblem,
  type WorkflowSource
} from "@/lib/cp2-workflow";
import type { MeProfile } from "@/lib/me";
import { ROLE_LABELS } from "@/lib/roles";

interface AssistantWorkflowProps {
  activeSurfaceId: string;
  profile: MeProfile;
  setActiveSurfaceId: (surfaceId: string) => void;
}

type LoadState = Cp2WorkflowLoadState | { status: "loading" };

type ActionMessage = {
  tone: "error" | "info" | "success";
  text: string;
};

type LeadDuplicateReview = {
  status: "failed" | "loading" | "ready";
  suggestions: DuplicateSuggestion[];
};

type WorkflowMode = "appointments" | "lead-inbox" | "patients" | "today";

const WORKFLOW_MODES: Array<{
  icon: typeof CalendarDays;
  id: WorkflowMode;
  label: string;
}> = [
  { icon: ClipboardList, id: "today", label: "Morning" },
  { icon: Inbox, id: "lead-inbox", label: "Leads" },
  { icon: CalendarDays, id: "appointments", label: "Appointments" },
  { icon: UsersRound, id: "patients", label: "Patients" }
];

const LEAD_FILTERS: Array<{ label: string; value: LeadStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Matched", value: "matched" },
  { label: "Booked", value: "booked" }
];

const SOURCE_OPTIONS: WorkflowSource[] = [
  "whatsapp",
  "phone",
  "walk_in",
  "practo",
  "google",
  "referral",
  "manual"
];

const workflowSurfaceIds = new Set<string>(["today", "lead-inbox", "appointments", "patients"]);

export function isCp2WorkflowSurface(surfaceId: string) {
  return workflowSurfaceIds.has(surfaceId);
}

export function AssistantWorkflow({
  activeSurfaceId,
  profile,
  setActiveSurfaceId
}: AssistantWorkflowProps) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [leadFilter, setLeadFilter] = useState<LeadStatus | "all">("all");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [patientSearchQuery, setPatientSearchQuery] = useState("");
  const [patientSearchResults, setPatientSearchResults] = useState<PatientSummary[]>([]);
  const [leadDuplicateReviews, setLeadDuplicateReviews] = useState<
    Record<string, LeadDuplicateReview>
  >({});
  const [duplicateReviewClearedLeadIds, setDuplicateReviewClearedLeadIds] = useState<Set<string>>(
    new Set()
  );
  const [actionMessage, setActionMessage] = useState<ActionMessage | null>(null);
  const [patientForm, setPatientForm] = useState<PatientCreateInput>({
    displayName: "",
    phone: "",
    source: "whatsapp"
  });
  const [leadForm, setLeadForm] = useState<LeadCreateInput>({
    contactName: "",
    messageSnippet: "",
    phone: "",
    source: "whatsapp"
  });
  const [bookingForm, setBookingForm] = useState({
    appointmentType: "Consultation",
    chair: "Chair 1",
    durationMinutes: 30,
    providerName: "Assigned doctor",
    startAt: `${getTodayInputValue()}T15:00`
  });

  const mode = isCp2WorkflowSurface(activeSurfaceId) ? (activeSurfaceId as WorkflowMode) : "today";
  const canCreatePatients = profile.roles.some((role) =>
    ["owner", "doctor", "assistant", "receptionist"].includes(role)
  );

  const reloadWorkflow = () => {
    const controller = new AbortController();

    setLoadState({ status: "loading" });
    void loadCp2Workflow(controller.signal).then(setLoadState);

    return controller;
  };

  useEffect(() => {
    const controller = reloadWorkflow();

    return () => controller.abort();
  }, []);

  const data = loadState.status === "ready" ? loadState.data : null;
  const selectedLead = useMemo(() => {
    if (!data) {
      return null;
    }

    return data.leads.find((lead) => lead.id === selectedLeadId) ?? data.leads[0] ?? null;
  }, [data, selectedLeadId]);
  const duplicateSuggestions = useMemo(
    () =>
      data
        ? findDuplicateSuggestions(data.patients, {
            displayName: patientForm.displayName,
            phone: patientForm.phone
          })
        : [],
    [data, patientForm.displayName, patientForm.phone]
  );
  const selectedLeadSuggestions = useMemo(
    () => {
      if (!data || !selectedLead) return [];
      if (data.source === "api") {
        const review = leadDuplicateReviews[selectedLead.id];
        return review?.status === "ready" ? review.suggestions : [];
      }
      return findDuplicateSuggestions(data.patients, {
            displayName: selectedLead.contactName,
            phone: selectedLead.phone
          });
    },
    [data, leadDuplicateReviews, selectedLead]
  );
  const selectedLeadDuplicateReviewStatus =
    !data || !selectedLead || data.source === "cp2_fixture"
      ? "ready"
      : (leadDuplicateReviews[selectedLead.id]?.status ?? "loading");

  useEffect(() => {
    if (!selectedLeadId && selectedLead) {
      setSelectedLeadId(selectedLead.id);
    }
  }, [selectedLead, selectedLeadId]);

  const setReadyData = (nextData: Cp2WorkflowData) => {
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

  const reviewLeadDuplicates = useCallback(async (lead: LeadSummary) => {
    setDuplicateReviewClearedLeadIds((current) => {
      const next = new Set(current);
      next.delete(lead.id);
      return next;
    });
    setLeadDuplicateReviews((current) => ({
      ...current,
      [lead.id]: { status: "loading", suggestions: [] }
    }));
    try {
      const patients = await searchLivePatients(lead.phone);
      setLeadDuplicateReviews((current) => ({
        ...current,
        [lead.id]: {
          status: "ready",
          suggestions: patients.map((patient) => ({
            matchedOn: "phone",
            patient,
            score: 100
          }))
        }
      }));
    } catch (error) {
      setLeadDuplicateReviews((current) => ({
        ...current,
        [lead.id]: { status: "failed", suggestions: [] }
      }));
      setActionMessage({
        text: formatActionError(error, "Duplicate review failed. Retry before creating a patient."),
        tone: "error"
      });
    }
  }, []);

  useEffect(() => {
    if (
      !data ||
      data.source !== "api" ||
      !selectedLead ||
      leadDuplicateReviews[selectedLead.id]
    ) {
      return;
    }
    void reviewLeadDuplicates(selectedLead);
  }, [data, leadDuplicateReviews, reviewLeadDuplicates, selectedLead]);

  const handleCreatePatient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data) {
      return;
    }

    if (!patientForm.displayName.trim() || !patientForm.phone.trim()) {
      setActionMessage({
        text: "Name and phone are required before a patient shell can be created.",
        tone: "error"
      });
      return;
    }

    setActionBusy("create-patient");

    try {
      if (data.source === "cp2_fixture") {
        const result = applyFixtureCreatePatient(data, patientForm);
        setReadyData(result.data);
        setSelectedPatientId(result.patient.id);
        setPatientForm({ displayName: "", phone: "", source: patientForm.source });
        setActionMessage({
          text: "Synthetic patient created in local fixture mode.",
          tone: "success"
        });
      } else {
        await createLivePatient(patientForm);
        reloadWorkflow();
        setActionMessage({
          text: "Patient create request sent to /v1/patients.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Patient create failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handlePatientSearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data) return;
    const query = patientSearchQuery.trim();
    if (query.length < 2) {
      setActionMessage({
        text: "Enter at least 2 characters, or a full phone number, before searching.",
        tone: "error"
      });
      return;
    }
    setActionBusy("patient-search");
    try {
      const patients =
        data.source === "cp2_fixture"
          ? data.patients.filter((patient) =>
              `${patient.displayName} ${patient.phone}`.toLowerCase().includes(query.toLowerCase())
            )
          : await searchLivePatients(query);
      setPatientSearchResults(patients);
      setSelectedPatientId(null);
      setActionMessage({
        text:
          patients.length > 0
            ? `${patients.length} matching patient${patients.length === 1 ? "" : "s"} found.`
            : "No matching patients found. Confirm the identity details before creating a new record.",
        tone: "info"
      });
    } catch (error) {
      handleActionError(error, "Patient search failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreateLead = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data) {
      return;
    }

    if (!leadForm.contactName.trim() || !leadForm.phone.trim()) {
      setActionMessage({
        text: "Lead name and phone are required before capture.",
        tone: "error"
      });
      return;
    }

    setActionBusy("create-lead");

    try {
      if (data.source === "cp2_fixture") {
        const result = applyFixtureCreateLead(data, leadForm);
        setReadyData(result.data);
        setSelectedLeadId(result.lead.id);
        setLeadForm({ contactName: "", messageSnippet: "", phone: "", source: leadForm.source });
        setActionMessage({
          text: "Synthetic source-attributed lead captured.",
          tone: "success"
        });
      } else {
        const result = await createLiveLead(leadForm);
        setLeadDuplicateReviews((current) => ({
          ...current,
          [result.lead.id]: {
            status: "ready",
            suggestions: result.patientMatchSuggestions
          }
        }));
        setSelectedLeadId(result.lead.id);
        reloadWorkflow();
        setActionMessage({
          text: "Lead capture request sent to /v1/leads.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Lead capture failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleMatchLead = async (lead: LeadSummary, patientId: string) => {
    if (!data) {
      return;
    }

    setActionBusy(`match-${lead.id}`);

    try {
      if (data.source === "cp2_fixture") {
        setReadyData(applyFixtureMatchLead(data, lead.id, patientId));
        setSelectedPatientId(patientId);
        setActionMessage({
          text: "Synthetic lead matched to patient.",
          tone: "success"
        });
      } else {
        await matchLiveLeadToPatient(lead.id, patientId);
        reloadWorkflow();
        setActionMessage({
          text: "Lead match request sent to /v1/leads/{id}/match-patient.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Lead match failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCreateFromLead = async (lead: LeadSummary) => {
    if (!data) {
      return;
    }

    if (selectedPatientId) {
      await handleMatchLead(lead, selectedPatientId);
      return;
    }

    setActionBusy(`lead-create-${lead.id}`);

    try {
      const input: PatientCreateInput = {
        displayName: lead.contactName,
        phone: lead.phone,
        source: lead.attribution.source
      };

      if (data.source === "cp2_fixture") {
        const result = applyFixtureCreatePatient(data, input);
        const matched = applyFixtureMatchLead(result.data, lead.id, result.patient.id);
        setReadyData(matched);
        setSelectedPatientId(result.patient.id);
        setActionMessage({
          text: "Synthetic lead converted into a new patient shell.",
          tone: "success"
        });
      } else {
        await createLivePatient(input);
        reloadWorkflow();
        setActionMessage({
          text: "Patient create request sent from lead context.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Patient create from lead failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleBookAppointment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!data || !selectedLead) {
      return;
    }

    const patientId = selectedLead.matchedPatientId ?? selectedPatientId;

    if (!patientId) {
      setActionMessage({
        text: "Match the lead to a patient or create a patient shell before booking.",
        tone: "error"
      });
      return;
    }

    setActionBusy(`book-${selectedLead.id}`);

    try {
      const appointmentInput: AppointmentCreateInput = {
        appointmentType: bookingForm.appointmentType,
        chair: bookingForm.chair,
        durationMinutes: bookingForm.durationMinutes,
        leadId: selectedLead.id,
        patientId,
        providerName: bookingForm.providerName,
        source: selectedLead.attribution.source,
        startAt: new Date(bookingForm.startAt).toISOString()
      };

      if (data.source === "cp2_fixture") {
        const matchedData = selectedLead.matchedPatientId
          ? data
          : applyFixtureMatchLead(data, selectedLead.id, patientId);
        const result = applyFixtureConvertLeadToAppointment(matchedData, appointmentInput);
        setReadyData(result.data);
        setActiveSurfaceId("appointments");
        setActionMessage({
          text: "Synthetic appointment booked with source attribution.",
          tone: "success"
        });
      } else {
        await convertLiveLeadToAppointment(appointmentInput);
        reloadWorkflow();
        setActionMessage({
          text: "Lead conversion request sent to /v1/leads/{id}/convert-to-appointment.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Appointment booking failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleConfirmAppointment = async (appointment: AppointmentSummary) => {
    if (!data) {
      return;
    }

    setActionBusy(`confirm-${appointment.id}`);

    try {
      if (data.source === "cp2_fixture") {
        setReadyData(applyFixtureConfirmAppointment(data, appointment.id));
        setActionMessage({
          text: "Synthetic appointment marked confirmed.",
          tone: "success"
        });
      } else {
        await confirmLiveAppointment(appointment.id);
        reloadWorkflow();
        setActionMessage({
          text: "Confirmation request sent to /v1/appointments/{id}/confirm.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Appointment confirmation failed.");
    } finally {
      setActionBusy(null);
    }
  };

  const handleCheckInAppointment = async (appointment: AppointmentSummary) => {
    if (!data) {
      return;
    }

    setActionBusy(`check-in-${appointment.id}`);

    try {
      if (data.source === "cp2_fixture") {
        setReadyData(applyFixtureCheckInAppointment(data, appointment.id));
        setActiveSurfaceId("appointments");
        setActionMessage({
          text: "Synthetic patient checked in and added to queue.",
          tone: "success"
        });
      } else {
        await checkInLiveAppointment(appointment.id);
        reloadWorkflow();
        setActionMessage({
          text: "Check-in request sent to /v1/appointments/{id}/check-in.",
          tone: "success"
        });
      }
    } catch (error) {
      handleActionError(error, "Check-in failed.");
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div className="surface-stack cp2-workflow">
      <section className="surface-hero surface-hero--day" aria-labelledby="cp2-title">
        <div>
          <p className="eyebrow">Assistant day start</p>
          <h1 id="cp2-title">{profile.clinic.name}</h1>
          <p className="hero-subline">
            Lead capture, patient match, booking, confirmation, and queue controls for{" "}
            {profile.roles.map((role) => ROLE_LABELS[role]).join(", ")}.
          </p>
        </div>
        <div className="hero-status" aria-label="Workflow API mode">
          <span
            className={
              data?.source === "cp2_fixture"
                ? "status-dot status-dot--warn"
                : "status-dot status-dot--ok"
            }
          />
          <span>{data?.source === "cp2_fixture" ? "Local fixture" : "Live boundary"}</span>
        </div>
      </section>

      {loadState.status === "loading" ? (
        <WorkflowLoading />
      ) : loadState.status === "ready" ? (
        <>
          {loadState.data.source === "cp2_fixture" ? (
            <section className="inline-alert" aria-label="Synthetic workflow fixture">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <strong>Local synthetic CP2 fixture mode</strong>
                <span>
                  This browser-smoke data is non-PHI and local/test only. Live mode uses the CP2 API
                  endpoints instead.
                </span>
              </div>
            </section>
          ) : loadState.data.api?.appointmentsTruncated ? (
            <section className="inline-alert" aria-label="Clinic-day data truncated">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <strong>Clinic-day view is truncated</strong>
                <span>
                  The API returned the first 500 appointments. Narrow the operational date or use a
                  paginated schedule view before relying on complete-day counts.
                </span>
              </div>
            </section>
          ) : loadState.data.api?.dataAsOf ? (
            <section className="inline-alert" aria-label="Clinic-day data freshness">
              <CheckCircle2 size={18} aria-hidden="true" />
              <div>
                <strong>Durable clinic-day data</strong>
                <span>
                  Patient, practitioner, appointment type, chair, and queue identity were joined by
                  the API. Latest appointment update: {formatDateTime(loadState.data.api.dataAsOf)}.
                </span>
              </div>
            </section>
          ) : (
            <section className="inline-alert" aria-label="No clinic-day data">
              <AlertCircle size={18} aria-hidden="true" />
              <div>
                <strong>No clinic-day appointments</strong>
                <span>The durable API returned no appointments for this clinic date.</span>
              </div>
            </section>
          )}

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

          <WorkflowTabs mode={mode} setActiveSurfaceId={setActiveSurfaceId} />

          {mode === "today" ? (
            <DashboardPanel
              data={loadState.data}
              onCheckIn={handleCheckInAppointment}
              onConfirm={handleConfirmAppointment}
              setActiveSurfaceId={setActiveSurfaceId}
              actionBusy={actionBusy}
            />
          ) : null}

          {mode === "lead-inbox" ? (
            <LeadInboxPanel
              actionBusy={actionBusy}
              bookingForm={bookingForm}
              canCreatePatients={canCreatePatients}
              data={loadState.data}
              duplicateReviewCleared={
                selectedLead ? duplicateReviewClearedLeadIds.has(selectedLead.id) : false
              }
              duplicateReviewStatus={selectedLeadDuplicateReviewStatus}
              duplicateSuggestions={selectedLeadSuggestions}
              leadForm={leadForm}
              leadFilter={leadFilter}
              onBookAppointment={handleBookAppointment}
              onCreateLead={handleCreateLead}
              onCreateFromLead={handleCreateFromLead}
              onLeadFilterChange={setLeadFilter}
              onClearDuplicateReview={(leadId) =>
                setDuplicateReviewClearedLeadIds((current) => new Set(current).add(leadId))
              }
              onMatchLead={handleMatchLead}
              onSelectLead={(leadId) => {
                setSelectedLeadId(leadId);
                setSelectedPatientId(null);
              }}
              onSelectPatient={setSelectedPatientId}
              onRetryDuplicateReview={(lead) => void reviewLeadDuplicates(lead)}
              onLeadFormChange={setLeadForm}
              selectedLead={selectedLead}
              selectedPatientId={selectedPatientId}
              setBookingForm={setBookingForm}
            />
          ) : null}

          {mode === "appointments" ? (
            <AppointmentsPanel
              actionBusy={actionBusy}
              data={loadState.data}
              onCheckIn={handleCheckInAppointment}
              onConfirm={handleConfirmAppointment}
            />
          ) : null}

          {mode === "patients" ? (
            <PatientsPanel
              actionBusy={actionBusy}
              canCreatePatients={canCreatePatients}
              duplicateSuggestions={duplicateSuggestions}
              onCreatePatient={handleCreatePatient}
              onPatientSearch={handlePatientSearch}
              onPatientFormChange={setPatientForm}
              onSelectPatient={setSelectedPatientId}
              patientForm={patientForm}
              patientSearchQuery={patientSearchQuery}
              patientSearchResults={patientSearchResults}
              setPatientSearchQuery={setPatientSearchQuery}
              selectedPatientId={selectedPatientId}
            />
          ) : null}
        </>
      ) : (
        <WorkflowUnavailable problem={loadState.problem} onRetry={reloadWorkflow} />
      )}
    </div>
  );
}

export function AttributionBadge({ detail, source }: { detail?: string; source: WorkflowSource }) {
  return (
    <span className="source-badge" title={detail}>
      {SOURCE_LABELS[source]}
    </span>
  );
}

export function DuplicateSuggestionList({
  onSelect,
  selectedPatientId,
  suggestions
}: {
  onSelect?: (patientId: string) => void;
  selectedPatientId?: string | null;
  suggestions: DuplicateSuggestion[];
}) {
  if (suggestions.length === 0) {
    return (
      <div className="empty-inline" data-testid="cp2-no-duplicate-suggestions">
        <Search size={16} aria-hidden="true" />
        <span>No duplicate suggestions for the current name or phone.</span>
      </div>
    );
  }

  return (
    <div className="duplicate-list" aria-label="Duplicate patient suggestions">
      {suggestions.map((suggestion) => {
        const selected = selectedPatientId === suggestion.patient.id;
        const content = (
          <>
            <strong>{suggestion.patient.displayName}</strong>
            <span>{duplicateSuggestionDisplayText(suggestion)}</span>
          </>
        );

        return onSelect ? (
          <button
            aria-pressed={selected}
            className={selected ? "duplicate-item duplicate-item--selected" : "duplicate-item"}
            data-testid={`cp2-duplicate-suggestion-${suggestion.patient.id}`}
            key={`${suggestion.patient.id}-${suggestion.matchedOn}`}
            onClick={() => onSelect(suggestion.patient.id)}
            type="button"
          >
            {content}
          </button>
        ) : (
          <div
            className="duplicate-item"
            data-testid={`cp2-duplicate-suggestion-${suggestion.patient.id}`}
            key={`${suggestion.patient.id}-${suggestion.matchedOn}`}
          >
            {content}
          </div>
        );
      })}
    </div>
  );
}

function WorkflowTabs({
  mode,
  setActiveSurfaceId
}: {
  mode: WorkflowMode;
  setActiveSurfaceId: (surfaceId: string) => void;
}) {
  return (
    <div className="workflow-tabs" role="tablist" aria-label="CP2 workflow surfaces">
      {WORKFLOW_MODES.map((item) => {
        const Icon = item.icon;
        const active = mode === item.id;

        return (
          <button
            aria-selected={active}
            className={active ? "workflow-tab workflow-tab--active" : "workflow-tab"}
            key={item.id}
            onClick={() => setActiveSurfaceId(item.id)}
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

function DashboardPanel({
  actionBusy,
  data,
  onCheckIn,
  onConfirm,
  setActiveSurfaceId
}: {
  actionBusy: string | null;
  data: Cp2WorkflowData;
  onCheckIn: (appointment: AppointmentSummary) => void;
  onConfirm: (appointment: AppointmentSummary) => void;
  setActiveSurfaceId: (surfaceId: string) => void;
}) {
  const summary = summarizeDashboard(data);
  const pendingLeads = data.leads.filter((lead) =>
    ["new", "pending", "matched"].includes(lead.status)
  );

  return (
    <>
      <section
        className="dashboard-metrics"
        aria-label="Morning dashboard summary"
        data-testid="cp2-morning-dashboard"
      >
        <Metric label="Today" value={summary.bookedToday} sublabel="active appointments" />
        <Metric label="Unconfirmed" value={summary.unconfirmed} sublabel="needs confirmation" />
        <Metric label="Lead tasks" value={summary.leadTasks} sublabel="new, pending, matched" />
        <Metric
          label="Queue"
          value={summary.queueWaiting}
          sublabel="waiting or called"
          valueTestId="cp2-dashboard-queue-waiting-count"
        />
        <Metric label="New patients" value={summary.newPatientsToday} sublabel="on today's book" />
        <Metric
          label="Returning"
          value={summary.returningPatientsToday}
          sublabel="on today's book"
        />
      </section>
      <div className="dashboard-flags" data-testid="cp2-dashboard-new-returning-flags">
        <span>{summary.newPatientsToday} new</span>
        <span>{summary.returningPatientsToday} returning</span>
      </div>

      <div className="workflow-grid workflow-grid--dashboard">
        <section className="work-panel" aria-labelledby="today-appointments-title">
          <div className="panel-heading">
            <div>
              <h2 id="today-appointments-title">Today&apos;s appointments</h2>
              <p>Confirmation and check-in controls update the dashboard and queue state.</p>
            </div>
            <Button
              icon={<CalendarDays size={16} />}
              onClick={() => setActiveSurfaceId("appointments")}
              size="sm"
              variant="secondary"
            >
              Open schedule
            </Button>
          </div>
          <AppointmentList
            actionBusy={actionBusy}
            appointments={data.appointments}
            onCheckIn={onCheckIn}
            onConfirm={onConfirm}
          />
        </section>

        <section
          className="work-panel"
          aria-labelledby="lead-tasks-title"
          data-testid="cp2-lead-inbox"
        >
          <div className="panel-heading">
            <div>
              <h2 id="lead-tasks-title">Lead tasks</h2>
              <p>Source-attributed appointment requests and missed calls.</p>
            </div>
            <Button
              icon={<Inbox size={16} />}
              onClick={() => setActiveSurfaceId("lead-inbox")}
              size="sm"
              variant="secondary"
            >
              Open inbox
            </Button>
          </div>
          <div className="workflow-list">
            {pendingLeads.map((lead) => (
              <LeadRow
                key={lead.id}
                lead={lead}
                onSelect={() => setActiveSurfaceId("lead-inbox")}
              />
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function LeadInboxPanel({
  actionBusy,
  bookingForm,
  canCreatePatients,
  data,
  duplicateReviewCleared,
  duplicateReviewStatus,
  duplicateSuggestions,
  leadFilter,
  leadForm,
  onBookAppointment,
  onCreateLead,
  onCreateFromLead,
  onLeadFormChange,
  onLeadFilterChange,
  onClearDuplicateReview,
  onMatchLead,
  onSelectLead,
  onSelectPatient,
  onRetryDuplicateReview,
  selectedLead,
  selectedPatientId,
  setBookingForm
}: {
  actionBusy: string | null;
  bookingForm: {
    appointmentType: string;
    chair: string;
    durationMinutes: number;
    providerName: string;
    startAt: string;
  };
  canCreatePatients: boolean;
  data: Cp2WorkflowData;
  duplicateReviewCleared: boolean;
  duplicateReviewStatus: LeadDuplicateReview["status"];
  duplicateSuggestions: DuplicateSuggestion[];
  leadFilter: LeadStatus | "all";
  leadForm: LeadCreateInput;
  onBookAppointment: (event: FormEvent<HTMLFormElement>) => void;
  onCreateLead: (event: FormEvent<HTMLFormElement>) => void;
  onCreateFromLead: (lead: LeadSummary) => void;
  onLeadFormChange: (input: LeadCreateInput) => void;
  onLeadFilterChange: (status: LeadStatus | "all") => void;
  onClearDuplicateReview: (leadId: string) => void;
  onMatchLead: (lead: LeadSummary, patientId: string) => void;
  onSelectLead: (leadId: string) => void;
  onSelectPatient: (patientId: string) => void;
  onRetryDuplicateReview: (lead: LeadSummary) => void;
  selectedLead: LeadSummary | null;
  selectedPatientId: string | null;
  setBookingForm: (value: {
    appointmentType: string;
    chair: string;
    durationMinutes: number;
    providerName: string;
    startAt: string;
  }) => void;
}) {
  const leads =
    leadFilter === "all" ? data.leads : data.leads.filter((lead) => lead.status === leadFilter);
  const patientIdForMatch =
    selectedPatientId ?? selectedLead?.matchedPatientId ?? null;
  const matchedPatient = patientIdForMatch
    ? (data.patients.find((patient) => patient.id === patientIdForMatch) ?? null)
    : null;

  return (
    <div className="workflow-grid workflow-grid--split">
      <section
        className="work-panel"
        aria-labelledby="lead-inbox-title"
        data-testid="cp2-lead-inbox"
      >
        <div className="panel-heading">
          <div>
            <h2 id="lead-inbox-title">Lead inbox</h2>
            <p>Lead source, SLA, delivery state, match status, and booking path.</p>
          </div>
          <div className="segmented-control" aria-label="Lead status filter">
            {LEAD_FILTERS.map((filter) => (
              <button
                aria-pressed={leadFilter === filter.value}
                className={leadFilter === filter.value ? "segment segment--active" : "segment"}
                key={filter.value}
                onClick={() => onLeadFilterChange(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
        <form className="lead-capture form-grid" onSubmit={onCreateLead}>
          <h3>Capture lead</h3>
          <label>
            <span>Name</span>
            <input
              value={leadForm.contactName}
              onChange={(event) =>
                onLeadFormChange({ ...leadForm, contactName: event.target.value })
              }
            />
          </label>
          <label>
            <span>Phone</span>
            <input
              value={leadForm.phone}
              onChange={(event) => onLeadFormChange({ ...leadForm, phone: event.target.value })}
            />
          </label>
          <label>
            <span>Source</span>
            <select
              value={leadForm.source}
              onChange={(event) =>
                onLeadFormChange({ ...leadForm, source: event.target.value as WorkflowSource })
              }
            >
              {SOURCE_OPTIONS.map((source) => (
                <option key={source} value={source}>
                  {sourceLabel(source)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Message</span>
            <input
              value={leadForm.messageSnippet}
              onChange={(event) =>
                onLeadFormChange({ ...leadForm, messageSnippet: event.target.value })
              }
            />
          </label>
          <Button
            className="form-submit"
            disabled={actionBusy === "create-lead"}
            icon={<Inbox size={16} />}
            type="submit"
            variant="primary"
          >
            Capture lead
          </Button>
        </form>
        <div className="workflow-list workflow-list--dense">
          {leads.map((lead) => (
            <LeadRow
              active={selectedLead?.id === lead.id}
              key={lead.id}
              lead={lead}
              onSelect={() => onSelectLead(lead.id)}
            />
          ))}
        </div>
      </section>

      <section className="work-panel" aria-labelledby="lead-detail-title">
        <div className="panel-heading">
          <div>
            <h2 id="lead-detail-title">Match and book</h2>
            <p>Duplicate review comes before patient creation and appointment booking.</p>
          </div>
        </div>
        {selectedLead ? (
          <div className="lead-detail">
            <div className="detail-strip">
              <div>
                <span>Lead</span>
                <strong>{selectedLead.contactName}</strong>
              </div>
              <div>
                <span>Phone</span>
                <strong>{selectedLead.phone}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{LEAD_STATUS_LABELS[selectedLead.status]}</strong>
              </div>
            </div>

            <AttributionLine attribution={selectedLead.attribution} />
            {matchedPatient ? <PatientRow patient={matchedPatient} /> : null}

            <div className="subsection">
              <h3>Duplicate suggestions</h3>
              {duplicateReviewStatus === "loading" ? (
                <div className="empty-inline">
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                  <span>Checking the patient registry before creation…</span>
                </div>
              ) : duplicateReviewStatus === "failed" ? (
                <div className="empty-inline">
                  <AlertCircle size={16} aria-hidden="true" />
                  <span>Duplicate review is unavailable. Retry before creating a patient.</span>
                </div>
              ) : (
                <DuplicateSuggestionList
                  onSelect={onSelectPatient}
                  selectedPatientId={selectedPatientId ?? selectedLead.matchedPatientId ?? null}
                  suggestions={duplicateSuggestions}
                />
              )}
              <div className="action-row">
                {canCreatePatients && patientIdForMatch ? (
                  <Button
                    disabled={actionBusy === `match-${selectedLead.id}`}
                    data-testid={
                      selectedLead.id === "whatsappReturningLead"
                        ? "cp2-match-returning-patient"
                        : `cp2-match-${selectedLead.id}`
                    }
                    onClick={() => onMatchLead(selectedLead, patientIdForMatch)}
                    size="sm"
                    variant="secondary"
                  >
                    Match selected patient
                  </Button>
                ) : null}
                {duplicateReviewStatus === "failed" ? (
                  <Button
                    onClick={() => onRetryDuplicateReview(selectedLead)}
                    size="sm"
                    variant="secondary"
                  >
                    Retry duplicate review
                  </Button>
                ) : null}
                {duplicateReviewStatus === "ready" &&
                duplicateSuggestions.length > 0 &&
                !duplicateReviewCleared &&
                !patientIdForMatch ? (
                  <Button
                    onClick={() => onClearDuplicateReview(selectedLead.id)}
                    size="sm"
                    variant="secondary"
                  >
                    None of these match
                  </Button>
                ) : null}
                {canCreatePatients ? (
                  <Button
                    data-testid="cp2-create-patient-from-lead"
                    disabled={
                      actionBusy === `lead-create-${selectedLead.id}` ||
                      duplicateReviewStatus !== "ready" ||
                      Boolean(patientIdForMatch) ||
                      (duplicateSuggestions.length > 0 && !duplicateReviewCleared)
                    }
                    icon={<UserPlus size={16} />}
                    onClick={() => onCreateFromLead(selectedLead)}
                    size="sm"
                    variant="primary"
                  >
                    Create patient shell
                  </Button>
                ) : (
                  <div className="empty-inline" data-testid="cp2-patient-create-denied">
                    <AlertCircle size={16} aria-hidden="true" />
                    <span>Patient creation requires patient write access.</span>
                  </div>
                )}
              </div>
            </div>

            <form className="subsection form-grid" onSubmit={onBookAppointment}>
              <h3>Book appointment</h3>
              <label>
                <span>Provider</span>
                <input
                  value={bookingForm.providerName}
                  onChange={(event) =>
                    setBookingForm({ ...bookingForm, providerName: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Type</span>
                <input
                  value={bookingForm.appointmentType}
                  onChange={(event) =>
                    setBookingForm({ ...bookingForm, appointmentType: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Start</span>
                <input
                  type="datetime-local"
                  value={bookingForm.startAt}
                  onChange={(event) =>
                    setBookingForm({ ...bookingForm, startAt: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Chair</span>
                <input
                  value={bookingForm.chair}
                  onChange={(event) =>
                    setBookingForm({ ...bookingForm, chair: event.target.value })
                  }
                />
              </label>
              <label>
                <span>Duration</span>
                <input
                  min={10}
                  step={5}
                  type="number"
                  value={bookingForm.durationMinutes}
                  onChange={(event) =>
                    setBookingForm({
                      ...bookingForm,
                      durationMinutes: Number(event.target.value)
                    })
                  }
                />
              </label>
              <Button
                className="form-submit"
                data-testid="cp2-convert-lead-to-appointment"
                disabled={actionBusy === `book-${selectedLead.id}`}
                icon={<CalendarDays size={16} />}
                type="submit"
                variant="primary"
              >
                Book from lead
              </Button>
            </form>
          </div>
        ) : (
          <EmptyState text="No lead is selected." />
        )}
      </section>
    </div>
  );
}

function AppointmentsPanel({
  actionBusy,
  data,
  onCheckIn,
  onConfirm
}: {
  actionBusy: string | null;
  data: Cp2WorkflowData;
  onCheckIn: (appointment: AppointmentSummary) => void;
  onConfirm: (appointment: AppointmentSummary) => void;
}) {
  const summary = summarizeDashboard(data);

  return (
    <div className="workflow-grid workflow-grid--split">
      <section className="work-panel" aria-labelledby="appointments-title">
        <div className="panel-heading">
          <div>
            <h2 id="appointments-title">Appointment list</h2>
            <p>New vs returning, source attribution, confirmation state, and check-in actions.</p>
          </div>
        </div>
        <AppointmentList
          actionBusy={actionBusy}
          appointments={data.appointments}
          onCheckIn={onCheckIn}
          onConfirm={onConfirm}
        />
      </section>

      <section className="work-panel" aria-labelledby="queue-title">
        <div className="panel-heading">
          <div>
            <h2 id="queue-title">Queue board</h2>
            <p>Reception check-in state visible for doctor handoff.</p>
          </div>
        </div>
        <div className="workflow-list">
          <div className="queue-entry">
            <div>
              <strong data-testid="cp2-dashboard-queue-waiting-count">
                {summary.queueWaiting}
              </strong>
              <span data-testid="cp2-dashboard-new-returning-flags">
                {summary.newPatientsToday} new · {summary.returningPatientsToday} returning
              </span>
            </div>
            <span className="state-pill state-pill--waiting">Dashboard</span>
          </div>
          {data.queue.length > 0 ? (
            data.queue.map((entry) => (
              <div
                className="queue-entry"
                data-testid={`cp2-queue-entry-${entry.appointmentId}`}
                key={entry.id}
              >
                <div>
                  <strong>{entry.patientName}</strong>
                  <span>
                    {formatPatientKind(entry.patientKind)} · {entry.providerName}
                  </span>
                </div>
                <span className={`state-pill state-pill--${entry.state}`}>
                  {QUEUE_STATE_LABELS[entry.state]}
                </span>
                <span>{entry.waitMinutes} min</span>
              </div>
            ))
          ) : (
            <EmptyState text="No patients are checked in yet." />
          )}
        </div>
      </section>
    </div>
  );
}

function PatientsPanel({
  actionBusy,
  canCreatePatients,
  duplicateSuggestions,
  onCreatePatient,
  onPatientSearch,
  onPatientFormChange,
  onSelectPatient,
  patientForm,
  patientSearchQuery,
  patientSearchResults,
  selectedPatientId,
  setPatientSearchQuery
}: {
  actionBusy: string | null;
  canCreatePatients: boolean;
  duplicateSuggestions: DuplicateSuggestion[];
  onCreatePatient: (event: FormEvent<HTMLFormElement>) => void;
  onPatientSearch: (event: FormEvent<HTMLFormElement>) => void;
  onPatientFormChange: (input: PatientCreateInput) => void;
  onSelectPatient: (patientId: string) => void;
  patientForm: PatientCreateInput;
  patientSearchQuery: string;
  patientSearchResults: PatientSummary[];
  selectedPatientId: string | null;
  setPatientSearchQuery: (query: string) => void;
}) {
  return (
    <div className="workflow-grid workflow-grid--split">
      <section className="work-panel" aria-labelledby="quick-create-title">
        <div className="panel-heading">
          <div>
            <h2 id="quick-create-title">Quick patient create</h2>
            <p>Name, phone, duplicate suggestions, and source capture are required.</p>
          </div>
        </div>
        {canCreatePatients ? (
          <form className="form-grid" onSubmit={onCreatePatient}>
            <label>
              <span>Name</span>
              <input
                autoComplete="off"
                value={patientForm.displayName}
                onChange={(event) =>
                  onPatientFormChange({ ...patientForm, displayName: event.target.value })
                }
              />
            </label>
            <label>
              <span>Phone</span>
              <input
                autoComplete="off"
                value={patientForm.phone}
                onChange={(event) =>
                  onPatientFormChange({ ...patientForm, phone: event.target.value })
                }
              />
            </label>
            <label>
              <span>Source</span>
              <select
                value={patientForm.source}
                onChange={(event) =>
                  onPatientFormChange({
                    ...patientForm,
                    source: event.target.value as WorkflowSource
                  })
                }
              >
                {SOURCE_OPTIONS.map((source) => (
                  <option key={source} value={source}>
                    {sourceLabel(source)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              className="form-submit"
              disabled={actionBusy === "create-patient"}
              icon={<UserPlus size={16} />}
              type="submit"
              variant="primary"
            >
              Create patient
            </Button>
          </form>
        ) : (
          <div className="empty-inline" data-testid="cp2-patient-create-denied">
            <AlertCircle size={16} aria-hidden="true" />
            <span>Patient creation requires patient write access.</span>
          </div>
        )}

        <div className="subsection">
          <h3>Duplicate suggestions</h3>
          <DuplicateSuggestionList
            onSelect={onSelectPatient}
            selectedPatientId={selectedPatientId}
            suggestions={duplicateSuggestions}
          />
        </div>
      </section>

      <section className="work-panel" aria-labelledby="patient-registry-title">
        <div className="panel-heading">
          <div>
            <h2 id="patient-registry-title">Find a patient</h2>
            <p>Search first by name or full phone number; ClinicOS does not load the full registry.</p>
          </div>
        </div>
        <form className="form-grid" onSubmit={onPatientSearch}>
          <label>
            <span>Name or phone</span>
            <input
              autoComplete="off"
              data-testid="cp2-patient-search-input"
              placeholder="e.g. Rhea or +91…"
              value={patientSearchQuery}
              onChange={(event) => setPatientSearchQuery(event.target.value)}
            />
          </label>
          <Button
            className="form-submit"
            disabled={actionBusy === "patient-search"}
            icon={<Search size={16} />}
            type="submit"
            variant="primary"
          >
            Search patients
          </Button>
        </form>
        <div className="workflow-list" data-testid="cp2-patient-search-results">
          {patientSearchResults.length > 0 ? (
            patientSearchResults.map((patient) => (
              <PatientRow key={patient.id} patient={patient} showKind={false} />
            ))
          ) : (
            <EmptyState text="Search results will appear here." />
          )}
        </div>
      </section>
    </div>
  );
}

function AppointmentList({
  actionBusy,
  appointments,
  onCheckIn,
  onConfirm
}: {
  actionBusy: string | null;
  appointments: AppointmentSummary[];
  onCheckIn: (appointment: AppointmentSummary) => void;
  onConfirm: (appointment: AppointmentSummary) => void;
}) {
  if (appointments.length === 0) {
    return <EmptyState text="No appointments returned for today." />;
  }

  return (
    <div className="workflow-list">
      {appointments.map((appointment) => (
        <div className="appointment-row" key={appointment.id}>
          <time dateTime={appointment.startAt}>{formatTimeRange(appointment)}</time>
          <div className="appointment-row__main">
            <strong>{appointment.patientName}</strong>
            <span>
              {formatPatientKind(appointment.patientKind)} · {appointment.appointmentType} ·{" "}
              {appointment.providerName} · {appointment.chair}
            </span>
            <div className="meta-line">
              <AttributionBadge source={appointment.source} />
              <span data-testid={`cp2-appointment-status-${appointment.id}`}>
                {APPOINTMENT_STATUS_LABELS[appointment.status]}
              </span>
              <span>{CONFIRMATION_LABELS[appointment.confirmationState]}</span>
            </div>
          </div>
          <div className="action-row appointment-row__actions">
            <Button
              data-testid={`cp2-confirm-appointment-${appointment.id}`}
              disabled={
                appointment.confirmationState === "confirmed" ||
                !["requested", "booked"].includes(appointment.status) ||
                actionBusy === `confirm-${appointment.id}`
              }
              onClick={() => onConfirm(appointment)}
              size="sm"
              variant="secondary"
            >
              Confirm
            </Button>
            <Button
              data-testid={`cp2-check-in-${appointment.id}`}
              disabled={
                appointment.status === "checked_in" || actionBusy === `check-in-${appointment.id}`
              }
              onClick={() => onCheckIn(appointment)}
              size="sm"
              variant="primary"
            >
              Check in
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeadRow({
  active,
  lead,
  onSelect
}: {
  active?: boolean;
  lead: LeadSummary;
  onSelect: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={active ? "lead-row lead-row--active" : "lead-row"}
      data-testid={`cp2-lead-card-${lead.id}`}
      onClick={onSelect}
      type="button"
    >
      <div>
        <strong>{lead.contactName}</strong>
        <span>{lead.messageSnippet}</span>
        <div className="meta-line">
          <AttributionBadge detail={lead.attribution.detail} source={lead.attribution.source} />
          <span data-testid={`cp2-lead-status-${lead.id}`}>{LEAD_STATUS_LABELS[lead.status]}</span>
          {lead.deliveryStatus ? <span>{lead.deliveryStatus}</span> : null}
          <span>{lead.slaMinutesRemaining} min SLA</span>
        </div>
      </div>
    </button>
  );
}

function PatientRow({
  patient,
  showKind = true
}: {
  patient: PatientSummary;
  showKind?: boolean;
}) {
  const firstAttribution = patient.attribution[0];

  return (
    <div className="patient-row" data-testid={`cp2-patient-chip-${patient.id}`}>
      <div>
        <strong>{patient.displayName}</strong>
        <span>
          {patient.phone}
          {showKind ? ` · ${formatPatientKind(patient.kind)}` : ""}
        </span>
      </div>
      {firstAttribution ? (
        <AttributionBadge detail={firstAttribution.detail} source={firstAttribution.source} />
      ) : (
        <span className="source-badge source-badge--muted">No source</span>
      )}
    </div>
  );
}

function AttributionLine({ attribution }: { attribution: LeadSummary["attribution"] }) {
  return (
    <div className="attribution-line">
      <AttributionBadge detail={attribution.detail} source={attribution.source} />
      <span>{attribution.detail ?? "Source captured for lead attribution."}</span>
      {attribution.externalRef ? <code>{attribution.externalRef}</code> : null}
    </div>
  );
}

function Metric({
  label,
  sublabel,
  value,
  valueTestId
}: {
  label: string;
  sublabel: string;
  value: number;
  valueTestId?: string;
}) {
  return (
    <div className="workflow-metric">
      <span>{label}</span>
      <strong data-testid={valueTestId}>{value}</strong>
      <small>{sublabel}</small>
    </div>
  );
}

function WorkflowLoading() {
  return (
    <section className="work-panel" aria-busy="true" aria-live="polite">
      <div className="loading-row">
        <Loader2 size={18} aria-hidden="true" />
        <span>Loading CP2 workflow API state</span>
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
  problem: WorkflowProblem;
}) {
  return (
    <section className="work-panel" aria-labelledby="workflow-unavailable-title">
      <div className="empty-state empty-state--large">
        <PlugZap size={28} aria-hidden="true" />
        <p className="state-kicker">CP2 API boundary unavailable</p>
        <h2 id="workflow-unavailable-title">{problem.message}</h2>
        {problem.detail ? <p>{problem.detail}</p> : null}
      </div>
      <div className="endpoint-table" role="table" aria-label="Required CP2 endpoints">
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
          : CP2_REQUIRED_ENDPOINTS.map((endpoint) => (
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

function formatTimeRange(appointment: AppointmentSummary) {
  const start = formatTime(appointment.startAt);
  const end = formatTime(appointment.endAt);

  return `${start}-${end}`;
}

function formatTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Time pending";
  }

  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
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
