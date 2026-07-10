export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  readonly #instant: Date;

  constructor(instant: Date | string) {
    const parsed = instant instanceof Date ? instant : new Date(instant);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("FixedClock requires a valid instant.");
    }
    this.#instant = new Date(parsed.getTime());
  }

  now(): Date {
    return new Date(this.#instant.getTime());
  }
}

export const systemClock: Clock = new SystemClock();

export function clockNowIso(clock: Clock): string {
  return clock.now().toISOString();
}

export function clinicLocalDate(instant: Date, timeZone: string): string {
  if (Number.isNaN(instant.getTime())) {
    throw new Error("clinicLocalDate requires a valid instant.");
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(instant);
  const valueByType = new Map(parts.map((part) => [part.type, part.value]));
  const year = valueByType.get("year");
  const month = valueByType.get("month");
  const day = valueByType.get("day");

  if (!year || !month || !day) {
    throw new Error(`Unable to derive clinic-local date for timezone ${timeZone}.`);
  }

  return `${year}-${month}-${day}`;
}

export function clinicLocalDateFromClock(clock: Clock, timeZone: string): string {
  return clinicLocalDate(clock.now(), timeZone);
}

export function clinicLocalDateTimeToInstant(
  localDate: string,
  localTime: string,
  timeZone: string
): Date {
  const date = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u.exec(localDate)?.groups;
  const time =
    /^(?<hour>[01]\d|2[0-3]):(?<minute>[0-5]\d)(?::(?<second>[0-5]\d)(?:\.(?<fraction>\d{1,6}))?)?$/u.exec(
      localTime
    )?.groups;
  if (!date || !time) {
    throw new Error("Clinic-local date and time must use ISO date and 24-hour time syntax.");
  }

  const target = {
    year: Number(date.year),
    month: Number(date.month),
    day: Number(date.day),
    hour: Number(time.hour),
    minute: Number(time.minute),
    second: Number(time.second ?? "0"),
    millisecond: Number((time.fraction ?? "").padEnd(3, "0").slice(0, 3))
  };
  const targetAsUtc = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
    target.millisecond
  );
  if (new Date(targetAsUtc).toISOString().slice(0, 10) !== localDate) {
    throw new Error("Clinic-local date is not a real calendar date.");
  }

  let candidate = targetAsUtc;
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const observed = zonedDateTimeParts(new Date(candidate), timeZone);
      const observedAsUtc = Date.UTC(
        observed.year,
        observed.month - 1,
        observed.day,
        observed.hour,
        observed.minute,
        observed.second,
        target.millisecond
      );
      const correction = targetAsUtc - observedAsUtc;
      candidate += correction;
      if (correction === 0) break;
    }
    const verified = zonedDateTimeParts(new Date(candidate), timeZone);
    if (
      verified.year !== target.year ||
      verified.month !== target.month ||
      verified.day !== target.day ||
      verified.hour !== target.hour ||
      verified.minute !== target.minute ||
      verified.second !== target.second
    ) {
      throw new Error("nonexistent local time");
    }
  } catch {
    throw new Error("Clinic-local date and time cannot be resolved in the configured timezone.");
  }
  return new Date(candidate);
}

function zonedDateTimeParts(
  instant: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(instant);
  const value = (type: "year" | "month" | "day" | "hour" | "minute" | "second"): number =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second")
  };
}
