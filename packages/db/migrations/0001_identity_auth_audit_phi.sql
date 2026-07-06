-- Checkpoint 1: identity, tenancy, audit, and first PHI/RLS proof.
-- Applies to PostgreSQL 16+.

create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists clinic_os;

create or replace function clinic_os.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function clinic_os.current_clinic_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.clinic_id', true), '')::uuid
$$;

create or replace function clinic_os.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function clinic_os.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  legal_name text not null,
  display_name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tenants_set_updated_at
before update on tenants
for each row execute function clinic_os.set_updated_at();

create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  display_name text not null,
  legal_name text,
  timezone text not null default 'Asia/Kolkata',
  address jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  unique (tenant_id, id)
);

create index if not exists clinics_tenant_id_idx on clinics(tenant_id);

create trigger clinics_set_updated_at
before update on clinics
for each row execute function clinic_os.set_updated_at();

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email citext,
  phone text,
  status text not null default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_email_unique_idx on users(email) where email is not null;

create trigger users_set_updated_at
before update on users
for each row execute function clinic_os.set_updated_at();

create table if not exists user_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('keycloak')),
  issuer text not null,
  subject text not null,
  email_at_provider citext,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, issuer, subject)
);

create index if not exists user_identities_user_id_idx on user_identities(user_id);

create trigger user_identities_set_updated_at
before update on user_identities
for each row execute function clinic_os.set_updated_at();

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'invited', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);

create index if not exists memberships_user_id_idx on memberships(user_id);

create trigger memberships_set_updated_at
before update on memberships
for each row execute function clinic_os.set_updated_at();

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  slug text not null,
  display_name text not null,
  description text,
  is_system_role boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, slug),
  unique (tenant_id, id)
);

create trigger roles_set_updated_at
before update on roles
for each row execute function clinic_os.set_updated_at();

create table if not exists permissions (
  key text primary key,
  display_name text not null,
  category text not null,
  description text not null,
  phi_involved boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_key text not null references permissions(key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table if not exists user_role_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  clinic_id uuid,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null,
  assigned_by_user_id uuid references users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (tenant_id, clinic_id, user_id, role_id),
  constraint user_role_assignments_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete cascade,
  constraint user_role_assignments_role_tenant_fk
    foreign key (tenant_id, role_id) references roles(tenant_id, id) on delete cascade
);

create index if not exists user_role_assignments_user_idx on user_role_assignments(user_id);
create index if not exists user_role_assignments_tenant_clinic_idx on user_role_assignments(tenant_id, clinic_id);
create unique index if not exists user_role_assignments_tenant_wide_unique_idx
  on user_role_assignments(tenant_id, user_id, role_id)
  where clinic_id is null;

create table if not exists clinic_user_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  clinic_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'invited', 'suspended', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, clinic_id, user_id),
  constraint clinic_user_assignments_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete cascade
);

create index if not exists clinic_user_assignments_user_idx on clinic_user_assignments(user_id);

create trigger clinic_user_assignments_set_updated_at
before update on clinic_user_assignments
for each row execute function clinic_os.set_updated_at();

create table if not exists break_glass_accesses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  clinic_id uuid,
  user_id uuid not null references users(id) on delete cascade,
  patient_id uuid,
  reason text not null,
  status text not null default 'requested' check (status in ('requested', 'approved', 'denied', 'expired', 'revoked')),
  requested_at timestamptz not null default now(),
  approved_by_user_id uuid references users(id) on delete set null,
  approved_at timestamptz,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint break_glass_accesses_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete cascade
);

create index if not exists break_glass_accesses_lookup_idx
  on break_glass_accesses(tenant_id, clinic_id, user_id, patient_id, status, expires_at);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid,
  actor_type text not null check (actor_type in ('user', 'system', 'integration', 'ai')),
  actor_id text not null,
  action text not null,
  category text not null,
  risk_level text not null check (risk_level in ('low', 'medium', 'high', 'critical')),
  phi_involved boolean not null,
  resource_type text,
  resource_id text,
  patient_id uuid,
  ip_address inet,
  user_agent text,
  correlation_id text,
  metadata jsonb not null default '{}',
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint audit_events_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists audit_events_tenant_occurred_at_idx on audit_events(tenant_id, occurred_at desc);
create index if not exists audit_events_patient_idx on audit_events(tenant_id, patient_id, occurred_at desc)
  where patient_id is not null;
create index if not exists audit_events_action_idx on audit_events(action, occurred_at desc);

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  full_name text not null,
  phone text,
  email citext,
  date_of_birth date,
  gender text not null default 'unknown' check (gender in ('female', 'male', 'other', 'unknown')),
  abha_address text,
  source text not null default 'manual' check (source in ('manual', 'imported', 'external_system')),
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint patients_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

alter table audit_events
  add constraint audit_events_patient_fk foreign key (tenant_id, patient_id)
  references patients(tenant_id, id) on delete restrict;

alter table break_glass_accesses
  add constraint break_glass_accesses_patient_fk foreign key (tenant_id, patient_id)
  references patients(tenant_id, id) on delete restrict;

create index if not exists patients_tenant_clinic_name_idx on patients(tenant_id, clinic_id, lower(full_name));
create index if not exists patients_tenant_phone_idx on patients(tenant_id, phone) where phone is not null;
create index if not exists patients_tenant_email_idx on patients(tenant_id, email) where email is not null;

create trigger patients_set_updated_at
before update on patients
for each row execute function clinic_os.set_updated_at();

alter table audit_events enable row level security;
alter table audit_events force row level security;

drop policy if exists audit_events_tenant_isolation on audit_events;
create policy audit_events_tenant_isolation on audit_events
  using (tenant_id = clinic_os.current_tenant_id())
  with check (tenant_id = clinic_os.current_tenant_id());

alter table patients enable row level security;
alter table patients force row level security;

drop policy if exists patients_tenant_clinic_isolation on patients;
create policy patients_tenant_clinic_isolation on patients
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (
      clinic_os.current_clinic_id() is null
      or clinic_id = clinic_os.current_clinic_id()
    )
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (
      clinic_os.current_clinic_id() is null
      or clinic_id = clinic_os.current_clinic_id()
    )
  );

comment on table patients is 'First PHI table for Checkpoint 1. Protected by tenant/clinic RLS plus app authorization/audit.';
comment on policy patients_tenant_clinic_isolation on patients is
  'Requires transaction-local app.tenant_id and optional app.clinic_id via set_config before tenant-owned queries.';
