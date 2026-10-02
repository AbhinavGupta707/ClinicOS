"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import type {
  ClinicOsApiClient,
  ExecuteCommunicationCommandRequest,
  GetCommunicationThreadResponse,
  GetCommunicationConfigurationResponse,
  PreviewCommunicationAppointmentResponse
} from "@clinic-os/api-client-generated";
import type { MeProfile } from "@/lib/me";
import { PatientSelector } from "../shared/PatientSelector";
import { WorkflowAction, useWorkflowAction } from "../shared/WorkflowAction";
import { WorkflowCard, useWorkflowData } from "../shared/WorkflowData";
import { fieldText } from "../shared/workflow-values";

type Props = {
  client: ClinicOsApiClient;
  profile: MeProfile;
  onOpenPatientProfile: (id: string) => void;
};
type Command = ExecuteCommunicationCommandRequest["body"];
type Action = ReturnType<typeof useWorkflowAction>;
const states = ["open", "waiting", "handled"] as const;
export function CommunicationsWorkspace(props: Props) {
  const [status, setStatus] = useState<(typeof states)[number]>("open"),
    [selected, setSelected] = useState<string | null>(null),
    [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const action = useWorkflowAction(
    `${props.profile.tenant.id}:${props.profile.clinic.id}:${props.profile.user.id}`
  );
  const cursor = pages.at(-1),
    list = useWorkflowData(
      () => props.client.listCommunicationThreads({ query: { status, cursor } }),
      [props.client, status, cursor]
    );
  const config = useWorkflowData(
    () => props.client.getCommunicationConfiguration(),
    [props.client]
  );
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const writable = props.profile.permissions.includes("message.write");
  const refresh = async (result: unknown) => {
    if (
      result &&
      typeof result === "object" &&
      "threadId" in result &&
      typeof result.threadId === "string"
    )
      setSelected(result.threadId);
    setRecoveryVersion((v) => v + 1);
    await Promise.all([list.refresh(), config.refresh()]);
  };
  return (
    <div className="daily-workspace" data-testid="communications-workspace">
      <h1>Patient messages</h1>
      <p>
        Review conversations and appointment messages. Replies never automatically book, confirm or
        cancel a visit.
      </p>
      <WorkflowAction {...action} onRecover={() => void action.recover(refresh)} />
      {!config.data?.dispatchEnabled ? (
        <p role="status">
          Official WhatsApp sending is not enabled here. Inbox review and recorded manual contact
          remain available.
        </p>
      ) : (
        <p>
          Approved requests are queued for the worker. Provider acceptance, delivery and read status
          are shown separately.
        </p>
      )}
      <WorkflowCard
        title="Conversations"
        loading={list.loading}
        error={list.error}
        onRefresh={() => void list.refresh().catch(() => undefined)}
      >
        <fieldset disabled={action.locked}>
          <label>
            Conversation status
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPages([undefined]);
                setSelected(null);
              }}
            >
              {states.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {!list.loading && !list.error && !list.data?.threads.length ? (
            <p>No conversations in this status.</p>
          ) : null}
          {!list.loading &&
            !list.error &&
            list.data?.threads.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={selected === t.id}
                onClick={() => setSelected(t.id)}
              >
                {t.patientName ?? "Patient not selected"} · {t.contact} ·{" "}
                {t.unread ? "Unread" : "Read"} · {t.assignedName ?? "Unassigned"}
              </button>
            ))}
          <div className="workflow-toolbar">
            <button
              disabled={list.loading || pages.length < 2}
              onClick={() => {
                setPages(pages.slice(0, -1));
                setSelected(null);
              }}
            >
              Previous conversations
            </button>
            <button
              disabled={list.loading || !list.data?.nextCursor}
              onClick={() => {
                setPages([...pages, list.data?.nextCursor ?? undefined]);
                setSelected(null);
              }}
            >
              Next conversations
            </button>
          </div>
        </fieldset>
      </WorkflowCard>
      <WorkflowCard
        title="WhatsApp configuration"
        loading={config.loading}
        error={config.error}
        onRefresh={() => void config.refresh().catch(() => undefined)}
      >
        {config.data?.accounts.map((a) => (
          <p key={a.id}>
            {a.name} · {a.activation}
          </p>
        ))}
        {!config.loading && !config.error && !config.data?.accounts.length ? (
          <p>No official WhatsApp account is registered for this clinic.</p>
        ) : null}
      </WorkflowCard>
      {writable && config.data?.accounts.length ? (
        <StartConversation
          {...props}
          action={action}
          config={config.data}
          after={async (id) => {
            setSelected(id);
            await list.refresh();
          }}
        />
      ) : null}
      {selected ? (
        <Conversation
          key={`${selected}:${recoveryVersion}`}
          {...props}
          id={selected}
          action={action}
          config={config.data}
          writable={writable}
          refreshList={async () => {
            await list.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
function StartConversation(
  props: Props & {
    action: Action;
    config: GetCommunicationConfigurationResponse;
    after: (id: string) => Promise<void>;
  }
) {
  const [patient, setPatient] = useState<string | null>(null),
    [account, setAccount] = useState(props.config.accounts[0]?.id ?? "");
  return (
    <WorkflowCard title="Find or start a patient conversation">
      <fieldset disabled={props.action.locked}>
        <PatientSelector client={props.client} patientId={patient} onSelectPatient={setPatient} />
        <label>
          WhatsApp account
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            {props.config.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.activation}
              </option>
            ))}
          </select>
        </label>
        <p>
          Opens the current phone&apos;s conversation. A shared number still requires an explicit patient
          decision. This sends nothing.
        </p>
        <button
          disabled={!patient || !account}
          onClick={() =>
            void props.action.execute(
              (key) =>
                props.client.executeCommunicationCommand({
                  headers: { "idempotency-key": key },
                  body: { kind: "start", accountId: account, patientId: patient! }
                }),
              (r) => props.after(r.threadId!)
            )
          }
        >
          Open conversation
        </button>
      </fieldset>
    </WorkflowCard>
  );
}
function Conversation(
  props: Props & {
    id: string;
    action: Action;
    config: GetCommunicationConfigurationResponse | null;
    writable: boolean;
    refreshList: () => Promise<void>;
  }
) {
  const [pages, setPages] = useState<(number | undefined)[]>([undefined]),
    beforeSequence = pages.at(-1);
  const data = useWorkflowData(
    () =>
      props.client.getCommunicationThread({
        path: { threadId: props.id },
        query: { beforeSequence }
      }),
    [props.client, props.id, beforeSequence]
  );
  const refresh = async () => {
    await Promise.all([data.refresh(), props.refreshList()]);
  };
  const command = (body: Command) =>
    props.action.execute(
      (key) =>
        props.client.executeCommunicationCommand({ headers: { "idempotency-key": key }, body }),
      refresh
    );
  return (
    <WorkflowCard
      title="Conversation"
      loading={data.loading}
      error={data.error}
      onRefresh={() => void refresh().catch(() => undefined)}
    >
      {data.data && !data.loading && !data.error ? (
        <>
          <p>
            {data.data.thread.contact} · Patient: {data.data.thread.patientName ?? "Not selected"}
          </p>
          <p>
            A shared family phone is not proof of patient identity. Conversation history stays
            attached to the contact.
          </p>
          <ol className="communication-messages">
            {[...data.data.messages].reverse().map((m) => (
              <li key={m.id}>
                <strong>
                  {m.kind === "inbound"
                    ? "Incoming message"
                    : m.kind === "manual_contact"
                      ? "Staff record"
                      : "Approved appointment message"}
                </strong>
                <p>
                  {m.unsupportedContent
                    ? "Non-text content received. Open it through the clinic's authorized provider workflow; attachments are not downloaded here."
                    : m.text}
                </p>
                <small>
                  {new Date(m.occurredAt).toLocaleString()}{" "}
                  {m.recordedBy ? `· ${m.recordedBy}` : ""}
                </small>
                {m.requestId ? (
                  <>
                    <p>
                      Dispatch: {m.dispatchStatus}. Delivery: {m.deliveryStatus ?? "Not reported"}.
                      {m.failureCode ? ` ${m.failureCode}` : ""}
                    </p>
                    {m.dispatchStatus === "queued" && props.writable ? (
                      <button
                        disabled={props.action.locked}
                        onClick={() =>
                          void command({ kind: "cancel_request", requestId: m.requestId! })
                        }
                      >
                        Cancel queued message
                      </button>
                    ) : null}
                    {m.dispatchStatus === "ambiguous" ? (
                      <p>
                        Delivery is uncertain. Do not resend; ask the clinic administrator to review
                        provider reconciliation evidence.
                      </p>
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ol>
          <fieldset disabled={props.action.locked}>
            <div className="workflow-toolbar">
              <button disabled={pages.length < 2} onClick={() => setPages(pages.slice(0, -1))}>
                Newer messages
              </button>
              <button
                disabled={!data.data.nextBeforeSequence}
                onClick={() => setPages([...pages, data.data!.nextBeforeSequence!])}
              >
                Older messages
              </button>
              {props.writable ? (
                <button
                  onClick={() =>
                    void command({
                      kind: "read",
                      threadId: props.id,
                      throughSequence: Math.max(0, ...data.data!.messages.map((m) => m.sequence))
                    })
                  }
                >
                  Mark displayed messages read
                </button>
              ) : null}
            </div>
          </fieldset>
          {props.writable ? (
            <ThreadEditor
              key={`${data.data.thread.rowVersion}`}
              {...props}
              value={data.data}
              command={command}
            />
          ) : null}
        </>
      ) : null}
    </WorkflowCard>
  );
}
function ThreadEditor(
  props: Props & {
    value: GetCommunicationThreadResponse;
    action: Action;
    config: GetCommunicationConfigurationResponse | null;
    command: (body: Command) => Promise<boolean>;
  }
) {
  const t = props.value.thread,
    [patient, setPatient] = useState<string | null>(t.patientId),
    [lead, setLead] = useState(t.leadId ?? ""),
    [leadPages, setLeadPages] = useState<(string | undefined)[]>([undefined]);
  const [status, setStatus] = useState(t.status),
    [assignee, setAssignee] = useState(t.assignedUserId ?? "");
  const leadCursor = leadPages.at(-1),
    leads = useWorkflowData(
      () =>
        props.client.listLeads({ query: { cursor: leadCursor, source: "whatsapp", limit: 100 } }),
      [props.client, leadCursor]
    );
  const form = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return new FormData(event.currentTarget);
  };
  return (
    <>
      <fieldset disabled={props.action.locked}>
        <form
          onSubmit={(e) => {
            form(e);
            void props.command({
              kind: "update",
              threadId: t.id,
              expectedVersion: t.rowVersion,
              status,
              assignedUserId: assignee || null
            });
          }}
        >
          <div className="workflow-fields">
            <label>
              Work status
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                {states.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Assigned staff
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {props.config?.staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button>Save conversation work</button>
        </form>
        <h3>Review patient and enquiry association</h3>
        <PatientSelector client={props.client} patientId={patient} onSelectPatient={setPatient} />
        <button type="button" onClick={() => setPatient(null)}>
          Clear patient selection
        </button>
        <p>
          {patient === t.patientId
            ? (t.patientName ?? "No patient selected")
            : "New selection awaiting identity review"}
        </p>
        <WorkflowCard
          title="WhatsApp enquiries"
          loading={leads.loading}
          error={leads.error}
          onRefresh={() => void leads.refresh().catch(() => undefined)}
        >
          <label>
            Linked enquiry
            <select value={lead} onChange={(e) => setLead(e.target.value)}>
              <option value="">No enquiry</option>
              {t.leadId && !leads.data?.leads.some((l) => l.id === t.leadId) ? (
                <option value={t.leadId}>Current linked enquiry</option>
              ) : null}
              {leads.data?.leads
                .filter((l) => fieldText(l, "primaryContact") === t.contact)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {fieldText(l, "intent")} · {fieldText(l, "status")}
                  </option>
                ))}
            </select>
          </label>
          <p>
            Only matching contacts are listed from this page. Match and book through Lead inbox.
          </p>
          <button
            type="button"
            disabled={leadPages.length < 2 || leads.loading}
            onClick={() => setLeadPages(leadPages.slice(0, -1))}
          >
            Previous enquiry page
          </button>
          <button
            type="button"
            disabled={!leads.data?.nextCursor || leads.loading}
            onClick={() => setLeadPages([...leadPages, leads.data?.nextCursor ?? undefined])}
          >
            Next enquiry page
          </button>
          <Link href="/surface/lead-inbox">Open enquiries and booking</Link>
        </WorkflowCard>
        <form
          onSubmit={(e) => {
            const f = form(e);
            void props.command({
              kind: "link",
              threadId: t.id,
              expectedVersion: t.rowVersion,
              patientId: patient,
              leadId: lead || null,
              reason: String(f.get("reason"))
            });
          }}
        >
          <label>
            Identity review reason
            <textarea name="reason" maxLength={1900} required />
          </label>
          <label>
            <input type="checkbox" required />I checked the caller and selected the correct patient
            or left them unlinked.
          </label>
          <button>Save reviewed association</button>
        </form>
        {t.patientId ? (
          <button type="button" onClick={() => props.onOpenPatientProfile(t.patientId!)}>
            Open selected patient profile
          </button>
        ) : null}
        <Link href="/surface/appointments">
          Open appointments for staff confirmation or changes
        </Link>
        <form
          onSubmit={(e) => {
            const f = form(e);
            void props.command({
              kind: "manual_contact",
              threadId: t.id,
              expectedVersion: t.rowVersion,
              evidence: String(f.get("evidence"))
            });
          }}
        >
          <label>
            Manual contact or follow-up evidence
            <textarea name="evidence" required maxLength={2000} />
          </label>
          <p>This is a staff record, not proof of WhatsApp delivery.</p>
          <button>Record manual contact</button>
        </form>
      </fieldset>
      {t.patientId && props.config ? (
        <AppointmentComposer
          {...props}
          threadId={t.id}
          accountId={t.accountId}
          patientId={t.patientId}
          config={props.config}
        />
      ) : null}
    </>
  );
}
function AppointmentComposer(
  props: Props & {
    threadId: string;
    accountId: string;
    patientId: string;
    config: GetCommunicationConfigurationResponse;
    action: Action;
    command: (body: Command) => Promise<boolean>;
  }
) {
  const [appointmentPages, setAppointmentPages] = useState<(string | undefined)[]>([undefined]),
    [appointment, setAppointment] = useState(""),
    [template, setTemplate] = useState(""),
    [preview, setPreview] = useState<PreviewCommunicationAppointmentResponse | null>(null);
  const [templatePages, setTemplatePages] = useState<(string | undefined)[]>([undefined]);
  const cursor = templatePages.at(-1);
  const templates = useWorkflowData(
    () => props.client.getCommunicationConfiguration({ query: { cursor } }),
    [props.client, cursor]
  );
  const appointmentCursor = appointmentPages.at(-1),
    appointments = useWorkflowData(
      () =>
        props.client.listCommunicationAppointments({
          path: { threadId: props.threadId },
          query: { cursor: appointmentCursor }
        }),
      [props.client, props.threadId, appointmentCursor]
    );
  return (
    <section aria-label="Prepare appointment message">
      <h3>Prepare appointment message</h3>
      <p>
        Only verified utility templates with a plain body and one appointment-details parameter are
        supported. Approval is valid for dispatch for 15 minutes.
      </p>
      <fieldset disabled={props.action.locked || !props.config.dispatchEnabled}>
        <WorkflowCard
          title="Appointment selection"
          loading={appointments.loading}
          error={appointments.error}
          onRefresh={() => {
            setPreview(null);
            void appointments.refresh().catch(() => undefined);
          }}
        >
          <label>
            Appointment
            <select
              aria-label="Appointment"
              value={appointment}
              onChange={(e) => {
                setAppointment(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">Choose appointment</option>
              {appointments.data?.appointments.map((a) => (
                <option key={a.id} value={a.id}>
                  {new Intl.DateTimeFormat("en-GB", {
                    timeZone: a.timezone,
                    dateStyle: "medium",
                    timeStyle: "short"
                  }).format(new Date(a.startAt))}{" "}
                  · {a.doctorName} · {a.status}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={appointmentPages.length < 2 || appointments.loading}
            onClick={() => {
              setAppointmentPages(appointmentPages.slice(0, -1));
              setAppointment("");
              setPreview(null);
            }}
          >
            Previous appointments
          </button>
          <button
            type="button"
            disabled={!appointments.data?.nextCursor || appointments.loading}
            onClick={() => {
              setAppointmentPages([
                ...appointmentPages,
                appointments.data?.nextCursor ?? undefined
              ]);
              setAppointment("");
              setPreview(null);
            }}
          >
            Next appointments
          </button>
        </WorkflowCard>
        <WorkflowCard
          title="Approved message templates"
          loading={templates.loading}
          error={templates.error}
          onRefresh={() => {
            setPreview(null);
            void templates.refresh().catch(() => undefined);
          }}
        >
          <label>
            Template
            <select
              aria-label="Template"
              value={template}
              onChange={(e) => {
                setTemplate(e.target.value);
                setPreview(null);
              }}
            >
              <option value="">Choose template</option>
              {templates.data?.templates
                .filter((t) => t.accountId === props.accountId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.language} · {t.syncStatus}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!template}
            onClick={() => {
              setPreview(null);
              void props.command({ kind: "sync_template", templateId: template });
            }}
          >
            Fetch verified template details
          </button>
          <button
            type="button"
            disabled={templatePages.length < 2}
            onClick={() => {
              setTemplatePages(templatePages.slice(0, -1));
              setTemplate("");
              setPreview(null);
            }}
          >
            Previous templates
          </button>
          <button
            type="button"
            disabled={!templates.data?.nextTemplateCursor}
            onClick={() => {
              setTemplatePages([...templatePages, templates.data?.nextTemplateCursor ?? undefined]);
              setTemplate("");
              setPreview(null);
            }}
          >
            Next templates
          </button>
        </WorkflowCard>
        <button
          type="button"
          disabled={
            !appointment ||
            !template ||
            appointments.loading ||
            !!appointments.error ||
            templates.loading ||
            !!templates.error
          }
          onClick={() =>
            void props.action.execute(
              (key) =>
                props.client.previewCommunicationAppointment({
                  headers: { "idempotency-key": key },
                  body: {
                    threadId: props.threadId,
                    appointmentId: appointment,
                    templateId: template
                  }
                }),
              (result) => {
                setPreview(result);
              }
            )
          }
        >
          Review exact message
        </button>
        {preview ? (
          <section aria-label="Exact message review">
            <p>To: {preview.recipient}</p>
            <p>
              Template: {preview.templateName} · {preview.language}
            </p>
            <blockquote>{preview.text}</blockquote>
            <p>Sending does not confirm attendance or change the appointment.</p>
            <button
              type="button"
              onClick={() =>
                void props.command({
                  kind: "approve",
                  threadId: preview.threadId,
                  appointmentId: preview.appointmentId,
                  templateId: preview.templateId,
                  expectedDigest: preview.digest
                })
              }
            >
              Approve and queue this exact message
            </button>
          </section>
        ) : null}
      </fieldset>
    </section>
  );
}
