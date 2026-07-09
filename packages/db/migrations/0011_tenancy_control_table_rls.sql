-- Checkpoint 11: close tenant-isolation gaps on tenancy and authorization control tables.
-- Historical migrations remain immutable; this migration is safe for upgrades and clean builds.

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

comment on policy clinics_tenant_clinic_isolation on clinics is
  'Requires transaction-local tenant context and, when present, limits access to the active clinic.';
comment on policy memberships_tenant_isolation on memberships is
  'Requires transaction-local tenant context for membership reads and writes.';
comment on policy roles_tenant_isolation on roles is
  'Requires transaction-local tenant context; runtime access to unscoped roles is intentionally denied.';
comment on policy user_role_assignments_tenant_clinic_isolation on user_role_assignments is
  'Requires transaction-local tenant context and limits clinic-specific assignments to the active clinic.';
comment on policy clinic_user_assignments_tenant_clinic_isolation on clinic_user_assignments is
  'Requires transaction-local tenant and clinic context for clinic assignment reads and writes.';
