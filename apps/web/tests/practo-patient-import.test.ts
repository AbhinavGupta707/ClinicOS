import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  parsePatientMigrationCsv,
  validatePatientImportRow,
  migrationSourceFormat
} from "@clinic-os/domain";
import { PRACTO_PATIENT_HEADERS, preparePractoPatients } from "../lib/practo-patient-import";
import {
  getInitialImportRunStep,
  isPractoPatientTrial,
  normalizeLiveMigrationBatch
} from "../lib/cp7-integration-ops";

const patient = {
  "Patient Number": "00017",
  "Patient Name": "Synthetic O'Neil, Test",
  "Mobile Number": "+91 9000000017",
  "Email Address": "synthetic@example.test",
  "Date of Birth": "1992-02-29",
  Gender: "Female",
  "Patient Notes": "EXCLUDED_NOTE\nSecond line",
  "National Id": "EXCLUDED_ID",
  "Medical History": 'EXCLUDED_HISTORY "quoted"',
  "Contact Number": "+91 8000000017"
};
function csv(
  rows: Record<string, string>[] = [patient],
  headers: readonly string[] = PRACTO_PATIENT_HEADERS
) {
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((row) => row.map((value) => '"' + value.replaceAll('"', '""') + '"').join(","))
    .join("\r\n");
}
function canonical(input: string) {
  const result = preparePractoPatients(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result;
}

describe("Practo patient preparation before durable staging", () => {
  it("prepares the supplied synthetic operator rehearsal file", () => {
    const result = canonical(
      readFileSync(
        new URL("../../../tests/fixtures/practo/patients-synthetic.csv", import.meta.url),
        "utf8"
      )
    );
    expect(result.rowCount).toBe(2);
    expect(
      parsePatientMigrationCsv(result.csv).every(
        (draft) => validatePatientImportRow(draft).validationErrors.length === 0
      )
    ).toBe(true);
    expect(result.csv).not.toContain("EXCLUDED");
  });
  it("minimizes the upload and preserves identity through canonical parsing/validation", () => {
    const result = canonical(csv());
    expect(result.rowCount).toBe(1);
    expect(result.excludedFieldsWithValues).toEqual([
      "Contact Number",
      "National Id",
      "Medical History",
      "Patient Notes"
    ]);
    expect(result.csv).not.toMatch(/EXCLUDED|8000000017|Medical History|Patient Notes/u);
    const draft = parsePatientMigrationCsv(result.csv)[0]!;
    expect(Object.keys(draft.rawPayload)).toEqual([
      "externalReference",
      "fullName",
      "phone",
      "email",
      "dateOfBirth",
      "gender",
      "sourceType",
      "sourceFormat"
    ]);
    expect(validatePatientImportRow(draft)).toMatchObject({
      validationErrors: [],
      normalizedRecord: {
        externalReference: "00017",
        fullName: "Synthetic O'Neil, Test",
        gender: "female",
        dateOfBirth: "1992-02-29",
        source: "imported",
        sourceDetail: { originalSource: "imported", rawSource: "imported" }
      }
    });
  });
  it("accepts BOM, reordered headers, CRLF, embedded commas, quotes and newlines", () => {
    expect(canonical("\uFEFF" + csv([patient], [...PRACTO_PATIENT_HEADERS].reverse())).csv).toBe(
      canonical(csv()).csv
    );
  });
  it("retains literal apostrophes and leading zeros in identifiers", () => {
    const result = canonical(csv([{ ...patient, "Patient Number": "'00017'" }]));
    expect(parsePatientMigrationCsv(result.csv)[0]!.externalReference).toBe("'00017'");
  });
  it.each(["", " 00017", "00017 ", "000\t17", "000\n17"])(
    "blocks ambiguous ID %j instead of normalizing it",
    (id) => {
      expect(preparePractoPatients(csv([{ ...patient, "Patient Number": id }]))).toMatchObject({
        ok: false,
        message: expect.stringContaining("Patient Number")
      });
    }
  );
  it.each(["29/02/1992", "'1992-02-29'", "1991-02-29", "0000-01-01", "2020-13-01"])(
    "does not guess DOB %j",
    (dob) => {
      expect(preparePractoPatients(csv([{ ...patient, "Date of Birth": dob }])).ok).toBe(false);
    }
  );
  it("blocks unknown gender instead of silently discarding it", () => {
    expect(
      preparePractoPatients(csv([{ ...patient, Gender: "unsupported-secret-value" }]))
    ).toEqual({ ok: false, message: expect.stringContaining("verified mapping") });
    expect(
      JSON.stringify(
        preparePractoPatients(csv([{ ...patient, Gender: "unsupported-secret-value" }]))
      )
    ).not.toContain("unsupported-secret-value");
  });
  it("does not derive DOB from Age or invent an alternate phone", () => {
    const result = canonical(
      csv([{ ...patient, "Mobile Number": "", "Date of Birth": "", Gender: "", Age: "34" }])
    );
    const draft = parsePatientMigrationCsv(result.csv)[0]!;
    expect(draft).toMatchObject({ phone: "", dateOfBirth: "", gender: "unknown" });
    expect(validatePatientImportRow(draft).validationErrors).toContainEqual(
      expect.objectContaining({ field: "phone", code: "required" })
    );
  });
  it("keeps duplicates for authoritative conflict review", () => {
    expect(canonical(csv([patient, patient])).rowCount).toBe(2);
  });
  it("accepts 100 rows and rejects the whole 101-row file", () => {
    expect(canonical(csv(Array.from({ length: 100 }, () => patient))).rowCount).toBe(100);
    expect(preparePractoPatients(csv(Array.from({ length: 101 }, () => patient)))).toMatchObject({
      ok: false,
      message: expect.stringContaining("nothing was truncated")
    });
  });
  it.each([
    "",
    "Date,Patient Number,Notes\n2030-01-01,123,private",
    csv([], [...PRACTO_PATIENT_HEADERS.slice(1), "Patient Name"]),
    csv() + ",extra",
    csv().slice(0, -1),
    csv().replace('"Patient Number"', '"Patient Number"x'),
    csv().replace('"Patient Number"', 'Pat"ient Number'),
    csv() + "\0",
    csv() + "\ufffd",
    "x".repeat(256_001),
    csv([{ ...patient, "Patient Notes": "x".repeat(32_001) }]),
    csv([{}]),
    csv([])
  ])("rejects malformed, empty, unsupported or excessive content", (input) => {
    const result = preparePractoPatients(input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/EXCLUDED|synthetic@example/u);
  });
  it("does not skip all-empty records or malformed widths", () => {
    expect(preparePractoPatients(csv() + "\n" + ",".repeat(20)).ok).toBe(false);
    expect(preparePractoPatients(csv() + "\nshort,row").ok).toBe(false);
    expect(preparePractoPatients(csv() + "\n\n").ok).toBe(false);
    expect(preparePractoPatients(csv().replace("\r\n", "\r\n\r\n")).ok).toBe(false);
    expect(preparePractoPatients(csv() + "\r\n").ok).toBe(true);
  });
  it("retains patient-only scope after canonical storage and run reload", () => {
    const draft = parsePatientMigrationCsv(canonical(csv()).csv)[0]!;
    const batch = normalizeLiveMigrationBatch({
      batch: { id: "batch-1", state: "committed", importType: "patients", committedRowCount: 1 },
      rows: [
        {
          id: "row-1",
          rowNumber: 2,
          importType: "patients",
          status: "committed",
          sourceFormat: migrationSourceFormat("patients", draft.rawPayload)
        }
      ]
    });
    expect(batch).not.toBeNull();
    expect(isPractoPatientTrial([batch!])).toBe(true);
    expect(getInitialImportRunStep([batch!])).toBe("patients");
    expect(
      migrationSourceFormat("patients", { sourceFormat: "private arbitrary source value" })
    ).toBeUndefined();
    expect(migrationSourceFormat("appointments", draft.rawPayload)).toBeUndefined();
  });
});
