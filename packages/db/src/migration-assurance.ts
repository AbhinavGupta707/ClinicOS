import type { MigrationAssuranceFacts, UUID } from "@clinic-os/domain";
import type { SqlQueryClient } from "./postgres.ts";
import type { RepositoryScope } from "./repositories.ts";
import { ImportRunRepositoryError } from "./repositories.ts";

// One SQL statement gives every aggregate the same MVCC snapshot. No PHI rows,
// JSON source payloads, clinical notes or error text leave the database.
export async function readMigrationAssurance(
  client: SqlQueryClient,
  scope: RepositoryScope,
  runId: UUID,
  comparisonRunId: UUID | null,
  appointmentImportId: UUID | null
): Promise<MigrationAssuranceFacts | null> {
  const result = (
    await client.query<{
      facts: MigrationAssuranceFacts;
      comparison_allowed: boolean;
      appointment_allowed: boolean;
    }>(
      `with
    run as (select * from import_runs where tenant_id=$1 and clinic_id=$2 and id=$3),
    file as (select * from patient_import_files where tenant_id=$1 and clinic_id=$2 and run_id=$3),
    batches as (
      select b.* from migration_batches b where b.tenant_id=$1 and b.clinic_id=$2
      and (b.import_run_id=$3 or exists(select 1 from patient_import_chunks c
        where c.tenant_id=$1 and c.clinic_id=$2 and c.run_id=$3 and c.batch_id=b.id))
    ),
    rows as (select r.* from migration_rows r join batches b on b.id=r.batch_id
      where r.tenant_id=$1 and r.clinic_id=$2),
    actual as (select b.id, count(r.id)::int n,
      count(*) filter(where r.status='invalid')::int invalid,
      count(r.id) filter(where r.status<>'invalid')::int valid,
      count(*) filter(where r.status='ready_to_commit')::int ready,
      count(*) filter(where r.status='committed')::int committed,
      count(*) filter(where r.status='rolled_back')::int rolled_back,
      count(*) filter(where r.status='failed')::int failed,
      count(distinct r.id) filter(where exists(select 1 from migration_conflicts c
        where c.tenant_id=$1 and c.clinic_id=$2 and c.row_id=r.id and c.status='open'))::int conflicts
      from batches b left join rows r on r.batch_id=b.id group by b.id),
    patient_rows as (select r.*, exists(select 1 from imported_record_links l
      join patients p on p.tenant_id=l.tenant_id and p.clinic_id=l.clinic_id and p.id=l.target_record_id
      where l.tenant_id=$1 and l.clinic_id=$2 and l.source_system=(select source_system from run)
      and r.committed_record_type='patient' and l.target_record_type='patient' and l.target_record_id=r.committed_record_id
      and l.verification_status<>'rolled_back'
      and (l.row_id=r.id or (r.external_record_id is not null and l.external_record_id=r.external_record_id))) as linked
      from rows r where r.import_type='patients' and r.status='committed'),
    contexts_added as (select c.id from patient_source_contexts c join batches b on b.id=c.import_batch_id
      where c.tenant_id=$1 and c.clinic_id=$2),
    retained as (select distinct on (c.source_system,c.external_reference) c.id,
      (select v.decision from patient_source_context_reviews v where v.tenant_id=$1 and v.clinic_id=$2 and v.context_id=c.id
       order by v.revision desc limit 1) decision
      from patient_source_contexts c join patient_rows r on c.patient_id=r.committed_record_id and c.external_reference=r.external_record_id
      where c.tenant_id=$1 and c.clinic_id=$2 and c.source_system=(select source_system from run)
        and exists(select 1 from file where profile='practo_ray_patients_context_v2')
      order by c.source_system,c.external_reference,c.version desc),
    previous as (select f.* from patient_import_files f join import_runs p
      on (p.tenant_id,p.clinic_id,p.id)=(f.tenant_id,f.clinic_id,f.run_id)
      where f.tenant_id=$1 and f.clinic_id=$2 and f.run_id=$4
      and p.source_system=(select source_system from run) and p.id<>$3),
    selected_files as (select * from file union all select * from previous),
    receipt_counts as (select c.run_id,c.ordinal,c.batch_id,c.digest,c.row_count,count(r.id)::int actual_count
      from patient_import_chunks c left join migration_rows r on (r.tenant_id,r.clinic_id,r.batch_id)=(c.tenant_id,c.clinic_id,c.batch_id)
      where c.tenant_id=$1 and c.clinic_id=$2 and c.run_id in ($3,$4)
      group by c.run_id,c.ordinal,c.batch_id,c.digest,c.row_count),
    manifest_checks as (select f.run_id,
      (select count(*) from jsonb_array_elements(f.manifest) m left join receipt_counts c
        on c.run_id=f.run_id and c.ordinal=(m->>'ordinal')::int
        where (c.batch_id is null and f.sealed_at is not null) or (c.batch_id is not null and
          (c.digest<>m->>'digest' or c.row_count<>(m->>'rowCount')::int or c.actual_count<>c.row_count)))
      + (select count(*) from receipt_counts c where c.run_id=f.run_id and not exists
          (select 1 from jsonb_array_elements(f.manifest) m where (m->>'ordinal')::int=c.ordinal))
      + case when (select sum((m->>'rowCount')::int) from jsonb_array_elements(f.manifest) m)<>f.row_count then 1 else 0 end
      as problems from selected_files f),
    prior_rows as (select r.external_record_id,r.raw_payload_digest from migration_rows r
      join patient_import_chunks c on (c.tenant_id,c.clinic_id,c.batch_id)=(r.tenant_id,r.clinic_id,r.batch_id)
      where c.tenant_id=$1 and c.clinic_id=$2 and c.run_id=$4),
    current_ids as (select external_record_id,min(raw_payload_digest) digest from rows group by external_record_id),
    prior_ids as (select external_record_id,min(raw_payload_digest) digest from prior_rows group by external_record_id),
    comparison as (select
      count(*) filter(where p.external_record_id is null)::int added,
      count(*) filter(where c.external_record_id is null)::int absent,
      count(*) filter(where c.external_record_id is not null and p.external_record_id is not null and c.digest<>p.digest)::int changed,
      count(*) filter(where c.external_record_id is not null and p.external_record_id is not null and c.digest=p.digest)::int unchanged
      from current_ids c full join prior_ids p using(external_record_id)),
    appointments as (select * from appointment_imports where tenant_id=$1 and clinic_id=$2 and id=$5
      and source_system=(select source_system from run)),
    observations as (select o.* from appointment_source_observations o join appointments a on a.id=o.import_id
      where o.tenant_id=$1 and o.clinic_id=$2)
    select ($4::uuid is null or exists(select 1 from previous)) comparison_allowed,
      ($5::uuid is null or exists(select 1 from appointments)) appointment_allowed,
      jsonb_build_object(
        'runId',run.id,'profile',(select profile from file),'expected',(select row_count from file),
        'sealed',(select sealed_at is not null from file),
        'rows',(select jsonb_build_object(
          'invalid',count(*) filter(where status='invalid'),'needsReview',count(*) filter(where status='needs_review'),
          'ready',count(*) filter(where status='ready_to_commit'),'committed',count(*) filter(where status='committed'),
          'skipped',count(*) filter(where status='skipped'),'rolledBack',count(*) filter(where status='rolled_back'),
          'failed',count(*) filter(where status='failed')) from rows),
        'manifestProblems',coalesce((select problems from manifest_checks where run_id=$3),0),
        'counterMismatches',(select count(*) from batches b join actual a on a.id=b.id
          where (b.row_count,b.valid_row_count,b.invalid_row_count,b.ready_row_count,b.committed_row_count,b.rolled_back_row_count,b.failed_row_count,b.conflict_row_count)
            is distinct from (a.n,a.valid,a.invalid,a.ready,a.committed,a.rolled_back,a.failed,a.conflicts)),
        'openConflicts',(select count(*) from migration_conflicts c join rows r on r.id=c.row_id
          where c.tenant_id=$1 and c.clinic_id=$2 and c.status='open'),
        'patients',(select jsonb_build_object('committedRows',count(*),'distinctPatients',count(distinct committed_record_id) filter(where linked),
          'missingLinks',count(*) filter(where not linked),
          'createdPatients',(select count(distinct l.target_record_id) from imported_record_links l join rows r on r.id=l.row_id
            where l.tenant_id=$1 and l.clinic_id=$2 and l.target_record_type='patient' and l.link_type='created_from_import'
              and l.verification_status<>'rolled_back' and r.status='committed')) from patient_rows),
        'context',(select jsonb_build_object('versionsAdded',(select count(*) from contexts_added),
          'retainedVersions',count(*),'reviewed',count(*) filter(where decision='reviewed'),
          'needsClarification',count(*) filter(where decision='needs_clarification'),'unreviewed',count(*) filter(where decision is null),
          'missingRows',(select count(*) from patient_rows r where exists(select 1 from file where profile='practo_ray_patients_context_v2')
            and not exists(select 1 from patient_source_contexts c where c.tenant_id=$1 and c.clinic_id=$2 and c.patient_id=r.committed_record_id
              and c.source_system=(select source_system from run) and c.external_reference=r.external_record_id))) from retained),
        'comparison',case when $4::uuid is null then null else (select jsonb_build_object('runId',$4::uuid,
          'eligibility',case
            when not exists(select 1 from file) or (select profile from file)<>(select profile from previous) then 'different_profile'
            when not exists(select 1 from file where sealed_at is not null) or not exists(select 1 from previous where sealed_at is not null)
              or (select count(*) from rows)<>(select row_count from file) or (select count(*) from prior_rows)<>(select row_count from previous) then 'incomplete'
            when exists(select 1 from manifest_checks where problems>0) then 'integrity_mismatch'
            when exists(select 1 from rows where external_record_id is null) or exists(select 1 from prior_rows where external_record_id is null)
              or (select count(*) from current_ids)<>(select count(*) from rows)
              or (select count(*) from prior_ids)<>(select count(*) from prior_rows) then 'ambiguous_identifiers'
            else 'comparable' end,'added',added,'changed',changed,'unchanged',unchanged,'absent',absent) from comparison) end,
        'appointments',(select jsonb_build_object('importId',id,'expected',row_count,'sealed',sealed_at is not null,
          'pending',(select count(*) from observations where decision='pending'),
          'history',(select count(*) from observations where decision='history'),
          'excluded',(select count(*) from observations where decision='exclude'),
          'linked',(select count(*) from observations where decision='link'),
          'created',(select count(*) from observations where decision='create'),
          'missingLinks',(select count(*) from observations o where o.decision in ('link','create')
            and not exists(select 1 from public.appointments a where a.tenant_id=$1 and a.clinic_id=$2 and a.id=o.appointment_id))) from appointments)
      ) facts from run`,
      [scope.tenantId, scope.clinicId, runId, comparisonRunId, appointmentImportId]
    )
  ).rows[0];
  if (!result) return null;
  if (!result.comparison_allowed || !result.appointment_allowed)
    throw new ImportRunRepositoryError(
      "not_found",
      "Selected evidence is unavailable for this run and source."
    );
  return result.facts;
}
