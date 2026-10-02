import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const timezone of ["UTC", "Europe/London", "Asia/Kolkata", "America/Los_Angeles"]) {
  test(`PostgreSQL DATE round trips without a calendar shift in ${timezone}`, () => {
    const helper = new URL("../src/sql-calendar-date.ts", import.meta.url).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { types } from "pg";
      import { sqlCalendarDate } from ${JSON.stringify(helper)};
      const dates = ["2026-09-26", "2026-01-01", "2024-02-29", "1991-06-15"];
      const decode = types.getTypeParser(1082);
      console.log(JSON.stringify(dates.map(date => [sqlCalendarDate(decode(date)), sqlCalendarDate(date)])));
    `
      ],
      { env: { ...process.env, TZ: timezone }, encoding: "utf8", timeout: 10000 }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [
      ["2026-09-26", "2026-09-26"],
      ["2026-01-01", "2026-01-01"],
      ["2024-02-29", "2024-02-29"],
      ["1991-06-15", "1991-06-15"]
    ]);
  });
}
