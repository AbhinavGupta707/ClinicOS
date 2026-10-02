import type { SqlQueryClient } from "./postgres.ts";
import { sqlCalendarDate } from "./sql-calendar-date.ts";
import type { UUID } from "@clinic-os/domain";
import type { RepositoryScope, WorkflowPage, WorkflowPageFilter } from "./repositories.ts";

export const CLINIC_SETUP_KINDS = [
  "clinic",
  "appointment_type",
  "chair",
  "provider_schedule",
  "pricebook"
] as const;
export type ClinicSetupKind = (typeof CLINIC_SETUP_KINDS)[number];
export interface ClinicSetupRecord {
  id: UUID;
  rowVersion: number;
  kind: ClinicSetupKind;
  configuration: Record<string, unknown>;
}
export interface ClinicSetupInput {
  recordId?: UUID;
  expectedVersion?: number;
  configuration: Record<string, unknown>;
}
export class ClinicSetupConflict extends Error {}
const definitions = {
  clinic: {
    table: "clinics",
    fields: {
      displayName: "display_name",
      legalName: "legal_name",
      timezone: "timezone",
      address: "address"
    }
  },
  appointment_type: {
    table: "appointment_types",
    fields: {
      code: "code",
      displayName: "display_name",
      defaultDurationMinutes: "default_duration_minutes",
      color: "color",
      active: "active"
    }
  },
  chair: {
    table: "chairs_or_rooms",
    fields: { code: "code", displayName: "display_name", active: "active" }
  },
  provider_schedule: {
    table: "provider_schedules",
    fields: {
      providerUserId: "provider_user_id",
      dayOfWeek: "day_of_week",
      startsAt: "starts_at",
      endsAt: "ends_at",
      effectiveFrom: "effective_from",
      effectiveUntil: "effective_until",
      active: "active"
    }
  },
  pricebook: {
    table: "pricebook_procedures",
    fields: {
      code: "code",
      displayName: "display_name",
      category: "category",
      description: "description",
      defaultUnitPriceMinor: "default_unit_price_minor",
      currency: "currency",
      taxRateBasisPoints: "tax_rate_basis_points",
      status: "status"
    }
  }
} as const;
function definition(kind: ClinicSetupKind) {
  const d = definitions[kind];
  if (!d) throw new RangeError("Unknown clinic setup section.");
  return d;
}
function map(kind: ClinicSetupKind, row: Record<string, unknown>): ClinicSetupRecord {
  return {
    id: row.id as UUID,
    rowVersion: Number(row.row_version),
    kind,
    configuration: Object.fromEntries(
      Object.entries(definition(kind).fields).map(([key, column]) => {
        let value = row[column];
        if (value instanceof Date) value = sqlCalendarDate(value);
        if (key === "defaultUnitPriceMinor") value = Number(value);
        return [key, value];
      })
    )
  };
}
export function validateClinicSetup(
  kind: ClinicSetupKind,
  input: ClinicSetupInput
): Record<string, unknown> {
  const d = definition(kind),
    c = { ...input.configuration };
  if (Object.keys(c).some((k) => !Object.hasOwn(d.fields, k)))
    throw new RangeError("A configuration field does not belong to this section.");
  if (
    input.recordId
      ? !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion! < 1
      : input.expectedVersion !== undefined
  )
    throw new RangeError("A saved record and its current version must be supplied together.");
  const text = (key: string) => {
    if (typeof c[key] !== "string" || !c[key].trim() || c[key].length > 200)
      throw new RangeError(`Enter a valid ${key}.`);
    c[key] = c[key].trim();
  };
  const integer = (key: string, min: number, max: number) => {
    if (!Number.isSafeInteger(c[key]) || (c[key] as number) < min || (c[key] as number) > max)
      throw new RangeError(`Enter a valid ${key}.`);
  };
  if (kind !== "provider_schedule") text("displayName");
  if (["appointment_type", "chair", "pricebook"].includes(kind)) {
    text("code");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(String(c.code)))
      throw new RangeError("Use letters, numbers, dots, hyphens or underscores for the code.");
  }
  if (
    ["appointment_type", "chair", "provider_schedule"].includes(kind) &&
    typeof c.active !== "boolean"
  )
    throw new RangeError("Select whether this record is active.");
  if (kind === "clinic") {
    if (!input.recordId)
      throw new RangeError("This screen edits the selected clinic; it cannot create clinics.");
    text("timezone");
    try {
      new Intl.DateTimeFormat("en", { timeZone: String(c.timezone) });
    } catch {
      throw new RangeError("Choose a valid IANA clinic timezone.");
    }
    c.legalName ??= null;
    c.address ??= {};
  }
  if (kind === "appointment_type") {
    integer("defaultDurationMinutes", 5, 720);
    c.color ??= null;
    if (c.color !== null && !/^#[0-9a-fA-F]{6}$/.test(String(c.color)))
      throw new RangeError("Colour must be a six-digit hex colour.");
  }
  if (kind === "provider_schedule") {
    if (typeof c.providerUserId !== "string" || !/^[0-9a-f-]{36}$/i.test(c.providerUserId))
      throw new RangeError("Choose a clinic doctor.");
    integer("dayOfWeek", 0, 6);
    for (const key of ["startsAt", "endsAt"])
      if (typeof c[key] !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(c[key]))
        throw new RangeError("Enter valid same-day working hours.");
    c.startsAt = String(c.startsAt).slice(0, 5);
    c.endsAt = String(c.endsAt).slice(0, 5);
    if (String(c.startsAt) >= String(c.endsAt))
      throw new RangeError("Working hours must end after they start.");
    for (const key of ["effectiveFrom", "effectiveUntil"])
      if (
        c[key] != null &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(String(c[key])) ||
          new Date(`${String(c[key])}T00:00:00Z`).toISOString().slice(0, 10) !== c[key])
      )
        throw new RangeError("Enter valid effective dates.");
    if (
      !c.effectiveFrom ||
      (c.effectiveUntil && String(c.effectiveUntil) < String(c.effectiveFrom))
    )
      throw new RangeError("Working-hours date range is invalid.");
    c.effectiveUntil ??= null;
  }
  if (kind === "pricebook") {
    text("category");
    integer("defaultUnitPriceMinor", 0, 1_000_000_000);
    integer("taxRateBasisPoints", 0, 10000);
    if (c.currency !== "INR" || !["active", "retired"].includes(String(c.status)))
      throw new RangeError("Use INR and a valid pricebook status.");
    c.description ??= null;
  }
  return c;
}
export async function listClinicSetup(
  client: SqlQueryClient,
  scope: RepositoryScope,
  kind: ClinicSetupKind,
  filter: WorkflowPageFilter = {}
): Promise<WorkflowPage<ClinicSetupRecord>> {
  const { table } = definition(kind),
    limit = filter.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("Page size must be between 1 and 100.");
  const where = kind === "clinic" ? "tenant_id=$1 and id=$2" : "tenant_id=$1 and clinic_id=$2";
  if (filter.cursor) {
    const check = await client.query(`select id from ${table} where ${where} and id=$3`, [
      scope.tenantId,
      scope.clinicId,
      filter.cursor
    ]);
    if (!check.rows.length)
      throw new RangeError("The page cursor does not belong to this clinic section.");
  }
  const result = await client.query(
    `select * from ${table} where ${where} and ($3::uuid is null or id>$3) order by id limit $4`,
    [scope.tenantId, scope.clinicId, filter.cursor ?? null, limit + 1]
  );
  return {
    records: result.rows.slice(0, limit).map((r) => map(kind, r)),
    nextCursor: result.rows.length > limit ? (result.rows[limit - 1].id as UUID) : null
  };
}
export async function saveClinicSetup(
  client: SqlQueryClient,
  scope: RepositoryScope,
  kind: ClinicSetupKind,
  input: ClinicSetupInput
): Promise<ClinicSetupRecord> {
  const c = validateClinicSetup(kind, input),
    d = definition(kind);
  // Serialize configuration edits in a clinic. This includes schedule overlap checks.
  await lockClinicConfiguration(client, scope, "exclusive");
  const where = kind === "clinic" ? "tenant_id=$1 and id=$2" : "tenant_id=$1 and clinic_id=$2";
  if (input.recordId) {
    const existing = await client.query(
      `select * from ${d.table} where ${where} and id=$3 for update`,
      [scope.tenantId, scope.clinicId, input.recordId]
    );
    if (!existing.rows[0] || Number(existing.rows[0].row_version) !== input.expectedVersion)
      throw new ClinicSetupConflict(
        "This setup record changed or is no longer available. Refresh before saving."
      );
    const before = existing.rows[0];
    if (kind === "clinic" && c.timezone !== before.timezone) {
      const used = await client.query(
        `select id from appointments where tenant_id=$1 and clinic_id=$2 limit 1`,
        [scope.tenantId, scope.clinicId]
      );
      if (used.rows.length)
        throw new ClinicSetupConflict(
          "Changing timezone after scheduling begins requires a reviewed migration. Existing clinic times must remain consistent."
        );
    }
    const changesAvailability =
      (kind === "appointment_type" || kind === "chair") && c.active === false;
    if (changesAvailability) {
      const column = kind === "chair" ? "chair_id" : "appointment_type_id";
      const booked = await client.query(
        `select id from appointments where tenant_id=$1 and clinic_id=$2 and ${column}=$3 and status in ('requested','booked','confirmed','checked_in','in_consult') and (end_at>=now() or status in ('checked_in','in_consult')) limit 1`,
        [scope.tenantId, scope.clinicId, input.recordId]
      );
      if (booked.rows.length)
        throw new ClinicSetupConflict(
          "Reassign open appointments before disabling their visit type or chair."
        );
    }
    const changed = Object.entries(d.fields).some(([key, column]) => {
      const normalize = (value: unknown) =>
        value instanceof Date
          ? sqlCalendarDate(value)
          : key === "startsAt" || key === "endsAt"
            ? String(value ?? "").slice(0, 5)
            : String(value ?? "");
      return normalize(c[key]) !== normalize(before[column]);
    });
    if (kind === "provider_schedule" && changed) {
      const booked = await client.query(
        `select a.id from appointments a join clinics cl on cl.tenant_id=a.tenant_id and cl.id=a.clinic_id where a.tenant_id=$1 and a.clinic_id=$2 and a.provider_user_id=$3 and a.status in ('requested','booked','confirmed','checked_in','in_consult') and a.end_at>=now() and extract(dow from a.start_at at time zone cl.timezone)=$4 and (a.start_at at time zone cl.timezone)::date between $5::date and coalesce($6::date,'infinity'::date) and (a.start_at at time zone cl.timezone)::time >= $7::time and (a.end_at at time zone cl.timezone)::time <= $8::time limit 1`,
        [
          scope.tenantId,
          scope.clinicId,
          before.provider_user_id,
          before.day_of_week,
          before.effective_from,
          before.effective_until,
          before.starts_at,
          before.ends_at
        ]
      );
      if (booked.rows.length)
        throw new ClinicSetupConflict(
          "This schedule covers open appointments. Reassign those appointments before changing its hours or availability."
        );
    }
    if (kind !== "provider_schedule" && kind !== "clinic" && c.code !== existing.rows[0].code)
      throw new RangeError(
        "The stable code cannot be changed. Retire this entry and create a new one if necessary."
      );
  }
  if (kind === "provider_schedule") {
    const doctor = await client.query(
      `select u.id from users u join memberships m on m.user_id=u.id and m.tenant_id=$1 and m.status='active' join clinic_user_assignments a on a.user_id=u.id and a.tenant_id=$1 and a.clinic_id=$2 and a.status='active' where u.id=$3 and u.status='active' and exists(select 1 from user_role_assignments x join roles r on r.id=x.role_id where x.tenant_id=$1 and x.clinic_id=$2 and x.user_id=u.id and x.revoked_at is null and r.slug='doctor')`,
      [scope.tenantId, scope.clinicId, c.providerUserId]
    );
    if (!doctor.rows.length)
      throw new RangeError("Working hours require an active assigned clinic doctor.");
    if (c.active) {
      const overlap = await client.query(
        `select id from provider_schedules where tenant_id=$1 and clinic_id=$2 and provider_user_id=$3 and day_of_week=$4 and active and ($5::uuid is null or id<>$5) and starts_at<$7::time and ends_at>$6::time and effective_from<=coalesce($9::date,'infinity'::date) and coalesce(effective_until,'infinity'::date)>=$8::date limit 1`,
        [
          scope.tenantId,
          scope.clinicId,
          c.providerUserId,
          c.dayOfWeek,
          input.recordId ?? null,
          c.startsAt,
          c.endsAt,
          c.effectiveFrom,
          c.effectiveUntil
        ]
      );
      if (overlap.rows.length)
        throw new ClinicSetupConflict(
          "These working hours overlap an active schedule. Edit or retire that schedule first."
        );
    }
  }
  const fields = Object.entries(d.fields),
    values = fields.map(([key]) => (key === "address" ? JSON.stringify(c[key]) : c[key]));
  let result;
  if (input.recordId)
    result = await client.query(
      `update ${d.table} set ${fields.map(([, column], i) => `${column}=$${i + 4}`).join(",")},row_version=row_version+1${kind === "pricebook" ? `,updated_by_user_id=$${values.length + 4}` : ""} where ${where} and id=$3 returning *`,
      [
        scope.tenantId,
        scope.clinicId,
        input.recordId,
        ...values,
        ...(kind === "pricebook" ? [scope.actorUserId] : [])
      ]
    );
  else
    result = await client.query(
      `insert into ${d.table}(tenant_id,clinic_id,${fields.map(([, column]) => column).join(",")}${kind === "pricebook" ? ",created_by_user_id,updated_by_user_id" : ""}) values(${[scope.tenantId, scope.clinicId, ...values, ...(kind === "pricebook" ? [scope.actorUserId, scope.actorUserId] : [])].map((_, i) => `$${i + 1}`).join(",")}) returning *`,
      [
        scope.tenantId,
        scope.clinicId,
        ...values,
        ...(kind === "pricebook" ? [scope.actorUserId, scope.actorUserId] : [])
      ]
    );
  return map(kind, result.rows[0]);
}

