import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  APPOINTMENT_HEADERS,
  LIMITS,
  PATIENT_HEADERS,
  main,
  parseCsv,
  profileExports
} from "./practo-export-profile.mjs";

const sensitive = "SYNTHETIC_PRIVATE_CANARY_OnlyForTests";
function csv(headers, rows, newline = "\n") {
  const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return [headers, ...rows.map((row) => headers.map((key) => row[key] ?? ""))]
    .map((row) => row.map(quote).join(","))
    .join(newline);
}
const patient = {
  "Patient Number": "0001",
  "Patient Name": sensitive,
  "Mobile Number": "+919000000001",
  "Date of Birth": "'2000-02-29'"
};
const appointment = {
  Date: "'2030-04-20 11:00:00'",
  "Patient Number": "0001",
  "Patient Name": sensitive,
  DoctorName: "Synthetic Doctor",
  Status: "'Scheduled'",
  "Checked In At": "'2030-04-20 10:55:00'",
  "Checked Out At": "'2030-04-20 11:25:00'"
};
function profile(patients = [patient], appointments = [appointment]) {
  return profileExports(csv(PATIENT_HEADERS, patients), csv(APPOINTMENT_HEADERS, appointments));
}

test("reported header shape and scalar wrappers produce counts, never an import approval", () => {
  const report = profile();
  assert.equal(report.importReady, false);
  assert.equal(report.patients.rows, 1);
  assert.equal(report.patients.dateOfBirth.validIsoDate, 1);
  assert.equal(report.appointments.date.validLocalDateTime, 1);
  assert.equal(report.appointments.date.apostropheWrapped, 1);
  assert.equal(report.appointments.statuses.scheduled, 1);
  assert.equal(report.appointments.unmatchedPatientNumber, 0);
  assert.equal(report.appointments.checkedOutBeforeCheckedIn, 0);
  assert.doesNotMatch(
    JSON.stringify(report),
    /2030|2000|0001|9000000001|Synthetic Doctor|SYNTHETIC_PRIVATE/
  );
  assert.ok(report.unresolved.includes("appointment_id_absent"));
  assert.ok(report.unresolved.includes("scheduled_end_or_duration_absent"));
});

test("CSV preserves escaped quotes, commas, newlines, apostrophes, BOM and CRLF", () => {
  const text = '\uFEFFa,b\r\n"O\'Brien, example","line 1\r\nline 2 ""quoted"""\r\n';
  assert.deepEqual(parseCsv(text), [
    ["a", "b"],
    ["O'Brien, example", 'line 1\r\nline 2 "quoted"']
  ]);
  assert.equal(
    profile([{ ...patient, "Patient Notes": 'Synthetic, multiline\n"note"' }]).patients.rows,
    1
  );
  assert.deepEqual(parseCsv('a,b\n\n,\n"",""\n'), [
    ["a", "b"],
    ["", ""],
    ["", ""]
  ]);
});

for (const text of [
  'a,b\n"open',
  'a,b\nstray"quote,x',
  'a,b\n"closed"tail,x',
  'a,b\n"closed" ,x'
]) {
  test(`malformed CSV case ${JSON.stringify(text)} fails closed`, () => {
    assert.throws(() => parseCsv(text), /^Error: malformed_csv$/);
  });
}

test("wrong delimiter, duplicate, missing, extra headers and row widths fail closed", () => {
  for (const headers of [
    PATIENT_HEADERS.slice(1),
    [...PATIENT_HEADERS, sensitive],
    PATIENT_HEADERS.map((value, index) => (index === 1 ? "Patient Number" : value))
  ]) {
    assert.throws(
      () => profileExports(csv(headers, []), csv(APPOINTMENT_HEADERS, [])),
      /^Error: header_mismatch$/
    );
  }
  assert.throws(
    () => profileExports(PATIENT_HEADERS.join(";"), csv(APPOINTMENT_HEADERS, [])),
    /header_mismatch/
  );
  assert.throws(
    () => profileExports(`${PATIENT_HEADERS.join(",")}\nshort,row`, csv(APPOINTMENT_HEADERS, [])),
    /row_width_mismatch/
  );
  assert.throws(
    () => profileExports(`${csv(PATIENT_HEADERS, [patient])},extra`, csv(APPOINTMENT_HEADERS, [])),
    /row_width_mismatch/
  );
});

