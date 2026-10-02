/**
 * node-postgres decodes a PostgreSQL DATE as midnight in the process timezone.
 * A DATE is a calendar value, not an instant: converting that Date to UTC can
 * move a birthday, schedule boundary or accounting period into another day.
 * Drivers configured to return DATE strings retain their original value.
 */
export function sqlCalendarDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  if (!Number.isFinite(value.getTime())) throw new RangeError("Invalid SQL calendar date.");
  return [
    String(value.getFullYear()).padStart(4, "0"),
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0")
  ].join("-");
}
