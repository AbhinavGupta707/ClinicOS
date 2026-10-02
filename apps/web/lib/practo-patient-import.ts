// This boundary runs on the operator's device, before canonical staging. Never
// send the original Ray export: it contains clinical text and national IDs.
export const PRACTO_PATIENT_HEADERS = [
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
] as const;

const MAPPED_HEADERS = [
  "Patient Number",
  "Patient Name",
  "Mobile Number",
  "Email Address",
  "Date of Birth",
  "Gender"
];
export const PRACTO_PATIENT_EXCLUDED_HEADERS = PRACTO_PATIENT_HEADERS.filter(
  (header) => !MAPPED_HEADERS.includes(header)
);
const CANONICAL_HEADERS =
  "external_reference,full_name,phone,email,date_of_birth,gender,source_type,source_format";
export const PRACTO_PATIENT_FORMAT = "practo_ray_patients_v1";
export const PATIENT_IMPORT_MAX_BYTES = 256_000;

export type PractoPatientPreparation =
  | { ok: true; csv: string; rowCount: number; excludedFieldsWithValues: string[] }
  | { ok: false; message: string };

class PreparationError extends Error {}
function reject(message: string): never {
  throw new PreparationError(message);
}

// Strict UTF-8 comma-separated CSV. Preserve decoded identifiers exactly;
// apostrophes are data, not CSV delimiters. Bound work before allocating rows.
function records(input: string): string[][] {
  if (
    input.length > PATIENT_IMPORT_MAX_BYTES ||
    new TextEncoder().encode(input).length > PATIENT_IMPORT_MAX_BYTES
  )
    reject("Choose a CSV smaller than 256 KB, containing at most 100 patients. No rows were sent.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(input))
    reject("The file contains unsupported characters. Use the original UTF-8 CSV export.");
  const text = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const result: string[][] = [];
  let row: string[] = [],
    field = "";
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  const finishField = () => {
    row.push(field);
    if (row.length > PRACTO_PATIENT_HEADERS.length)
      reject("Unexpected column count in the Practo file.");
    field = "";
    state = "start";
  };
  const finishRow = () => {
    finishField();
    result.push(row);
    if (result.length > 101)
      reject(
        "This trial accepts at most 100 patients per run. The full file was rejected; nothing was truncated or sent. Whole-clinic import is not available yet."
      );
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (state === "quoted") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else state = "closed";
      } else field += character;
    } else if (character === ",") finishField();
    else if (character === "\r" || character === "\n") {
      if (state === "start" && !row.length && !field)
        reject("The CSV contains an empty record. No rows were skipped or sent.");
      finishRow();
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else if (state === "closed") reject("Malformed CSV quoting. No rows were sent.");
    else if (character === '"') {
      if (state !== "start") reject("Malformed CSV quoting. No rows were sent.");
      state = "quoted";
    } else {
      state = "plain";
      field += character;
    }
    if (field.length > 32_000) reject("A CSV cell exceeds the supported size. No rows were sent.");
  }
  if (state === "quoted") reject("Malformed CSV quoting. No rows were sent.");
  if (state !== "start" || row.length || field) finishRow();
  return result;
}

function csvCell(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

export function preparePractoPatients(input: string): PractoPatientPreparation {
  try {
    const [headers, ...rows] = records(input);
    if (
      !headers ||
      headers.length !== PRACTO_PATIENT_HEADERS.length ||
      new Set(headers).size !== PRACTO_PATIENT_HEADERS.length ||
      PRACTO_PATIENT_HEADERS.some((header) => !headers.includes(header))
    )
      reject(
        "Expected the 21 patient-export columns, from Patient Number through Patient Notes. Appointments and other export formats are not supported here."
      );
    if (!rows.length) reject("The file contains no patients.");
    const get = (row: string[], header: string): string => {
      const value = row[headers.indexOf(header)];
      if (value === undefined) reject("Unexpected column count in the Practo file.");
      return value;
    };
    const excluded = new Set<string>();
    const output = rows.map((row, index) => {
      const rowNumber = index + 2;
      if (row.length !== headers.length)
        reject(`CSV record ${rowNumber} has an unexpected column count.`);
      const id = get(row, "Patient Number");
      if (!id || id !== id.trim() || /[\r\n\t]/u.test(id))
        reject(
          `CSV record ${rowNumber}: Patient Number must be present without outer whitespace or line breaks. Identifiers are never silently changed.`
        );
      const dob = get(row, "Date of Birth").trim();
      // No ambiguous day/month conversion, Age-derived birthday, or guessed
      // apostrophe wrapper: this wire format still needs clinic verification.
      if (
        dob &&
        (!/^\d{4}-\d{2}-\d{2}$/u.test(dob) ||
          dob.startsWith("0000") ||
          !Number.isFinite(Date.parse(`${dob}T00:00:00Z`)) ||
          new Date(`${dob}T00:00:00Z`).toISOString().slice(0, 10) !== dob)
      )
        reject(
          `CSV record ${rowNumber}: Date of Birth must be blank or YYYY-MM-DD. Other formats need a verified mapping; no date was guessed.`
        );
      const gender = get(row, "Gender").trim().toLowerCase() || "unknown";
      if (!["female", "male", "other", "unknown"].includes(gender))
        reject(
          `CSV record ${rowNumber}: Gender needs a verified mapping. Supported values are female, male, other, unknown, or blank.`
        );
      for (const header of PRACTO_PATIENT_EXCLUDED_HEADERS)
        if (get(row, header).trim()) excluded.add(header);
      return [
        id,
        get(row, "Patient Name"),
        get(row, "Mobile Number"),
        get(row, "Email Address"),
        dob,
        gender,
        "imported",
        PRACTO_PATIENT_FORMAT
      ]
        .map(csvCell)
        .join(",");
    });
    return {
      ok: true,
      csv: [CANONICAL_HEADERS, ...output].join("\n"),
      rowCount: rows.length,
      excludedFieldsWithValues: PRACTO_PATIENT_EXCLUDED_HEADERS.filter((header) =>
        excluded.has(header)
      )
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof PreparationError
          ? error.message
          : "The patient file could not be prepared. No rows were sent."
    };
  }
}

// A headers-only download. It contains no invented clinic records.
export const PRACTO_PATIENT_TEMPLATE = PRACTO_PATIENT_HEADERS.map(csvCell).join(",") + "\n";
