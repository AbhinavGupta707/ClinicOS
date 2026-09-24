-- Issuer-bound read-only identity bootstrap. Existing identity rows are not rewritten.
-- Run as the migration owner; no SECURITY DEFINER or BYPASSRLS is introduced.
-- app.identity_* must be supplied only from a verified, accepted token.
create or replace function clinic_os.current_identity_issuer()
returns text language sql stable as $$
  select nullif(current_setting('app.identity_issuer', true), '')
$$;

alter table clinics enable row level security;
alter table clinics force row level security;

drop policy if exists clinics_tenant_clinic_isolation on clinics;
create policy clinics_tenant_clinic_isolation on clinics
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_os.current_clinic_id() is null or id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_os.current_clinic_id() is null or id = clinic_os.current_clinic_id())
  );

alter table memberships enable row level security;
alter table memberships force row level security;

drop policy if exists memberships_tenant_isolation on memberships;
create policy memberships_tenant_isolation on memberships
  using (tenant_id = clinic_os.current_tenant_id())
  with check (tenant_id = clinic_os.current_tenant_id());

alter table roles enable row level security;
alter table roles force row level security;

drop policy if exists roles_tenant_isolation on roles;
create policy roles_tenant_isolation on roles
  using (tenant_id = clinic_os.current_tenant_id())
  with check (tenant_id = clinic_os.current_tenant_id());

alter table user_role_assignments enable row level security;
alter table user_role_assignments force row level security;

drop policy if exists user_role_assignments_tenant_clinic_isolation on user_role_assignments;
create policy user_role_assignments_tenant_clinic_isolation on user_role_assignments
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (
      clinic_os.current_clinic_id() is null
      or clinic_id is null
      or clinic_id = clinic_os.current_clinic_id()
    )
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (
      clinic_os.current_clinic_id() is null
      or clinic_id is null
      or clinic_id = clinic_os.current_clinic_id()
    )
  );

alter table clinic_user_assignments enable row level security;
alter table clinic_user_assignments force row level security;

drop policy if exists clinic_user_assignments_tenant_clinic_isolation on clinic_user_assignments;
create policy clinic_user_assignments_tenant_clinic_isolation on clinic_user_assignments
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_os.current_clinic_id() is null or clinic_id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_os.current_clinic_id() is null or clinic_id = clinic_os.current_clinic_id())
  );

create policy memberships_verified_identity_read on memberships
  for select using (
    user_id in (
      select user_id from user_identities
      where provider = 'keycloak'
        and issuer = (select clinic_os.current_identity_issuer())
        and subject = (select clinic_os.current_identity_subject())
    )
  );

create policy clinic_user_assignments_verified_identity_read on clinic_user_assignments
  for select using (
    user_id in (
      select user_id from user_identities
      where provider = 'keycloak'
        and issuer = (select clinic_os.current_identity_issuer())
        and subject = (select clinic_os.current_identity_subject())
    )
  );

create policy user_role_assignments_verified_identity_read on user_role_assignments
  for select using (
    user_id in (
      select user_id from user_identities
      where provider = 'keycloak'
        and issuer = (select clinic_os.current_identity_issuer())
        and subject = (select clinic_os.current_identity_subject())
    )
  );

create policy clinics_verified_identity_read on clinics
  for select using (
    exists (
      select 1 from clinic_user_assignments
      join user_identities on user_identities.user_id = clinic_user_assignments.user_id
      where clinic_user_assignments.tenant_id = clinics.tenant_id
        and clinic_user_assignments.clinic_id = clinics.id
        and user_identities.provider = 'keycloak'
        and user_identities.issuer = (select clinic_os.current_identity_issuer())
        and user_identities.subject = (select clinic_os.current_identity_subject())
    )
  );

create policy roles_verified_identity_read on roles
  for select using (
    exists (
      select 1 from user_role_assignments
      join user_identities on user_identities.user_id = user_role_assignments.user_id
      where user_role_assignments.tenant_id = roles.tenant_id
        and user_role_assignments.role_id = roles.id
        and user_identities.provider = 'keycloak'
        and user_identities.issuer = (select clinic_os.current_identity_issuer())
        and user_identities.subject = (select clinic_os.current_identity_subject())
    )
  );

comment on function clinic_os.current_identity_issuer() is
  'Exact verified issuer paired with subject for transaction-local read-only identity bootstrap.';
