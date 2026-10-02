#!/usr/bin/env node
// Offline discovery only. Never import this tool into the clinical write path.
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PATIENT_HEADERS = Object.freeze([
  "Patient Number",
  "Patient Name",
  "Mobile Number",
  "Contact Number",
  "Email Address",
  "Secondary Mobile",
  "Gender",
  "Address",
  "Locality",
  "City",
  "Pincode",
  "National Id",
  "Date of Birth",
  "Age",
  "Anniversary Date",
  "Blood Group",
  "Remarks",
  "Medical History",
  "Referred By",
  "Groups",
  "Patient Notes"
]);
export const APPOINTMENT_HEADERS = Object.freeze([
  "Date",
  "Patient Number",
  "Patient Name",
  "Notes",
  "DoctorName",
  "Status",
  "Checked In At",
  "Checked Out At"
]);
export const LIMITS = Object.freeze({
  bytes: 32 * 1024 * 1024,
  rows: 100_000,
  cell: 262_144,
  columns: 64
});

class ProfileError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ProfileError(code);
}

// Strict comma-separated CSV; apostrophes are DATA, not CSV delimiters.
// Kept separate from migration parsing because this tool must reject malformed
// quoting/widths and must never emit raw payloads or parser exception messages.
export function parseCsv(text) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > LIMITS.bytes)
    fail("file_too_large");
  if (text.includes("\0")) fail("unsupported_encoding");
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  const records = [];
  let row = [],
    field = "",
    state = "start";
  function finishField() {
    row.push(field);
    if (row.length > LIMITS.columns) fail("too_many_columns");
    field = "";
    state = "start";
  }
  function finishRow() {
    finishField();
    // Only genuinely empty physical lines are ignored. Commas/quoted empties
    // must remain records so all-empty patient rows cannot disappear silently.
    records.push(row);
    if (records.length > LIMITS.rows + 1) fail("too_many_rows");
    row = [];
  }
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (state === "quoted") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else state = "closed";
      } else field += character;
    } else if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      const emptyLine = state === "start" && row.length === 0 && field === "";
      if (!emptyLine) finishRow();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else if (state === "closed") {
      fail("malformed_csv");
    } else if (character === '"') {
      if (state !== "start") fail("malformed_csv");
      state = "quoted";
    } else {
      state = "plain";
      field += character;
    }
    if (field.length > LIMITS.cell) fail("cell_too_large");
  }
  if (state === "quoted") fail("malformed_csv");
  if (state !== "start" || row.length > 0 || field !== "") finishRow();
  if (records.length === 0) fail("empty_csv");
  return records;
}

function table(text, expected) {
  const [headers, ...rows] = parseCsv(text);
  // Exact observed header names, optionally reordered. No heuristic renaming or
  // echoing unknown headers (which might themselves contain patient information).
  if (
    headers.length !== expected.length ||
    new Set(headers).size !== expected.length ||
    expected.some((header) => !headers.includes(header))
  )
    fail("header_mismatch");
  if (rows.some((row) => row.length !== headers.length)) fail("row_width_mismatch");
  return {
    rows,
    reordered: headers.some((header, index) => header !== expected[index]),
    get: (row, header) => row[headers.indexOf(header)]
  };
}

// Recognize the owner-reported scalar wrapper ONLY for date/status diagnostics.
// Never strip apostrophes from patient identifiers, names or arbitrary text.
function scalar(value) {
  const wrapped = value.length >= 2 && value.startsWith("'") && value.endsWith("'");
  return { value: wrapped ? value.slice(1, -1) : value, wrapped };
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validLocalTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value)) return false;
  return (
    validDate(value.slice(0, 10)) &&
    Number(value.slice(11, 13)) < 24 &&
    Number(value.slice(14, 16)) < 60 &&
    Number(value.slice(17, 19)) < 60
  );
}

function timestampCounts() {
  return { blank: 0, validLocalDateTime: 0, otherOrInvalid: 0, apostropheWrapped: 0 };
}
function countTimestamp(counts, raw) {
  const { value, wrapped } = scalar(raw);
  if (wrapped) counts.apostropheWrapped += 1;
  if (!value) counts.blank += 1;
  else if (validLocalTimestamp(value)) counts.validLocalDateTime += 1;
  else counts.otherOrInvalid += 1;
  return validLocalTimestamp(value) ? value : null;
}

