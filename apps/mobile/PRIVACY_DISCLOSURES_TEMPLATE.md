# Mobile Privacy Disclosure Template

Status: source template only. Product, privacy, security, and legal owners must approve deployed facts before copying any answer into App Store Connect, Play Console, a privacy notice, or a data-safety form.

## Declared local slice

| Data category | Purpose | Linked | Tracking | Local handling |
|---|---|---:|---:|---|
| Health/clinical context | App functionality | Yes | No | Tenant/clinic/patient/encounter bindings in SQLCipher |
| Photos/videos | App functionality | Yes | No | Camera photo is immediately AES-256-GCM sealed; no photo-library write |
| Audio data | App functionality | Yes | No | Consent-gated AAC/MP4 recording is immediately sealed; no background recording |
| User ID/session | Authentication and app functionality | Yes | No | Device-only SecureStore token/key handling |

The app code in this lane does not declare advertising, cross-app tracking, analytics SDKs, contacts, location, photo-library reads, shared-media storage, or background audio. Re-audit the complete integrated dependency graph and deployed telemetry before release; absence in this lane is not proof of absence in the distributed product.

## Questions requiring owner-approved deployed facts

- Controller/legal entity, privacy contact, grievance contact, clinic processor/controller roles, countries of processing, and age/minor handling.
- Server-side media retention, raw-audio retention, derived transcript retention, backups, disaster-recovery copies, deletion SLAs, legal holds, and patient-request workflows.
- Production identity provider, hosting/storage regions, subprocessors, signed-upload provider, observability/crash provider, customer support tooling, and any data export.
- Store privacy-policy URL, support URL, account-deletion URL/process, and exact App Store/Play data-safety answers.
- MDM enrollment, lost-device response, remote session revocation, remote wipe, device passcode/jailbreak/root policy, and evidence owner.
- Encryption export-compliance determination for Expo Crypto/SQLCipher and jurisdiction-specific health/privacy review.

## Release evidence checklist

- Approved data-flow diagram matches the integrated binary and live providers.
- Dependency/SBOM scan and privacy-manifest merge reviewed from the signed archive/AAB.
- Physical iOS/Android backup/restore confirms capture media and SQLCipher artifacts are excluded.
- Consent grant/revoke and raw-audio purge verified against the live authorization service.
- Logout, admin revocation, and MDM lost-device tests prove the documented behavior without claiming completion before verified deletion.
- Store-console screenshots/exports, approved privacy notice, DPA/subprocessor register, and sign-off are retained in the master-owned evidence location.
