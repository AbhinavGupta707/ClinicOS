"use client";

import type {
  ClinicOsApiClient,
  PublicJsonObject,
  VersionedPublicResource
} from "@clinic-os/api-client-generated";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from "react";

import type { MeProfile } from "@/lib/me";
import { formatInrMinor, parseInrMinor } from "../treatment-billing/billing-workflow";
import { clinicDateTimeToInstant } from "../front-office/front-desk";
import {
  asVersioned,
  dashboardMetric,
  errorMessage,
  evidence,
  ifMatch,
  knownRejected,
  labCaseDisplay,
  label,
  object,
  operationsCommandForScope,
  word,
  type LabCaseDisplay
} from "./operations-ui";

type Data = {
  tasks: readonly VersionedPublicResource[];
  recalls: readonly PublicJsonObject[];
  sops: readonly VersionedPublicResource[];
  sopTemplates: readonly PublicJsonObject[];
  sopSchedules: readonly PublicJsonObject[];
  vendors: readonly PublicJsonObject[];
  labCases: readonly LabCaseDisplay[];
  reconciliations: readonly PublicJsonObject[];
  staff: readonly { id: string; displayName: string }[];
  categories: readonly PublicJsonObject[];
  items: readonly PublicJsonObject[];
  checkTemplates: readonly PublicJsonObject[];
  checkRuns: readonly PublicJsonObject[];
  exceptions: readonly PublicJsonObject[];
  incidents: readonly PublicJsonObject[];
  actions: readonly VersionedPublicResource[];
  dashboard: PublicJsonObject | null;
};

const empty: Data = {
  tasks: [],
  recalls: [],
  sops: [],
  sopTemplates: [],
  sopSchedules: [],
  vendors: [],
  labCases: [],
  reconciliations: [],
  staff: [],
  categories: [],
  items: [],
  checkTemplates: [],
  checkRuns: [],
  exceptions: [],
  incidents: [],
  actions: [],
  dashboard: null
};
const emptyCursors = {
  exceptions: null as string | null,
  tasks: null as string | null,
  recalls: null as string | null,
  sops: null as string | null,
  vendors: null as string | null,
  labCases: null as string | null,
  categories: null as string | null,
  items: null as string | null,
  checkTemplates: null as string | null,
  incidents: null as string | null,
  actions: null as string | null,
  sopTemplates: null as string | null,
  sopSchedules: null as string | null,
  checkRuns: null as string | null,
  reconciliations: null as string | null
};
type PageKind = keyof typeof emptyCursors;
type Load =
  { status: "loading" } | { status: "ready"; data: Data } | { status: "error"; message: string };
type Pending = { title: string };

export function OperationsWorkspace({
  client,
  profile,
  surfaceId
}: {
  client: ClinicOsApiClient;
  profile: MeProfile;
  surfaceId: string;
}) {
  const scope = [profile.tenant.id, profile.clinic.id, profile.user.id].join(":");
  return (
    <ScopedOperationsWorkspace
      key={scope}
      client={client}
      profile={profile}
      surfaceId={surfaceId}
    />
  );
}

