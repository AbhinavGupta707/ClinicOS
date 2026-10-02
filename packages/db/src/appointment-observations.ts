import { createHash } from "node:crypto";
import {
  canonicalAppointmentObservations,
  validateAppointmentObservation,
  type AppointmentSourceObservation,
  type UUID
} from "@clinic-os/domain";
import type { SqlQueryClient } from "./postgres.ts";
import type { RepositoryScope } from "./repositories.ts";
export class AppointmentObservationConflict extends Error {}
type Row = Record<string, unknown>;
const args = (s: RepositoryScope) => [s.tenantId, s.clinicId];
function map(r: Row): Row {
  return Object.fromEntries(
    Object.entries(r).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : v
    ])
  );
}
async function source(c: SqlQueryClient, s: RepositoryScope, id: string, lock = false) {
  const r = (
    await c.query<Row>(
      `select * from appointment_imports where tenant_id=$1 and clinic_id=$2 and id=$3 ${lock ? "for update" : ""}`,
      [...args(s), id]
    )
  ).rows[0];
  if (!r) throw new AppointmentObservationConflict("Source import not found.");
  return r;
}
export async function createAppointmentImport(
  c: SqlQueryClient,
  s: RepositoryScope,
  input: { sourceSystem: string; digest: string; rowCount: number }
) {
  if (
    !input.sourceSystem.trim() ||
    input.sourceSystem.length > 100 ||
    !Number.isInteger(input.rowCount) ||
    input.rowCount < 1 ||
    input.rowCount > 5000 ||
    !/^[a-f0-9]{64}$/.test(input.digest)
  )
    throw new RangeError("Invalid appointment file manifest.");
  await c.query(
    `insert into appointment_imports(tenant_id,clinic_id,source_system,digest,row_count,created_by_user_id) values($1,$2,$3,$4,$5,$6) on conflict(tenant_id,clinic_id,source_system,digest) do nothing`,
    [...args(s), input.sourceSystem, input.digest, input.rowCount, s.actorUserId]
  );
  const r = (
    await c.query<Row>(
      "select * from appointment_imports where tenant_id=$1 and clinic_id=$2 and source_system=$3 and digest=$4",
      [...args(s), input.sourceSystem, input.digest]
    )
  ).rows[0];
  if (r.row_count !== input.rowCount)
    throw new AppointmentObservationConflict("Manifest count differs from the saved evidence.");
  return map(r);
}
export async function stageAppointmentObservations(
  c: SqlQueryClient,
  s: RepositoryScope,
  id: string,
  input: { offset: number; rows: AppointmentSourceObservation[] }
) {
  const run = await source(c, s, id, true);
  if (
    !Number.isInteger(input.offset) ||
    input.offset < 0 ||
    input.offset % 100 !== 0 ||
    !input.rows.length ||
    input.rows.length !== Math.min(100, Number(run.row_count) - input.offset)
  )
    throw new RangeError("Supply the complete bounded source group at its declared offset.");
  for (const row of input.rows) validateAppointmentObservation(row);
  for (const [index, row] of input.rows.entries()) {
    const ordinal = input.offset + index;
    const existing = (
      await c.query<Row>(
        "select source_data from appointment_source_observations where tenant_id=$1 and clinic_id=$2 and import_id=$3 and ordinal=$4",
        [...args(s), id, ordinal]
      )
    ).rows[0];
    if (existing) {
      if (
        canonicalAppointmentObservations([
          existing.source_data as unknown as AppointmentSourceObservation
        ]) !== canonicalAppointmentObservations([row])
      )
        throw new AppointmentObservationConflict(
          "This source group differs from the saved evidence."
        );
      continue;
    }
    if (run.sealed_at)
      throw new AppointmentObservationConflict("A sealed source file cannot receive new rows.");
    await c.query(
      "insert into appointment_source_observations(tenant_id,clinic_id,import_id,ordinal,source_data) values($1,$2,$3,$4,$5::jsonb)",
      [...args(s), id, ordinal, JSON.stringify(row)]
    );
  }
  return { offset: input.offset, rowCount: input.rows.length };
}
export async function sealAppointmentImport(
  c: SqlQueryClient,
  s: RepositoryScope,
  id: string,
  now: Date
) {
  const run = await source(c, s, id, true);
  if (run.sealed_at) return map(run);
  const rows = (
    await c.query<{ source_data: AppointmentSourceObservation }>(
      "select source_data from appointment_source_observations where tenant_id=$1 and clinic_id=$2 and import_id=$3 order by ordinal",
      [...args(s), id]
    )
  ).rows;
  if (
    rows.length !== run.row_count ||
    createHash("sha256")
      .update(canonicalAppointmentObservations(rows.map((r) => r.source_data)))
      .digest("hex") !== run.digest
  )
    throw new AppointmentObservationConflict(
      "Upload is incomplete or differs from its manifest. Reselect the original file and resume."
    );
  return map(
    (
      await c.query<Row>(
        "update appointment_imports set sealed_at=$4 where tenant_id=$1 and clinic_id=$2 and id=$3 returning *",
        [...args(s), id, now]
      )
    ).rows[0]
  );
}
export async function listAppointmentImports(
  c: SqlQueryClient,
  s: RepositoryScope,
  cursor?: string
) {
  const rows = (
    await c.query<Row>(
      "select * from appointment_imports where tenant_id=$1 and clinic_id=$2 and ($3::uuid is null or (created_at,id)<(select created_at,id from appointment_imports where tenant_id=$1 and clinic_id=$2 and id=$3)) order by created_at desc,id desc limit 51",
      [...args(s), cursor ?? null]
    )
  ).rows;
  return { imports: rows.slice(0, 50).map(map), nextCursor: rows.length > 50 ? rows[49].id : null };
}
export async function getAppointmentImport(
  c: SqlQueryClient,
  s: RepositoryScope,
  id: string,
  offset = 0
) {
  const run = await source(c, s, id);
  if (!Number.isInteger(offset) || offset < 0 || offset > 5000)
    throw new RangeError("Invalid review page.");
  const rows = (
    await c.query<Row>(
      "select * from appointment_source_observations where tenant_id=$1 and clinic_id=$2 and import_id=$3 and ordinal >= $4 order by ordinal limit 51",
      [...args(s), id, offset]
    )
  ).rows;
  const counts = (
    await c.query<Row>(
      "select decision,count(*)::int as count from appointment_source_observations where tenant_id=$1 and clinic_id=$2 and import_id=$3 group by decision",
      [...args(s), id]
    )
  ).rows;
  return {
    import: map(run),
    rows: rows.slice(0, 50).map(map),
    counts,
    nextOffset: rows.length > 50 ? rows[50].ordinal : null
  };
}
export async function lockAppointmentObservation(
  c: SqlQueryClient,
  s: RepositoryScope,
  id: string,
  rowId: string
) {
  const run = await source(c, s, id, true);
  if (!run.sealed_at)
    throw new AppointmentObservationConflict(
      "Complete and seal this file before reviewing bookings."
    );
  const row = (
    await c.query<Row>(
      "select * from appointment_source_observations where tenant_id=$1 and clinic_id=$2 and import_id=$3 and id=$4 for update",
      [...args(s), id, rowId]
    )
  ).rows[0];
  if (!row || row.decision !== "pending")
    throw new AppointmentObservationConflict(
      "This source row is unavailable or already reviewed. Refresh saved decisions."
    );
  return map(row);
}
export async function decideAppointmentObservation(
  c: SqlQueryClient,
  s: RepositoryScope,
  id: string,
  rowId: string,
  input: { decision: string; reason: string; appointmentId?: UUID },
  now: Date
) {
  if (
    !["history", "exclude", "link", "create"].includes(input.decision) ||
    !input.reason.trim() ||
    input.reason.length > 1000
  )
    throw new RangeError("Choose a review decision and give its reason.");
  const rows = (
    await c.query<Row>(
      `update appointment_source_observations set decision=$5,reason=$6,appointment_id=$7,reviewed_by_user_id=$8,reviewed_at=$9 where tenant_id=$1 and clinic_id=$2 and import_id=$3 and id=$4 and decision='pending' returning *`,
      [
        ...args(s),
        id,
        rowId,
        input.decision,
        input.reason,
        input.appointmentId ?? null,
        s.actorUserId,
        now
      ]
    )
  ).rows;
  if (!rows[0]) throw new AppointmentObservationConflict("The row was reviewed elsewhere.");
  return map(rows[0]);
}
