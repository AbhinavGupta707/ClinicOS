import test from "node:test";
import assert from "node:assert/strict";
import {
  asUuid,
  differingAppointmentImportFields,
  differingPatientImportFields,
  parseAppointmentMigrationCsv,
  parsePatientMigrationCsv,
  parsePractitionerMigrationCsv,
  summarizeMigrationBatchState,
  validateAppointmentImportRow,
  validatePractitionerImportRow,
  validatePatientImportRow
} from "../src/index.ts";

test("patient migration requires a stable external reference", () => {
  const [draft] = parsePatientMigrationCsv(
    ["external_reference,full_name,phone", ",Asha Import,+91 98765 11111"].join("\n")
  );

  const invalid = validatePatientImportRow(draft);
  assert.equal(invalid.normalizedRecord, null);
  assert.deepEqual(
    invalid.validationErrors.map((issue) => issue.field),
    ["externalReference"]
  );
});

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

test("patient import replay comparison reports only changed canonical fields", () => {
  const [draft] = parsePatientMigrationCsv(
    [
      "external_reference,full_name,phone,email,date_of_birth,gender",
      "legacy-1,Asha Import,+91 98765 11111,asha@example.com,1984-02-03,female"
    ].join("\n")
  );
  const normalized = validatePatientImportRow(draft).normalizedRecord;
  assert.ok(normalized);

  assert.deepEqual(
    differingPatientImportFields(normalized, {
      fullName: "Asha Import",
      phone: "+919876511111",
      email: "asha@example.com",
      dateOfBirth: "1984-02-03",
      gender: "female"
    }),
    []
  );
  assert.deepEqual(
    differingPatientImportFields(normalized, {
      fullName: "Asha Changed",
      phone: "+919876511111",
      email: null,
      dateOfBirth: "1984-02-03",
      gender: "female"
    }),
    ["fullName", "email"]
  );
});

test("practitioner migration requires stable reviewable link evidence", () => {
  const rows = parsePractitionerMigrationCsv(
    [
      "external_reference,display_name,email,phone",
      "doctor-7,Dr Rhea Example,rhea@example.com,+91 98765 10000",
      ",,not-an-email,123"
    ].join("\n")
  );

  const valid = validatePractitionerImportRow(rows[0]);
  const invalid = validatePractitionerImportRow(rows[1]);
  assert.deepEqual(valid.normalizedRecord, {
    recordType: "provider_user",
    externalReference: "doctor-7",
    displayName: "Dr Rhea Example",
    email: "rhea@example.com",
    phone: "+91 98765 10000",
    sourceDetail: {}
  });
  assert.equal(invalid.normalizedRecord, null);
  assert.deepEqual(
    invalid.validationErrors.map((issue) => issue.field),
    ["externalReference", "displayName", "email", "phone"]
  );
});

test("appointment migration accepts only explicit canonical references, statuses, sources, and instants", () => {
  const rows = parseAppointmentMigrationCsv(
    [
      "external_reference,patient_external_reference,provider_external_reference,appointment_type_code,chair_code,start_at,end_at,status,source",
      "visit-1,patient-1,doctor-7,consultation,chair-1,2026-08-30T10:00:00+05:30,2026-08-30T10:30:00+05:30,booked,practo",
      "visit-2,,,consultation,,2026-08-30T10:00:00,2026-08-30T09:30:00Z,checked_in,walk_in",
      "visit-3,patient-1,doctor-7,consultation,,2026-08-30T10:00:00Z,2026-08-30T10:30:00Z,booked,"
    ].join("\n")
  );

  const valid = validateAppointmentImportRow(rows[0]);
  const invalid = validateAppointmentImportRow(rows[1]);
  const missingSource = validateAppointmentImportRow(rows[2]);
  assert.deepEqual(valid.normalizedRecord, {
    recordType: "appointment",
    externalReference: "visit-1",
    patientExternalReference: "patient-1",
    providerExternalReference: "doctor-7",
    appointmentTypeCode: "consultation",
    chairCode: "chair-1",
    startAt: "2026-08-30T04:30:00.000Z",
    endAt: "2026-08-30T05:00:00.000Z",
    status: "booked",
    source: "practo",
    reason: null,
    notes: null,
    sourceDetail: { rawSource: "practo", rawStatus: "booked" }
  });
  assert.equal(invalid.normalizedRecord, null);
  assert.deepEqual(
    invalid.validationErrors.map((issue) => [issue.field, issue.code]),
    [
      ["patientExternalReference", "required"],
      ["providerExternalReference", "required"],
      ["startAt", "invalid_instant"],
      ["status", "unsupported_status"],
      ["source", "unsupported_source"]
    ]
  );
  assert.equal(missingSource.normalizedRecord, null);
  assert.deepEqual(
    missingSource.validationErrors.map((issue) => [issue.field, issue.code]),
    [["source", "unsupported_source"]]
  );
});

