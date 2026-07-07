# Checkpoint 10 UX Polish Evidence

Date: 2026-07-07

## Scope

- Web registered-unavailable state for pilot settings/compliance/platform shells.
- Web role-boundary copy for direct navigation into unauthorized clinical surfaces.
- Mobile capture shell honest native-audio unavailable state.

## Browser Evidence

Codex in-app Browser was attempted first and blocked before page load:

- `Failed to connect to browser-use backend "iab". No Codex IAB backends were discovered.`

Playwright fallback was used because the CP10 lane prompt allows closest browser smoke when browser launch is blocked.

Screenshots:

- `/private/tmp/clinicos-cp10-settings-unavailable-desktop.png`
- `/private/tmp/clinicos-cp10-settings-unavailable-mobile-390.png`
- `/private/tmp/clinicos-cp10-accountant-role-boundary.png`

## Smoke Commands

- `CLINICOS_CP10_UX_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3010 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner npx playwright test tests/e2e/checkpoint-10-ux-polish-flow.spec.ts --grep "owner settings|390px"`
- `CLINICOS_CP10_UX_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3011 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=accountant npx playwright test tests/e2e/checkpoint-10-ux-polish-flow.spec.ts --grep "accountant direct"`

## Assertions

- Settings shell shows `Registered unavailable`, required API boundaries, and no fake pilot/provider/ABDM readiness claim.
- 390px settings shell has no horizontal overflow and keeps the disabled registered-unavailable control reachable.
- Accountant direct navigation to `/surface/encounter` shows a role boundary and does not render clinical workflow controls.
- Mobile audio remains disabled when consent is ready but the native recording adapter is not registered.
