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
