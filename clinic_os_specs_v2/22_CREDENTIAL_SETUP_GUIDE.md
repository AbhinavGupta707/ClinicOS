# 22 - Credential Setup Guide

**Date:** 2026-07-10
**Status:** Current local presence/activation tracker; secrets remain external
**Purpose:** Give the autonomous implementation run a concrete, provider-by-provider credential handoff path without committing secrets.

## 1. Local Secret File

Use this ignored local file for the unattended checkpoint chain:

```text
.secrets/orchestration.env
```

The checked-in template is:

```text
docs/orchestration/orchestration.env.example
```

Never commit the real `.secrets/orchestration.env` file.

Keep it readable only by the local user:

```text
chmod 600 .secrets/orchestration.env
```

The master task may use this file for authorized integration checks. Worker worktrees must never copy, read, source or print it. Workers use deterministic fixtures/contracts and honest unavailable states; the master performs live AWS/provider verification after reviewed integration.

Credential **presence is not readiness**. Track every integration through `absent`, `registered`, `configured`, `sandbox_verified`, `production_verified`, `degraded`, and `disabled`. Diagnose provider registration/discovery and official activation before permissions/runtime. The 2026-07-09 audit found no provider at `production_verified`.

## 2. Verified Local Execution Surface

Verified through 2026-07-10:

| Surface | Status | Notes |
|---|---|---|
| GitHub remote | Ready | `origin` points to `https://github.com/AbhinavGupta707/ClinicOS.git`. |
| GitHub CLI | Ready | `gh auth status -h github.com` verified `AbhinavGupta707` through the keyring on 2026-07-10 with `repo` and `workflow` scopes. |
| npm/package network | Ready | `npm ping` succeeded. |
| Node/npm | Ready | Node `v22.22.2`, npm `10.9.7`. |
| Playwright CLI | Available | `npx --yes playwright --version` resolved `1.61.1`; project dependency and browser install still belong in Checkpoint 1. |
| Chrome extension control | Ready | Codex Chrome extension backend is reachable and exposes Playwright-style tab control. |
| Expo CLI | Available | `npx --yes expo --version` resolved `57.0.4`; actual Expo app setup belongs in the mobile checkpoint. |
| Xcode | Ready | Xcode `26.4`. |
| iOS simulators | Ready | iOS `26.4` simulators are available; XcodeBuildMCP project/scheme defaults will be configured after an app exists. |
| AWS CLI | Ready | AWS CLI `2.35.11`; `clinicos-human` resolved on 2026-07-10 to account `222634407676`. |
| AWS console/MFA | User-confirmed ready | Console access and both configured MFA methods were reported working on 2026-07-10; CLI STS was verified separately. |
| Terraform CLI | Absent | Install/activate and version-pin during CP14 preflight before Terraform validation/plan/apply evidence. |
| AWS Terraform backend | Ready | S3 state bucket and DynamoDB lock table are created in `ap-south-1`; names are stored only in `.secrets/orchestration.env`. |
| AWS cost controls | Ready for alerts | AWS Budgets near-zero alert is configured. This warns on spend; it is not a hard usage stop and cannot guarantee credits are used before card billing in every AWS billing path. |
| Razorpay sandbox API | Ready | Test key ID and secret are present locally and API auth has been verified. |
| Razorpay webhook secret | Ready locally | Secret is generated and stored locally; dashboard webhook URL must wait for a deployed HTTPS API endpoint. |
| Meta WhatsApp sandbox | Config present; not registered/verified | Core IDs, token, app secret, and verify token are present locally. No inbound API route/public callback/provider-side registration or sandbox event evidence exists. |
| Telephony | Absent | Required provider credentials/callback registration are not present. |
| AI/STT | Absent for live use | No approved live keys/model/base URL plus residency/retention/no-training authorization. Keep disabled/simulator-only. |
| ABDM | Absent | Credential fields are empty and official sandbox/compliance activation is not complete. |
| Production media | Absent | No S3/KMS runtime adapter or deployed storage resources. |

## 3. Razorpay Sandbox

