import test from "node:test";
import assert from "node:assert/strict";
import {
  approvedAppointmentTemplate,
  appointmentMessageParameter,
  communicationPhone
} from "../src/communications.ts";
const valid = {
  id: "123456789",
  name: "appointment_notice",
  language: "en",
  status: "APPROVED",
  category: "UTILITY",
  components: [{ type: "BODY", text: "Hello. {{1}} Contact the clinic for changes." }]
};
test("communication templates allow only a reviewed plain utility body with one positional parameter", () => {
  assert.ok(approvedAppointmentTemplate(valid));
  for (const change of [
    { status: "PAUSED" },
    { category: "MARKETING" },
    { id: "../../messages" },
    { components: [{ type: "HEADER", text: "Hello" }, ...valid.components] },
    { components: [{ type: "BODY", text: "{{1}} {{2}}" }] },
    { components: [{ type: "BODY", text: "{{1}} {{1}}" }] },
    { components: [{ type: "BODY", text: "{{patient}}" }] },
    { components: [{ type: "BODY", text: "{{1}}\u0000" }] },
    { components: [{ type: "BODY", text: "{{1}}" + "x".repeat(1024) }] }
  ])
    assert.equal(approvedAppointmentTemplate({ ...valid, ...change }), null);
});
test("appointment text uses clinic timezone, preserves clinical details outside the message", () => {
  const text = appointmentMessageParameter({
    clinic: "Synthetic Clinic",
    doctor: "Dr Test",
    startsAt: "2026-10-02T05:30:00Z",
    timezone: "Asia/Kolkata"
  });
  assert.match(text, /11:00/);
  assert.match(text, /02 Oct 2026/);
  assert.match(text, /Asia\/Kolkata/);
  assert.throws(() =>
    appointmentMessageParameter({
      clinic: "Bad\nClinic",
      doctor: "Dr Test",
      startsAt: "2026-10-02T05:30:00Z",
      timezone: "Asia/Kolkata"
    })
  );
});
test("contact normalization does not guess countries or accept URL-like endpoints", () => {
  assert.equal(communicationPhone("919999888877"), "+919999888877");
  assert.equal(communicationPhone("+919999888877"), "+919999888877");
  for (const s of ["0999999999", "+91 9999", "https://127.0.0.1", "1".repeat(16), ""])
    assert.equal(communicationPhone(s), null);
});
