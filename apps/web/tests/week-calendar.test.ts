import {describe,it,expect} from "vitest";
import {weekDates} from "../features/cp13/front-office/WeekCalendar";
describe("clinic week labels",()=>{
 it("uses calendar days independent of computer timezone and spans year boundaries",()=>{
  expect(weekDates("2026-01-01")).toEqual(["2025-12-29","2025-12-30","2025-12-31","2026-01-01","2026-01-02","2026-01-03","2026-01-04"]);
  expect(weekDates("2024-02-29")).toContain("2024-02-29");
 });
 it("rejects impossible calendar dates",()=>{expect(()=>weekDates("2026-02-30")).toThrow();expect(()=>weekDates("")).toThrow();});
});
