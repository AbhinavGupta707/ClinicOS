-- Checkpoint 11: allow the runtime role to read migration state for truthful startup/readiness.
-- Migration history remains immutable to the application role.

revoke all on table flyway_schema_history from clinic_os_runtime;
grant select on table flyway_schema_history to clinic_os_runtime;
