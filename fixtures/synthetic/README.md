# Synthetic Clinic Fixtures

These files are safe seed inputs for autonomous implementation and testing. They are intentionally synthetic: no real patient names, phone numbers, ABHA identifiers, payment references, X-ray files, or clinic exports.

The domain/model checkpoints may expand these files or replace them with richer generated fixtures once schemas are formalised.

## Fixture Set

- `patients.csv` - synthetic patient demographics and communication preferences.
- `appointments.csv` - synthetic appointment and queue scenarios.
- `pricebook.csv` - synthetic dental procedure prices.
- `templates/` - message, consent, prescription, and post-op templates.
- `transcripts/` - synthetic consultation transcript text for scribe tests.
- `media/` - placeholder location for synthetic X-ray/photo metadata or generated non-PHI media.
- `cp2/` - deterministic Checkpoint 2 lead/patient/appointment/day-start QA scenarios.