Best default for ClinicOS:

- Use Razorpay Payment Links for patient-facing checkout links.
- Render the Payment Link URL as a QR code in ClinicOS for the front desk / chairside scan flow.
- Use Razorpay QR Codes when the clinic specifically wants UPI QR primitives managed by Razorpay.
- Subscribe to webhooks for payment success/failure reconciliation.

Setup:

1. Go to `https://dashboard.razorpay.com`.
2. Switch to Test Mode.
3. Go to Account & Settings -> API Keys.
4. Generate Test API keys.
5. Go to Account & Settings -> Webhooks.
6. Add a public HTTPS webhook URL once the API is deployed.
7. Create a webhook secret and enable payment/payment-link/QR events needed by the payment adapter.
8. If QR Codes are needed, enable/request QR Codes for the account from the Razorpay dashboard or point of contact.

Environment fields:

```text
PAYMENT_PROVIDER=razorpay
PAYMENT_QR_MODE=payment_link_qr
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
RAZORPAY_WEBHOOK_URL=https://.../webhooks/razorpay
```

Keep `PAYMENT_PROVIDER=simulator` even while credentials are stored. Select `razorpay` only when CP15 has deployed the canonical HTTPS callback and begins explicitly authorized sandbox verification.

Current local status:

- Test API credentials are present in `.secrets/orchestration.env`.
- `RAZORPAY_WEBHOOK_SECRET` is present in `.secrets/orchestration.env`.
- `RAZORPAY_WEBHOOK_URL` should remain empty until the API has a public HTTPS endpoint that preserves the raw request body and verifies Razorpay webhook signatures.

## 4. WhatsApp / Meta / BSP

Best default for ClinicOS:

- Build a provider adapter around WhatsApp Business Platform concepts, not one BSP's proprietary surface.
- Start with Meta Cloud API sandbox/direct credentials for technical validation.
- Choose a BSP later only if it improves Indian clinic onboarding, template approvals, support, billing, or phone-number operations.

Setup for Meta Cloud API:

1. Go to `https://developers.facebook.com`.
2. Create or open a Meta app.
3. Add the WhatsApp product.
4. In WhatsApp API setup, capture the temporary access token, test phone number, phone number ID, and WhatsApp Business Account ID.
5. Add your own recipient phone number for sandbox testing.
6. Configure a webhook callback URL once the API is deployed.
7. Set a webhook verify token that you also place in the env.
8. For production, create a permanent system-user access token, complete business verification, add a real phone number, and submit templates.

Environment fields:

```text
WHATSAPP_PROVIDER=meta_cloud
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_APP_ID=...
WHATSAPP_APP_SECRET=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=...
WHATSAPP_WEBHOOK_APP_SECRET_PROOF_REQUIRED=false
```

Keep `WHATSAPP_PROVIDER=simulator` even while credentials are stored. Select `meta_cloud` only when CP15 has deployed the canonical HTTPS callback and begins explicitly authorized sandbox verification.

Current local status:

