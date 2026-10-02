import { createHash } from "node:crypto";
import {
  PATIENT_CONTEXT_PROFILE,
  patientSourceFields,
  type PatientSourceContextRecord,
  type MigrationBatchRecord,
  type MigrationRowRecord,
  type UUID,
  type SourceContextReviewDecision
} from "@clinic-os/domain";
import type { SqlQueryClient } from "./postgres.ts";
import type { RepositoryScope } from "./repositories.ts";

export class PatientSourceContextConflict extends Error {}
type Row = Record<string, unknown>;
const scopeArgs = (scope: RepositoryScope) => [scope.tenantId, scope.clinicId];
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : String(value));
function map(row: Row): PatientSourceContextRecord {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    sourceSystem: String(row.source_system),
    externalReference: String(row.external_reference),
    sourceFormat: PATIENT_CONTEXT_PROFILE,
    version: Number(row.version),
    fields: patientSourceFields(row.fields),
    contactUnavailable: row.contact_unavailable === true,
    importedAt: iso(row.imported_at),
    sourceRecordDate: null,
    review: row.decision
      ? {
          decision: row.decision as SourceContextReviewDecision,
          note: String(row.note),
          reviewedByUserId: String(row.reviewed_by_user_id),
          reviewedAt: iso(row.reviewed_at)
        }
      : null
  };
}
const projection = `select c.*, r.decision,r.note,r.reviewed_by_user_id,r.reviewed_at
  from patient_source_contexts c left join lateral
  (select * from patient_source_context_reviews r where (r.tenant_id,r.clinic_id,r.context_id)=(c.tenant_id,c.clinic_id,c.id)
   order by r.revision desc limit 1) r on true`;

