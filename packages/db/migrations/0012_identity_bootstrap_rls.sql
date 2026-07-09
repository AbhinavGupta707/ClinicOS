-- Checkpoint 11: permit read-only identity bootstrap before a tenant context is known.
-- The application sets app.identity_subject from a cryptographically verified Keycloak token.

create or replace function clinic_os.current_identity_subject()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.identity_subject', true), '')
$$;

drop policy if exists memberships_tenant_isolation on memberships;
create policy memberships_tenant_isolation on memberships
  using (
    tenant_id = clinic_os.current_tenant_id()
    or user_id in (
      select user_id from user_identities
      where provider = 'keycloak'
        and subject = clinic_os.current_identity_subject()
    )
  )
  with check (tenant_id = clinic_os.current_tenant_id());

drop policy if exists clinic_user_assignments_tenant_clinic_isolation on clinic_user_assignments;
create policy clinic_user_assignments_tenant_clinic_isolation on clinic_user_assignments
  using (
    (
      tenant_id = clinic_os.current_tenant_id()
      and (clinic_os.current_clinic_id() is null or clinic_id = clinic_os.current_clinic_id())
    )
    or user_id in (
      select user_id from user_identities
      where provider = 'keycloak'
        and subject = clinic_os.current_identity_subject()
    )
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_os.current_clinic_id() is null or clinic_id = clinic_os.current_clinic_id())
  );

drop policy if exists user_role_assignments_tenant_clinic_isolation on user_role_assignments;
create policy user_role_assignments_tenant_clinic_isolation on user_role_assignments
  using (
    (
      tenant_id = clinic_os.current_tenant_id()
      and (
        clinic_os.current_clinic_id() is null
        or clinic_id is null
        or clinic_id = clinic_os.current_clinic_id()
      )
    )
    or user_id in (
      select user_id from user_identities
      where provider = 'keycloak'
        and subject = clinic_os.current_identity_subject()
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

drop policy if exists clinics_tenant_clinic_isolation on clinics;
create policy clinics_tenant_clinic_isolation on clinics
  using (
    (
      tenant_id = clinic_os.current_tenant_id()
      and (clinic_os.current_clinic_id() is null or id = clinic_os.current_clinic_id())
    )
    or exists (
      select 1
      from clinic_user_assignments
      join user_identities on user_identities.user_id = clinic_user_assignments.user_id
      where clinic_user_assignments.tenant_id = clinics.tenant_id
        and clinic_user_assignments.clinic_id = clinics.id
        and user_identities.provider = 'keycloak'
        and user_identities.subject = clinic_os.current_identity_subject()
    )
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_os.current_clinic_id() is null or id = clinic_os.current_clinic_id())
  );

drop policy if exists roles_tenant_isolation on roles;
create policy roles_tenant_isolation on roles
  using (
    tenant_id = clinic_os.current_tenant_id()
    or exists (
      select 1
      from user_role_assignments
      join user_identities on user_identities.user_id = user_role_assignments.user_id
      where user_role_assignments.tenant_id = roles.tenant_id
        and user_role_assignments.role_id = roles.id
        and user_identities.provider = 'keycloak'
        and user_identities.subject = clinic_os.current_identity_subject()
    )
  )
  with check (tenant_id = clinic_os.current_tenant_id());

comment on function clinic_os.current_identity_subject() is
  'Transaction-local verified identity subject used only for pre-tenant, read-only access resolution.';