export const MANAGEABLE_CLINIC_ROLES = [
  "owner_admin",
  "doctor",
  "assistant",
  "receptionist",
  "accountant"
] as const;
export interface ClinicAccessPerson {
  id: UUID;
  displayName: string;
  authorityVersion: UUID;
  clinicStatus: string | null;
  clinicRoles: string[];
  tenantRoles: string[];
}
export interface ClinicAccessInput {
  userId: UUID;
  expectedAuthorityVersion: UUID;
  status: "active" | "suspended";
  roles: readonly string[];
}
const accessProjection = `u.id,u.display_name,u.authority_generation,a.status as clinic_status,
 coalesce((select jsonb_agg(r.slug order by r.slug) from user_role_assignments x join roles r on r.id=x.role_id where x.tenant_id=$1 and x.clinic_id=$2 and x.user_id=u.id and x.revoked_at is null),'[]') as clinic_roles,
 coalesce((select jsonb_agg(r.slug order by r.slug) from user_role_assignments x join roles r on r.id=x.role_id where x.tenant_id=$1 and x.clinic_id is null and x.user_id=u.id and x.revoked_at is null),'[]') as tenant_roles`;
function mapAccess(r: Record<string, unknown>): ClinicAccessPerson {
  return {
    id: r.id as UUID,
    displayName: String(r.display_name),
    authorityVersion: r.authority_generation as UUID,
    clinicStatus: r.clinic_status as string | null,
    clinicRoles: r.clinic_roles as string[],
    tenantRoles: r.tenant_roles as string[]
  };
}
export async function listClinicAccess(
  client: SqlQueryClient,
  scope: RepositoryScope,
  filter: WorkflowPageFilter = {}
): Promise<WorkflowPage<ClinicAccessPerson>> {
  const limit = filter.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("Page size must be between 1 and 100.");
  const joins = `from users u join memberships m on m.user_id=u.id and m.tenant_id=$1 and m.status='active' left join clinic_user_assignments a on a.tenant_id=$1 and a.clinic_id=$2 and a.user_id=u.id where u.status='active'`;
  if (filter.cursor) {
    const c = await client.query(`select u.id ${joins} and u.id=$3`, [
      scope.tenantId,
      scope.clinicId,
      filter.cursor
    ]);
    if (!c.rows.length) throw new RangeError("Staff cursor is unavailable in this tenant.");
  }
  const result = await client.query(
    `select ${accessProjection} ${joins} and ($3::uuid is null or u.id>$3) order by u.id limit $4`,
    [scope.tenantId, scope.clinicId, filter.cursor ?? null, limit + 1]
  );
  return {
    records: result.rows.slice(0, limit).map(mapAccess),
    nextCursor: result.rows.length > limit ? (result.rows[limit - 1].id as UUID) : null
  };
}
export async function saveClinicAccess(
  client: SqlQueryClient,
  scope: RepositoryScope,
  input: ClinicAccessInput
): Promise<ClinicAccessPerson> {
  if (input.userId === scope.actorUserId)
    throw new RangeError("Another authorized owner must change your clinic access.");
  if (
    !["active", "suspended"].includes(input.status) ||
    !input.roles.length ||
    new Set(input.roles).size !== input.roles.length ||
    input.roles.some((r) => !(MANAGEABLE_CLINIC_ROLES as readonly string[]).includes(r))
  )
    throw new RangeError("Choose at least one supported clinic role and an access status.");
  await lockClinicConfiguration(client, scope, "exclusive");
  const existing = await client.query(
    `select u.* from users u join memberships m on m.user_id=u.id and m.tenant_id=$1 and m.status='active' where u.id=$2 and u.status='active' for update of u`,
    [scope.tenantId, input.userId]
  );
  if (!existing.rows[0] || existing.rows[0].authority_generation !== input.expectedAuthorityVersion)
    throw new ClinicSetupConflict(
      "Staff access changed or the account is no longer active. Refresh before saving."
    );
  const grants = await client.query<{ slug: string; clinic_id: UUID | null }>(
    `select r.slug,x.clinic_id from user_role_assignments x join roles r on r.id=x.role_id where x.tenant_id=$1 and (x.clinic_id=$2 or x.clinic_id is null) and x.user_id=$3 and x.revoked_at is null`,
    [scope.tenantId, scope.clinicId, input.userId]
  );
  if (
    grants.rows.some(
      (r) =>
        r.clinic_id !== null && !(MANAGEABLE_CLINIC_ROLES as readonly string[]).includes(r.slug)
    )
  )
    throw new RangeError(
      "This user has a specialist clinic role. Use the identity administration workflow to change it."
    );
  const remainsOwner =
    input.status === "active" &&
    (input.roles.includes("owner_admin") ||
      grants.rows.some((r) => r.clinic_id === null && r.slug === "owner_admin"));
  if (!remainsOwner && grants.rows.some((r) => r.slug === "owner_admin")) {
    const other = await client.query(
      `select u.id from users u join memberships m on m.user_id=u.id and m.tenant_id=$1 and m.status='active' join clinic_user_assignments a on a.user_id=u.id and a.tenant_id=$1 and a.clinic_id=$2 and a.status='active' where u.status='active' and u.id<>$3 and exists(select 1 from user_role_assignments x join roles r on r.id=x.role_id where x.tenant_id=$1 and (x.clinic_id=$2 or x.clinic_id is null) and x.user_id=u.id and x.revoked_at is null and r.slug='owner_admin') limit 1`,
      [scope.tenantId, scope.clinicId, input.userId]
    );
    if (!other.rows.length)
      throw new ClinicSetupConflict("Keep at least one active owner assigned to this clinic.");
  }
  if (input.status !== "active" || !input.roles.includes("doctor")) {
    const work = await client.query(
      `select id from appointments where tenant_id=$1 and clinic_id=$2 and provider_user_id=$3 and status in ('requested','booked','confirmed','checked_in','in_consult') union all select id from encounters where tenant_id=$1 and clinic_id=$2 and provider_user_id=$3 and status not in ('closed','cancelled') limit 1`,
      [scope.tenantId, scope.clinicId, input.userId]
    );
    if (work.rows.length)
      throw new ClinicSetupConflict(
        "Reassign or finish this doctor's open appointments and consultations before removing doctor access."
      );
  }
  const roles = await client.query<{ id: UUID; slug: string }>(
    `select id,slug from roles where tenant_id=$1 and slug=any($2::text[])`,
    [scope.tenantId, input.roles]
  );
  if (roles.rows.length !== input.roles.length)
    throw new RangeError("A selected role is not registered for this tenant.");
  await client.query(
    `insert into clinic_user_assignments(tenant_id,clinic_id,user_id,status) values($1,$2,$3,$4) on conflict(tenant_id,clinic_id,user_id) do update set status=excluded.status`,
    [scope.tenantId, scope.clinicId, input.userId, input.status]
  );
  await client.query(
    `update user_role_assignments x set revoked_at=now() from roles r where r.id=x.role_id and x.tenant_id=$1 and x.clinic_id=$2 and x.user_id=$3 and x.revoked_at is null and not(r.slug=any($4::text[]))`,
    [scope.tenantId, scope.clinicId, input.userId, input.roles]
  );
  for (const role of roles.rows)
    await client.query(
      `insert into user_role_assignments(tenant_id,clinic_id,user_id,role_id,assigned_by_user_id) values($1,$2,$3,$4,$5) on conflict(tenant_id,clinic_id,user_id,role_id) do update set revoked_at=null,assigned_at=now(),assigned_by_user_id=excluded.assigned_by_user_id`,
      [scope.tenantId, scope.clinicId, input.userId, role.id, scope.actorUserId]
    );
  const result = await client.query(
    `select ${accessProjection} from users u left join clinic_user_assignments a on a.tenant_id=$1 and a.clinic_id=$2 and a.user_id=u.id where u.id=$3`,
    [scope.tenantId, scope.clinicId, input.userId]
  );
  return mapAccess(result.rows[0]);
}