export async function appendPatientSourceContext(
  client: SqlQueryClient,
  scope: RepositoryScope,
  patientId: UUID,
  batch: MigrationBatchRecord,
  row: MigrationRowRecord
) {
  const record = row.normalizedRecord;
  if (
    record?.recordType !== "patient" ||
    record.sourceDetail.sourceFormat !== PATIENT_CONTEXT_PROFILE
  )
    return;
  const fields = patientSourceFields(record.sourceDetail.historicalFields);
  const contactUnavailable = record.sourceDetail.contactUnavailable === true;
  const digest = createHash("sha256")
    .update(JSON.stringify({ fields, contactUnavailable }))
    .digest("hex");
  // Review and import serialize on the canonical patient; the caller also owns
  // the sorted external-identity lock for this migration row.
  await client.query(
    "select id from patients where tenant_id=$1 and clinic_id=$2 and id=$3 for update",
    [...scopeArgs(scope), patientId]
  );
  const latest = (
    await client.query<Row>(
      `select * from patient_source_contexts where tenant_id=$1 and clinic_id=$2 and source_system=$3 and external_reference=$4 order by version desc limit 1`,
      [...scopeArgs(scope), batch.sourceSystem, row.externalRecordId]
    )
  ).rows[0];
  if (latest && latest.patient_id !== patientId)
    throw new PatientSourceContextConflict(
      "Source context is already attached to another patient."
    );
  if (latest?.content_digest === digest) return;
  const saved = (
    await client.query<Row>(
      `insert into patient_source_contexts(tenant_id,clinic_id,patient_id,source_system,external_reference,source_format,version,fields,contact_unavailable,content_digest,import_batch_id,import_row_id,imported_by_user_id)
    values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13) returning id,version,imported_at`,
      [
        ...scopeArgs(scope),
        patientId,
        batch.sourceSystem,
        row.externalRecordId,
        PATIENT_CONTEXT_PROFILE,
        Number(latest?.version ?? 0) + 1,
        JSON.stringify(fields),
        contactUnavailable,
        digest,
        batch.id,
        row.id,
        scope.actorUserId
      ]
    )
  ).rows[0]!;
  const metadata = JSON.stringify({
    batchId: batch.id,
    rowId: row.id,
    version: saved.version,
    fieldCount: Object.keys(fields).length
  });
  await client.query(
    `insert into audit_events(tenant_id,clinic_id,actor_type,actor_id,action,category,risk_level,phi_involved,resource_type,resource_id,patient_id,correlation_id,metadata,occurred_at)
    values($1,$2,'user',$3,'patient.source_context.imported','clinical','high',true,'patient_source_context',$4,$5,$6,$7::jsonb,$8)`,
    [
      ...scopeArgs(scope),
      scope.actorUserId,
      saved.id,
      patientId,
      batch.id,
      metadata,
      saved.imported_at
    ]
  );
  await client.query(
    `insert into outbox_events(tenant_id,clinic_id,actor_type,actor_id,event_type,aggregate_type,aggregate_id,patient_id,idempotency_key,correlation_id,payload,occurred_at)
    values($1,$2,'user',$3,'patient.source_context.imported','patient_source_context',$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      ...scopeArgs(scope),
      scope.actorUserId,
      saved.id,
      patientId,
      `source-context:${String(saved.id)}`,
      batch.id,
      metadata,
      saved.imported_at
    ]
  );
}

export async function listPatientSourceContexts(
  client: SqlQueryClient,
  scope: RepositoryScope,
  patientId: UUID,
  cursor?: string
) {
  if (cursor && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor))
    throw new RangeError("Invalid source context cursor.");
  if (
    cursor &&
    !(
      await client.query(
        "select id from patient_source_contexts where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and id=$4",
        [...scopeArgs(scope), patientId, cursor]
      )
    ).rows.length
  )
    throw new RangeError("Source context cursor does not belong to this patient.");
  const rows = (
    await client.query<Row>(
      `${projection} where c.tenant_id=$1 and c.clinic_id=$2 and c.patient_id=$3
    and ($4::uuid is null or c.position<(select position from patient_source_contexts where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and id=$4))
    order by c.position desc limit 21`,
      [...scopeArgs(scope), patientId, cursor ?? null]
    )
  ).rows;
  return {
    records: rows.slice(0, 20).map(map),
    nextCursor: rows.length > 20 ? String(rows[19]!.id) : null
  };
}

export async function reviewPatientSourceContext(
  client: SqlQueryClient,
  scope: RepositoryScope,
  patientId: UUID,
  contextId: UUID,
  input: { decision: SourceContextReviewDecision; note: string }
) {
  if (
    !["reviewed", "needs_clarification"].includes(input.decision) ||
    typeof input.note !== "string" ||
    input.note.trim().length < 5 ||
    input.note.length > 2000
  )
    throw new RangeError(
      "Choose a review outcome and record 5–2,000 characters of review evidence."
    );
  await client.query(
    "select id from patients where tenant_id=$1 and clinic_id=$2 and id=$3 for update",
    [...scopeArgs(scope), patientId]
  );
  const record = (
    await client.query<Row>(
      "select * from patient_source_contexts where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and id=$4",
      [...scopeArgs(scope), patientId, contextId]
    )
  ).rows[0];
  if (!record) return null;
  const newer = (
    await client.query(
      "select id from patient_source_contexts where tenant_id=$1 and clinic_id=$2 and source_system=$3 and external_reference=$4 and version>$5 limit 1",
      [...scopeArgs(scope), record.source_system, record.external_reference, record.version]
    )
  ).rows.length;
  if (newer)
    throw new PatientSourceContextConflict(
      "Newer source evidence exists. Refresh and review the latest version; the older review was not saved."
    );
  await client.query(
    "insert into patient_source_context_reviews(tenant_id,clinic_id,context_id,decision,note,reviewed_by_user_id,revision) values($1,$2,$3,$4,$5,$6,(select coalesce(max(revision),0)+1 from patient_source_context_reviews where tenant_id=$1 and clinic_id=$2 and context_id=$3))",
    [...scopeArgs(scope), contextId, input.decision, input.note.trim(), scope.actorUserId]
  );
  const result = (
    await client.query<Row>(
      `${projection} where c.tenant_id=$1 and c.clinic_id=$2 and c.patient_id=$3 and c.id=$4`,
      [...scopeArgs(scope), patientId, contextId]
    )
  ).rows[0];
  return map(result!);
}
