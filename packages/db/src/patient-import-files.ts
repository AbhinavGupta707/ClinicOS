import type { MigrationBatchRecord, UUID } from "@clinic-os/domain";
import { normalizePhone } from "@clinic-os/domain";
import type { SqlQueryClient } from "./postgres.ts";
import type { RepositoryScope } from "./repositories.ts";
import { ImportRunRepositoryError } from "./repositories.ts";

export interface PatientFileManifest {
  profile: "practo_ray_patients_v1";
  rowCount: number;
  chunks: Array<{ ordinal: number; rowCount: number; digest: string }>;
}
export type PatientFileChunk = PatientFileManifest["chunks"][number] & {
  batchId: UUID | null;
  state: MigrationBatchRecord["state"] | null;
  ready: number;
  needsReview: number;
  invalid: number;
  skipped: number;
  committed: number;
  reconciled: number;
  failed: number;
  rolledBack: number;
};
export interface PatientFileDetail {
  runId: UUID;
  profile: PatientFileManifest["profile"];
  rowCount: number;
  sealed: boolean;
  received: number;
  chunks: PatientFileChunk[];
}

export interface PatientFileIdentityRow {
  id: UUID;
  batchId: UUID;
  rowNumber: number;
  fullName: string;
  phone: string;
}

// Compare the whole sealed snapshot, including rows in different chunks. These
// are review suggestions, never evidence that shared family contacts are one person.
// Keep only bounded row-number examples in each conflict, not copied PHI.
function patientFileName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function patientFileIdentityConflicts(rows: PatientFileIdentityRow[]) {
  const phones = new Map<string, PatientFileIdentityRow[]>();
  const names = new Map<string, PatientFileIdentityRow[]>();
  for (const row of rows) {
    for (const [key, groups] of [
      [normalizePhone(row.phone), phones],
      [patientFileName(row.fullName), names]
    ] as const) {
      if (!key.trim()) continue;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
  }
  return rows.flatMap((row) => {
    const phone = phones.get(normalizePhone(row.phone)) ?? [];
    const name = names.get(patientFileName(row.fullName)) ?? [];
    if (phone.length < 2 && name.length < 2) return [];
    const relatedRowNumbers = [
      ...new Set(
        [...phone.slice(0, 6), ...name.slice(0, 6)]
          .filter((candidate) => candidate.id !== row.id)
          .map((candidate) => candidate.rowNumber)
      )
    ].slice(0, 5);
    return [
      {
        ...row,
        summary: `Potential duplicate within this file. Review source CSV rows ${relatedRowNumbers.join(", ")}${Math.max(phone.length, name.length) > 6 ? " and others" : ""}. Shared contacts may be separate family members; explicitly approve a separate patient or skip a duplicate.`,
        evidence: {
          policy: "patient_file_identity_v1",
          relatedRowNumbers,
          samePhoneRows: Math.max(0, phone.length - 1),
          sameNameRows: Math.max(0, name.length - 1)
        }
      }
    ];
  });
}

export function assertPatientFileManifest(input: PatientFileManifest): void {
  if (
    input.profile !== "practo_ray_patients_v1" ||
    !Number.isInteger(input.rowCount) ||
    input.rowCount < 1 ||
    input.rowCount > 5000 ||
    !Array.isArray(input.chunks) ||
    input.chunks.length !== Math.ceil(input.rowCount / 100) ||
    input.chunks.some(
      (chunk, ordinal) =>
        chunk.ordinal !== ordinal ||
        chunk.rowCount !== Math.min(100, input.rowCount - ordinal * 100) ||
        !/^[0-9a-f]{64}$/u.test(chunk.digest)
    )
  ) {
    throw new ImportRunRepositoryError(
      "step_conflict",
      "Invalid patient file manifest (maximum 5,000 patients)."
    );
  }
}

export function patientFileChunkSummary(
  chunk: PatientFileManifest["chunks"][number],
  batch?: MigrationBatchRecord
): PatientFileChunk {
  return {
    ...chunk,
    batchId: batch?.id ?? null,
    state: batch?.state ?? null,
    ready: batch?.readyRowCount ?? 0,
    needsReview: batch?.conflictRowCount ?? 0,
    invalid: batch?.invalidRowCount ?? 0,
    skipped: 0,
    committed: batch?.committedRowCount ?? 0,
    reconciled: 0,
    failed: batch?.failedRowCount ?? 0,
    rolledBack: batch?.rolledBackRowCount ?? 0
  };
}

export interface PatientFileSqlRow {
  run_id: UUID;
  profile: PatientFileManifest["profile"];
  row_count: number;
  manifest: PatientFileManifest["chunks"];
  sealed_at: Date | string | null;
}

export async function readPatientFile(
  client: SqlQueryClient,
  scope: RepositoryScope,
  runId: UUID
): Promise<PatientFileDetail | null> {
  const file = (
    await client.query<PatientFileSqlRow>(
      "select * from patient_import_files where tenant_id = $1 and clinic_id = $2 and run_id = $3",
      [scope.tenantId, scope.clinicId, runId]
    )
  ).rows[0];
  if (!file) return null;
  // Only batch counters, never thousands of rows or conflicts in a run response.
  const rows = (
    await client.query<{
      ordinal: number;
      batch_id: UUID;
      state: MigrationBatchRecord["state"];
      row_count: number;
      reconciled: number;
      ready_row_count: number;
      conflict_row_count: number;
      invalid_row_count: number;
      skipped_row_count: number;
      committed_row_count: number;
      failed_row_count: number;
      rolled_back_row_count: number;
    }>(
      `select c.ordinal, c.batch_id, b.state, b.row_count, b.ready_row_count, b.conflict_row_count,
       coalesce((select (m.summary->>'reconciledRows')::int from migration_commits m
         where (m.tenant_id, m.clinic_id, m.batch_id) = (b.tenant_id, b.clinic_id, b.id)
         and m.action = 'commit' order by m.started_at desc limit 1), 0) as reconciled,
       b.invalid_row_count, (select count(*)::int from migration_rows r
         where (r.tenant_id, r.clinic_id, r.batch_id) = (b.tenant_id, b.clinic_id, b.id)
         and r.status = 'skipped') as skipped_row_count, b.committed_row_count, b.failed_row_count, b.rolled_back_row_count
     from patient_import_chunks c join migration_batches b
       on (b.tenant_id, b.clinic_id, b.id) = (c.tenant_id, c.clinic_id, c.batch_id)
     where c.tenant_id = $1 and c.clinic_id = $2 and c.run_id = $3 order by c.ordinal`,
      [scope.tenantId, scope.clinicId, runId]
    )
  ).rows;
  return {
    runId,
    profile: file.profile,
    rowCount: Number(file.row_count),
    sealed: file.sealed_at !== null,
    received: rows.reduce((sum, row) => sum + Number(row.row_count), 0),
    chunks: file.manifest.map((chunk) => {
      const row = rows.find((item) => item.ordinal === chunk.ordinal);
      return row
        ? {
            ...chunk,
            batchId: row.batch_id,
            state: row.state,
            ready: Number(row.ready_row_count),
            needsReview: Number(row.conflict_row_count),
            invalid: Number(row.invalid_row_count),
            skipped: Number(row.skipped_row_count),
            committed: Number(row.committed_row_count),
            reconciled: Number(row.reconciled),
            failed: Number(row.failed_row_count),
            rolledBack: Number(row.rolled_back_row_count)
          }
        : patientFileChunkSummary(chunk);
    })
  };
}

export async function lockPatientFileForBatch(
  client: SqlQueryClient,
  scope: RepositoryScope,
  batchId: UUID
): Promise<PatientFileDetail | null> {
  // Lock the file before a batch everywhere: staging/finalization and concurrent
  // commits share this order. Generic batch APIs cannot bypass incomplete upload.
  const membership = (
    await client.query<{ run_id: UUID }>(
      "select run_id from patient_import_chunks where tenant_id = $1 and clinic_id = $2 and batch_id = $3",
      [scope.tenantId, scope.clinicId, batchId]
    )
  ).rows[0];
  if (!membership) return null;
  await client.query(
    "select run_id from patient_import_files where tenant_id = $1 and clinic_id = $2 and run_id = $3 for update",
    [scope.tenantId, scope.clinicId, membership.run_id]
  );
  return readPatientFile(client, scope, membership.run_id);
}

export async function assertPatientFileCommitAllowed(
  client: SqlQueryClient,
  scope: RepositoryScope,
  batchId: UUID
): Promise<void> {
  const file = await lockPatientFileForBatch(client, scope, batchId);
  if (!file) return;
  if (
    !file?.sealed ||
    file.received !== file.rowCount ||
    file.chunks.some((chunk) => chunk.needsReview > 0)
  )
    throw new ImportRunRepositoryError(
      "prerequisite",
      "Finish uploading and resolve all patient-file review conflicts before committing."
    );
}
