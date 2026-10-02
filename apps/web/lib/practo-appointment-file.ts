import { streamPracticeCsvRecords, PATIENT_FILE_MAX_BYTES } from "./practo-patient-file";
export const APPOINTMENT_HEADERS = [
  "Date",
  "Patient Number",
  "Patient Name",
  "Notes",
  "DoctorName",
  "Status",
  "Checked In At",
  "Checked Out At"
];
export interface AppointmentObservation {
  date: string;
  patientNumber: string;
  patientName: string;
  doctorName: string;
  status: "Scheduled" | "Cancelled";
}
export async function prepareAppointmentFile(
  file: Blob
): Promise<{ rows: AppointmentObservation[]; digest: string }> {
  if (file.size > PATIENT_FILE_MAX_BYTES)
    throw new Error("Appointment review supports at most 25 MiB and 5,000 observations.");
  let headers: string[] | undefined;
  const rows: AppointmentObservation[] = [];
  const scalar = (s: string) => (s.startsWith("'") && s.endsWith("'") ? s.slice(1, -1) : s);
  for await (const row of streamPracticeCsvRecords(file)) {
    if (!headers) {
      headers = row;
      if (
        headers.length !== 8 ||
        new Set(headers).size !== 8 ||
        APPOINTMENT_HEADERS.some((h) => !headers!.includes(h))
      )
        throw new Error("Expected the eight reported Practo appointment headers.");
      continue;
    }
    if (row.length !== 8 || rows.length >= 5000)
      throw new Error("Invalid column count or more than 5,000 observations. No rows were sent.");
    const get = (h: string) => row[headers!.indexOf(h)]!;
    const date = scalar(get("Date")),
      status = scalar(get("Status"));
    if (
      !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date.replace(" ", "T") + "Z")) ||
      new Date(date.replace(" ", "T") + "Z").toISOString().slice(0, 19) !== date.replace(" ", "T")
    )
      throw new Error(
        "An observation has an unsupported date. No timezone or duration was guessed."
      );
    if (status !== "Scheduled" && status !== "Cancelled")
      throw new Error("Unknown source status. Verify the source mapping before continuing.");
    const patientNumber = get("Patient Number"),
      patientName = get("Patient Name"),
      doctorName = get("DoctorName");
    if (
      [patientNumber, patientName, doctorName].some(
        (s) => !s.trim() || s.length > 200 || /[\u0000-\u001f]/.test(s)
      )
    )
      throw new Error("A source identity field is missing, multiline or too long.");
    rows.push({ date, patientNumber, patientName, doctorName, status });
  }
  if (!rows.length) throw new Error("The source file has no observations.");
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(rows)))
    )
  )
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  return { rows, digest };
}
