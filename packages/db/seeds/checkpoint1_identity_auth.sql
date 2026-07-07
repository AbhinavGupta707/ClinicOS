-- Synthetic local/dev seed for Checkpoint 1.
-- Keycloak local realm users should use matching subjects:
-- seed-owner, seed-doctor, seed-assistant, seed-receptionist, seed-accountant.

insert into tenants (id, slug, legal_name, display_name, status)
values (
  '10000000-0000-4000-8000-000000000001',
  'demo-dental-care',
  'Demo Dental Care Private Limited',
  'Demo Dental Care',
  'active'
)
on conflict (id) do update set
  legal_name = excluded.legal_name,
  display_name = excluded.display_name,
  status = excluded.status;

insert into clinics (id, tenant_id, slug, display_name, legal_name, timezone, address, status)
values (
  '10000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000001',
  'indiranagar',
  'Demo Dental Care Indiranagar',
  'Demo Dental Care Indiranagar Clinic',
  'Asia/Kolkata',
  '{"city":"Bengaluru","state":"Karnataka","country":"IN"}',
  'active'
)
on conflict (id) do update set
  display_name = excluded.display_name,
  timezone = excluded.timezone,
  address = excluded.address,
  status = excluded.status;

insert into permissions (key, display_name, category, description, phi_involved)
values
  ('tenant.manage', 'Manage tenant', 'administration', 'Manage tenant-level configuration.', false),
  ('clinic.manage', 'Manage clinic', 'administration', 'Manage clinic profile and operating configuration.', false),
  ('user.manage', 'Manage users', 'administration', 'Invite, disable, and update users.', false),
  ('role.manage', 'Manage roles', 'administration', 'Assign and revoke product roles.', false),
  ('security.manage', 'Manage security', 'security', 'Manage security policies and break-glass configuration.', false),
  ('integration.manage', 'Manage integrations', 'integration', 'Connect, disconnect, and configure provider accounts.', false),
  ('audit.read', 'Read audit log', 'security', 'Read protected audit events.', false),
  ('patient.read', 'Read patient', 'patient', 'Read patient registry records.', true),
  ('patient.write', 'Write patient', 'patient', 'Create and update patient registry records.', true),
  ('patient.export', 'Export patient', 'privacy', 'Export patient records.', true),
  ('patient.phi.read', 'Read patient PHI', 'patient', 'Read directly identifying patient data.', true),
  ('schedule.read', 'Read schedule', 'operations', 'Read appointment calendar and queue.', false),
  ('schedule.write', 'Write schedule', 'operations', 'Create and update appointments.', false),
  ('queue.manage', 'Manage queue', 'operations', 'Check in, call, and route patients.', false),
  ('intake.write', 'Write intake', 'clinical', 'Capture patient intake and history drafts.', true),
  ('clinical.note.read', 'Read clinical notes', 'clinical', 'Read clinical notes and encounter context.', true),
  ('clinical.note.write', 'Write clinical notes', 'clinical', 'Draft and update unsigned clinical notes.', true),
  ('clinical.note.sign', 'Sign clinical notes', 'clinical', 'Sign final clinical notes.', true),
  ('prescription.write', 'Write prescriptions', 'clinical', 'Create and update unsigned prescription drafts.', true),
  ('prescription.sign', 'Sign prescriptions', 'clinical', 'Sign prescriptions and clinical instructions.', true),
  ('media.read', 'Read media', 'clinical', 'View patient photos, X-rays, and documents.', true),
  ('media.write', 'Write media', 'clinical', 'Upload and tag patient media.', true),
  ('billing.read', 'Read billing', 'billing', 'Read invoices, dues, and payment state.', false),
  ('billing.write', 'Write billing', 'billing', 'Create invoices and record payments.', false),
  ('billing.export', 'Export billing', 'billing', 'Export billing and payment reports.', false),
  ('message.read', 'Read messages', 'communication', 'Read patient communication threads.', true),
  ('message.write', 'Write messages', 'communication', 'Send approved patient messages.', true),
  ('task.manage', 'Manage tasks', 'operations', 'Create and update operational tasks.', false),
  ('lab.manage', 'Manage lab', 'operations', 'Create and update lab cases.', true),
  ('inventory.manage', 'Manage inventory', 'operations', 'Manage inventory and procurement tasks.', false),
  ('analytics.read', 'Read analytics', 'analytics', 'Read owner dashboards and clinic metrics.', false),
  ('break_glass.request', 'Request break-glass', 'security', 'Request emergency PHI access with reason.', true),
  ('break_glass.approve', 'Approve break-glass', 'security', 'Approve emergency PHI access.', true)
