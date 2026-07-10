-- CP13 Clinical/Dental lane proposal. This is not a canonical migration.
-- Master integration must reconcile it into the single numbered CP13 forward migration.
--
-- Proven gaps closed by this proposal:
-- 1. existing tenant-only foreign keys allow an appointment, encounter, dental finding, or media
--    row to carry another same-tenant patient's identifier;
-- 2. receiveMediaUploadContent has no durable receipt metadata between object PUT and completion.
--
-- Active-doctor assignment cannot be expressed as a stable foreign key because role assignments
-- are time-varying. The required ClinicalDentalRelationshipAuthority remains the application/RLS
-- control for provider role and active clinic assignment.

begin;

-- Referenced keys for patient-association foreign keys.
create unique index if not exists patients_cp13_clinic_identity_uidx
  on patients (tenant_id, primary_clinic_id, id);
create unique index if not exists appointments_cp13_patient_identity_uidx
  on appointments (tenant_id, clinic_id, id, patient_id);
create unique index if not exists encounters_cp13_patient_identity_uidx
  on encounters (tenant_id, clinic_id, id, patient_id);
create unique index if not exists dental_findings_cp13_patient_identity_uidx
  on dental_findings (tenant_id, clinic_id, id, patient_id);

-- Fail before constraint installation if historical state contains a wrong-patient association.
do $$
begin
  if exists (
    select 1
    from encounters e
    join appointments a on a.tenant_id = e.tenant_id and a.id = e.appointment_id
    where e.appointment_id is not null
      and (a.clinic_id, a.patient_id) is distinct from (e.clinic_id, e.patient_id)
  ) then
    raise exception 'CP13 association preflight: encounter appointment patient mismatch';
  end if;

  if exists (
    select 1
    from dental_findings f
    join encounters e on e.tenant_id = f.tenant_id and e.id = f.encounter_id
    where f.encounter_id is not null
      and (e.clinic_id, e.patient_id) is distinct from (f.clinic_id, f.patient_id)
  ) then
    raise exception 'CP13 association preflight: dental finding encounter patient mismatch';
  end if;

  if exists (
    select 1
    from media_uploads m
    join encounters e on e.tenant_id = m.tenant_id and e.id = m.encounter_id
    where m.encounter_id is not null
      and (e.clinic_id, e.patient_id) is distinct from (m.clinic_id, m.patient_id)
  ) or exists (
    select 1
    from media_assets m
    join encounters e on e.tenant_id = m.tenant_id and e.id = m.encounter_id
    where m.encounter_id is not null
      and (e.clinic_id, e.patient_id) is distinct from (m.clinic_id, m.patient_id)
  ) then
    raise exception 'CP13 association preflight: clinical media encounter patient mismatch';
  end if;

  if exists (
    select 1
    from media_uploads m
    join dental_findings f on f.tenant_id = m.tenant_id and f.id = m.dental_finding_id
    where m.dental_finding_id is not null
      and (f.clinic_id, f.patient_id) is distinct from (m.clinic_id, m.patient_id)
  ) or exists (
    select 1
    from media_assets m
    join dental_findings f on f.tenant_id = m.tenant_id and f.id = m.dental_finding_id
    where m.dental_finding_id is not null
      and (f.clinic_id, f.patient_id) is distinct from (m.clinic_id, m.patient_id)
  ) then
    raise exception 'CP13 association preflight: clinical media dental finding patient mismatch';
  end if;
end $$;

alter table encounters
  drop constraint if exists encounters_cp13_patient_clinic_fk,
  add constraint encounters_cp13_patient_clinic_fk
    foreign key (tenant_id, clinic_id, patient_id)
    references patients (tenant_id, primary_clinic_id, id) on delete restrict,
  drop constraint if exists encounters_cp13_appointment_patient_fk,
  add constraint encounters_cp13_appointment_patient_fk
    foreign key (tenant_id, clinic_id, appointment_id, patient_id)
    references appointments (tenant_id, clinic_id, id, patient_id)
    on delete set null (appointment_id);

alter table clinical_note_versions
  drop constraint if exists clinical_notes_cp13_encounter_patient_fk,
  add constraint clinical_notes_cp13_encounter_patient_fk
    foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters (tenant_id, clinic_id, id, patient_id) on delete cascade;

alter table prescriptions
  drop constraint if exists prescriptions_cp13_encounter_patient_fk,
  add constraint prescriptions_cp13_encounter_patient_fk
    foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters (tenant_id, clinic_id, id, patient_id) on delete cascade;

alter table dental_findings
  drop constraint if exists dental_findings_cp13_encounter_patient_fk,
  add constraint dental_findings_cp13_encounter_patient_fk
    foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters (tenant_id, clinic_id, id, patient_id)
    on delete set null (encounter_id);

alter table media_uploads
  drop constraint if exists media_uploads_cp13_encounter_patient_fk,
  add constraint media_uploads_cp13_encounter_patient_fk
    foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters (tenant_id, clinic_id, id, patient_id)
    on delete set null (encounter_id),
  drop constraint if exists media_uploads_cp13_finding_patient_fk,
  add constraint media_uploads_cp13_finding_patient_fk
    foreign key (tenant_id, clinic_id, dental_finding_id, patient_id)
    references dental_findings (tenant_id, clinic_id, id, patient_id)
    on delete set null (dental_finding_id);

alter table media_assets
  drop constraint if exists media_assets_cp13_encounter_patient_fk,
  add constraint media_assets_cp13_encounter_patient_fk
    foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters (tenant_id, clinic_id, id, patient_id)
    on delete set null (encounter_id),
  drop constraint if exists media_assets_cp13_finding_patient_fk,
  add constraint media_assets_cp13_finding_patient_fk
    foreign key (tenant_id, clinic_id, dental_finding_id, patient_id)
    references dental_findings (tenant_id, clinic_id, id, patient_id)
    on delete set null (dental_finding_id);

-- Durable receipt evidence for the object PUT boundary. Master integration must add a
-- transaction-bound clinicalMedia.recordReceivedContent port and populate these fields only from
-- storage-provider stat/receipt data, never from public completion input.
alter table media_uploads
  add column if not exists content_received_at timestamptz,
  add column if not exists received_content_length bigint,
  add column if not exists received_mime_type text,
  add column if not exists received_sha256_digest text,
  add column if not exists received_object_version text,
  drop constraint if exists media_uploads_cp13_received_content_consistent,
  add constraint media_uploads_cp13_received_content_consistent check (
    (
      content_received_at is null
      and received_content_length is null
      and received_mime_type is null
      and received_sha256_digest is null
      and received_object_version is null
    ) or (
      content_received_at is not null
      and received_content_length > 0
      and length(trim(received_mime_type)) > 0
      and received_sha256_digest ~ '^[a-f0-9]{64}$'
    )
  );

commit;