- Meta Cloud API sandbox identifiers and access token are present in `.secrets/orchestration.env`.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN` is present in `.secrets/orchestration.env`.
- `WHATSAPP_APP_SECRET` is present locally; presence does not prove signature handling or provider registration.
- Do not configure the Meta webhook callback URL until the API has a public HTTPS endpoint that supports Meta verification challenge handling and signed webhook processing.

## 5. AWS

Best default for ClinicOS:

- Primary region: `ap-south-1`.
- Disaster recovery / backup region: `ap-south-2`.
- Prefer AWS IAM Identity Center / SSO for local human-controlled work.
- Prefer GitHub Actions OIDC -> AWS role assumption for CI/CD.
- Avoid long-lived access keys where possible.

For the local autonomous run, use the human-controlled `clinicos-human` profile. Never silently fall back to the older `clinicos` profile or long-lived environment credentials.

Recommended local SSO route:

```text
aws login --profile clinicos-human --region ap-south-1
```

or, for IAM Identity Center profiles:

```text
aws sso login --profile <profile>
```

Environment fields:

```text
AWS_PROFILE=clinicos-human
AWS_REGION=ap-south-1
AWS_DR_REGION=ap-south-2
AWS_ACCOUNT_ID=...
AWS_TERRAFORM_STATE_BUCKET=...
AWS_TERRAFORM_LOCK_TABLE=...
AWS_KMS_KEY_ALIAS=...
```

If using temporary env credentials instead of a profile:

```text
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...
```

Before every AWS-dependent checkpoint or mutation, run:

```text
aws sts get-caller-identity --profile clinicos-human
```

Require account `222634407676`. If the session is expired, stop and request:

```text
aws login --profile clinicos-human --region ap-south-1
```

Infra plan/apply, provider registration and recovery mutations remain master-only and still require the checkpoint's explicit authority.

Current local status:

- `aws sts get-caller-identity --profile clinicos-human` succeeded on 2026-07-10 for account `222634407676`.
- Terraform backend bucket and lock table values are present in `.secrets/orchestration.env`.
- `AWS_KMS_KEY_ALIAS` is not yet present and pilot-prod Terraform currently declares no providers/resources.
- `.secrets/orchestration.env` is mode `0600`, selects `clinicos-human`, and keeps Meta/Razorpay adapters on `simulator` until CP15.
- Do not use or silently fall back to `clinicos`. CP14 should define GitHub Actions OIDC and KMS resources before the master requests apply authority.

## 6. Webhook Registration Readiness

The provider dashboards must not be connected until CP15 exposes deployed HTTPS callbacks with production-grade verification. The current API includes `POST /v1/payment-webhooks/razorpay`; it is not deployed or registered. There is no current Meta WhatsApp inbound route or telephony callback. CP15 must choose one canonical generated-OpenAPI route family and update provider dashboards, adapters, tests, clients and runbooks together; do not add weak aliases for older route examples.

Required before dashboard registration:

- Public HTTPS API base URL.
- Raw body preservation before JSON parsing.
- WhatsApp verification challenge handler using `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
- Meta signature/app-secret verification where configured.
- Razorpay signature verification using `RAZORPAY_WEBHOOK_SECRET`.
- Raw webhook storage before normalization.
- Idempotency and replay handling.
- Provider-state reconciliation before any domain state change such as marking a payment paid.

Until those endpoints exist, local setup should stop at storing the secrets and provider IDs. Dashboard webhook registration belongs in the integration/deployment checkpoints.

## 7. AI Providers

Separate these two concerns:

- `LLM_PROVIDER`: clinical summarisation, extraction, task proposals, treatment-plan drafting.
- `TRANSCRIPTION_PROVIDER`: audio-to-text from the mobile capture app.

Fireworks AI is a reasonable LLM provider because it exposes an OpenAI-compatible endpoint and supports fast open-model inference. It should not be treated as the whole scribe stack unless a production-grade transcription route is also selected.

Recommended initial config if using Fireworks for LLM:

```text
LLM_PROVIDER=fireworks
LLM_BASE_URL=https://api.fireworks.ai/inference/v1
LLM_MODEL_PRIMARY=accounts/fireworks/models/kimi-k2-instruct-0905
FIREWORKS_API_KEY=...
TRANSCRIPTION_PROVIDER=simulator
```

For live transcription, choose one provider deliberately. Good candidates:

- OpenAI transcription API for straightforward managed ASR.
- Deepgram or another speech-specialist provider if diarisation, latency, language coverage, or cost is better for Indian clinic audio.
- On-device capture plus delayed server transcription if data minimisation is more important than realtime behavior.

Until that decision is made:

```text
TRANSCRIPTION_PROVIDER=simulator
```

## 8. Google Business Profile

Use:

- lead/source attribution,
- review monitoring and reply workflows,
- clinic location/profile data,
- optional post/update workflows later.

Google Business Profile APIs require Google approval and OAuth. There is no true sandbox, so early implementation should use source links and `validateOnly` where available.

Environment fields:

```text
GOOGLE_CLOUD_PROJECT=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_BUSINESS_PROFILE_LOCATION_ID=...
```

This is optional for the first autonomous run.

## 9. Telephony

Use:

- missed-call capture,
- call-source attribution,
- optional click-to-call,
- optional IVR/call routing,
- optional call event reconciliation.

Best India-first default: Exotel, because its docs and product surface are India-oriented and expose Mumbai-region API routing. Keep a provider abstraction so Twilio or another provider can be used later.

Environment fields for Exotel-style setup:

```text
TELEPHONY_PROVIDER=exotel
TELEPHONY_ACCOUNT_SID=...
TELEPHONY_API_KEY=...
TELEPHONY_API_TOKEN=...
TELEPHONY_REGION_SUBDOMAIN=api.in.exotel.com
TELEPHONY_VIRTUAL_NUMBER=...
TELEPHONY_WEBHOOK_SECRET=...
```

This is optional for the first autonomous run.

## 10. ABDM

Use:

- FHIR R4-ready exports,
- future consent-based health-record exchange,
- facility/provider identity alignment,
- optional ABHA-linked workflows after compliance readiness.

ABDM should not block day-one product adoption. Build internal FHIR projections first, then enable ABDM behind feature flags when sandbox credentials and compliance decisions are ready.

Environment fields:

```text
ABDM_CLIENT_ID=...
ABDM_CLIENT_SECRET=...
ABDM_BASE_URL=...
ABDM_HIP_ID=...
ABDM_HIU_ID=...
ABDM_CM_ID=...
```

This is optional for the first autonomous run.

## 11. Synthetic Pilot Data

Use synthetic data until the clinic explicitly approves real exports.

Generate fixtures for:

- patients,
- leads,
- appointments,
- procedures and pricebook,
- dental chart findings,
- invoices and payment states,
- prescriptions,
- post-op instructions,
- recalls,
- lab cases,
- inventory items,
- WhatsApp conversations,
- missed calls,
- X-ray/photo metadata,
- synthetic transcript/audio text.

Synthetic data should preserve workflow realism without using real patient identities. Recommended fixture locations:

```text
fixtures/synthetic/patients.csv
fixtures/synthetic/appointments.csv
fixtures/synthetic/pricebook.csv
fixtures/synthetic/templates/
fixtures/synthetic/transcripts/
fixtures/synthetic/media/
```

Environment fields:

```text
PILOT_SYNTHETIC_DATA_ONLY=true
PILOT_PATIENT_EXPORT_PATH=fixtures/synthetic/patients.csv
PILOT_APPOINTMENT_EXPORT_PATH=fixtures/synthetic/appointments.csv
PILOT_PRICEBOOK_PATH=fixtures/synthetic/pricebook.csv
PILOT_TEMPLATES_DIR=fixtures/synthetic/templates
PILOT_XRAY_SAMPLE_DIR=fixtures/synthetic/media
```

## 12. Source Links

- Razorpay API keys: `https://razorpay.com/docs/payments/dashboard/account-settings/api-keys/`
- Razorpay webhooks: `https://razorpay.com/docs/payments/dashboard/account-settings/webhooks/`
- Razorpay Payment Links: `https://razorpay.com/docs/payments/payment-links/`
- Razorpay QR Codes: `https://razorpay.com/docs/payments/qr-codes/`
- Meta WhatsApp Cloud API: `https://developers.facebook.com/docs/whatsapp/cloud-api/get-started`
- Meta WhatsApp webhooks: `https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks`
- AWS CLI IAM Identity Center: `https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html`
- GitHub Actions OIDC with AWS: `https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws`
- Fireworks quickstart: `https://docs.fireworks.ai/getting-started/quickstart`
- OpenAI speech-to-text: `https://platform.openai.com/docs/guides/speech-to-text`
- Google Business Profile basic setup: `https://developers.google.com/my-business/content/basic-setup`
- Exotel Voice API: `https://developer.exotel.com/docs/voice-v1/overview`
- ABDM sandbox: `https://sandbox.abdm.gov.in/`
