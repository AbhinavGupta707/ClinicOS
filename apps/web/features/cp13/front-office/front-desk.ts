import {
  ClinicOsApiError,
  type ClinicOsApiClient,
  type PublicJsonObject
} from "@clinic-os/api-client-generated";

export interface NamedOption {
  id: string;
  name: string;
}
export interface VisitOption extends NamedOption {
  durationMinutes: number;
}
export interface BookingConfiguration {
  doctors: NamedOption[];
  types: VisitOption[];
  chairs: NamedOption[];
}

function requiredText(record: PublicJsonObject, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim())
    throw new Error("Clinic configuration is incomplete.");
  return value;
}

export async function loadBookingConfiguration(
  client: Pick<ClinicOsApiClient, "listClinicDoctors" | "listAppointmentTypes" | "listChairs">
): Promise<BookingConfiguration> {
  const [doctors, types, chairs] = await Promise.all([
    client.listClinicDoctors(),
    client.listAppointmentTypes(),
    client.listChairs()
  ]);
  return {
    doctors: doctors.clinicDoctors.map((record) => ({
      id: requiredText(record, "providerUserId"),
      name: requiredText(record, "displayName")
    })),
    types: types.appointmentTypes
      .filter((record) => record.active === true)
      .map((record) => {
        const durationMinutes = record.defaultDurationMinutes;
        if (
          typeof durationMinutes !== "number" ||
          !Number.isInteger(durationMinutes) ||
          durationMinutes < 5 ||
          durationMinutes > 720
        )
          throw new Error("Visit duration configuration is invalid.");
        return {
          id: requiredText(record, "id"),
          name: requiredText(record, "displayName"),
          durationMinutes
        };
      }),
    chairs: chairs.chairs
      .filter((record) => record.active === true)
      .map((record) => ({
        id: requiredText(record, "id"),
        name: requiredText(record, "displayName")
      }))
  };
}

export function clinicDateTime(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(instant));
  const get = (key: string) => parts.find((part) => part.type === key)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// HTML datetime-local has no timezone. Resolve using the clinic zone, never the
// computer's zone. Reject a DST gap/fold instead of silently choosing an instant.
export function clinicDateTimeToInstant(local: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error("Enter a valid date and time.");
  const naive = Date.parse(`${local}:00Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== local) {
    throw new Error("Enter a valid date and time.");
  }
  const offsets = new Set<number>();
  // Covers offset changes on either side of the selected local day, including
  // half-hour transitions. Intl supplies authoritative IANA offsets.
  for (let hour = -36; hour <= 36; hour += 6) {
    const probe = naive + hour * 3_600_000;
    offsets.add(
      Date.parse(`${clinicDateTime(new Date(probe).toISOString(), timeZone)}:00Z`) - probe
    );
  }
  const matches = [...offsets]
    .map((offset) => new Date(naive - offset).toISOString())
    .filter((instant) => clinicDateTime(instant, timeZone) === local);
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? "This time occurs twice during a clock change. Choose an unambiguous time."
        : "This time does not exist during a clock change. Choose another time."
    );
  return matches[0]!;
}

export function mutationProblem(error: unknown): { message: string; uncertain: boolean } {
  if (error instanceof ClinicOsApiError) {
    if (error.status === 409 && error.details.reason === "idempotency_request_in_progress")
      return {
        message: "This save is still processing. Wait briefly, then retry the same request.",
        uncertain: true
      };
    if (error.status === 409 && error.details.reason === "if_match_failed")
      return {
        message:
          "Another staff member changed this record. Close this editor, refresh the schedule, and reopen the record before trying again.",
        uncertain: false
      };
    if (error.status === 401 || error.status === 403)
      return {
        message: "Your session cannot make this change. Sign in with an authorized clinic role.",
        uncertain: false
      };
    if (error.status === 429)
      return {
        message: `Too many requests. Wait ${error.responseMetadata.retryAfterSeconds ?? 60} seconds, then try again.`,
        uncertain: false
      };
    if (error.status < 500) return { message: error.message, uncertain: false };
  }
  return {
    message:
      "The outcome could not be confirmed. Retry this same request to recover its result safely. Do not submit a second booking.",
    uncertain: true
  };
}

// Keeps the operation key and the exact payload in memory until the server gives
// a definitive outcome. No patient details are placed in browser storage or URLs.
export function createFrontDeskCommand() {
  let pending: { key: string; run: (key: string) => Promise<unknown> } | null = null;
  let inFlight: Promise<unknown> | null = null;
  return {
    hasPending: () => pending !== null,
    recover(): Promise<unknown> | null {
      return pending ? this.execute(pending.run) : null;
    },
    execute(run: (key: string) => Promise<unknown>): Promise<unknown> {
      if (inFlight) return inFlight;
      pending ??= { key: crypto.randomUUID(), run };
      const action = pending;
      inFlight = Promise.resolve()
        .then(() => action.run(action.key))
        .then((result) => {
          pending = null;
          return result;
        })
        .catch((error: unknown) => {
          if (!mutationProblem(error).uncertain) pending = null;
          throw error;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    }
  };
}

// In-memory recovery survives client-side navigation, scoped to the verified
// tenant/clinic/user. Switching identity discards the previous actor's closures.
let activeScope: string | null = null;
let scopedCommand = createFrontDeskCommand();
export function frontDeskCommandForScope(scope: string) {
  if (activeScope !== scope) {
    activeScope = scope;
    scopedCommand = createFrontDeskCommand();
  }
  return scopedCommand;
}
