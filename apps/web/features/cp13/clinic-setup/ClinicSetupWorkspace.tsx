"use client";
import { useState, type FormEvent } from "react";
import type {
  ClinicOsApiClient,
  ListClinicSetupRequest,
  SaveClinicSetupRequest,
  SaveClinicAccessRequest,
  PublicJsonObject,
  VersionedPublicResource,
  WritableJsonObject
} from "@clinic-os/api-client-generated";
import type { MeProfile } from "@/lib/me";
import { useWorkflowData, WorkflowCard } from "../shared/WorkflowData";
import { useWorkflowAction, WorkflowAction } from "../shared/WorkflowAction";
import { fieldText, record, valueList } from "../shared/workflow-values";
import { parseInrMinor, formatInrMinor } from "../treatment-billing/billing-workflow";

type Kind = ListClinicSetupRequest["path"]["kind"];
type Props = { client: ClinicOsApiClient; profile: MeProfile };
type Action = ReturnType<typeof useWorkflowAction>;
const sections: readonly [Kind, string][] = [
  ["clinic", "Practice details"],
  ["appointment_type", "Visit types"],
  ["chair", "Chairs and rooms"],
  ["provider_schedule", "Doctor working hours"],
  ["pricebook", "Treatments and prices"]
];
export function ClinicSetupWorkspace(props: Props) {
  const [section, setSection] = useState<Kind | "staff" | "intake">("clinic");
  const action = useWorkflowAction(
    `${props.profile.tenant.id}:${props.profile.clinic.id}:${props.profile.user.id}`
  );
  const [revision, setRevision] = useState(0);
  if (!props.profile.permissions.includes("clinic.manage"))
    return <p role="alert">Clinic setup requires clinic administration access.</p>;
  return (
    <div className="daily-workspace" data-testid="clinic-setup">
      <h1>Clinic setup</h1>
      <nav className="workflow-links" aria-label="Setup sections">
        {sections.map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            aria-pressed={section === kind}
            disabled={action.locked}
            onClick={() => setSection(kind)}
          >
            {label}
          </button>
        ))}
        <button type="button" disabled={action.locked} onClick={() => setSection("staff")}>
          Staff access
        </button>
        <button type="button" disabled={action.locked} onClick={() => setSection("intake")}>
          Intake templates
        </button>
      </nav>
      <WorkflowAction
        {...action}
        onRecover={() => void action.recover(() => setRevision((value) => value + 1))}
      />
      {section === "staff" ? (
        <StaffSetup {...props} action={action} key={`staff:${revision}`} />
      ) : section === "intake" ? (
        <IntakeSetup {...props} action={action} key={`intake:${revision}`} />
      ) : (
        <Configuration {...props} action={action} kind={section} key={`${section}:${revision}`} />
      )}
    </div>
  );
}
function Configuration(props: Props & { kind: Kind; action: Action }) {
  const [cursor, setCursor] = useState<string | undefined>(),
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false);
  const data = useWorkflowData(
    () =>
      props.client.listClinicSetup({ path: { kind: props.kind }, query: { cursor, limit: 50 } }),
    [props.client, props.kind, cursor]
  );
  const doctors = useWorkflowData(
    () =>
      props.kind === "provider_schedule"
        ? props.client.listClinicDoctors()
        : Promise.resolve({ clinicDoctors: [] }),
    [props.client, props.kind]
  );
  const selectedRow =
    data.data?.records.find((row) => row.id === selected) ??
    (props.kind === "clinic" ? data.data?.records[0] : undefined);
  const label = sections.find(([kind]) => kind === props.kind)![1];
  return (
    <WorkflowCard
      title={label}
      loading={data.loading}
      error={data.error}
      onRefresh={() => void data.refresh().catch(() => undefined)}
    >
      {props.kind !== "clinic" ? (
        <>
          <ul>
            {data.data?.records.map((row) => {
              const c = record(row.configuration);
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={props.action.locked}
                    onClick={() => {
                      setSelected(row.id);
                      setCreating(false);
                    }}
                  >
                    {props.kind === "provider_schedule"
                      ? `${doctors.data?.clinicDoctors.find((d) => d.providerUserId === c.providerUserId)?.displayName ?? "Clinic doctor"} · ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][Number(c.dayOfWeek)]} ${fieldText(c, "startsAt")}–${fieldText(c, "endsAt")}`
                      : fieldText(c, "displayName")}{" "}
                    · {c.active === false || c.status === "retired" ? "Inactive" : "Active"}
                    {props.kind === "pricebook"
                      ? ` · ${formatInrMinor(c.defaultUnitPriceMinor)}`
                      : ""}
                  </button>
                </li>
              );
            })}
          </ul>
          {cursor ? (
            <button
              type="button"
              onClick={() => {
                setCursor(undefined);
                setSelected(null);
              }}
            >
              First page
            </button>
          ) : null}
          {data.data?.nextCursor ? (
            <button
              type="button"
              onClick={() => {
                setCursor(data.data!.nextCursor!);
                setSelected(null);
              }}
            >
              Next page
            </button>
          ) : null}
          <button
            type="button"
            disabled={props.action.locked}
            onClick={() => {
              setCreating(true);
              setSelected(null);
            }}
          >
            Add {label.toLowerCase()}
          </button>
        </>
      ) : null}
      {doctors.error ? <p role="alert">{doctors.error}</p> : null}
      {(creating || selectedRow) && !data.error ? (
        <ConfigurationForm
          {...props}
          key={`${selectedRow?.id ?? "new"}:${selectedRow?.rowVersion ?? 0}`}
          current={creating ? undefined : selectedRow}
          doctors={doctors.data?.clinicDoctors ?? []}
          onSaved={async (id) => {
            setSelected(id);
            setCreating(false);
            await data.refresh();
          }}
        />
      ) : null}
      <p>
        Changes are checked against the saved version. Existing bookings must be reassigned before
        disabling their doctor, chair, visit type or working hours.
      </p>
    </WorkflowCard>
  );
}
function ConfigurationForm(
  props: Props & {
    kind: Kind;
    action: Action;
    current?: VersionedPublicResource;
    doctors: readonly PublicJsonObject[];
    onSaved: (id: string) => Promise<void>;
  }
) {
  const c = record(props.current?.configuration),
    [error, setError] = useState("");
  const text = (key: string, fallback = "") => fieldText(c, key) || fallback;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget),
      get = (key: string) => String(form.get(key) ?? "").trim();
    try {
      let configuration: SaveClinicSetupRequest["body"]["configuration"] = {};
      if (props.kind === "clinic")
        configuration = {
          displayName: get("displayName"),
          legalName: get("legalName") || null,
          timezone: get("timezone"),
          address: Object.fromEntries(
            ["line1", "line2", "city", "state", "postalCode", "country"]
              .map((key) => [key, get(key)])
              .filter(([, value]) => value)
          )
        };
      if (props.kind === "appointment_type")
        configuration = {
          displayName: get("displayName"),
          code: get("code"),
          defaultDurationMinutes: Number(get("duration")),
          color: get("color") || null,
          active: form.has("active")
        };
      if (props.kind === "chair")
        configuration = {
          displayName: get("displayName"),
          code: get("code"),
          active: form.has("active")
        };
      if (props.kind === "provider_schedule")
        configuration = {
          providerUserId: get("providerUserId"),
          dayOfWeek: Number(get("dayOfWeek")),
          startsAt: get("startsAt"),
          endsAt: get("endsAt"),
          effectiveFrom: get("effectiveFrom"),
          effectiveUntil: get("effectiveUntil") || null,
          active: form.has("active")
        };
      if (props.kind === "pricebook")
        configuration = {
          displayName: get("displayName"),
          code: get("code"),
          category: get("category"),
          description: get("description") || null,
          defaultUnitPriceMinor: /^0(?:\.0{1,2})?$/.test(get("price"))
            ? 0
            : parseInrMinor(get("price")),
          currency: "INR",
          taxRateBasisPoints: Math.round(Number(get("tax")) * 100),
          status: form.has("active") ? "active" : "retired"
        };
      await props.action.execute(
        (key) =>
          props.client.saveClinicSetup({
            path: { kind: props.kind },
            headers: { "idempotency-key": key },
            body: {
              recordId: props.current?.id,
              expectedVersion: props.current?.rowVersion,
              configuration
            }
          }),
        async (result) => props.onSaved(result.record.id)
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the form.");
    }
  }
  return (
    <form onSubmit={(event) => void submit(event)}>
      <fieldset disabled={props.action.locked}>
        <legend>{props.current ? "Edit saved configuration" : "New configuration"}</legend>
        <div className="workflow-fields">
          {props.kind !== "provider_schedule" ? (
            <label>
              Display name
              <input
                name="displayName"
                required
                maxLength={200}
                defaultValue={text("displayName")}
              />
            </label>
          ) : null}
          {["appointment_type", "chair", "pricebook"].includes(props.kind) ? (
            <label>
              Stable code
              <input
                name="code"
                required
                maxLength={80}
                readOnly={!!props.current}
                defaultValue={text("code")}
                pattern="[A-Za-z0-9][A-Za-z0-9_.-]*"
              />
            </label>
          ) : null}
          {props.kind === "clinic" ? (
            <>
              <label>
                Legal name
                <input name="legalName" defaultValue={text("legalName")} />
              </label>
              <label>
                Clinic timezone
                <input
                  name="timezone"
                  required
                  defaultValue={text("timezone", props.profile.clinic.timezone)}
                  placeholder="Asia/Kolkata"
                />
              </label>
              {["line1", "line2", "city", "state", "postalCode", "country"].map((key) => (
                <label key={key}>
                  {
                    (
                      {
                        line1: "Address line 1",
                        line2: "Address line 2",
                        city: "City",
                        state: "State",
                        postalCode: "Postal code",
                        country: "Country"
                      } as Record<string, string>
                    )[key]
                  }
                  <input name={key} defaultValue={fieldText(record(c.address), key)} />
                </label>
              ))}
            </>
          ) : null}
          {props.kind === "appointment_type" ? (
            <>
              <label>
                Default duration in minutes
                <input
                  name="duration"
                  type="number"
                  min={5}
                  max={720}
                  step={1}
                  required
                  defaultValue={Number(c.defaultDurationMinutes ?? 30)}
                />
              </label>
              <label>
                Calendar colour
                <input name="color" type="color" defaultValue={text("color", "#0f8a70")} />
              </label>
            </>
          ) : null}
          {props.kind === "provider_schedule" ? (
            <>
              <label>
                Doctor
                <select name="providerUserId" required defaultValue={text("providerUserId")}>
                  <option value="">Choose active doctor</option>
                  {props.doctors.map((doctor) => (
                    <option
                      key={fieldText(doctor, "providerUserId")}
                      value={fieldText(doctor, "providerUserId")}
                    >
                      {fieldText(doctor, "displayName")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Weekday
                <select name="dayOfWeek" defaultValue={String(c.dayOfWeek ?? 1)}>
                  {[
                    "Sunday",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday"
                  ].map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Starts at (clinic time)
                <input
                  name="startsAt"
                  type="time"
                  required
                  defaultValue={text("startsAt").slice(0, 5)}
                />
              </label>
              <label>
                Ends at (clinic time)
                <input
                  name="endsAt"
                  type="time"
                  required
                  defaultValue={text("endsAt").slice(0, 5)}
                />
              </label>
              <label>
                Effective from
                <input
                  name="effectiveFrom"
                  type="date"
                  required
                  defaultValue={text("effectiveFrom")}
                />
              </label>
              <label>
                Effective until (optional)
                <input name="effectiveUntil" type="date" defaultValue={text("effectiveUntil")} />
              </label>
            </>
          ) : null}
          {props.kind === "pricebook" ? (
            <>
              <label>
                Category
                <input name="category" required defaultValue={text("category")} />
              </label>
              <label>
                Description
                <textarea name="description" defaultValue={text("description")} />
              </label>
              <label>
                Unit price in INR
                <input
                  name="price"
                  inputMode="decimal"
                  required
                  defaultValue={
                    typeof c.defaultUnitPriceMinor === "number"
                      ? (c.defaultUnitPriceMinor / 100).toFixed(2)
                      : ""
                  }
                />
              </label>
              <label>
                Tax percent
                <input
                  name="tax"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  required
                  defaultValue={Number(c.taxRateBasisPoints ?? 0) / 100}
                />
              </label>
            </>
          ) : null}
          {props.kind !== "clinic" ? (
            <label>
              <input
                name="active"
                type="checkbox"
                defaultChecked={c.active !== false && c.status !== "retired"}
              />
              Active
            </label>
          ) : null}
        </div>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit">Save configuration</button>
      </fieldset>
    </form>
  );
}
const staffRoles = ["owner_admin", "doctor", "assistant", "receptionist", "accountant"] as const;
function StaffSetup(props: Props & { action: Action }) {
  const [cursor, setCursor] = useState<string | undefined>(),
    [selected, setSelected] = useState("");
  const data = useWorkflowData(
    () => props.client.listClinicAccess({ query: { cursor, limit: 50 } }),
    [props.client, cursor]
  );
  const person = data.data?.staff.find((row) => row.id === selected);
  if (
    !props.profile.permissions.includes("user.manage") ||
    !props.profile.permissions.includes("role.manage")
  )
    return <p role="alert">Staff administration is not permitted for this account.</p>;
  return (
    <WorkflowCard
      title="Staff access"
      loading={data.loading}
      error={data.error}
      onRefresh={() => void data.refresh().catch(() => undefined)}
    >
      <p>
        Choose an existing registered staff account. Creating or inviting a new identity requires
        the configured identity administrator; this screen does not create login credentials.
        Tenant-wide roles remain unchanged.
      </p>
      <label>
        Registered staff
        <select value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">Choose staff member</option>
          {data.data?.staff.map((row) => (
            <option key={fieldText(row, "id")} value={fieldText(row, "id")}>
              {fieldText(row, "displayName")} ·{" "}
              {fieldText(row, "clinicStatus") || "Not assigned here"}
            </option>
          ))}
        </select>
      </label>
      {cursor ? (
        <button
          onClick={() => {
            setCursor(undefined);
            setSelected("");
          }}
        >
          First staff page
        </button>
      ) : null}
      {data.data?.nextCursor ? (
        <button
          onClick={() => {
            setCursor(data.data!.nextCursor!);
            setSelected("");
          }}
        >
          Next staff page
        </button>
      ) : null}
      {person ? (
        <StaffAccessForm
          {...props}
          key={`${person.id}:${person.authorityVersion}`}
          person={person}
          onSaved={async () => {
            await data.refresh();
          }}
        />
      ) : null}
    </WorkflowCard>
  );
}
function StaffAccessForm(
  props: Props & { action: Action; person: PublicJsonObject; onSaved: () => Promise<void> }
) {
  const [roles, setRoles] = useState<SaveClinicAccessRequest["body"]["roles"]>(
    valueList(props.person.clinicRoles).filter((role): role is (typeof staffRoles)[number] =>
      staffRoles.includes(role as (typeof staffRoles)[number])
    )
  );
  const [status, setStatus] = useState<"active" | "suspended">(
      props.person.clinicStatus === "suspended" ? "suspended" : "active"
    ),
    [confirmed, setConfirmed] = useState(false);
  const self = props.person.id === props.profile.user.id;
  const custom = valueList(props.person.clinicRoles).some(
    (role) => !staffRoles.includes(role as (typeof staffRoles)[number])
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed) return;
        void props.action.execute(
          (key) =>
            props.client.saveClinicAccess({
              headers: { "idempotency-key": key },
              body: {
                userId: fieldText(props.person, "id"),
                expectedAuthorityVersion: fieldText(props.person, "authorityVersion"),
                status,
                roles
              }
            }),
          props.onSaved
        );
      }}
    >
      <fieldset disabled={props.action.locked || self || custom}>
        <legend>Access for {fieldText(props.person, "displayName")}</legend>
        <p>Tenant roles: {valueList(props.person.tenantRoles).join(", ") || "None"}.</p>
        {self ? <p>Another authorized owner must change your access.</p> : null}
        {custom ? <p>Specialist roles require the identity administration workflow.</p> : null}
        <label>
          Clinic access
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as typeof status);
              setConfirmed(false);
            }}
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        {staffRoles.map((role) => (
          <label key={role}>
            <input
              type="checkbox"
              checked={roles.includes(role)}
              onChange={(event) => {
                setRoles(
                  event.target.checked ? [...roles, role] : roles.filter((value) => value !== role)
                );
                setConfirmed(false);
              }}
            />
            {role.replaceAll("_", " ")}
          </label>
        ))}
        <p>
          Saving rotates access authority. The staff member must sign in again. Finish or reassign
          open clinical work before removing doctor access.
        </p>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          I reviewed these roles and access status.
        </label>
        <button type="submit" disabled={!confirmed || !roles.length}>
          Save staff access
        </button>
      </fieldset>
    </form>
  );
}
type Field = {
  id: string;
  key: string;
  label: string;
  type: "string" | "boolean" | "number";
  choices: string;
  required: boolean;
};
const newField = (): Field => ({
  id: crypto.randomUUID(),
  key: "",
  label: "",
  type: "string",
  choices: "",
  required: false
});
function IntakeSetup(props: Props & { action: Action }) {
  const data = useWorkflowData(() => props.client.listIntakeFormTemplates(), [props.client]);
  const [fields, setFields] = useState<Field[]>([newField()]),
    [error, setError] = useState(""),
    [version, setVersion] = useState(1);
  const update = (id: string, change: Partial<Field>) =>
    setFields((rows) => rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget),
      text = (key: string) => String(form.get(key) ?? "").trim();
    try {
      if (
        !fields.length ||
        fields.length > 50 ||
        new Set(fields.map((field) => field.key)).size !== fields.length ||
        fields.some(
          (field) =>
            !field.label.trim() ||
            !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.key) ||
            ["constructor", "prototype", "__proto__"].includes(field.key)
        )
      )
        throw new Error("Use unique field codes, labels and supported types for 1–50 fields.");
      const properties: WritableJsonObject = Object.fromEntries(
        fields.map((field) => [
          field.key,
          {
            type: field.type,
            title: field.label.trim(),
            ...(field.type === "string" && field.choices.trim()
              ? {
                  enum: field.choices
                    .split("\n")
                    .map((value) => value.trim())
                    .filter(Boolean)
                }
              : {})
          }
        ])
      );
      await props.action.execute(
        (key) =>
          props.client.createIntakeFormTemplate({
            headers: { "idempotency-key": key },
            body: {
              code: text("code"),
              displayName: text("displayName"),
              version,
              formType: text("formType") as "patient_intake" | "medical_history",
              schema: {
                type: "object",
                additionalProperties: false,
                properties,
                required: fields.filter((field) => field.required).map((field) => field.key)
              },
              active: true
            }
          }),
        async () => {
          await data.refresh();
        }
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the template.");
    }
  }
  return (
    <WorkflowCard
      title="Intake templates"
      loading={data.loading}
      error={data.error}
      onRefresh={() => void data.refresh().catch(() => undefined)}
    >
      <p>
        Publish only a form approved by the clinic. Saved responses retain their original template
        version. To revise a form, use the same stable code with a new version and the complete
        reviewed field set.
      </p>
      <ul>
        {data.data?.templates.map((template) => (
          <li key={fieldText(template, "id")}>
            {fieldText(template, "displayName")} · {fieldText(template, "code")} · version{" "}
            {String(template.version)} · {fieldText(template, "formType")}
          </li>
        ))}
      </ul>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={props.action.locked}>
          <legend>Publish reviewed intake template</legend>
          <div className="workflow-fields">
            <label>
              Template code
              <input name="code" required />
            </label>
            <label>
              Template name
              <input name="displayName" required />
            </label>
            <label>
              Template version
              <input
                type="number"
                min={1}
                max={10000}
                value={version}
                onChange={(event) => setVersion(Number(event.target.value))}
                required
              />
            </label>
            <label>
              Form purpose
              <select name="formType">
                <option value="patient_intake">Patient intake</option>
                <option value="medical_history">Medical history</option>
              </select>
            </label>
          </div>
          {fields.map((field, index) => (
            <fieldset key={field.id}>
              <legend>Field {index + 1}</legend>
              <div className="workflow-fields">
                <label>
                  Field code
                  <input
                    value={field.key}
                    onChange={(event) => update(field.id, { key: event.target.value })}
                    required
                    pattern="[A-Za-z][A-Za-z0-9_]{0,63}"
                  />
                </label>
                <label>
                  Field label
                  <input
                    value={field.label}
                    onChange={(event) => update(field.id, { label: event.target.value })}
                    required
                  />
                </label>
                <label>
                  Answer type
                  <select
                    value={field.type}
                    onChange={(event) =>
                      update(field.id, { type: event.target.value as Field["type"] })
                    }
                  >
                    <option value="string">Text or choices</option>
                    <option value="boolean">Yes or no</option>
                    <option value="number">Number</option>
                  </select>
                </label>
                {field.type === "string" ? (
                  <label>
                    Choices, one per line (optional)
                    <textarea
                      value={field.choices}
                      onChange={(event) => update(field.id, { choices: event.target.value })}
                    />
                  </label>
                ) : null}
                <label>
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) => update(field.id, { required: event.target.checked })}
                  />
                  Required
                </label>
              </div>
              {fields.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setFields((rows) => rows.filter((row) => row.id !== field.id))}
                >
                  Remove field
                </button>
              ) : null}
            </fieldset>
          ))}
          <button
            type="button"
            disabled={fields.length >= 50}
            onClick={() => setFields((rows) => [...rows, newField()])}
          >
            Add field
          </button>
          {error ? <p role="alert">{error}</p> : null}
          <button type="submit">Publish intake template</button>
        </fieldset>
      </form>
    </WorkflowCard>
  );
}
