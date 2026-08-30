# MVP Source Integration Intake

Status: awaiting owner/clinic input

Data policy: attach only synthetic or de-identified samples unless separately approved

This document freezes the source contract for MVP1. Connector-specific code must
not begin from assumptions; every required field below needs evidence or an
explicitly approved fallback.

## Clinic and source

- Clinic name or non-sensitive identifier: pending
- Clinic country/timezone: pending
- Source software/vendor: pending
- Product edition/version: pending
- Clinic contact who can verify source behavior: pending
- Expected patient count: pending
- Expected practitioner count: pending
- Expected appointment count per day/month: pending

## Authorized access

Choose one and attach the relevant documentation:

- [ ] official read API
- [ ] official scheduled export
- [ ] clinic-authorized CSV/XLS export
- [ ] explicit manual handoff
- [ ] other official/authorized mechanism

Required details:

- Documentation URL or supplied document: pending
- Sandbox/test account available: pending
- Authentication method: pending
- Rate/pagination limits: pending
- Export generation procedure: pending
- File encoding/delimiter/workbook sheets: pending
- Access authorization confirmed by: pending
- Date confirmed: pending

## Representative de-identified samples

Store approved fixtures under a vendor-specific test-fixture path, never in this
document.

- Patient sample path: pending
- Practitioner sample path: pending
- Appointment sample path: pending
- At least one changed appointment sample: pending
- At least one cancellation/no-show sample: pending
- At least one malformed or incomplete row sample: pending
- Sample de-identification confirmed by: pending

## Identity and field semantics

- Stable external patient identifier: pending
- Stable external practitioner identifier: pending
- Stable external appointment identifier: pending
- Whether identifiers can be reused: pending
- Patient duplicate signals available: pending
- Practitioner-to-ClinicOS user mapping rule: pending
- Appointment start/end/timezone semantics: pending
- Appointment status vocabulary: pending
- Cancellation/deletion semantics: pending
- Last-updated timestamp or change cursor: pending
- Missing record meaning (deleted, filtered, or unknown): pending
- Source-of-truth owner for each field: pending

## Trial mode

- Initial mode: import-once / operator-triggered / scheduled (pending)
- Desired cadence: pending
- Maximum acceptable data staleness: pending
- Read-only confirmed: pending
- Writeback explicitly excluded for MVP1: pending
- Success window and clinic trial date: pending

## Acceptance dataset counts

Record expected counts before running the first import:

| Entity/state | Source count | Expected ClinicOS result |
| --- | ---: | --- |
| Patients | pending | pending |
| Practitioners | pending | pending |
| Appointments | pending | pending |
| Cancellations/no-shows | pending | pending |
| Known duplicates | pending | pending |
| Known invalid rows | pending | pending |

## Decisions and sign-off

- Unverified source behavior and chosen conservative fallback: pending
- Fields intentionally not imported: pending
- Known data-quality limitations: pending
- Owner approval to begin MVP1: pending
- Approval date: pending