test("reordered headers map by name and header-only files report zero rows", () => {
  const report = profileExports(
    csv([...PATIENT_HEADERS].reverse(), [patient]),
    csv([...APPOINTMENT_HEADERS].reverse(), [appointment])
  );
  assert.equal(report.patients.headersReordered, true);
  assert.equal(report.appointments.headersReordered, true);
  assert.equal(report.appointments.unmatchedPatientNumber, 0);
  assert.equal(profile([], []).patients.rows, 0);
  assert.equal(profile([], []).importReady, false);
});

test("identifier diagnostics preserve leading zeros and apostrophes without merging identities", () => {
  const report = profile(
    [patient, patient, { ...patient, "Patient Number": "1" }, { ...patient, "Patient Number": "" }],
    [
      appointment,
      { ...appointment, "Patient Number": "1" },
      { ...appointment, "Patient Number": "'0001'" },
      { ...appointment, "Patient Number": "" }
    ]
  );
  assert.equal(report.patients.duplicatePatientNumberRows, 2);
  assert.equal(report.patients.missingPatientNumber, 1);
  assert.equal(report.appointments.ambiguousPatientNumber, 1);
  assert.equal(report.appointments.unmatchedPatientNumber, 1);
  assert.equal(report.appointments.missingPatientNumber, 1);
});

test("padded patient identifiers remain distinct and whitespace-only identifiers stay missing", () => {
  const report = profile(
    [
      { ...patient, "Patient Number": " 0001" },
      { ...patient, "Patient Number": "0001 " },
      { ...patient, "Patient Number": "   " }
    ],
    [
      appointment,
      { ...appointment, "Patient Number": " 0001" },
      { ...appointment, "Patient Number": "   " }
    ]
  );
  assert.equal(report.patients.duplicatePatientNumberRows, 0);
  assert.equal(report.patients.whitespacePaddedPatientNumber, 2);
  assert.equal(report.patients.missingPatientNumber, 1);
  assert.equal(report.appointments.whitespacePaddedPatientNumber, 1);
  assert.equal(report.appointments.unmatchedPatientNumber, 1);
  assert.equal(report.appointments.missingPatientNumber, 1);
  assert.equal(report.appointments.candidateKeyCollisionRows, 0);
});

test("statuses never turn a past scheduled appointment into a completed visit", () => {
  const report = profile(
    [patient],
    [
      appointment,
      { ...appointment, Status: "'Cancelled'" },
      { ...appointment, Status: sensitive },
      { ...appointment, Status: "" },
      { ...appointment, Status: "scheduled", Date: "2010-01-01 09:00:00" }
    ]
  );
  assert.deepEqual(report.appointments.statuses, {
    scheduled: 2,
    cancelled: 1,
    blank: 1,
    other: 1,
    apostropheWrapped: 2
  });
  assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC_PRIVATE/);
});

test("Gregorian dates, 24-hour time and missing or unrecognized attendance are checked without guessing units", () => {
  const invalid = [
    "2030-02-29 12:00:00",
    "2030-13-01 12:00:00",
    "2030-04-20 24:00:00",
    "2030-04-20 11:60:00",
    "2030-04-20 11:00:60",
    "0000-01-01 11:00:00",
    "2030-04-20T11:00:00Z",
    "1871377200",
    "'2030-04-20 11:00:00"
  ];
  const rows = invalid.map((Date) => ({
    ...appointment,
    Date,
    "Checked In At": "1234",
    "Checked Out At": ""
  }));
  const report = profile([patient], rows);
  assert.equal(report.appointments.date.otherOrInvalid, invalid.length);
  assert.equal(report.appointments.checkedIn.otherOrInvalid, invalid.length);
  assert.equal(report.appointments.checkedOut.blank, invalid.length);
  assert.equal(
    profile([patient], [{ ...appointment, Date: "2032-02-29 23:59:59" }]).appointments.date
      .validLocalDateTime,
    1
  );
  assert.equal(
    profile([{ ...patient, "Date of Birth": "31/12/2000" }]).patients.dateOfBirth.otherOrInvalid,
    1
  );
});

test("check-out before check-in is counted and never used to synthesize a booking duration", () => {
  const report = profile([patient], [{ ...appointment, "Checked Out At": "2030-04-19 12:00:00" }]);
  assert.equal(report.appointments.checkedOutBeforeCheckedIn, 1);
  assert.equal("duration" in report.appointments, false);
  assert.equal(report.importReady, false);
});

test("candidate collisions include all colliding rows and never fabricate appointment IDs", () => {
  const report = profile(
    [patient],
    [
      appointment,
      { ...appointment, Status: "Cancelled" },
      { ...appointment, DoctorName: "Other Synthetic Doctor" },
      { ...appointment, DoctorName: "" }
    ]
  );
  assert.equal(report.appointments.candidateKeyCollisionRows, 2);
  assert.equal(report.appointments.distinctDoctorNames, 2);
  assert.equal(report.appointments.missingDoctorName, 1);
});

