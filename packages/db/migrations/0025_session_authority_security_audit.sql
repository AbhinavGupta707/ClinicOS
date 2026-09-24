-- Durable generations, not wall-clock timestamps or a hash of current grants: a
-- revoke/regrant between requests must never resurrect an older browser session.
alter table users add column authority_generation uuid not null default gen_random_uuid();
alter table tenants add column authority_generation uuid not null default gen_random_uuid();

create function clinic_os.rotate_authority_generation()
returns trigger language plpgsql as $$
begin
  new.authority_generation := gen_random_uuid();
  return new;
end;
$$;

create trigger users_rotate_authority before insert or update on users
for each row execute function clinic_os.rotate_authority_generation();
create trigger tenants_rotate_authority before insert or update on tenants
for each row execute function clinic_os.rotate_authority_generation();

-- Invoker rights; these triggers do not bypass RLS or acquire elevated privileges.
-- Ordered IDs avoid inverted old/new locks when a row changes owner.
create function clinic_os.invalidate_user_authority()
returns trigger language plpgsql as $$
declare old_id uuid; new_id uuid; affected_id uuid;
begin
  if tg_op <> 'INSERT' then old_id := old.user_id; end if;
  if tg_op <> 'DELETE' then new_id := new.user_id; end if;
  for affected_id in select distinct id from unnest(array[old_id, new_id]) as ids(id)
    where id is not null order by id
  loop
    update public.users set authority_generation = gen_random_uuid() where id = affected_id;
  end loop;
  return null;
end;
$$;

create trigger identities_invalidate_authority after insert or update or delete on user_identities
for each row execute function clinic_os.invalidate_user_authority();
create trigger memberships_invalidate_authority after insert or update or delete on memberships
for each row execute function clinic_os.invalidate_user_authority();
create trigger clinic_assignments_invalidate_authority after insert or update or delete on clinic_user_assignments
for each row execute function clinic_os.invalidate_user_authority();
create trigger role_assignments_invalidate_authority after insert or update or delete on user_role_assignments
for each row execute function clinic_os.invalidate_user_authority();

create function clinic_os.invalidate_tenant_authority()
returns trigger language plpgsql as $$
declare old_id uuid; new_id uuid; affected_id uuid;
begin
  if tg_op <> 'INSERT' then old_id := old.tenant_id; end if;
  if tg_op <> 'DELETE' then new_id := new.tenant_id; end if;
  for affected_id in select distinct id from unnest(array[old_id, new_id]) as ids(id)
    where id is not null order by id
  loop
    update public.tenants set authority_generation = gen_random_uuid() where id = affected_id;
  end loop;
  return null;
end;
$$;

create trigger clinics_invalidate_authority after insert or update or delete on clinics
for each row execute function clinic_os.invalidate_tenant_authority();
create trigger roles_invalidate_authority after insert or update or delete on roles
for each row execute function clinic_os.invalidate_tenant_authority();

create function clinic_os.invalidate_role_permission_authority()
returns trigger language plpgsql as $$
declare old_id uuid; new_id uuid; affected_id uuid;
begin
  if tg_op <> 'INSERT' then old_id := old.role_id; end if;
  if tg_op <> 'DELETE' then new_id := new.role_id; end if;
  for affected_id in select distinct tenant_id from public.roles
    where id in (old_id, new_id) and tenant_id is not null order by tenant_id
  loop
    update public.tenants set authority_generation = gen_random_uuid() where id = affected_id;
  end loop;
  return null;
end;
$$;

create trigger role_permissions_invalidate_authority after insert or update or delete on role_permissions
for each row execute function clinic_os.invalidate_role_permission_authority();

-- Required authentication evidence can precede tenant/clinic membership. Keep it
-- out of clinical audit_events rather than inventing a tenant or weakening its RLS.
create table identity_security_audit_events (
  id uuid primary key default gen_random_uuid(),
  deduplication_key varchar(384) not null unique check (deduplication_key ~ '^[0-9a-f]{64}$'),
  payload_digest char(64) not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  schema_version smallint not null check (schema_version = 1),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object' and octet_length(canonical_payload::text) <= 8192),
  action varchar(64) not null check (action in ('auth.session.created', 'auth.session.rotated', 'auth.session.revoked',
    'auth.refresh.replay_detected', 'auth.refresh.recovery_uncertain', 'auth.mfa.denied',
    'identity.joiner.completed', 'identity.mover.completed', 'identity.leaver.completed')),
  subject varchar(255) not null,
  reason_code varchar(128) not null,
  issuer varchar(512),
  authorized_party varchar(255),
  tenant_id uuid references tenants(id) on delete restrict,
  clinic_id uuid,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  source_adapter_version varchar(64) not null,
  correlation_metadata jsonb not null default '{}' check (correlation_metadata = '{}'::jsonb),
  check (action not like 'auth.%' or (issuer is not null and authorized_party is not null)),
  check (action not like 'identity.%' or tenant_id is not null),
  check (clinic_id is null or tenant_id is not null),
  foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);
create index identity_security_audit_occurred_idx on identity_security_audit_events (occurred_at desc);
create index identity_security_audit_subject_idx on identity_security_audit_events (subject, occurred_at desc);
create index identity_security_audit_tenant_idx on identity_security_audit_events (tenant_id, occurred_at desc) where tenant_id is not null;
alter table identity_security_audit_events enable row level security;
alter table identity_security_audit_events force row level security;
create policy security_audit_key_read on identity_security_audit_events for select
using (deduplication_key = nullif(current_setting('app.security_audit_key', true), ''));
create policy security_audit_key_append on identity_security_audit_events for insert
with check (deduplication_key = nullif(current_setting('app.security_audit_key', true), ''));

create function clinic_os.deny_security_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Identity security audit is append-only' using errcode = '42501';
end;
$$;
create trigger security_audit_no_mutation before update or delete or truncate
on identity_security_audit_events for each statement
execute function clinic_os.deny_security_audit_mutation();
