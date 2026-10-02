-- Preserve existing assets and source evidence; add stable patient-file paging indexes.
create index if not exists media_assets_patient_page_idx
  on media_assets (tenant_id, clinic_id, patient_id, uploaded_at desc, id desc)
  where status <> 'deleted';
create index if not exists media_assets_patient_type_page_idx
  on media_assets (tenant_id, clinic_id, patient_id, media_type, uploaded_at desc, id desc)
  where status <> 'deleted';