test("missing phone fields are counted; no substitute contact or age-derived birthdate is invented", () => {
  const report = profile([
    { ...patient, "Mobile Number": "", "Contact Number": "Synthetic phone" },
    { ...patient, "Mobile Number": "", "Date of Birth": "", Age: "42", "Patient Name": "" }
  ]);
  assert.equal(report.patients.missingMobile, 2);
  assert.equal(report.patients.missingAllPhoneFields, 1);
  assert.equal(report.patients.dateOfBirth.blank, 1);
  assert.equal(report.patients.missingName, 1);
});

test("bounded inputs and unsupported encoding fail with constant errors", () => {
  assert.throws(() => parseCsv(""), /empty_csv/);
  assert.throws(() => parseCsv("a\0,b"), /unsupported_encoding/);
  assert.throws(() => parseCsv("x".repeat(LIMITS.bytes + 1)), /file_too_large/);
  assert.throws(() => parseCsv("x".repeat(LIMITS.cell + 1)), /cell_too_large/);
  assert.throws(
    () =>
      parseCsv(
        Array(LIMITS.columns + 1)
          .fill("x")
          .join(",")
      ),
    /too_many_columns/
  );
  assert.throws(() => parseCsv("a\n".repeat(LIMITS.rows + 2)), /too_many_rows/);
});

async function capture(args) {
  let stdout = "",
    stderr = "";
  const code = await main(
    args,
    {
      write: (value) => {
        stdout += value;
      }
    },
    {
      write: (value) => {
        stderr += value;
      }
    }
  );
  return { code, stdout, stderr };
}

test("CLI outputs only aggregates, leaves input bytes unchanged, and requires explicit paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "clinicos-synthetic-profile-"));
  try {
    const patientPath = join(directory, `${sensitive}-patients.csv`),
      appointmentPath = join(directory, "appointments.csv");
    const before = csv(PATIENT_HEADERS, [
      {
        ...patient,
        Remarks: sensitive,
        "Medical History": sensitive,
        "Patient Notes": sensitive,
        "National Id": sensitive
      }
    ]);
    await writeFile(patientPath, before);
    await writeFile(
      appointmentPath,
      csv(APPOINTMENT_HEADERS, [{ ...appointment, Notes: sensitive }])
    );
    const result = spawnSync(
      process.execPath,
      [
        "scripts/practo-export-profile.mjs",
        "--patients",
        patientPath,
        "--appointments",
        appointmentPath
      ],
      { encoding: "utf8", timeout: 10000 }
    );
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).importReady, false);
    assert.doesNotMatch(result.stdout, new RegExp(`${sensitive}|${directory}`));
    assert.equal(await readFile(patientPath, "utf8"), before);
    const usage = await capture([sensitive]);
    assert.deepEqual(JSON.parse(usage.stderr), { error: "usage", importReady: false });
    assert.equal(usage.stdout, "");
    const missing = await capture([
      "--patients",
      join(directory, sensitive),
      "--appointments",
      appointmentPath
    ]);
    assert.deepEqual(JSON.parse(missing.stderr), { error: "file_unreadable", importReady: false });
    assert.equal(missing.code, 1);
    assert.equal(missing.stdout, "");
    await writeFile(appointmentPath, `"${sensitive}`);
    const malformed = await capture(["--patients", patientPath, "--appointments", appointmentPath]);
    assert.equal(malformed.code, 1);
    assert.deepEqual(JSON.parse(malformed.stderr), { error: "malformed_csv", importReady: false });
    assert.equal(malformed.stdout, "");
    await writeFile(appointmentPath, Buffer.from([0xff, 0xfe, 0x61, 0x00]));
    assert.match(
      (await capture(["--patients", patientPath, "--appointments", appointmentPath])).stderr,
      /unsupported_encoding/
    );
    assert.match(
      (await capture(["--patients", directory, "--appointments", appointmentPath])).stderr,
      /regular_file_required/
    );
    if (process.platform !== "win32") {
      const link = join(directory, "link.csv");
      await symlink(patientPath, link);
      assert.match(
        (await capture(["--patients", link, "--appointments", appointmentPath])).stderr,
        /file_unreadable/
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("help requires no files and promises no import capability", async () => {
  const result = await capture(["--help"]);
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /NOT that migration is safe/);
});
