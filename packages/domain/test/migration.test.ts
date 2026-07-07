import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePatientMigrationCsv,
  summarizeMigrationBatchState,
  validatePatientImportRow
} from "../src/index.ts";

test("patient migration CSV validation separates bad rows from good rows", () => {
  const rows = parsePatientMigrationCsv(
    [
      "external_reference,full_name,phone,email,date_of_birth,gender,source_type",
      "legacy-1,Asha Import,+91 98765 11111,asha@example.com,1984-02-03,female,practo",
      "legacy-2,,123,bad-email,not-a-date,unknown,google"
    ].join("\n")
  );

  assert.equal(rows.length, 2);
  const valid = validatePatientImportRow(rows[0]);
  const invalid = validatePatientImportRow(rows[1]);

  assert.equal(valid.validationErrors.length, 0);
  assert.equal(valid.normalizedRecord?.source, "imported");
  assert.equal(valid.normalizedRecord?.sourceDetail.originalSource, "practo");
  assert.equal(invalid.normalizedRecord, null);
  assert.deepEqual(
    invalid.validationErrors.map((error) => error.field),
    ["fullName", "phone", "email", "dateOfBirth"]
  );
});

test("migration batch state summarizes ready conflict and invalid rows", () => {
  assert.equal(
    summarizeMigrationBatchState({
      totalRows: 3,
      invalidRows: 1,
      conflictRows: 1,
      readyRows: 1
    }),
    "needs_review"
  );
  assert.equal(
    summarizeMigrationBatchState({
      totalRows: 2,
      invalidRows: 1,
      conflictRows: 0,
      readyRows: 1
    }),
    "ready_to_commit"
  );
});
