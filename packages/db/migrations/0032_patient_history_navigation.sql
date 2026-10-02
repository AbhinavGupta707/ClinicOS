-- Read paths stay on the existing canonical records; no parallel history store.
create index if not exists patient_timeline_items_page_idx
  on patient_timeline_items(tenant_id, clinic_id, patient_id, occurred_at desc, id desc);
create index if not exists patient_timeline_items_category_page_idx
  on patient_timeline_items(tenant_id, clinic_id, patient_id, item_type, occurred_at desc, id desc);
create index if not exists form_responses_latest_patient_idx
  on form_responses(tenant_id, clinic_id, patient_id, submitted_at desc, id desc);
create index if not exists consents_latest_purpose_idx
  on consents(tenant_id, clinic_id, patient_id, purpose, greatest(created_at,revoked_at) desc, created_at asc, id desc);
