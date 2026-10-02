-- Keep the ABA-resistant generation; separately bind bearer authentication time
-- to the latest authority mutation. The cutoff and generation commit or roll back
-- together. This is a mutation-time cutoff, not a PostgreSQL commit timestamp.
alter table users add column authentication_valid_after timestamptz not null default clock_timestamp();
alter table tenants add column authentication_valid_after timestamptz not null default clock_timestamp();
create or replace function clinic_os.rotate_authority_generation()
returns trigger language plpgsql as $$
begin
  new.authority_generation := gen_random_uuid();
  new.authentication_valid_after := greatest(old.authentication_valid_after + interval '1 microsecond', clock_timestamp());
  return new;
end;
$$;