export function profileExports(patientCsv, appointmentCsv) {
  const patients = table(patientCsv, PATIENT_HEADERS);
  const appointments = table(appointmentCsv, APPOINTMENT_HEADERS);
  const ids = new Map();
  const patientCounts = {
    rows: patients.rows.length,
    headersReordered: patients.reordered,
    missingPatientNumber: 0,
    whitespacePaddedPatientNumber: 0,
    duplicatePatientNumberRows: 0,
    missingName: 0,
    missingMobile: 0,
    missingAllPhoneFields: 0,
    dateOfBirth: { blank: 0, validIsoDate: 0, otherOrInvalid: 0, apostropheWrapped: 0 }
  };
  for (const row of patients.rows) {
    const get = (header) => patients.get(row, header).trim();
    const id = patients.get(row, "Patient Number");
    if (id.trim() && id !== id.trim()) patientCounts.whitespacePaddedPatientNumber += 1;
    if (!id.trim()) patientCounts.missingPatientNumber += 1;
    else ids.set(id, (ids.get(id) ?? 0) + 1);
    if (!get("Patient Name")) patientCounts.missingName += 1;
    if (!get("Mobile Number")) patientCounts.missingMobile += 1;
    if (!["Mobile Number", "Contact Number", "Secondary Mobile"].some((key) => get(key)))
      patientCounts.missingAllPhoneFields += 1;
    const birth = scalar(get("Date of Birth"));
    if (birth.wrapped) patientCounts.dateOfBirth.apostropheWrapped += 1;
    if (!birth.value) patientCounts.dateOfBirth.blank += 1;
    else if (validDate(birth.value)) patientCounts.dateOfBirth.validIsoDate += 1;
    else patientCounts.dateOfBirth.otherOrInvalid += 1;
  }
  patientCounts.duplicatePatientNumberRows = [...ids.values()]
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0);
  const doctors = new Set();
  const candidateKeys = new Map();
  const appointmentCounts = {
    rows: appointments.rows.length,
    headersReordered: appointments.reordered,
    missingPatientNumber: 0,
    whitespacePaddedPatientNumber: 0,
    unmatchedPatientNumber: 0,
    ambiguousPatientNumber: 0,
    missingDoctorName: 0,
    distinctDoctorNames: 0,
    candidateKeyCollisionRows: 0,
    statuses: { scheduled: 0, cancelled: 0, blank: 0, other: 0, apostropheWrapped: 0 },
    date: timestampCounts(),
    checkedIn: timestampCounts(),
    checkedOut: timestampCounts(),
    checkedOutBeforeCheckedIn: 0
  };
  for (const row of appointments.rows) {
    const get = (header) => appointments.get(row, header).trim();
    const id = appointments.get(row, "Patient Number"),
      doctor = get("DoctorName");
    if (id.trim() && id !== id.trim()) appointmentCounts.whitespacePaddedPatientNumber += 1;
    if (!id.trim()) appointmentCounts.missingPatientNumber += 1;
    else if (!ids.has(id)) appointmentCounts.unmatchedPatientNumber += 1;
    else if (ids.get(id) > 1) appointmentCounts.ambiguousPatientNumber += 1;
    if (!doctor) appointmentCounts.missingDoctorName += 1;
    else doctors.add(doctor);
    const status = scalar(get("Status"));
    if (status.wrapped) appointmentCounts.statuses.apostropheWrapped += 1;
    // Only known labels can reach the report; unknown values are counted, never echoed.
    const label = status.value.toLowerCase();
    appointmentCounts.statuses[
      label === "scheduled" || label === "cancelled" ? label : label === "" ? "blank" : "other"
    ] += 1;
    const start = countTimestamp(appointmentCounts.date, get("Date"));
    const arrival = countTimestamp(appointmentCounts.checkedIn, get("Checked In At"));
    const departure = countTimestamp(appointmentCounts.checkedOut, get("Checked Out At"));
    if (arrival && departure && departure < arrival)
      appointmentCounts.checkedOutBeforeCheckedIn += 1;
    if (id.trim() && doctor && start) {
      // Diagnostic collision count only: this is NOT a durable appointment ID.
      const key = JSON.stringify([id, doctor, start]);
      candidateKeys.set(key, (candidateKeys.get(key) ?? 0) + 1);
    }
  }
  appointmentCounts.distinctDoctorNames = doctors.size;
  appointmentCounts.candidateKeyCollisionRows = [...candidateKeys.values()]
    .filter((count) => count > 1)
    .reduce((sum, count) => sum + count, 0);
  return {
    reportVersion: 1,
    purpose: "offline_format_profile_only",
    importReady: false,
    patients: patientCounts,
    appointments: appointmentCounts,
    unresolved: [
      "appointment_id_absent",
      "scheduled_end_or_duration_absent",
      "appointment_type_absent",
      "doctor_mapping_requires_review",
      "export_timezone_requires_confirmation",
      "repeated_export_and_reschedule_semantics_unverified",
      "patient_mapping_requires_validation"
    ]
  };
}

async function readLocalCsv(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail("regular_file_required");
    if (stat.size > LIMITS.bytes) fail("file_too_large");
    const chunks = [];
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      bytes += chunk.length;
      if (bytes > LIMITS.bytes) fail("file_too_large");
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      fail("unsupported_encoding");
    }
  } finally {
    await handle.close();
  }
}

const HELP = `Offline Practo CSV profile (no imports, network, or output files).
Usage: node scripts/practo-export-profile.mjs --patients /private/path/patients.csv --appointments /private/path/appointments.csv
Run locally only with clinic authorization. stdout contains aggregate counts, not records.
Inputs: UTF-8 comma-separated CSV, max 32 MiB/file, 100,000 data rows/file.
Exit 0 means the profile ran, NOT that migration is safe. Exit 1 means a safe error code.
`;

export async function main(args, output = process.stdout, error = process.stderr) {
  try {
    if (args.length === 1 && args[0] === "--help") {
      output.write(HELP);
      return 0;
    }
    if (
      args.length !== 4 ||
      args[0] !== "--patients" ||
      args[2] !== "--appointments" ||
      !args[1] ||
      !args[3]
    )
      fail("usage");
    const patientCsv = await readLocalCsv(args[1]);
    const appointmentCsv = await readLocalCsv(args[3]);
    output.write(`${JSON.stringify(profileExports(patientCsv, appointmentCsv), null, 2)}\n`);
    return 0;
  } catch (cause) {
    // File paths, unexpected headers, source values and library errors can all
    // contain PHI. Only our closed set of diagnostic codes may cross stdout/stderr.
    error.write(
      `${JSON.stringify({ error: cause instanceof ProfileError ? cause.code : "file_unreadable", importReady: false })}\n`
    );
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
