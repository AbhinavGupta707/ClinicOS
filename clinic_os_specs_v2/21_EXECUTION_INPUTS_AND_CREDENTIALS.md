# 21 - Execution Inputs and Credentials Checklist

**Date:** 2026-07-09
**Status:** Current CP11-CP18 external-input checklist
**Purpose:** List the information, accounts, and credentials needed for autonomous end-to-end implementation and verification.

> CP11 was executed in one master session. CP12-CP18 use master-orchestrated visible worktrees. This file tracks external inputs/authority by remediation checkpoint; credential presence never equals provider activation and does not broaden worker authority.

## 1. Important Secret Handling Rule

Do not commit secrets to the repository.

Use one of these patterns:

- preferred for local autonomous runs: `.secrets/orchestration.env`,
- local `.env.local` / `.env` files excluded by `.gitignore`,
- GitHub Actions secrets,
- cloud secrets manager,
- already-authenticated CLI/browser sessions,
- temporary sandbox credentials that can be rotated.

Do not paste production PHI, patient data, live payment secrets, or long-lived production credentials into Markdown files.

## 1.1 Recommended Local Handoff

For the autonomous checkpoint chain, use:

```text
.secrets/orchestration.env
```

This directory is ignored by Git. Use `docs/orchestration/orchestration.env.example` as the template.

For provider-specific setup steps, use `22_CREDENTIAL_SETUP_GUIDE.md`.

Rules:

- Use sandbox/test credentials wherever possible.
- Use production credentials only when explicitly needed and revocable.
- Prefer already-authenticated CLI/browser sessions for GitHub/AWS where practical.
- Rotate credentials after long autonomous runs.
- Never place real patient data in this file.
- Store sample clinic data as synthetic CSV/PDF files unless the clinic has explicitly approved real exports for testing.

## 2. Needed Before Checkpoint 0

Required:

- GitHub repository URL: `https://github.com/AbhinavGupta707/ClinicOS`
- Confirmation that the repository exists and the current machine has push access.
- Preferred default branch name: `main` unless you want otherwise.

Helpful:

- Whether to keep this exact local path as the implementation repo: `/Users/abhinavgupta/Desktop/ClinicOS`.
- Whether GitHub CLI (`gh`) is authenticated on this machine, or whether Git credential manager already has access.

## 3. Needed Before Checkpoint 1

Usually no live third-party credentials are required.

Useful inputs:

- Preferred package manager if you care: npm, pnpm, or yarn. Current checkpoint plan can use npm because it is installed.
- Preferred database provider for deployed environments, if already chosen. Default is AWS RDS/Aurora PostgreSQL.
- Any company/org naming conventions for package names, app names, or domains.

## 4. Needed Before Provider-Backed Checkpoints

### WhatsApp / Messaging

Needed by Checkpoint 7 for live sandbox testing:

- Meta Business account access or chosen BSP account.
- WhatsApp Business phone number or test number.
- App ID / phone number ID / business account ID where applicable.
- Access token or sandbox credentials.
- Webhook verify token.
- Approved message templates or permission to create sandbox templates.

Can proceed earlier with:

- Contract-tested simulator.
- Manual source capture.
- Provider capability set to unavailable.

### Razorpay / Payments

Needed by Checkpoint 5 or 7 for sandbox/live payment verification:

- Razorpay sandbox account.
- Key ID and key secret.
- Webhook secret.
- Permission to create QR Codes and Payment Links.
- Test UPI/payment flow details from Razorpay sandbox.

Can proceed earlier with:

- Payment provider simulator for contract tests.
- Manual payment recording with audit.

### Telephony / Missed Calls

Needed by Checkpoint 7 if live missed-call capture is required:

- Exotel/Knowlarity/Twilio-like sandbox or account.
- Virtual number.
- API credentials.
- Webhook/callback URL configuration access.

Can proceed earlier with:

- Manual missed-call entry.
- Telephony provider unavailable state.

### Google Business Profile

Needed by Checkpoint 7+ for live Google integration:

- Google Cloud project.
- OAuth client credentials.
- Business Profile access to the clinic listing.
- Test location/profile link.

Can proceed earlier with:

- Profile/review links.
- UTM/source attribution.

### Practo / Existing PMS / Ray / Eka

Needed for migration/import checkpoints:

- Sample exports: patients, appointments, invoices, clinical notes, prescriptions, reminders where available.
- Export format examples: CSV/XLS/PDF/JSON.
- Clear statement of what the clinic is allowed to export/import.
- No dashboard scraping credentials should be used unless there is explicit official permission and a compliant integration route.

Can proceed earlier with:

- Manual Practo source capture.
- Sample synthetic import files.