function ScopedOperationsWorkspace({
  client,
  profile,
  surfaceId
}: {
  client: ClinicOsApiClient;
  profile: MeProfile;
  surfaceId: string;
}) {
  const scope = [profile.tenant.id, profile.clinic.id, profile.user.id].join(":");
  const command = useMemo(() => operationsCommandForScope(scope), [scope]);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [notice, setNotice] = useState("");
  const [cursors, setCursors] = useState(emptyCursors);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const writeLock = useRef(false);
  const [pending, setPending] = useState<Pending | null>(() =>
    command.hasPending() ? { title: command.pendingTitle() ?? "an earlier operation" } : null
  );
  const epoch = useRef(0);
  const permissionsKey = profile.permissions.join("|");
  const permissions = useMemo(() => new Set(permissionsKey.split("|")), [permissionsKey]);
  const can = useCallback((key: string) => permissions.has(key), [permissions]);

  const refresh = useCallback(async () => {
    const request = ++epoch.current;
    setRefreshing(true);
    setLoad((current) => (current.status === "ready" ? current : { status: "loading" }));
    try {
      let data: Data = empty;
      if (surfaceId === "tasks") {
        const [tasks, recalls, sops, templates, schedules, staff] = await Promise.all([
          can("task.manage")
            ? client.listTasks({ query: { limit: 100 } })
            : { tasks: [], nextCursor: null },
          can("recall.manage") && can("patient.read")
            ? client.listRecalls({ query: { limit: 100 } })
            : { recalls: [], nextCursor: null },
          can("sop.manage")
            ? client.listSopRuns({ query: { limit: 100 } })
            : { sopRuns: [], nextCursor: null },
          can("sop.manage")
            ? client.listSopTemplates({ query: { limit: 50 } })
            : { templates: [], nextCursor: null },
          can("sop.manage")
            ? client.listSopSchedules({ query: { limit: 50 } })
            : { schedules: [], nextCursor: null },
          can("schedule.read") && (can("task.manage") || can("sop.manage"))
            ? client.listClinicStaff()
            : { staff: [] }
        ]);
        data = {
          ...empty,
          tasks: tasks.tasks,
          recalls: recalls.recalls,
          sops: sops.sopRuns,
          sopTemplates: templates.templates,
          sopSchedules: schedules.schedules,
          staff: staff.staff
        };
        if (request === epoch.current)
          setCursors({
            ...emptyCursors,
            tasks: tasks.nextCursor,
            recalls: recalls.nextCursor,
            sops: sops.nextCursor,
            sopTemplates: templates.nextCursor ?? null,
            sopSchedules: schedules.nextCursor ?? null,
            checkRuns: null,
            reconciliations: null
          });
      } else if (surfaceId === "lab") {
        const [vendors, cases, reconciliations] = await Promise.all([
          can("lab.manage")
            ? client.listLabVendors({ query: { limit: 100 } })
            : { labVendors: [], nextCursor: null },
          can("lab.manage")
            ? client.listLabCases({ query: { limit: 100 } })
            : { labCases: [], nextCursor: null },
          can("lab.manage")
            ? client.listLabReconciliations({ query: { limit: 50 } })
            : { reconciliations: [], nextCursor: null }
        ]);
        data = {
          ...empty,
          vendors: vendors.labVendors,
          reconciliations: reconciliations.reconciliations,
          labCases: cases.labCases
            .map(labCaseDisplay)
            .filter((item): item is LabCaseDisplay => item !== null)
        };
        if (request === epoch.current)
          setCursors({
            ...emptyCursors,
            vendors: vendors.nextCursor,
            labCases: cases.nextCursor,
            sopTemplates: null,
            sopSchedules: null,
            checkRuns: null,
            reconciliations: reconciliations.nextCursor ?? null
          });
      } else if (surfaceId === "operations") {
        const [categories, items, templates, runs, exceptions, incidents, actions, staff] =
          await Promise.all([
            can("inventory.manage")
              ? client.listInventoryCategories({ query: { limit: 100 } })
              : { categories: [], nextCursor: null },
            can("inventory.manage")
              ? client.listInventoryItems({ query: { limit: 100 } })
              : { items: [], nextCursor: null },
            can("inventory.manage")
              ? client.listInventoryCheckTemplates({ query: { limit: 100 } })
              : { templates: [], nextCursor: null },
            can("inventory.manage")
              ? client.listInventoryCheckRuns({ query: { limit: 50 } })
              : { runs: [], nextCursor: null },
            can("inventory.manage")
              ? client.listInventoryExceptions({ query: { limit: 100 } })
              : { exceptions: [], nextCursor: null },
            can("incident.manage")
              ? client.listIncidents({ query: { limit: 100 } })
              : { incidents: [], nextCursor: null },
            can("corrective_action.manage")
              ? client.listCorrectiveActions({ query: { limit: 100 } })
              : { correctiveActions: [], nextCursor: null },
            can("schedule.read") && can("corrective_action.manage")
              ? client.listClinicStaff()
              : { staff: [] }
          ]);
        data = {
          ...empty,
          categories: categories.categories,
          items: items.items,
          checkTemplates: templates.templates,
          checkRuns: runs.runs,
          exceptions: exceptions.exceptions,
          incidents: incidents.incidents,
          actions: actions.correctiveActions,
          staff: staff.staff
        };
        if (request === epoch.current)
          setCursors({
            ...emptyCursors,
            exceptions: exceptions.nextCursor,
            categories: categories.nextCursor,
            items: items.nextCursor,
            checkTemplates: templates.nextCursor,
            incidents: incidents.nextCursor,
            actions: actions.nextCursor,
            sopTemplates: null,
            sopSchedules: null,
            checkRuns: runs.nextCursor ?? null,
            reconciliations: null
          });
      } else if (surfaceId === "owner-control") {
        if (can("analytics.read")) {
          const dashboard = await client.getOwnerDashboard();
          data = { ...empty, dashboard: dashboard.dashboard };
        }
      }
      if (request === epoch.current) setLoad({ status: "ready", data });
    } catch (error) {
      if (request === epoch.current) setLoad({ status: "error", message: errorMessage(error) });
    } finally {
      if (request === epoch.current) setRefreshing(false);
    }
  }, [client, surfaceId, can]);

  useEffect(() => {
    void refresh();
    return () => {
      epoch.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!command.hasPending()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [command]);

  const write = async (
    title: string,
    invoke: (key: string) => Promise<unknown>
  ): Promise<boolean> => {
    if (writeLock.current || command.hasPending()) return false;
    writeLock.current = true;
    const execute = async () => {
      setBusy(true);
      setNotice("");
      try {
        await command.execute(title, invoke);
        setPending(null);
        setNotice(`${title} recorded. Refreshing durable state.`);
        await refresh();
        return true;
      } catch (error) {
        const message = errorMessage(error);
        if (knownRejected(error)) {
          setPending(null);
          setNotice(`${title} was rejected: ${message}`);
          await refresh();
        } else {
          setPending({ title });
          setNotice(
            `${title} has an unknown outcome: ${message}. Do not start another write. Retry the exact request below.`
          );
        }
        return false;
      } finally {
        setBusy(false);
        writeLock.current = false;
      }
    };
    return execute();
  };

  const recover = async () => {
    if (busy || !command.hasPending()) return;
    setBusy(true);
    try {
      await command.recover();
      setPending(null);
      setNotice("The original request was resolved. Refreshing durable records.");
      await refresh();
    } catch (error) {
      if (knownRejected(error)) {
        setPending(null);
        setNotice(`The original request was rejected: ${errorMessage(error)}`);
        await refresh();
      } else {
        setNotice(`The original request still has an unknown outcome: ${errorMessage(error)}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async (kind: PageKind) => {
    const cursor = cursors[kind];
    if (!cursor || load.status !== "ready" || busy) return;
    const request = epoch.current;
    setBusy(true);
    try {
      let rows: readonly unknown[] = [],
        next: string | null = null;
      switch (kind) {
        case "exceptions": {
          const page = await client.listInventoryExceptions({ query: { cursor, limit: 100 } });
          rows = page.exceptions;
          next = page.nextCursor;
          break;
        }
        case "tasks": {
          const page = await client.listTasks({ query: { cursor, limit: 100 } });
          rows = page.tasks;
          next = page.nextCursor;
          break;
        }
        case "recalls": {
          const page = await client.listRecalls({ query: { cursor, limit: 100 } });
          rows = page.recalls;
          next = page.nextCursor;
          break;
        }
        case "sops": {
          const page = await client.listSopRuns({ query: { cursor, limit: 100 } });
          rows = page.sopRuns;
          next = page.nextCursor;
          break;
        }
        case "vendors": {
          const page = await client.listLabVendors({ query: { cursor, limit: 100 } });
          rows = page.labVendors;
          next = page.nextCursor;
          break;
        }
        case "labCases": {
          const page = await client.listLabCases({ query: { cursor, limit: 100 } });
          rows = page.labCases
            .map(labCaseDisplay)
            .filter((row): row is LabCaseDisplay => row !== null);
          next = page.nextCursor;
          break;
        }
        case "categories": {
          const page = await client.listInventoryCategories({ query: { cursor, limit: 100 } });
          rows = page.categories;
          next = page.nextCursor;
          break;
        }
        case "items": {
          const page = await client.listInventoryItems({ query: { cursor, limit: 100 } });
          rows = page.items;
          next = page.nextCursor;
          break;
        }
        case "checkTemplates": {
          const page = await client.listInventoryCheckTemplates({ query: { cursor, limit: 100 } });
          rows = page.templates;
          next = page.nextCursor;
          break;
        }
        case "incidents": {
          const page = await client.listIncidents({ query: { cursor, limit: 100 } });
          rows = page.incidents;
          next = page.nextCursor;
          break;
        }
        case "actions": {
          const page = await client.listCorrectiveActions({ query: { cursor, limit: 100 } });
          rows = page.correctiveActions;
          next = page.nextCursor;
          break;
        }
        case "sopTemplates": {
          const page = await client.listSopTemplates({ query: { cursor, limit: 100 } });
          rows = page.templates;
          next = page.nextCursor;
          break;
        }
        case "sopSchedules": {
          const page = await client.listSopSchedules({ query: { cursor, limit: 100 } });
          rows = page.schedules;
          next = page.nextCursor;
          break;
        }
        case "checkRuns": {
          const page = await client.listInventoryCheckRuns({ query: { cursor, limit: 100 } });
          rows = page.runs;
          next = page.nextCursor;
          break;
        }
        case "reconciliations": {
          const page = await client.listLabReconciliations({ query: { cursor, limit: 100 } });
          rows = page.reconciliations;
          next = page.nextCursor;
          break;
        }
      }
      if (request !== epoch.current) return;
      setLoad((current) => {
        if (current.status !== "ready") return current;
        const key = (row: unknown) =>
          word(object(row).id) ||
          word(object(object(row).case).id) ||
          word(object(object(row).run).id) ||
          word(object(object(row).reconciliation).id) ||
          word(object(object(row).checkRunLine).id) ||
          word(object(object(row).item).id);
        const distinct = new Map([...current.data[kind], ...rows].map((row) => [key(row), row]));
        return { status: "ready", data: { ...current.data, [kind]: [...distinct.values()] } };
      });
      setCursors((current) => ({ ...current, [kind]: next }));
    } catch (error) {
      setNotice(`Could not load more records: ${errorMessage(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const data = load.status === "ready" ? load.data : empty;
  return (
    <section aria-labelledby="operations-title" data-testid="operations-workspace">
      <header>
        <h1 id="operations-title">
          {surfaceId === "tasks"
            ? "Tasks and recalls"
            : surfaceId === "lab"
              ? "Lab cases"
              : surfaceId === "operations"
                ? "Clinic operations"
                : "Owner control"}
        </h1>
        <button type="button" onClick={() => void refresh()} disabled={busy || Boolean(pending)}>
          Refresh
        </button>
      </header>
      {notice && <p role="status">{notice}</p>}
      {pending && (
        <div role="alert">
          <p>
            Outcome unresolved for {pending.title}. The original idempotency key and request are
            retained in this session.
          </p>
          <button type="button" disabled={busy} onClick={() => void recover()}>
            Retry exact request
          </button>
        </div>
      )}
      {load.status === "loading" && <p role="status">Loading clinic records…</p>}
      {load.status === "error" && (
        <div role="alert">
          <p>Records unavailable: {load.message}</p>
          <button type="button" onClick={() => void refresh()}>
            Try loading again
          </button>
        </div>
      )}
      {load.status === "ready" && (
        <fieldset disabled={busy || refreshing || Boolean(pending)} className="operations-forms">
          {surfaceId === "tasks" && (
            <Tasks client={client} data={data} can={can} write={write} profile={profile} />
          )}

          {surfaceId === "lab" && (
            <Lab client={client} data={data} can={can} write={write} profile={profile} />
          )}

          {surfaceId === "operations" && (
            <Inventory client={client} data={data} can={can} write={write} profile={profile} />
          )}

          {surfaceId === "owner-control" && <Owner data={data} can={can} />}
          {(Object.keys(cursors) as PageKind[])
            .filter((kind) => cursors[kind])
            .map((kind) => (
              <button key={kind} type="button" onClick={() => void loadMore(kind)}>
                Load more {kind.replace(/([A-Z])/g, " $1").toLowerCase()}
              </button>
            ))}
        </fieldset>
      )}
    </section>
  );
}

type Shared = {
  client: ClinicOsApiClient;
  data: Data;
  can: (key: string) => boolean;
  write: (title: string, invoke: (key: string) => Promise<unknown>) => Promise<boolean>;
};
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="work-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Text({
  label: title,
  value,
  onChange,
  required = false,
  area = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  area?: boolean;
}) {
  return (
    <label className="clinical-field">
      {title}
      {area ? (
        <textarea
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          required={required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}
function Select({
  label: title,
  value,
  onChange,
  rows,
  getLabel,
  optional = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: readonly unknown[];
  getLabel: (value: unknown) => string;
  optional?: boolean;
}) {
  return (
    <label className="clinical-field">
      {title}
      <select required={!optional} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{optional ? "None" : "Choose…"}</option>
        {rows.map((row) => {
          const id = word(object(row).id);
          return id ? (
            <option key={id} value={id}>
              {getLabel(row)}
            </option>
          ) : null;
        })}
      </select>
    </label>
  );
}
function Choices({
  label: title,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  return (
    <label className="clinical-field">
      {title}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </label>
  );
}
function Rows({ rows, fields }: { rows: readonly unknown[]; fields: readonly string[] }) {
  return rows.length ? (
    <ul>
      {rows.map((item, index) => {
        const row = object(item);
        return (
          <li key={word(row.id) || index}>
            <strong>{label(item, ...fields)}</strong>
            {word(row.status) && <span> · {word(row.status).replaceAll("_", " ")}</span>}
          </li>
        );
      })}
    </ul>
  ) : (
    <p>No records found.</p>
  );
}
function submit(event: FormEvent, run: () => Promise<void>) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  form.querySelector("[data-operations-validation]")?.remove();
  void run().catch((error: unknown) => {
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.setAttribute("data-operations-validation", "");
    message.textContent = errorMessage(error);
    form.prepend(message);
  });
}
function requiredEvidence(note: string) {
  return evidence(note);
}
function toInstant(local: string, profile: MeProfile) {
  if (!profile.clinic.timezone) throw new Error("Clinic timezone is unavailable.");
  return clinicDateTimeToInstant(local, profile.clinic.timezone);
}
function DateTime({
  label: title,
  value,
  onChange,
  optional = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  return (
    <label className="clinical-field">
      {title}
      <input
        type="datetime-local"
        required={!optional}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Tasks({ client, data, can, write, profile }: Shared & { profile: MeProfile }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [taskId, setTaskId] = useState("");
  const [taskStatus, setTaskStatus] = useState("in_progress");
  const [taskEvidence, setTaskEvidence] = useState("");
  const [taskAssignee, setTaskAssignee] = useState("");
  const [progressAssignee, setProgressAssignee] = useState("");
  const [continuityCursor, setContinuityCursor] = useState<string | null>(null);
  const [continuityAsOf, setContinuityAsOf] = useState<string | undefined>();
  const [sopCursor, setSopCursor] = useState<string | null>(null);
  const [sopAsOf, setSopAsOf] = useState<string | undefined>();
  const [taskDue, setTaskDue] = useState("");
  const [recallId, setRecallId] = useState("");
  const [recallAction, setRecallAction] = useState("manual_contacted");
  const [recallEvidence, setRecallEvidence] = useState("");
  const [sopId, setSopId] = useState("");
  const [sopEvidence, setSopEvidence] = useState("");
  const [sopItemId, setSopItemId] = useState("");
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateCode, setTemplateCode] = useState("");
  const [templateItems, setTemplateItems] = useState([""]);
  const [scheduleTemplate, setScheduleTemplate] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduleAssignee, setScheduleAssignee] = useState("");
  const [scheduleRecurrence, setScheduleRecurrence] = useState("daily");
  const [scheduleInterval, setScheduleInterval] = useState("7");
  const [scheduleWeekday, setScheduleWeekday] = useState("1");
  const [scheduleMonthday, setScheduleMonthday] = useState("1");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleCode, setRuleCode] = useState("");
  const [ruleOffsetDays, setRuleOffsetDays] = useState("180");
  const selectedTask = data.tasks.find((item) => item.id === taskId);
  const selectedSop = data.sops.find((item) => item.id === sopId);
  const sopItems = Array.isArray(selectedSop?.items) ? selectedSop.items : [];
  const sopRequiredPending = sopItems.some((item) => {
    const row = object(item);
    return row.evidenceRequired === true && row.status !== "done";
  });
  const sopLabel = (value: unknown) => {
    const row = object(value);
    const schedule = data.sopSchedules.find((item) => word(item.id) === word(row.scheduleId));
    return `${schedule ? label(schedule, "title") : "SOP run"} · ${word(row.dueAt) || "No due time"} · ${word(row.status)}`;
  };
  return (
    <>
      {can("task.manage") && (
        <Section title="Staff tasks">
          <Rows rows={data.tasks} fields={["title"]} />
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const body = {
                  title: title.trim(),
                  description: description.trim() || undefined,
                  taskType: "manual" as const,
                  sourceWorkflow: "manual" as const,
                  assignedToUserId: taskAssignee || undefined,
                  dueAt: taskDue ? toInstant(taskDue, profile) : undefined
                };
                if (
                  await write("Task", (key) =>
                    client.createTask({ headers: { "idempotency-key": key }, body })
                  )
                ) {
                  setTitle("");
                  setDescription("");
                }
              })
            }
          >
            <h3>Create task</h3>
            <Text label="Title" value={title} onChange={setTitle} required />
            <Text label="Instructions" value={description} onChange={setDescription} area />
            <Select
              label="Assign to"
              rows={data.staff}
              value={taskAssignee}
              onChange={setTaskAssignee}
              getLabel={(row) => label(row, "displayName")}
              optional
            />
            <DateTime
              label="Clinic local due time"
              value={taskDue}
              onChange={setTaskDue}
              optional
            />
            <button type="submit">Create task</button>
          </form>
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                if (!selectedTask) return;
                const body =
                  taskStatus === "done"
                    ? {
                        status: "done" as const,
                        completionEvidence: requiredEvidence(taskEvidence)
                      }
                    : taskStatus === "cancelled"
                      ? { status: "cancelled" as const, cancelledReason: taskEvidence.trim() }
                      : { status: "in_progress" as const };
                const updateBody = { ...body, assignedToUserId: progressAssignee || null };
                if (
                  await write("Task update", (key) =>
                    client.updateTask({
                      path: { taskId: selectedTask.id },
                      headers: { "idempotency-key": key, "if-match": ifMatch(selectedTask) },
                      body: updateBody
                    })
                  )
                )
                  setTaskEvidence("");
              })
            }
          >
            <h3>Progress task</h3>
            <Select
              label="Task"
              rows={data.tasks}
              value={taskId}
              onChange={(id) => {
                setTaskId(id);
                setTaskEvidence("");
                setProgressAssignee(
                  word(data.tasks.find((row) => row.id === id)?.assignedToUserId)
                );
              }}
              getLabel={(row) => label(row, "title")}
            />
            <Choices
              label="New state"
              value={taskStatus}
              onChange={setTaskStatus}
              options={["in_progress", "done", "cancelled"]}
            />
            <Select
              label="Assign to"
              rows={data.staff}
              value={progressAssignee}
              onChange={setProgressAssignee}
              getLabel={(row) => label(row, "displayName")}
              optional
            />
            <Text
              label={taskStatus === "cancelled" ? "Cancellation reason" : "Completion evidence"}
              value={taskEvidence}
              onChange={setTaskEvidence}
              required={taskStatus !== "in_progress"}
              area
            />
            <button type="submit">Record task state</button>
          </form>
        </Section>
      )}
      {can("recall.manage") && !can("patient.read") && (
        <p>Patient read access is required to view and action recalls.</p>
      )}
      {can("recall.manage") && can("patient.read") && (
        <Section title="Recall actions">
          <Rows rows={data.recalls} fields={["patientName", "ruleTitle"]} />
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                if (!recallId) return;
                const body = {
                  actionType: recallAction as
                    | "manual_contact_requested"
                    | "manual_contacted"
                    | "completed"
                    | "skipped"
                    | "cancelled",
                  evidence: requiredEvidence(recallEvidence),
                  notes: recallEvidence.trim()
                };
                if (
                  await write("Recall action", (key) =>
                    client.recordRecallAction({
                      path: { recallId },
                      headers: { "idempotency-key": key },
                      body
                    })
                  )
                )
                  setRecallEvidence("");
              })
            }
          >
            <Select
              label="Recall"
              rows={data.recalls}
              value={recallId}
              onChange={setRecallId}
              getLabel={(row) =>
                `${label(row, "patientName")} · ${label(row, "ruleTitle")} · ${word(object(row).dueAt)}`
              }
            />
            <Choices
              label="Action"
              value={recallAction}
              onChange={setRecallAction}
              options={[
                "manual_contact_requested",
                "manual_contacted",
                "completed",
                "skipped",
                "cancelled"
              ]}
            />
            <Text
              label="Manual action evidence"
              value={recallEvidence}
              onChange={setRecallEvidence}
              required
              area
            />
            <p>Manual action only. No provider delivery state is inferred.</p>
            <button type="submit">Record recall action</button>
          </form>
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const body = {
                  code: ruleCode.trim(),
                  title: ruleTitle.trim(),
                  anchor: "procedure_completed" as const,
                  offsetDays: Number(ruleOffsetDays)
                };
                if (
                  await write("Recall rule", (key) =>
                    client.createRecallRule({ headers: { "idempotency-key": key }, body })
                  )
                ) {
                  setRuleCode("");
                  setRuleTitle("");
                }
              })
            }
          >
            <h3>Create recall rule</h3>
            <Text label="Code" value={ruleCode} onChange={setRuleCode} required />
            <Text label="Rule title" value={ruleTitle} onChange={setRuleTitle} required />
            <label>
              Days after procedure
              <input
                type="number"
                min="1"
                max="3650"
                required
                value={ruleOffsetDays}
                onChange={(event) => setRuleOffsetDays(event.target.value)}
              />
            </label>
            <button type="submit">Create rule</button>
          </form>
          {can("task.manage") ? (
            <button
              type="button"
              onClick={() =>
                void write("Due recall generation", async (key) => {
                  const asOf = continuityCursor ? continuityAsOf : new Date().toISOString();
                  const result = await client.generateDueContinuityTasks({
                    headers: { "idempotency-key": key },
                    body: { asOf, cursor: continuityCursor ?? undefined, batchSize: 25 }
                  });
                  setContinuityAsOf(asOf);
                  setContinuityCursor(result.nextCursor);
                })
              }
            >
              {continuityCursor
                ? "Continue generating due recalls"
                : "Generate due recalls and follow-ups"}
            </button>
          ) : null}
        </Section>
      )}
      {can("sop.manage") && (
        <Section title="SOP runs">
          {data.sops.length ? (
            <ul>
              {data.sops.map((run) => (
                <li key={run.id}>{sopLabel(run)}</li>
              ))}
            </ul>
          ) : (
            <p>No SOP runs found.</p>
          )}
          <p>
            Templates: {data.sopTemplates.length}; schedules: {data.sopSchedules.length}.
          </p>
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                if (!selectedSop) return;
                const note = requiredEvidence(sopEvidence);
                if (!sopItemId && sopRequiredPending)
                  throw new Error("Complete required checklist items before completing this run.");
                const body = sopItemId
                  ? { items: [{ itemId: sopItemId, status: "done" as const, evidence: note }] }
                  : { status: "completed" as const, completionEvidence: note };
                if (
                  await write("SOP run", (key) =>
                    client.updateSopRun({
                      path: { sopRunId: selectedSop.id },
                      headers: { "idempotency-key": key, "if-match": ifMatch(selectedSop) },
                      body
                    })
                  )
                )
                  setSopEvidence("");
              })
            }
          >
            <Select
              label="SOP run"
              rows={data.sops}
              value={sopId}
              onChange={(value) => {
                setSopId(value);
                setSopItemId("");
              }}
              getLabel={sopLabel}
            />
            <Select
              label="Checklist item or complete entire run"
              rows={sopItems}
              value={sopItemId}
              onChange={setSopItemId}
              getLabel={(row) => label(row, "title")}
              optional
            />
            {sopRequiredPending && (
              <p>Complete the required checklist items before completing this run.</p>
            )}
            <Text
              label="Observed completion evidence"
              value={sopEvidence}
              onChange={setSopEvidence}
              required
              area
            />
            <button type="submit">Record SOP evidence</button>
          </form>
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const body = {
                  code: templateCode.trim(),
                  title: templateTitle.trim(),
                  items: templateItems.map((item) => ({
                    title: item.trim(),
                    evidenceRequired: true
                  }))
                };
                if (
                  await write("SOP template", (key) =>
                    client.createSopTemplate({ headers: { "idempotency-key": key }, body })
                  )
                ) {
                  setTemplateCode("");
                  setTemplateTitle("");
                  setTemplateItems([""]);
                }
              })
            }
          >
            <h3>Create SOP template</h3>
            <Text label="Code" value={templateCode} onChange={setTemplateCode} required />
            <Text label="Title" value={templateTitle} onChange={setTemplateTitle} required />
            {templateItems.map((item, index) => (
              <div key={index}>
                <Text
                  label={`Checklist item ${index + 1}`}
                  value={item}
                  required
                  onChange={(value) =>
                    setTemplateItems((current) =>
                      current.map((old, i) => (i === index ? value : old))
                    )
                  }
                />
                {templateItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setTemplateItems((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    Remove item
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={templateItems.length >= 100}
              onClick={() => setTemplateItems((current) => [...current, ""])}
            >
              Add checklist item
            </button>
            <button type="submit">Create template</button>
          </form>
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                if (!profile.clinic.timezone)
                  throw new Error("Clinic timezone is required for SOP scheduling.");
                const body = {
                  templateId: scheduleTemplate,
                  title: scheduleTitle.trim(),
                  recurrenceType: scheduleRecurrence as
                    "daily" | "weekly" | "monthly" | "interval_days",
                  intervalDays:
                    scheduleRecurrence === "interval_days" ? Number(scheduleInterval) : undefined,
                  dayOfWeek: scheduleRecurrence === "weekly" ? Number(scheduleWeekday) : undefined,
                  dayOfMonth:
                    scheduleRecurrence === "monthly" ? Number(scheduleMonthday) : undefined,
                  dueTime: scheduleTime,
                  timezone: profile.clinic.timezone,
                  startsOn: scheduleStart,
                  endsOn: scheduleEnd || undefined,
                  assignedToUserId: scheduleAssignee || undefined
                };
                if (
                  await write("SOP schedule", (key) =>
                    client.createSopSchedule({ headers: { "idempotency-key": key }, body })
                  )
                )
                  setScheduleTitle("");
              })
            }
          >
            <h3>Recurring SOP schedule</h3>
            <Select
              label="Template"
              rows={data.sopTemplates.filter((item) => word(item.status) === "active")}
              value={scheduleTemplate}
              onChange={setScheduleTemplate}
              getLabel={(row) => label(row, "title", "displayName")}
            />
            <Select
              label="Assign to"
              rows={data.staff}
              value={scheduleAssignee}
              onChange={setScheduleAssignee}
              getLabel={(row) => label(row, "displayName")}
              optional
            />
            <Choices
              label="Repeat"
              value={scheduleRecurrence}
              onChange={setScheduleRecurrence}
              options={["daily", "weekly", "monthly", "interval_days"]}
            />
            {scheduleRecurrence === "interval_days" && (
              <label>
                Every number of days
                <input
                  type="number"
                  min="1"
                  max="365"
                  required
                  value={scheduleInterval}
                  onChange={(event) => setScheduleInterval(event.target.value)}
                />
              </label>
            )}
            {scheduleRecurrence === "weekly" && (
              <label>
                Weekday (Sunday is 0)
                <input
                  type="number"
                  min="0"
                  max="6"
                  required
                  value={scheduleWeekday}
                  onChange={(event) => setScheduleWeekday(event.target.value)}
                />
              </label>
            )}
            {scheduleRecurrence === "monthly" && (
              <label>
                Day of month
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={scheduleMonthday}
                  onChange={(event) => setScheduleMonthday(event.target.value)}
                />
              </label>
            )}
            <Text
              label="Schedule title"
              value={scheduleTitle}
              onChange={setScheduleTitle}
              required
            />
            <label>
              Start date
              <input
                type="date"
                required
                value={scheduleStart}
                onChange={(event) => setScheduleStart(event.target.value)}
              />
            </label>
            <label>
              Clinic local due time
              <input
                type="time"
                required
                value={scheduleTime}
                onChange={(event) => setScheduleTime(event.target.value)}
              />
            </label>
            <label>
              End date (optional)
              <input
                type="date"
                value={scheduleEnd}
                onChange={(event) => setScheduleEnd(event.target.value)}
              />
            </label>
            <button type="submit">Create schedule</button>
          </form>
          <button
            type="button"
            onClick={() =>
              void write("Due SOP generation", (key) =>
                (async () => {
                  const asOf = sopCursor ? sopAsOf : new Date().toISOString();
                  const result = await client.generateDueSopRuns({
                    headers: { "idempotency-key": key },
                    body: { asOf, cursor: sopCursor ?? undefined, batchSize: 25 }
                  });
                  setSopAsOf(asOf);
                  setSopCursor(result.nextCursor);
                  return result;
                })()
              )
            }
          >
            {sopCursor ? "Continue generating due SOP runs" : "Generate due SOP runs"}
          </button>
        </Section>
      )}
    </>
  );
}

