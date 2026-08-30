-- MVP1 source-independent ingestion: safe practitioner mappings and appointment imports.
-- Practitioner rows are link-only and cannot provision users or grant access.

alter table migration_batches
  drop constraint if exists migration_batches_import_type_check;
alter table migration_batches
  add constraint migration_batches_import_type_check check (
    import_type in (
      'patients',
      'practitioners',
      'appointments',
      'invoices',
      'payments',
      'clinical_notes',
      'media_inventory'
    )
  ) not valid;
alter table migration_batches validate constraint migration_batches_import_type_check;

alter table migration_rows
  drop constraint if exists migration_rows_import_type_check;
alter table migration_rows
  add constraint migration_rows_import_type_check check (
    import_type in (
      'patients',
      'practitioners',
      'appointments',
      'invoices',
      'payments',
      'clinical_notes',
      'media_inventory'
    )
  ) not valid;
alter table migration_rows validate constraint migration_rows_import_type_check;

alter table imported_record_links
  drop constraint if exists imported_record_links_import_type_check;
alter table imported_record_links
  add constraint imported_record_links_import_type_check check (
    import_type in (
      'patients',
      'practitioners',
      'appointments',
      'invoices',
      'payments',
      'clinical_notes',
      'media_inventory'
    )
  ) not valid;
alter table imported_record_links validate constraint imported_record_links_import_type_check;

alter table migration_rows
  add constraint migration_rows_practitioner_link_only_check check (
    import_type <> 'practitioners'
    or resolution_action is null
    or resolution_action = 'skip'
    or (
      resolution_action = 'link_existing'
      and resolution_target_record_type = 'provider_user'
      and resolution_target_record_id is not null
    )
  ) not valid;
alter table migration_rows validate constraint migration_rows_practitioner_link_only_check;

alter table migration_rows
  add constraint migration_rows_ingestion_record_type_check check (
    normalized_record is null
    or (import_type = 'patients' and coalesce(normalized_record ->> 'recordType', '') = 'patient')
    or (import_type = 'practitioners' and coalesce(normalized_record ->> 'recordType', '') = 'provider_user')
    or (import_type = 'appointments' and coalesce(normalized_record ->> 'recordType', '') = 'appointment')
    or import_type in ('invoices', 'payments', 'clinical_notes', 'media_inventory')
  ) not valid;
alter table migration_rows validate constraint migration_rows_ingestion_record_type_check;

alter table migration_rows
  add column evidence_reaffirmed boolean not null default false;
alter table migration_rows
  add constraint migration_rows_evidence_reaffirmed_check check (
    not evidence_reaffirmed
    or (
      resolution_action = 'link_existing'
      and resolution_target_record_type is not null
      and resolution_target_record_id is not null
      and committed_record_type is not null
      and committed_record_id is not null
    )
  ) not valid;
alter table migration_rows validate constraint migration_rows_evidence_reaffirmed_check;

alter table imported_record_links
  add constraint imported_record_links_ingestion_target_type_check check (
    (import_type <> 'patients' or target_record_type = 'patient')
    and (
      import_type <> 'practitioners'
      or (
        target_record_type = 'provider_user'
        and link_type = 'linked_existing'
      )
    )
    and (import_type <> 'appointments' or target_record_type = 'appointment')
  ) not valid;
alter table imported_record_links validate constraint imported_record_links_ingestion_target_type_check;

comment on constraint migration_rows_practitioner_link_only_check on migration_rows is
  'External practitioner references may only link to an existing eligible provider user or be skipped; imports cannot provision identities or roles.';

comment on column migration_rows.evidence_reaffirmed is
  'True only when this committed row explicitly advanced canonical external-link evidence; automatic rollback must report it as non-reversible.';
