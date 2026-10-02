import {
  PRACTO_PATIENT_HEADERS,
  PRACTO_PATIENT_FORMAT,
  preparePractoPatients
} from "./practo-patient-import";

export const PATIENT_FILE_MAX_ROWS = 5_000;
export const PATIENT_FILE_MAX_BYTES = 25 * 1024 * 1024;
export interface PatientFileManifest {
  profile: typeof PRACTO_PATIENT_FORMAT;
  rowCount: number;
  chunks: Array<{ ordinal: number; rowCount: number; digest: string }>;
}
export interface PreparedPatientFile {
  manifest: PatientFileManifest;
  excludedFieldsWithValues: string[];
}
export interface PatientFileChunk {
  ordinal: number;
  rowCount: number;
  digest: string;
  csv: string;
  excludedFieldsWithValues: string[];
}
const canonicalHeader =
  "external_reference,full_name,phone,email,date_of_birth,gender,source_type,source_format";
const mapped = [
  "Patient Number",
  "Patient Name",
  "Mobile Number",
  "Email Address",
  "Date of Birth",
  "Gender"
];
const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"';
const failure = (message: string): never => {
  throw new Error(message);
};

// Two passes over the local File: preflight retains only IDs/hashes/counts, then
// upload regenerates at most 100 minimized rows at a time. No raw-file buffer,
// browser persistence, original filename, or excluded field values leave here.
async function* csvRecords(file: Blob, signal?: AbortSignal): AsyncGenerator<string[]> {
  if (file.size > PATIENT_FILE_MAX_BYTES)
    failure("This patient import supports files up to 25 MiB. No rows were sent.");
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let state: "start" | "plain" | "quoted" | "closed" = "start";
  let field = "",
    row: string[] = [],
    rowLength = 0,
    skipLf = false,
    first = true;
  const endField = () => {
    row.push(field);
    if (row.length > 21) failure("Unexpected column count in the patient file.");
    field = "";
    state = "start";
  };
  try {
    let done = false;
    while (!done) {
      signal?.throwIfAborted();
      const part = await reader.read();
      done = part.done;
      let text: string;
      try {
        text = decoder.decode(part.value, { stream: !done });
      } catch {
        failure("The patient file must be valid UTF-8. No unsupported encoding was guessed.");
      }
      if (first && text!.length) {
        first = false;
        if (text![0] === "\uFEFF") text = text!.slice(1);
      }
      for (const character of text!) {
        if (skipLf) {
          skipLf = false;
          if (character === "\n") continue;
        }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(character))
          failure("The file contains unsupported characters.");
        rowLength += 1;
        if (rowLength > 128_000 || field.length > 32_000)
          failure("A patient record or cell exceeds the supported size. Nothing was truncated.");
        if (state === "quoted") {
          if (character === '"') state = "closed";
          else field += character;
        } else if (state === "closed" && character === '"') {
          field += '"';
          state = "quoted";
        } else if (character === ",") endField();
        else if (character === "\r" || character === "\n") {
          if (state === "start" && !row.length && !field)
            failure("The file contains an empty record. No records were skipped.");
          endField();
          yield row;
          row = [];
          rowLength = 0;
          skipLf = character === "\r";
        } else if (state === "closed")
          failure("Malformed CSV quoting. Correct the file before importing.");
        else if (character === '"') {
          if (state !== "start")
            failure("Malformed CSV quoting. Correct the file before importing.");
          state = "quoted";
        } else {
          field += character;
          state = "plain";
        }
      }
      // Yield the main thread between stream windows, including large excluded
      // fields. The retained raw window is the browser's bounded stream chunk.
      if (!done) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    if (state === "quoted")
      failure("The file ends inside a quoted field. No incomplete file can be imported.");
    if (state !== "start" || row.length || field) {
      endField();
      yield row;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function* patientFileChunks(
  file: Blob,
  signal?: AbortSignal
): AsyncGenerator<PatientFileChunk> {
  let headers: string[] | null = null,
    rowCount = 0,
    ordinal = 0;
  let output: string[] = [];
  const ids = new Set<string>(),
    excluded = new Set<string>();
  const flush = async (): Promise<PatientFileChunk> => {
    const csv = [canonicalHeader, ...output].join("\n");
    const bytes = new TextEncoder().encode(csv);
    if (bytes.length > 256_000)
      failure("Mapped patient fields exceed the supported batch size. Nothing was truncated.");
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const digest = Array.from(new Uint8Array(hash), (value) =>
      value.toString(16).padStart(2, "0")
    ).join("");
    const chunk = {
      ordinal: ordinal++,
      rowCount: output.length,
      digest,
      csv,
      excludedFieldsWithValues: [...excluded]
    };
    output = [];
    return chunk;
  };
  for await (const row of csvRecords(file, signal)) {
    signal?.throwIfAborted();
    if (!headers) {
      headers = row;
      if (
        row.length !== 21 ||
        new Set(row).size !== 21 ||
        PRACTO_PATIENT_HEADERS.some((header) => !row.includes(header))
      )
        failure(
          "Expected the 21 Practo patient columns, from Patient Number through Patient Notes."
        );
      continue;
    }
    rowCount += 1;
    if (rowCount > PATIENT_FILE_MAX_ROWS)
      failure(
        "This import supports up to 5,000 patients. The whole file was rejected; no rows were truncated."
      );
    if (row.length !== headers.length)
      failure(`Patient record ${rowCount} has an unexpected column count.`);
    if (mapped.some((header) => (row[headers!.indexOf(header)]?.length ?? 0) > 512))
      failure(`Patient record ${rowCount} has an oversized mapped field. Nothing was truncated.`);
    const id = row[headers.indexOf("Patient Number")] ?? "";
    if (ids.has(id))
      failure(
        `Patient record ${rowCount} repeats a Patient Number. Correct duplicate IDs before importing the file.`
      );
    ids.add(id);
    const prepared = preparePractoPatients(
      [headers.map(cell).join(","), row.map(cell).join(",")].join("\n")
    );
    if (!prepared.ok) failure(`Patient record ${rowCount}: ${prepared.message}`);
    if (prepared.ok) {
      output.push(prepared.csv.slice(prepared.csv.indexOf("\n") + 1));
      for (const name of prepared.excludedFieldsWithValues) excluded.add(name);
    }
    if (output.length === 100) yield await flush();
  }
  if (!rowCount) failure("The patient file has no records.");
  if (output.length) yield await flush();
}

export async function preparePatientFile(
  file: Blob,
  onProgress?: (rows: number) => void,
  signal?: AbortSignal
): Promise<PreparedPatientFile> {
  const chunks: PatientFileManifest["chunks"] = [];
  const excluded = new Set<string>();
  let rowCount = 0;
  for await (const chunk of patientFileChunks(file, signal)) {
    chunks.push({ ordinal: chunk.ordinal, rowCount: chunk.rowCount, digest: chunk.digest });
    rowCount += chunk.rowCount;
    chunk.excludedFieldsWithValues.forEach((name) => excluded.add(name));
    onProgress?.(rowCount);
  }
  return {
    manifest: { profile: PRACTO_PATIENT_FORMAT, rowCount, chunks },
    excludedFieldsWithValues: [...excluded]
  };
}