function Lab({ client, data, can, write, profile }: Shared & { profile: MeProfile }) {
  const [vendorName, setVendorName] = useState("");
  const [expectedCost, setExpectedCost] = useState("");
  const patientGeneration = useRef(0);
  const [patientQuery, setPatientQuery] = useState("");
  const [patients, setPatients] = useState<readonly VersionedPublicResource[]>([]);
  const [patientProblem, setPatientProblem] = useState("");
  const [patientId, setPatientId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [itemType, setItemType] = useState("");
  const [material, setMaterial] = useState("");
  const [caseId, setCaseId] = useState("");
  const [status, setStatus] = useState("ready_for_pickup");
  const [reason, setReason] = useState("");
  const [caseEvidence, setCaseEvidence] = useState("");
  const [reconcileVendor, setReconcileVendor] = useState("");
  const [reconcileCases, setReconcileCases] = useState<string[]>([]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [invoiceReference, setInvoiceReference] = useState("");
  const [reconcileEvidence, setReconcileEvidence] = useState("");
  const [reconcileAmounts, setReconcileAmounts] = useState<Record<string, string>>({});
  const [invoiceTotal, setInvoiceTotal] = useState("");
  const [reconcileStatus, setReconcileStatus] = useState("draft");
  const selectedCase = data.labCases.find((item) => item.case.id === caseId)?.case;
  const transitions: Record<string, string[]> = {
    draft: ["ready_for_pickup", "sent_to_lab", "cancelled"],
    ready_for_pickup: ["sent_to_lab", "cancelled"],
    sent_to_lab: ["received_by_lab", "due", "returned", "rework_required", "cancelled"],
    received_by_lab: ["due", "returned", "rework_required", "cancelled"],
    due: ["returned", "rework_required", "cancelled"],
    returned: ["fitted", "completed", "rework_required"],
    fitted: ["completed", "rework_required"],
    rework_required: ["sent_to_lab", "cancelled"]
  };
  const allowedStates = selectedCase ? (transitions[word(selectedCase.status)] ?? []) : [];
  const selectedStatus = allowedStates.includes(status) ? status : (allowedStates[0] ?? "");
  const selectedCosts = reconcileCases.map(
    (id) => data.labCases.find((item) => item.case.id === id)?.case.expectedCostMinor
  );
  const expectedTotal = selectedCosts.every(
    (value) => typeof value === "number" && Number.isSafeInteger(value)
  )
    ? selectedCosts.reduce<number>((sum, value) => sum + (value as number), 0)
    : null;
  let invoiceVariance = "Not entered";
  if (invoiceTotal.trim()) {
    try {
      const amount = parseInrMinor(invoiceTotal, true);
      invoiceVariance =
        expectedTotal === null
          ? "Unavailable: an agreed case cost is missing"
          : formatInrMinor(amount - expectedTotal);
    } catch {
      invoiceVariance = "Enter a valid INR amount";
    }
  }
  if (!can("lab.manage")) return <p>Lab actions are outside this clinic role.</p>;
  return (
    <>
      <Section title="Lab vendors">
        <Rows rows={data.vendors} fields={["displayName"]} />
        <form
          onSubmit={(event) =>
            submit(event, async () => {
              const body = { displayName: vendorName.trim() };
              if (
                await write("Lab vendor", (key) =>
                  client.createLabVendor({ headers: { "idempotency-key": key }, body })
                )
              )
                setVendorName("");
            })
          }
        >
          <Text label="Vendor name" value={vendorName} onChange={setVendorName} required />
          <button type="submit">Add vendor</button>
        </form>
      </Section>
      <Section title="Lab cases">
        <ul>
          {data.labCases.length ? (
            data.labCases.map((item) => (
              <li key={item.case.id}>
                <strong>{label(item.case, "title")}</strong> · {label(item.vendor, "displayName")} ·{" "}
                {word(item.case.status).replaceAll("_", " ")}
              </li>
            ))
          ) : (
            <li>No lab cases found.</li>
          )}
        </ul>
        {can("patient.read") && can("patient.phi.read") ? (
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                setPatientProblem("");
                const generation = ++patientGeneration.current;
                try {
                  const response = await client.listPatients({
                    query: {
                      ...(/^[+\d][\d ()+-]+$/.test(patientQuery.trim())
                        ? { phone: patientQuery.trim().replace(/[ ()-]/g, "") }
                        : { query: patientQuery.trim() }),
                      limit: 50
                    }
                  });
                  if (generation === patientGeneration.current) setPatients(response.patients);
                } catch (error) {
                  if (generation === patientGeneration.current)
                    setPatientProblem(errorMessage(error));
                }
              })
            }
          >
            <h3>Find patient for a lab case</h3>
            <Text
              label="Patient name or phone"
              value={patientQuery}
              onChange={(value) => {
                patientGeneration.current++;
                setPatientQuery(value);
                setPatientId("");
                setPatients([]);
              }}
              required
            />
            <button type="submit">Search patients</button>
            {patientProblem && <p role="alert">{patientProblem}</p>}
            <Select
              label="Patient"
              rows={patients}
              value={patientId}
              onChange={setPatientId}
              getLabel={(row) => label(row, "fullName", "name")}
              optional
            />
          </form>
        ) : (
          <p>Patient lookup permission is required before creating a linked lab case.</p>
        )}
        {can("patient.read") && can("patient.phi.read") && (
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const body = {
                  vendorId,
                  patientId,
                  title: title.trim(),
                  expectedCostMinor: expectedCost.trim()
                    ? parseInrMinor(expectedCost, true)
                    : undefined,
                  dueAt: toInstant(due, profile),
                  items: [{ itemType: itemType.trim(), material: material.trim() || undefined }]
                };
                if (
                  await write("Lab case", (key) =>
                    client.createLabCase({ headers: { "idempotency-key": key }, body })
                  )
                ) {
                  setTitle("");
                  setItemType("");
                  setMaterial("");
                }
              })
            }
          >
            <h3>Create lab case and slip</h3>
            <Select
              label="Vendor"
              rows={data.vendors}
              value={vendorId}
              onChange={setVendorId}
              getLabel={(row) => label(row, "displayName")}
            />
            <p>
              Selected patient:{" "}
              {patients.find((item) => item.id === patientId)
                ? label(
                    patients.find((item) => item.id === patientId),
                    "fullName",
                    "name"
                  )
                : "Choose a search result above."}
            </p>
            <Text label="Case title" value={title} onChange={setTitle} required />
            <Text
              label="Agreed lab cost in INR (optional)"
              value={expectedCost}
              onChange={setExpectedCost}
            />
            <DateTime label="Clinic local due time" value={due} onChange={setDue} />
            <Text label="Item type" value={itemType} onChange={setItemType} required />
            <Text label="Material" value={material} onChange={setMaterial} />
            <button type="submit" disabled={!patientId}>
              Create case
            </button>
          </form>
        )}
        <form
          onSubmit={(event) =>
            submit(event, async () => {
              if (!selectedCase) return;
              const body = {
                status: selectedStatus as
                  | "ready_for_pickup"
                  | "sent_to_lab"
                  | "received_by_lab"
                  | "due"
                  | "returned"
                  | "fitted"
                  | "completed"
                  | "rework_required"
                  | "cancelled",
                reason: reason.trim() || undefined,
                evidence: requiredEvidence(caseEvidence)
              };
              if (
                await write("Lab case transition", (key) =>
                  client.updateLabCase({
                    path: { labCaseId: selectedCase.id },
                    headers: { "idempotency-key": key, "if-match": ifMatch(selectedCase) },
                    body
                  })
                )
              )
                setCaseEvidence("");
            })
          }
        >
          <h3>Record lab progress</h3>
          <Select
            label="Case"
            rows={data.labCases.map((item) => ({ ...item.case, title: label(item.case, "title") }))}
            value={caseId}
            onChange={setCaseId}
            getLabel={(row) => label(row, "title")}
          />
          <Choices
            label="New state"
            value={selectedStatus}
            onChange={setStatus}
            options={allowedStates}
          />
          <Text label="Reason" value={reason} onChange={setReason} />
          <Text
            label="Evidence observed"
            value={caseEvidence}
            onChange={setCaseEvidence}
            required
            area
          />
          <button type="submit" disabled={!selectedStatus}>
            Record progress
          </button>
        </form>
      </Section>
      <Section title="Lab invoice reconciliation">
        <p>Creating reconciliation records evidence. It does not record payment.</p>
        {data.reconciliations.length ? (
          <ul>
            {data.reconciliations.map((detail) => {
              const row = object(detail.reconciliation);
              return (
                <li key={word(row.id)}>
                  {label(
                    data.vendors.find((vendor) => word(vendor.id) === word(row.vendorId)),
                    "displayName"
                  )}
                  {" · "}
                  {word(row.invoiceReference) || "No invoice reference"}
                  {" · "}
                  {word(row.status)}
                  {" · variance "}
                  {formatInrMinor(row.varianceAmountMinor as number | undefined)}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>No saved lab reconciliations found.</p>
        )}
        <form
          onSubmit={(event) =>
            submit(event, async () => {
              if (["matched", "approved"].includes(reconcileStatus) && expectedTotal === null)
                throw new Error(
                  "An agreed case cost is missing. Review it before matching or approving this invoice."
                );
              const entries = reconcileCases.map((labCaseId) => {
                const raw = reconcileAmounts[labCaseId] ?? "";
                const caseRow = data.labCases.find((item) => item.case.id === labCaseId)?.case;
                const expected = caseRow?.expectedCostMinor;
                const invoiceAmountMinor = raw.trim() ? parseInrMinor(raw, true) : undefined;
                return {
                  labCaseId,
                  invoiceAmountMinor,
                  status:
                    invoiceAmountMinor === undefined
                      ? ("missing_invoice" as const)
                      : invoiceAmountMinor === expected
                        ? ("matched" as const)
                        : ("amount_variance" as const)
                };
              });
              const invoiceAmountMinor = invoiceTotal
                ? parseInrMinor(invoiceTotal, true)
                : undefined;
              if (
                ["matched", "approved"].includes(reconcileStatus) &&
                (invoiceAmountMinor === undefined ||
                  entries.some((entry) => entry.invoiceAmountMinor === undefined))
              )
                throw new Error(
                  "Enter the invoice total and every selected case amount before matching or approving."
                );
              const body = {
                vendorId: reconcileVendor,
                periodStart,
                periodEnd,
                status: reconcileStatus as
                  "draft" | "submitted" | "matched" | "variance_review" | "approved",
                invoiceReference: invoiceReference.trim() || undefined,
                invoiceAmountMinor,
                evidence: requiredEvidence(reconcileEvidence),
                entries
              };
              if (
                await write("Lab reconciliation", (key) =>
                  client.createLabReconciliation({ headers: { "idempotency-key": key }, body })
                )
              ) {
                setReconcileEvidence("");
                setReconcileCases([]);
                setReconcileAmounts({});
              }
            })
          }
        >
          <Select
            label="Vendor"
            rows={data.vendors}
            value={reconcileVendor}
            onChange={(value) => {
              setReconcileVendor(value);
              setReconcileCases([]);
              setReconcileAmounts({});
            }}
            getLabel={(row) => label(row, "displayName")}
          />
          <label>
            Period start
            <input
              type="date"
              required
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
            />
          </label>
          <label>
            Period end
            <input
              type="date"
              required
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
            />
          </label>
          <Text
            label="Invoice reference (if received)"
            value={invoiceReference}
            onChange={setInvoiceReference}
          />
          <p>
            Selected expected total:{" "}
            {expectedTotal === null
              ? "Unavailable: an agreed case cost is missing"
              : formatInrMinor(expectedTotal)}
            . Entered invoice variance: {invoiceVariance}.
          </p>
          <Choices
            label="Reconciliation state"
            value={reconcileStatus}
            onChange={setReconcileStatus}
            options={["draft", "submitted", "matched", "variance_review", "approved"]}
          />
          <label>
            Invoice total (INR)
            <input
              type="number"
              min="0"
              step="0.01"
              value={invoiceTotal}
              onChange={(event) => setInvoiceTotal(event.target.value)}
            />
          </label>
          <fieldset>
            <legend>Cases on vendor invoice</legend>
            {data.labCases
              .filter((item) => word(item.case.vendorId) === reconcileVendor)
              .map((item) => (
                <div key={item.case.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={reconcileCases.includes(item.case.id)}
                      onChange={(event) =>
                        setReconcileCases(
                          event.target.checked
                            ? [...reconcileCases, item.case.id]
                            : reconcileCases.filter((id) => id !== item.case.id)
                        )
                      }
                    />
                    {label(item.case, "title")} · expected{" "}
                    {formatInrMinor(item.case.expectedCostMinor)}
                  </label>
                  {reconcileCases.includes(item.case.id) && (
                    <label>
                      Invoice amount (INR) for {label(item.case, "title")}
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={reconcileAmounts[item.case.id] ?? ""}
                        onChange={(event) =>
                          setReconcileAmounts((current) => ({
                            ...current,
                            [item.case.id]: event.target.value
                          }))
                        }
                      />
                    </label>
                  )}
                </div>
              ))}
          </fieldset>
          <Text
            label="Reconciliation evidence"
            value={reconcileEvidence}
            onChange={setReconcileEvidence}
            required
            area
          />
          <button type="submit" disabled={!reconcileCases.length}>
            Create reconciliation
          </button>
        </form>
      </Section>
    </>
  );
}

function Inventory({ client, data, can, write, profile }: Shared & { profile: MeProfile }) {
  const [categoryCode, setCategoryCode] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [categoryKind, setCategoryKind] = useState("material");
  const [itemCategory, setItemCategory] = useState("");
  const [sku, setSku] = useState("");
  const [itemName, setItemName] = useState("");
  const [unit, setUnit] = useState("");
  const [location, setLocation] = useState("");
  const [templateCode, setTemplateCode] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateLines, setTemplateLines] = useState([{ itemId: "", drawer: "" }]);
  const [runTemplate, setRunTemplate] = useState("");
  const [runId, setRunId] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [ledgerItem, setLedgerItem] = useState("");
  const [ledgerType, setLedgerType] = useState("manual_adjustment");
  const [ledgerQuantity, setLedgerQuantity] = useState("");
  const [ledgerReason, setLedgerReason] = useState("");
  const [incidentCategory, setIncidentCategory] = useState("operational");
  const [severity, setSeverity] = useState("low");
  const [incidentSummary, setIncidentSummary] = useState("");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [actionIncident, setActionIncident] = useState("");
  const [actionTitle, setActionTitle] = useState("");
  const [actionDescription, setActionDescription] = useState("");
  const [actionDue, setActionDue] = useState("");
  const [actionOwner, setActionOwner] = useState(profile.user.id);
  const [actionId, setActionId] = useState("");
  const [actionStatus, setActionStatus] = useState("in_progress");
  const [actionEvidence, setActionEvidence] = useState("");
  const [verificationEvidence, setVerificationEvidence] = useState("");
  const run = data.checkRuns.find((item) => word(object(item.run).id) === runId);
  const runRow = asVersioned(object(run).run);
  const runLines = Array.isArray(object(run).lines)
    ? (object(run).lines as readonly unknown[])
    : [];
  const selectedAction = data.actions.find((item) => item.id === actionId);
  return (
    <>
      {can("inventory.manage") && (
        <Section title="Inventory catalogue">
          <Rows rows={data.items} fields={["displayName"]} />
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const body = {
                  code: categoryCode.trim(),
                  displayName: categoryName.trim(),
                  kind: categoryKind as "material" | "instrument" | "equipment"
                };
                if (
                  await write("Inventory category", (key) =>
                    client.createInventoryCategory({ headers: { "idempotency-key": key }, body })
                  )
                ) {
                  setCategoryCode("");
                  setCategoryName("");
                }
              })
            }
          >
            <h3>Create category</h3>
            <Text label="Code" value={categoryCode} onChange={setCategoryCode} required />
            <Text label="Name" value={categoryName} onChange={setCategoryName} required />
            <Choices
              label="Kind"
              value={categoryKind}
              onChange={setCategoryKind}
              options={["material", "instrument", "equipment"]}
            />
            <button type="submit">Create category</button>
          </form>
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const body = {
                  categoryId: itemCategory,
                  sku: sku.trim(),
                  displayName: itemName.trim(),
                  unitOfMeasure: unit.trim(),
                  storageLocation: location.trim()
                };
                if (
                  await write("Inventory item", (key) =>
                    client.createInventoryItem({ headers: { "idempotency-key": key }, body })
                  )
                ) {
                  setSku("");
                  setItemName("");
                }
              })
            }
          >
            <h3>Create inventory item</h3>
            <Select
              label="Category"
              rows={data.categories}
              value={itemCategory}
              onChange={setItemCategory}
              getLabel={(row) => label(row, "displayName")}
            />
            <Text label="SKU" value={sku} onChange={setSku} required />
            <Text label="Item name" value={itemName} onChange={setItemName} required />
            <Text label="Unit of measure" value={unit} onChange={setUnit} required />
            <Text label="Storage location" value={location} onChange={setLocation} required />
            <button type="submit">Create item</button>
          </form>
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const quantityDelta = Number(ledgerQuantity);
                if (!Number.isFinite(quantityDelta) || quantityDelta === 0)
                  throw new Error("Enter a non-zero quantity change.");
                const body = {
                  itemId: ledgerItem,
                  movementType: ledgerType as
                    "manual_adjustment" | "consumption" | "procurement_received" | "write_off",
                  quantityDelta,
                  reason: ledgerReason.trim(),
                  evidence: requiredEvidence(ledgerReason)
                };
                if (
                  await write("Stock movement", (key) =>
                    client.createStockLedgerEntry({ headers: { "idempotency-key": key }, body })
                  )
                ) {
                  setLedgerQuantity("");
                  setLedgerReason("");
                }
              })
            }
          >
            <h3>Record stock movement</h3>
            <Select
              label="Item"
              rows={data.items}
              value={ledgerItem}
              onChange={setLedgerItem}
              getLabel={(row) => label(row, "displayName")}
            />
            <Choices
              label="Movement"
              value={ledgerType}
              onChange={setLedgerType}
              options={["manual_adjustment", "consumption", "procurement_received", "write_off"]}
            />
            <label>
              Quantity change
              <input
                type="number"
                step="any"
                required
                value={ledgerQuantity}
                onChange={(event) => setLedgerQuantity(event.target.value)}
              />
            </label>
            <Text
              label="Reason and evidence"
              value={ledgerReason}
              onChange={setLedgerReason}
              required
              area
            />
            <button type="submit">Record movement</button>
          </form>
        </Section>
      )}
      {can("inventory.manage") && (
        <Section title="Inventory checks">
          <Rows rows={data.checkTemplates} fields={["displayName"]} />
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const body = {
                  code: templateCode.trim(),
                  displayName: templateName.trim(),
                  lines: templateLines.map((line) => ({
                    itemId: line.itemId,
                    drawerLocation: line.drawer.trim()
                  }))
                };
                if (new Set(templateLines.map((line) => line.itemId)).size !== templateLines.length)
                  throw new Error("Each check template item must be selected once.");
                if (
                  await write("Inventory check template", (key) =>
                    client.createInventoryCheckTemplate({
                      headers: { "idempotency-key": key },
                      body
                    })
                  )
                ) {
                  setTemplateCode("");
                  setTemplateName("");
                  setTemplateLines([{ itemId: "", drawer: "" }]);
                }
              })
            }
          >
            <h3>Create check template</h3>
            <Text label="Code" value={templateCode} onChange={setTemplateCode} required />
            <Text label="Name" value={templateName} onChange={setTemplateName} required />
            {templateLines.map((line, index) => (
              <div key={index}>
                <Select
                  label={`Item ${index + 1}`}
                  rows={data.items}
                  value={line.itemId}
                  onChange={(value) =>
                    setTemplateLines((current) =>
                      current.map((old, i) => (i === index ? { ...old, itemId: value } : old))
                    )
                  }
                  getLabel={(row) => label(row, "displayName")}
                />
                <Text
                  label="Drawer or location"
                  value={line.drawer}
                  required
                  onChange={(value) =>
                    setTemplateLines((current) =>
                      current.map((old, i) => (i === index ? { ...old, drawer: value } : old))
                    )
                  }
                />
                {templateLines.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setTemplateLines((current) => current.filter((_, i) => i !== index))
                    }
                  >
                    Remove line
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              disabled={templateLines.length >= 100}
              onClick={() =>
                setTemplateLines((current) => [...current, { itemId: "", drawer: "" }])
              }
            >
              Add check line
            </button>
            <button type="submit">Create template</button>
          </form>
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                await write("Inventory check run", (key) =>
                  client.createInventoryCheckRun({
                    headers: { "idempotency-key": key },
                    body: { templateId: runTemplate }
                  })
                );
              })
            }
          >
            <h3>Start check</h3>
            <Select
              label="Template"
              rows={data.checkTemplates}
              value={runTemplate}
              onChange={setRunTemplate}
              getLabel={(row) => label(row, "displayName")}
            />
            <button type="submit">Start check run</button>
          </form>
          <p>In-progress runs are loaded from durable records after refresh.</p>
          <Select
            label="Check run"
            rows={data.checkRuns
              .filter((detail) =>
                ["draft", "in_progress"].includes(word(object(detail.run).status))
              )
              .map((detail) => ({
                ...object(detail.run),
                title: label(detail.template, "displayName")
              }))}
            value={runId}
            onChange={(value) => {
              setRunId(value);
              setCounts({});
            }}
            getLabel={(row) => `${label(row, "title")} · ${word(object(row).status)}`}
          />
          {runRow && (
            <form
              onSubmit={(event) =>
                submit(event, async () => {
                  const lines = runLines.map((line) => ({
                    lineId: word(object(line).id),
                    countedQuantity: Number(counts[word(object(line).id)])
                  }));
                  if (
                    !lines.length ||
                    lines.some(
                      (line) =>
                        !line.lineId ||
                        !Number.isFinite(line.countedQuantity) ||
                        line.countedQuantity < 0
                    )
                  )
                    throw new Error("Count every line before completing the check.");
                  if (
                    await write("Inventory count", (key) =>
                      client.updateInventoryCheckRun({
                        path: { checkRunId: runRow.id },
                        headers: { "idempotency-key": key, "if-match": ifMatch(runRow) },
                        body: { status: "completed", lines }
                      })
                    )
                  )
                    setCounts({});
                })
              }
            >
              <h3>Count check lines</h3>
              {runLines.map((line) => {
                const row = object(line);
                const id = word(row.id);
                return (
                  <label key={id}>
                    {label(
                      data.items.find((item) => word(item.id) === word(row.itemId)),
                      "displayName"
                    )}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={counts[id] ?? ""}
                      onChange={(event) => setCounts({ ...counts, [id]: event.target.value })}
                    />
                  </label>
                );
              })}
              <button type="submit">Complete count</button>
            </form>
          )}
          <h3>Open exceptions</h3>
          <Rows rows={data.exceptions} fields={["reason", "exceptionType"]} />
          <p>
            Procurement suggestions are requests for staff action; they are not purchase
            confirmation.
          </p>
        </Section>
      )}
      {can("incident.manage") && (
        <Section title="Incident diary">
          <Rows rows={data.incidents} fields={["summary"]} />
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const body = {
                  category: incidentCategory as
                    | "operational"
                    | "clinical"
                    | "lab"
                    | "inventory"
                    | "billing"
                    | "safety"
                    | "patient_experience"
                    | "security_privacy"
                    | "other",
                  severity: severity as "low" | "medium" | "high" | "critical",
                  occurredAt: toInstant(occurredAt, profile),
                  summary: incidentSummary.trim(),
                  description: incidentDescription.trim()
                };
                if (
                  await write("Incident", (key) =>
                    client.createIncident({ headers: { "idempotency-key": key }, body })
                  )
                ) {
                  setIncidentSummary("");
                  setIncidentDescription("");
                }
              })
            }
          >
            <h3>Report incident</h3>
            <Choices
              label="Category"
              value={incidentCategory}
              onChange={setIncidentCategory}
              options={[
                "operational",
                "clinical",
                "lab",
                "inventory",
                "billing",
                "safety",
                "patient_experience",
                "security_privacy",
                "other"
              ]}
            />
            <Choices
              label="Severity"
              value={severity}
              onChange={setSeverity}
              options={["low", "medium", "high", "critical"]}
            />
            <DateTime
              label="Clinic local occurrence time"
              value={occurredAt}
              onChange={setOccurredAt}
            />
            <Text label="Summary" value={incidentSummary} onChange={setIncidentSummary} required />
            <Text
              label="Description"
              value={incidentDescription}
              onChange={setIncidentDescription}
              required
              area
            />
            <button type="submit">Record incident</button>
          </form>
        </Section>
      )}
      {can("corrective_action.manage") && (
        <Section title="Corrective actions">
          {!data.staff.length && (
            <p role="alert">
              Active clinic staff names are unavailable. Assignment requires staff-directory access.
            </p>
          )}
          <Rows rows={data.actions} fields={["title"]} />
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                const body = {
                  incidentId: actionIncident || undefined,
                  title: actionTitle.trim(),
                  description: actionDescription.trim(),
                  ownerUserId: actionOwner,
                  dueAt: toInstant(actionDue, profile)
                };
                if (
                  await write("Corrective action", (key) =>
                    client.createCorrectiveAction({ headers: { "idempotency-key": key }, body })
                  )
                ) {
                  setActionTitle("");
                  setActionDescription("");
                }
              })
            }
          >
            <h3>Assign corrective action</h3>
            <Select
              label="Related incident"
              rows={data.incidents}
              value={actionIncident}
              onChange={setActionIncident}
              getLabel={(row) => label(row, "summary")}
              optional
            />
            <Text label="Title" value={actionTitle} onChange={setActionTitle} required />
            <Text
              label="Description"
              value={actionDescription}
              onChange={setActionDescription}
              required
              area
            />
            <Select
              label="Owner"
              rows={data.staff}
              value={actionOwner}
              onChange={setActionOwner}
              getLabel={(row) => label(row, "displayName")}
            />
            <DateTime label="Clinic local due time" value={actionDue} onChange={setActionDue} />
            <button type="submit">Create action</button>
          </form>
          <form
            onSubmit={(event) =>
              submit(event, async () => {
                if (!selectedAction) return;
                const body = {
                  status: actionStatus as "open" | "in_progress" | "completed" | "cancelled",
                  completionEvidence: requiredEvidence(actionEvidence),
                  verificationEvidence:
                    actionStatus === "completed"
                      ? requiredEvidence(verificationEvidence)
                      : undefined
                };
                if (
                  await write("Corrective action update", (key) =>
                    client.updateCorrectiveAction({
                      path: { correctiveActionId: selectedAction.id },
                      headers: { "idempotency-key": key, "if-match": ifMatch(selectedAction) },
                      body
                    })
                  )
                ) {
                  setActionEvidence("");
                  setVerificationEvidence("");
                }
              })
            }
          >
            <h3>Progress action</h3>
            <Select
              label="Action"
              rows={data.actions}
              value={actionId}
              onChange={setActionId}
              getLabel={(row) => label(row, "title")}
            />
            <Choices
              label="New state"
              value={actionStatus}
              onChange={setActionStatus}
              options={["in_progress", "completed", "cancelled"]}
            />
            <Text
              label="Completion or progress evidence"
              value={actionEvidence}
              onChange={setActionEvidence}
              required
              area
            />
            {actionStatus === "completed" && (
              <Text
                label="Independent verification evidence"
                value={verificationEvidence}
                onChange={setVerificationEvidence}
                required
                area
              />
            )}
            <button type="submit">Record action state</button>
          </form>
        </Section>
      )}
    </>
  );
}

