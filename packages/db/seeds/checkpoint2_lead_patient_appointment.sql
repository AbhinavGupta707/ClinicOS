-- Synthetic local/dev seed for Checkpoint 2 day-start workflows.

insert into appointment_types (
  id,
  tenant_id,
  clinic_id,
  code,
  display_name,
  default_duration_minutes,
  color,
  active
)
values (
  '10000000-0000-4000-8000-000000003001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  'consultation',
  'Consultation',
  30,
  '#2563eb',
  true
)
on conflict (tenant_id, clinic_id, code) do update set
  display_name = excluded.display_name,
  default_duration_minutes = excluded.default_duration_minutes,
  color = excluded.color,
  active = excluded.active;

insert into chairs_or_rooms (
  id,
  tenant_id,
  clinic_id,
  code,
  display_name,
  active
)
values (
  '10000000-0000-4000-8000-000000004001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  'op-1',
  'Operatory 1',
  true
)
on conflict (tenant_id, clinic_id, code) do update set
  display_name = excluded.display_name,
  active = excluded.active;

insert into provider_schedules (
  id,
  tenant_id,
  clinic_id,
  provider_user_id,
  day_of_week,
  starts_at,
  ends_at,
  effective_from,
  active
)
values (
  '10000000-0000-4000-8000-000000005001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000001002',
  1,
  '09:00',
  '17:00',
  '2026-07-06',
  true
)
on conflict (id) do update set
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  active = excluded.active;
