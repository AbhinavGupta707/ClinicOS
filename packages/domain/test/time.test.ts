import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock, clinicLocalDate, clinicLocalDateFromClock } from "../src/time.ts";

test("fixed clocks return defensive copies of the configured instant", () => {
  const clock = new FixedClock("2026-07-07T18:29:00.000Z");
  const first = clock.now();
  first.setUTCFullYear(2030);
  assert.equal(clock.now().toISOString(), "2026-07-07T18:29:00.000Z");
});

test("clinic-local dates cross the Asia Kolkata midnight boundary deterministically", () => {
  assert.equal(clinicLocalDate(new Date("2026-07-07T18:29:59.999Z"), "Asia/Kolkata"), "2026-07-07");
  assert.equal(clinicLocalDate(new Date("2026-07-07T18:30:00.000Z"), "Asia/Kolkata"), "2026-07-08");
});

test("clinic-local dates handle leap day and DST without slicing UTC", () => {
  assert.equal(clinicLocalDate(new Date("2028-02-29T00:15:00.000Z"), "Asia/Kolkata"), "2028-02-29");
  assert.equal(clinicLocalDate(new Date("2026-03-08T04:30:00.000Z"), "America/New_York"), "2026-03-07");
  assert.equal(clinicLocalDate(new Date("2026-03-08T07:30:00.000Z"), "America/New_York"), "2026-03-08");
});

test("clinic-local dates can be derived through the injected clock boundary", () => {
  const clock = new FixedClock("2026-07-08T18:31:00.000Z");
  assert.equal(clinicLocalDateFromClock(clock, "Asia/Kolkata"), "2026-07-09");
});