function Owner({ data, can }: { data: Data; can: (key: string) => boolean }) {
  if (!can("analytics.read")) return <p>Owner analytics are outside this clinic role.</p>;
  if (!data.dashboard) return <p>No dashboard returned.</p>;
  const dashboard = object(data.dashboard);
  const freshness = object(dashboard.freshness);
  const sections = [
    "appointments",
    "revenue",
    "recalls",
    "tasks",
    "sops",
    "labs",
    "inventory",
    "treatmentAndPayments",
    "incidents"
  ];
  const title = (value: string) => value.replaceAll(/([A-Z])/g, " $1").replaceAll("_", " ");
  return (
    <Section title="Owner dashboard">
      <p>
        Generated: {word(freshness.generatedAt) || "Unavailable"}; status:{" "}
        {word(freshness.status) || "unavailable"}.
      </p>
      <p>
        Range: {word(dashboard.from)} to {word(dashboard.to)} · Currency: {word(dashboard.currency)}
      </p>
      {sections.map((name) => {
        const metrics = object(dashboard[name]);
        return (
          <section key={name}>
            <h3>{title(name)}</h3>
            <dl>
              {Object.entries(metrics)
                .filter(([, value]) => typeof value === "number")
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{title(key.replace(/(?:Minor|BasisPoints)$/, ""))}</dt>
                    <dd>{dashboardMetric(key, value as number, word(dashboard.currency))}</dd>
                  </div>
                ))}
            </dl>
          </section>
        );
      })}
      <h3>Data sources</h3>
      {Array.isArray(dashboard.dataSources) ? (
        <ul>
          {dashboard.dataSources.map((source, index) => {
            const row = object(source);
            return (
              <li key={word(row.key) || index}>
                {word(row.key)} · {word(row.status)}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Source information unavailable.</p>
      )}
      <p>
        Metrics are source-attributed dashboard values. Provider delivery and payment are not
        inferred here.
      </p>
    </Section>
  );
}
