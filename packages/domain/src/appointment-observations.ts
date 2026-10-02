export interface AppointmentSourceObservation {
  date: string;
  patientNumber: string;
  patientName: string;
  doctorName: string;
  status: "Scheduled" | "Cancelled";
}
export function canonicalAppointmentObservations(
  rows: readonly AppointmentSourceObservation[]
): string {
  return JSON.stringify(
    rows.map((r) => ({
      date: r.date,
      patientNumber: r.patientNumber,
      patientName: r.patientName,
      doctorName: r.doctorName,
      status: r.status
    }))
  );
}
export function validateAppointmentObservation(r: AppointmentSourceObservation): void {
  if (!r || Object.keys(r).sort().join(",") !== "date,doctorName,patientName,patientNumber,status")
    throw new RangeError("Only the approved appointment source fields may be staged.");
  if (
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(r.date) ||
    !Number.isFinite(Date.parse(r.date.replace(" ", "T") + "Z")) ||
    new Date(r.date.replace(" ", "T") + "Z").toISOString().slice(0, 19) !== r.date.replace(" ", "T")
  )
    throw new RangeError(
      "Source date must be a real local date and time. Its timezone still requires review."
    );
  for (const k of ["patientNumber", "patientName", "doctorName"] as const)
    if (
      typeof r[k] !== "string" ||
      !r[k].trim() ||
      r[k].length > 200 ||
      /[\u0000-\u001f]/.test(r[k])
    )
      throw new RangeError("Source identity fields must be present, bounded single-line values.");
  if (!["Scheduled", "Cancelled"].includes(r.status))
    throw new RangeError("Unknown source status; obtain a verified mapping first.");
}