on conflict (key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  description = excluded.description,
  phi_involved = excluded.phi_involved;

insert into roles (tenant_id, slug, display_name, description, is_system_role)
values
  ('10000000-0000-4000-8000-000000000001', 'owner_admin', 'Owner/Admin', 'Clinic owner or administrator.', true),
  ('10000000-0000-4000-8000-000000000001', 'doctor', 'Doctor', 'Doctor with clinical sign-off rights.', true),
  ('10000000-0000-4000-8000-000000000001', 'assistant', 'Assistant', 'Assistant for scheduling, intake, drafts, media, and operations.', true),
  ('10000000-0000-4000-8000-000000000001', 'receptionist', 'Receptionist', 'Front desk schedule, demographics, billing, and messages.', true),
  ('10000000-0000-4000-8000-000000000001', 'accountant', 'Accountant', 'Billing and finance role without clinical access.', true),
  ('10000000-0000-4000-8000-000000000001', 'auditor', 'Auditor', 'Audit and compliance review role.', true),
  ('10000000-0000-4000-8000-000000000001', 'platform_admin', 'Platform Admin', 'Platform support role scoped through audited tenant membership.', true)
on conflict (tenant_id, slug) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  is_system_role = excluded.is_system_role;

insert into role_permissions (role_id, permission_key)
select roles.id, permission_key
from roles
cross join lateral (
  values
    ('owner_admin', 'tenant.manage'), ('owner_admin', 'clinic.manage'), ('owner_admin', 'user.manage'),
    ('owner_admin', 'role.manage'), ('owner_admin', 'security.manage'), ('owner_admin', 'integration.manage'),
    ('owner_admin', 'audit.read'), ('owner_admin', 'patient.read'), ('owner_admin', 'patient.write'),
    ('owner_admin', 'patient.export'), ('owner_admin', 'patient.phi.read'), ('owner_admin', 'schedule.read'),
    ('owner_admin', 'schedule.write'), ('owner_admin', 'queue.manage'), ('owner_admin', 'intake.write'),
    ('owner_admin', 'clinical.note.read'), ('owner_admin', 'clinical.note.write'), ('owner_admin', 'clinical.note.sign'),
    ('owner_admin', 'prescription.write'), ('owner_admin', 'prescription.sign'), ('owner_admin', 'media.read'), ('owner_admin', 'media.write'),
    ('owner_admin', 'billing.read'), ('owner_admin', 'billing.write'), ('owner_admin', 'billing.export'),
    ('owner_admin', 'message.read'), ('owner_admin', 'message.write'), ('owner_admin', 'task.manage'),
    ('owner_admin', 'lab.manage'), ('owner_admin', 'inventory.manage'), ('owner_admin', 'analytics.read'),
    ('owner_admin', 'break_glass.request'), ('owner_admin', 'break_glass.approve'),
    ('doctor', 'patient.read'), ('doctor', 'patient.write'), ('doctor', 'patient.phi.read'),
    ('doctor', 'schedule.read'), ('doctor', 'queue.manage'), ('doctor', 'intake.write'),
    ('doctor', 'clinical.note.read'), ('doctor', 'clinical.note.write'), ('doctor', 'clinical.note.sign'),
    ('doctor', 'prescription.write'), ('doctor', 'prescription.sign'), ('doctor', 'media.read'), ('doctor', 'media.write'),
    ('doctor', 'billing.read'), ('doctor', 'message.read'), ('doctor', 'message.write'),
    ('doctor', 'task.manage'), ('doctor', 'lab.manage'), ('doctor', 'break_glass.request'),
    ('assistant', 'patient.read'), ('assistant', 'patient.write'), ('assistant', 'patient.phi.read'),
    ('assistant', 'schedule.read'), ('assistant', 'schedule.write'), ('assistant', 'queue.manage'),
    ('assistant', 'intake.write'), ('assistant', 'clinical.note.read'), ('assistant', 'clinical.note.write'),
    ('assistant', 'prescription.write'), ('assistant', 'media.read'), ('assistant', 'media.write'), ('assistant', 'billing.read'),
    ('assistant', 'message.read'), ('assistant', 'message.write'), ('assistant', 'task.manage'),
    ('assistant', 'lab.manage'), ('assistant', 'inventory.manage'),
    ('receptionist', 'patient.read'), ('receptionist', 'patient.write'), ('receptionist', 'schedule.read'),
    ('receptionist', 'schedule.write'), ('receptionist', 'queue.manage'), ('receptionist', 'billing.read'),
    ('receptionist', 'billing.write'), ('receptionist', 'message.read'), ('receptionist', 'message.write'),
    ('receptionist', 'task.manage'),
    ('accountant', 'billing.read'), ('accountant', 'billing.write'), ('accountant', 'billing.export'),
    ('accountant', 'analytics.read'),
    ('auditor', 'audit.read'), ('auditor', 'analytics.read'),
    ('platform_admin', 'tenant.manage'), ('platform_admin', 'clinic.manage'), ('platform_admin', 'user.manage'),
    ('platform_admin', 'role.manage'), ('platform_admin', 'security.manage'), ('platform_admin', 'integration.manage'),
    ('platform_admin', 'audit.read'), ('platform_admin', 'patient.read'), ('platform_admin', 'patient.write'),
    ('platform_admin', 'patient.export'), ('platform_admin', 'patient.phi.read'), ('platform_admin', 'schedule.read'),
    ('platform_admin', 'schedule.write'), ('platform_admin', 'queue.manage'), ('platform_admin', 'intake.write'),
    ('platform_admin', 'clinical.note.read'), ('platform_admin', 'clinical.note.write'), ('platform_admin', 'clinical.note.sign'),
    ('platform_admin', 'prescription.write'), ('platform_admin', 'prescription.sign'), ('platform_admin', 'media.read'), ('platform_admin', 'media.write'),
    ('platform_admin', 'billing.read'), ('platform_admin', 'billing.write'), ('platform_admin', 'billing.export'),
    ('platform_admin', 'message.read'), ('platform_admin', 'message.write'), ('platform_admin', 'task.manage'),
    ('platform_admin', 'lab.manage'), ('platform_admin', 'inventory.manage'), ('platform_admin', 'analytics.read'),
    ('platform_admin', 'break_glass.request'), ('platform_admin', 'break_glass.approve')
) grants(role_slug, permission_key)
where roles.tenant_id = '10000000-0000-4000-8000-000000000001'
  and roles.slug = grants.role_slug
on conflict do nothing;

insert into users (id, display_name, email, status)
values
  ('10000000-0000-4000-8000-000000001001', 'Dr Ananya Owner', 'owner@demo.clinicos.local', 'active'),
  ('10000000-0000-4000-8000-000000001002', 'Dr Kabir Doctor', 'doctor@demo.clinicos.local', 'active'),
  ('10000000-0000-4000-8000-000000001003', 'Meera Assistant', 'assistant@demo.clinicos.local', 'active'),
  ('10000000-0000-4000-8000-000000001004', 'Rohan Reception', 'reception@demo.clinicos.local', 'active'),
  ('10000000-0000-4000-8000-000000001005', 'Priya Accounts', 'accounts@demo.clinicos.local', 'active')
on conflict (id) do update set
  display_name = excluded.display_name,
  email = excluded.email,
  status = excluded.status;

insert into user_identities (user_id, provider, issuer, subject, email_at_provider)
values
  ('10000000-0000-4000-8000-000000001001', 'keycloak', 'http://localhost:8080/realms/clinicos-local', 'seed-owner', 'owner@demo.clinicos.local'),
  ('10000000-0000-4000-8000-000000001002', 'keycloak', 'http://localhost:8080/realms/clinicos-local', 'seed-doctor', 'doctor@demo.clinicos.local'),
  ('10000000-0000-4000-8000-000000001003', 'keycloak', 'http://localhost:8080/realms/clinicos-local', 'seed-assistant', 'assistant@demo.clinicos.local'),
  ('10000000-0000-4000-8000-000000001004', 'keycloak', 'http://localhost:8080/realms/clinicos-local', 'seed-receptionist', 'reception@demo.clinicos.local'),
  ('10000000-0000-4000-8000-000000001005', 'keycloak', 'http://localhost:8080/realms/clinicos-local', 'seed-accountant', 'accounts@demo.clinicos.local')
on conflict (provider, issuer, subject) do update set
  email_at_provider = excluded.email_at_provider;

insert into memberships (tenant_id, user_id, status)
select '10000000-0000-4000-8000-000000000001', users.id, 'active'
from users
where users.id in (
  '10000000-0000-4000-8000-000000001001',
  '10000000-0000-4000-8000-000000001002',
  '10000000-0000-4000-8000-000000001003',
  '10000000-0000-4000-8000-000000001004',
  '10000000-0000-4000-8000-000000001005'
)
on conflict (tenant_id, user_id) do update set status = excluded.status;

insert into clinic_user_assignments (tenant_id, clinic_id, user_id, status)
select
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  users.id,
  'active'
from users
where users.id in (
  '10000000-0000-4000-8000-000000001001',
  '10000000-0000-4000-8000-000000001002',
  '10000000-0000-4000-8000-000000001003',
  '10000000-0000-4000-8000-000000001004',
  '10000000-0000-4000-8000-000000001005'
)
on conflict (tenant_id, clinic_id, user_id) do update set status = excluded.status;

insert into user_role_assignments (tenant_id, clinic_id, user_id, role_id)
select
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  role_map.user_id,
  roles.id
from (
  values
    ('10000000-0000-4000-8000-000000001001'::uuid, 'owner_admin'),
    ('10000000-0000-4000-8000-000000001002'::uuid, 'doctor'),
    ('10000000-0000-4000-8000-000000001003'::uuid, 'assistant'),
    ('10000000-0000-4000-8000-000000001004'::uuid, 'receptionist'),
    ('10000000-0000-4000-8000-000000001005'::uuid, 'accountant')
) role_map(user_id, role_slug)
join roles on roles.tenant_id = '10000000-0000-4000-8000-000000000001'
  and roles.slug = role_map.role_slug
on conflict do nothing;

insert into patients (
  id,
  tenant_id,
  clinic_id,
  full_name,
  phone,
  email,
  gender,
  source,
  created_by_user_id,
  updated_by_user_id
)
values (
  '10000000-0000-4000-8000-000000002001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  'Rhea Synthetic',
  '+919876543210',
  'rhea.synthetic@example.test',
  'female',
  'manual',
  '10000000-0000-4000-8000-000000001003',
  '10000000-0000-4000-8000-000000001003'
)
on conflict (id) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  email = excluded.email,
  updated_by_user_id = excluded.updated_by_user_id;
