# CP4 Media Backend Schema Proposal

Dental Domain owns the numbered CP4 migration. Media Backend expects the CP4 migration to include these tables or equivalent columns before production Postgres media routes are enabled.

```sql
create table media_uploads (
  id uuid primary key,
  tenant_id uuid not null,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid null,
  tooth_number text null,
  dental_finding_id uuid null,
  media_type text not null,
  original_filename text not null,
  mime_type text not null,
  expected_file_size_bytes bigint not null,
  expected_sha256_digest text null,
  object_key text not null,
  storage_provider text not null,
  storage_region text null,
  status text not null default 'reserved',
  expires_at timestamptz not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  media_asset_id uuid null,
  tags jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb
);

create table media_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid null,
  tooth_number text null,
  dental_finding_id uuid null,
  media_type text not null,
  original_filename text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  sha256_digest text null,
  object_key text not null,
  object_version text null,
  storage_provider text not null,
  storage_region text null,
  status text not null,
  scan_status text not null,
  quarantine_reason text null,
  tags jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  dicom_metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid not null,
  uploaded_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index media_assets_object_key_unique on media_assets(object_key);
create index media_uploads_scope_idx on media_uploads(tenant_id, clinic_id, patient_id, status);
create index media_assets_patient_idx on media_assets(tenant_id, clinic_id, patient_id, uploaded_at desc);
create index media_assets_encounter_idx on media_assets(tenant_id, clinic_id, encounter_id)
  where encounter_id is not null;
create index media_assets_tooth_idx on media_assets(tenant_id, clinic_id, patient_id, tooth_number)
  where tooth_number is not null;
create index media_assets_finding_idx on media_assets(tenant_id, clinic_id, dental_finding_id)
  where dental_finding_id is not null;
```

Integration notes:

- `object_key` is internal only and must not be returned by API serializers.
- Add tenant/clinic foreign keys and patient/encounter/dental finding references in the CP4 migration once Dental Domain finalizes table names.
- Enable and force RLS with the same tenant/clinic context pattern used by patients, encounters, and clinical notes.
- Keep `media_uploads.media_asset_id` nullable until completion, then link to `media_assets.id`.