// Shared for booking/import/visit creation; exclusive for configuration/access edits.
// The tenant guard closes read-check-write races without preventing concurrent bookings.
export async function lockClinicConfiguration(
  client: SqlQueryClient,
  scope: RepositoryScope,
  mode: "shared" | "exclusive" = "shared"
) {
  await client.query(
    mode === "exclusive"
      ? "select pg_advisory_xact_lock(hashtextextended($1,0))"
      : "select pg_advisory_xact_lock_shared(hashtextextended($1,0))",
    [`clinic-configuration:${scope.tenantId}`]
  );
}
export async function assertActiveClinicDoctor(
  client: SqlQueryClient,
  scope: RepositoryScope,
  providerUserId: UUID
) {
  const result = await client.query(
    `select u.id from users u join memberships m on m.user_id=u.id and m.tenant_id=$1 and m.status='active' join clinic_user_assignments a on a.user_id=u.id and a.tenant_id=$1 and a.clinic_id=$2 and a.status='active' where u.id=$3 and u.status='active' and exists(select 1 from user_role_assignments x join roles r on r.id=x.role_id where x.tenant_id=$1 and x.clinic_id=$2 and x.user_id=u.id and x.revoked_at is null and r.slug='doctor')`,
    [scope.tenantId, scope.clinicId, providerUserId]
  );
  if (!result.rows.length)
    throw new ClinicSetupConflict(
      "The assigned doctor is no longer active in this clinic. Refresh and select an eligible doctor."
    );
}

export async function assertActiveClinicAssignee(
  client: SqlQueryClient,
  scope: RepositoryScope,
  userId: UUID | null | undefined
) {
  if (!userId) return;
  await lockClinicConfiguration(client, scope);
  const result = await client.query(
    `select u.id from users u join memberships m on m.user_id=u.id and m.tenant_id=$1 and m.status='active' join clinic_user_assignments a on a.user_id=u.id and a.tenant_id=$1 and a.clinic_id=$2 and a.status='active' where u.id=$3 and u.status='active'`,
    [scope.tenantId, scope.clinicId, userId]
  );
  if (!result.rows.length)
    throw new RangeError("Choose an active staff member assigned to this clinic.");
}