## 5. Needed Before AI / Scribe Checkpoint

Needed by Checkpoint 8 for live AI testing:

- AI provider choice and API key, such as OpenAI or another approved provider.
- LLM provider choice and API key, such as Fireworks AI, OpenAI, or another approved provider.
- Transcription provider choice and API key, if live mobile scribe transcription is required.
- Data retention preferences.
- Whether audio can leave India-region infrastructure during pilot, or whether stricter data-residency constraints apply.
- Consent language for audio recording and AI draft generation.
- Sample synthetic consultation transcripts.
- Preferred languages used in clinic: English, Hindi, Hinglish, regional languages.

Can proceed earlier with:

- Deterministic AI fixtures.
- Contract-tested AI provider simulator.
- Golden transcript evaluation files.

## 6. Needed Before Mobile / App Checks

Needed by Checkpoint 8:

- Target devices: iOS, Android, or both.
- Whether the pilot uses clinic-owned phones/tablets or staff personal devices.
- Apple Developer account if TestFlight/device distribution is required.
- Google Play Console account if Android internal testing is required.
- Camera/audio consent expectations.

Can proceed earlier with:

- Expo local development.
- Expo web checks.
- Simulator checks where local tooling is available.

## 7. Needed Before Cloud / Pilot-Prod Hardening

Needed by Checkpoint 9:

- AWS account access.
- Permission model: IAM user/role or SSO access.
- Billing/project tagging preferences.
- Domain name and DNS access if custom domains are needed.
- Email/SMS sender preferences.
- Sentry or equivalent error monitoring account, if chosen.
- Alerting destination: email, Slack, phone, etc.

Can proceed earlier with:

- Local and staging-like Docker environments.
- Terraform plans without applying to production.

## 8. Needed Before ABDM / FHIR Live Work

Needed by Checkpoint 9+:

- ABDM sandbox access.
- HPR/HFR/provider/facility details if available.
- ABHA test identities.
- Consent/data exchange test credentials.
- Legal/compliance decision on when ABDM is enabled for real patients.

Can proceed earlier with:

- Internal FHIR projections.
- Synthetic sample FHIR bundles.
- Feature-gated ABDM fields.

## 9. Needed From Pilot Clinic

Needed before release-candidate/pilot:

- Current software used: Practo/Ray/Eka/other/PMS.
- Sample patient export with synthetic or approved test data.
- Appointment types and working hours.
- Pricebook/procedure list.
- Prescription templates.
- Post-op instruction templates.
- Recall message templates.
- Lab slip/card examples.
- Inventory checklist examples.
- Event-management diary examples.
- Consent forms/language currently used.
- Current payment method and QR/provider setup.
- Current WhatsApp setup.
- X-ray software name and export options.
- Devices available in clinic.

## 10. What Can Be Fully Autonomous Without Credentials

The agent can proceed autonomously with:

- scaffold,
- local dev environment,
- domain models,
- APIs,
- UI workflows,
- test fixtures,
- simulated provider contracts,
- migration parsers with synthetic samples,
- AI deterministic fixtures,
- FHIR synthetic exports,
- browser checks against local app,
- Expo web/mobile simulator checks when available.

Live end-to-end provider verification needs the relevant sandbox/live credentials above.

## 11. Full Autonomous Launch Inputs

Before launching Checkpoint 1 through Checkpoint 10 unattended, provide as much of this as possible:

| Category | Required for full live verification? | Can use simulator if missing? |
|---|---:|---:|
| GitHub push access | Yes | No |
| Local package install/build access | Yes | No |
| Browser automation / Playwright install | Yes for UI checkpoints | Limited manual/code evidence only |
| Expo/mobile simulator tooling | Yes for mobile-native checks | Expo web only |
| Razorpay sandbox | Yes for live payment checks | Yes, until payment hardening |
| WhatsApp/BSP sandbox | Yes for live messaging checks | Yes, until live integration hardening |
| Telephony sandbox | Optional for first full run | Yes |
| LLM provider key | Yes for live AI drafting/extraction checks | Yes, deterministic AI fixtures |
| Transcription provider key | Yes for live audio-to-text checks | Yes, golden transcript fixtures |
| AWS access | Yes for pilot-prod infra apply | Terraform plan/local infra only |
| ABDM sandbox | Yes for ABDM live checks | FHIR synthetic export only |
| Google Business Profile access | Optional early | Source/link simulation |
| Practo/PMS exports | Optional early | Synthetic import samples |
| Pilot clinic templates/data | Yes for realistic release candidate | Synthetic clinic fixtures |

If these are incomplete, the orchestrator can still run the chain, but it must mark live verification gaps clearly in the checkpoint log.
