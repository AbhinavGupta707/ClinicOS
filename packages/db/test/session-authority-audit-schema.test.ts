import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../migrations/0025_session_authority_security_audit.sql", import.meta.url),
  "utf8"
);
test("canonical migration removes inherited API audit privileges before any separate grant recipe", () => {
  assert.match(migration, /revoke all on table identity_security_audit_events from public;/);
  assert.match(
    migration,
    /revoke all on table identity_security_audit_events from clinic_os_runtime;/
  );
  assert.match(
    migration,
    /revoke all on table identity_security_audit_events from clinic_os_worker;/
  );
  assert.match(
    migration,
    /grant select, insert on table identity_security_audit_events to clinic_os_worker;/
  );
  assert.doesNotMatch(migration, /grant .+identity_security_audit_events to clinic_os_runtime/);
  assert.doesNotMatch(migration, /security definer/i);
});
