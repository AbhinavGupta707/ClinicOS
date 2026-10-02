import assert from "node:assert/strict";
import test from "node:test";
import { patientSourceFields, parsePatientSourceFields } from "../src/patient-source-context.ts";
test("source context is a closed bounded evidence object preserving original nonblank text", () => {
  const text = "  Clinical source only\nनमस्ते\t  ";
  assert.deepEqual(patientSourceFields({ "Medical History": text, "Patient Notes": "  " }), {
    "Medical History": text
  });
  assert.deepEqual(parsePatientSourceFields(JSON.stringify({ "Medical History": text })), {
    "Medical History": text
  });
  for (const value of [
    null,
    [],
    { "National Id": "not retained" },
    { "Medical History": 42 },
    { "Patient Notes": "x".repeat(8193) },
    { Remarks: "bad\u0000text" }
  ])
    assert.throws(() => patientSourceFields(value));
  assert.throws(
    () =>
      patientSourceFields({
        "Medical History": "न".repeat(8000),
        "Patient Notes": "न".repeat(8000)
      }),
    /32 KiB/
  );
  for (const value of [undefined, "invalid json", "[]"])
    assert.throws(() => parsePatientSourceFields(value));
});

import { parsePatientMigrationCsv, validatePatientImportRow } from "../src/migration.ts";
test("context phones preserve explicit country codes and reject misplaced plus signs", () => {
  const parse = (phone: string, profile = "practo_ray_patients_context_v2") =>
    validatePatientImportRow(
      parsePatientMigrationCsv(
        `external_reference,full_name,phone,source_format,source_context\nx,Synthetic,${phone},${profile},{}`
      )[0]!
    );
  assert.equal(parse("+1234567890").normalizedRecord?.phone, "+1234567890");
  assert.equal(parse("9999001234").normalizedRecord?.phone, "+919999001234");
  for (const phone of [
    "++919999001234",
    "91+9999001234",
    "+9999001234+",
    "not-a-phone",
    "+01234567890",
    "1234567890"
  ])
    assert.equal(parse(phone).normalizedRecord, null, phone);
  assert.equal(parse("").normalizedRecord?.phone, "");
  assert.equal(
    parse("+1234567890", "practo_ray_patients_v1").normalizedRecord?.phone,
    "+1234567890"
  );
});