test("appointment migration rejects non-RFC3339 and impossible calendar instants", () => {
  const base = {
    externalReference: "visit-invalid-date",
    patientExternalReference: "patient-1",
    providerExternalReference: "doctor-7",
    appointmentTypeCode: "consultation",
    chairCode: null,
    endAt: "2026-03-02T10:30:00Z",
    status: "booked",
    source: "practo",
    reason: null,
    notes: null,
    sourceDetail: {}
  };

  for (const startAt of [
    "2026-02-30T10:00:00Z",
    "2025-02-29T10:00:00Z",
    "2026-2-03T10:00:00Z",
    "2026-03-02 10:00:00Z",
    "2026-03-02T24:00:00Z",
    "2026-03-02T10:00:60Z"
  ]) {
    const result = validateAppointmentImportRow({
      ...base,
      rowNumber: 1,
      rawPayload: { startAt },
      startAt
    });
    assert.equal(result.normalizedRecord, null, startAt);
    assert.ok(
      result.validationErrors.some(
        (issue) => issue.field === "startAt" && issue.code === "invalid_instant"
      ),
      startAt
    );
  }

  const leapDay = validateAppointmentImportRow({
    ...base,
    rowNumber: 1,
    rawPayload: {},
    startAt: "2024-02-29T10:00:00.123456Z",
    endAt: "2024-02-29T10:30:00.123456Z"
  });
  assert.equal(leapDay.validationErrors.length, 0);
  assert.equal(leapDay.normalizedRecord?.startAt, "2024-02-29T10:00:00.123Z");
});

test("appointment replay comparison names only changed canonical fields", () => {
  const [draft] = parseAppointmentMigrationCsv(
    [
      "external_reference,patient_external_reference,provider_external_reference,appointment_type_code,start_at,end_at,status,source",
      "visit-1,patient-1,doctor-7,consultation,2026-08-30T10:00:00Z,2026-08-30T10:30:00Z,completed,practo"
    ].join("\n")
  );
  const normalized = validateAppointmentImportRow(draft).normalizedRecord;
  assert.ok(normalized);
  const patientId = asUuid("10000000-0000-4000-8000-000000000001");
  const providerUserId = asUuid("10000000-0000-4000-8000-000000000002");
  const appointmentTypeId = asUuid("10000000-0000-4000-8000-000000000003");

  assert.deepEqual(
    differingAppointmentImportFields(
      normalized,
      {
        patientId,
        providerUserId,
        appointmentTypeId,
        chairId: null,
        startAt: normalized.startAt,
        endAt: normalized.endAt,
        status: normalized.status,
        source: normalized.source
      },
      { patientId, providerUserId, appointmentTypeId, chairId: null }
    ),
    []
  );
  assert.deepEqual(
    differingAppointmentImportFields(
      normalized,
      {
        patientId,
        providerUserId,
        appointmentTypeId,
        chairId: null,
        startAt: normalized.startAt,
        endAt: "2026-08-30T11:00:00.000Z",
        status: "cancelled",
        source: normalized.source
      },
      { patientId, providerUserId, appointmentTypeId, chairId: null }
    ),
    ["endAt", "status"]
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
