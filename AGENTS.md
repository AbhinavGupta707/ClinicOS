# ClinicOS Agent Instructions

## Production-Grade Scope

- Build for the blue-sky production system, not a throwaway MVP, demo, or bootstrap.
- A feature may be sequenced later, but any feature that is built must be fully functional, production-grade, distribution-ready, saleable, observable, secure, tested, and documented for its intended scope.
- Do not use mock, stub, placeholder, or partial implementations in product code. Test doubles, simulators, and fixtures are allowed only for local development and automated tests, and they must sit behind the same typed provider contracts as production integrations.
- Scope should be reduced by shipping fewer complete vertical slices, not by weakening quality, safety, permissions, auditability, integration correctness, or user experience.
- For missing, unavailable, or unlisted features, diagnose in layer order: registration/discovery/install state and official activation flows first; permissions/runtime only after the feature is actually present.
- External integrations must use official APIs, partner integrations, signed webhooks, authorized exports/imports, or explicit clinic-approved manual workflows. Do not build unauthorized scraping or brittle browser automation as a dependency.

## Source Of Truth

- Treat the individual Markdown files in `clinic_os_specs_v2/` as canonical.
- `COMBINED_BUILD_PACK.md` is a packaging artifact and may lag behind individual spec edits.
