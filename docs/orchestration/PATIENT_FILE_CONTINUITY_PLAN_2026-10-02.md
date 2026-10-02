# Historical patient-file continuity

Build on the reviewed clinic-day baseline `d92c54be` while its final CI runs. The prior integration PR remains pinned; this work is a separate slice.

Outcome: an authorized clinician can add an explicitly classified document, photo or X-ray with source/date context; recover an uncertain upload without creating another asset; browse all patient files; open the exact metadata record from history; and request short-lived content access only when consent and scanning permit it.

Use existing media uploads/assets, mediated provider contracts, consent enforcement, audit and timeline. Add a bounded patient/type-filtered keyset page ordered by upload time plus UUID, a patient-scoped exact metadata read, and forward-only indexes. Historical record date is source evidence, distinct from upload time. Unknown source dates remain unknown. Original filenames remain sanitized; source metadata never grants scan or signature authority. Keep clinical file viewing separate from metadata access. No automatic raw Ray document import, AI interpretation, browser scraping or provider activation.

Implementation: domain validation → scoped repositories and native contract/registration → generated client → paged file UI/upload recovery → exact history view. Acceptance: >50 equal-time assets without duplicates/omissions, wrong patient/clinic/filter/deleted denial, strict MIME/source dates, real generated routes, uncertain retry, pending/quarantined denial, expiry, patient switch, desktop/mobile, synthetic real API/Postgres browser and complete workspace gates. Document official private-storage/scanner activation and clinic consent/export coverage as external requirements. All local state stays on Spectra; only approved isolated synthetic services may run.
