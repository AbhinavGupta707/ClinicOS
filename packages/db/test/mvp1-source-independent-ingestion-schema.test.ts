import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LATEST_DATABASE_SCHEMA_VERSION } from "../src/schema.ts";

const migration = readFileSync(
  new URL("../migrations/0023_practitioner_appointment_ingestion.sql", import.meta.url),
  "utf8"
);
const postgresRepository = readFileSync(new URL("../src/postgres.ts", import.meta.url), "utf8");

test("MVP1 schema enables patient, practitioner, and appointment ingestion", () => {
  assert.equal(LATEST_DATABASE_SCHEMA_VERSION, "026");
  for (const table of ["migration_batches", "migration_rows", "imported_record_links"]) {
    assert.match(
      migration,
      new RegExp(
        `alter table ${table}[\\s\\S]*?'patients'[\\s\\S]*?'practitioners'[\\s\\S]*?'appointments'`,
        "u"
      )
    );
  }
});

test("MVP1 practitioner ingestion is link-only and cannot provision identity or access", () => {
  assert.match(migration, /migration_rows_practitioner_link_only_check/u);
  assert.match(migration, /resolution_action = 'link_existing'/u);
  assert.match(migration, /resolution_target_record_type = 'provider_user'/u);
  assert.match(migration, /resolution_target_record_id is not null/u);
  assert.doesNotMatch(migration, /insert into (users|memberships|clinic_user_assignments|user_role_assignments)/u);
  assert.doesNotMatch(migration, /create_new/u);
});

test("MVP1 normalized records and imported links cannot cross target types", () => {
  assert.match(migration, /migration_rows_ingestion_record_type_check/u);
  assert.match(migration, /coalesce\(normalized_record ->> 'recordType', ''\) = 'patient'/u);
  assert.match(migration, /coalesce\(normalized_record ->> 'recordType', ''\) = 'provider_user'/u);
  assert.match(migration, /coalesce\(normalized_record ->> 'recordType', ''\) = 'appointment'/u);
  assert.match(migration, /imported_record_links_ingestion_target_type_check/u);
  assert.match(
    migration,
    /import_type <> 'practitioners'[\s\S]*?target_record_type = 'provider_user'[\s\S]*?link_type = 'linked_existing'/u
  );
  assert.match(migration, /import_type <> 'appointments' or target_record_type = 'appointment'/u);
  assert.match(migration, /add column evidence_reaffirmed boolean not null default false/u);
  assert.match(migration, /migration_rows_evidence_reaffirmed_check/u);
});

test("MVP1 migration actions serialize batch transitions and guard rollback deletes", () => {
  assert.match(
    postgresRepository,
    /from migration_batches[\s\S]*?where tenant_id = \$1 and clinic_id = \$2 and id = \$3[\s\S]*?for update/u
  );
  assert.match(postgresRepository, /for update of appointments/u);
  assert.match(postgresRepository, /for update of patients/u);
  assert.match(
    postgresRepository,
    /delete from appointments[\s\S]*?row_version = 1[\s\S]*?returning id/u
  );
  assert.match(
    postgresRepository,
    /delete from patients[\s\S]*?row_version = 1[\s\S]*?returning id/u
  );
  assert.match(postgresRepository, /and migration_rows\.evidence_reaffirmed/u);
  assert.match(postgresRepository, /and not evidence_reaffirmed/u);
  assert.match(
    postgresRepository,
    /const rollbackReferences[\s\S]*?#lockImportedRecordReferenceInTransaction/u
  );
  assert.match(postgresRepository, /function compareImportedRecordReferenceLocks/u);
  assert.equal(
    postgresRepository.match(/\.sort\(compareImportedRecordReferenceLocks\)/gu)?.length,
    2
  );
  assert.match(
    postgresRepository,
    /Explicit evidence reaffirmation changes a canonical external mapping/u
  );
  assert.match(postgresRepository, /evidenceReaffirmedByBatchId/u);
  assert.match(postgresRepository, /evidenceReaffirmedByRowId/u);
  assert.match(
    postgresRepository,
    /A later committed migration reconciliation depends on this canonical external mapping/u
  );
});
