# Mobile Capture App

Owner: integrations/mobile workstream.

Checkpoint 8 provides the chairside capture foundation:

- Authenticated/session-aware shell through `GET /v1/me`.
- Patient and queue selection through existing ClinicOS API routes.
- Encounter context entry for already-open clinical encounters.
- Photo upload queue that targets the durable CP4 media sequence:
  `POST /v1/media/upload-urls`, `PUT /v1/media/uploads/{uploadId}/content`, and
  `POST /v1/media/uploads/{uploadId}/complete`.
- Secure cache abstraction that keeps raw bytes private and stores only sanitized queue snapshots.
- Audio controls that remain disabled unless consent enforcement reports both active
  `ai_audio_capture` and `raw_audio_retention` readiness.

Runtime commands:

```sh
npm run dev --workspace @clinic-os/mobile
npm run typecheck --workspace @clinic-os/mobile
npm run test --workspace @clinic-os/mobile
npm run build --workspace @clinic-os/mobile
```

Set `EXPO_PUBLIC_CLINIC_OS_API_URL` when the mobile shell should point at a non-default API host. The CP8 app renders authenticated-shell readiness, worklist context, explicit native-unavailable states, and consent-gated capture controls.
For local fixture auth, set `EXPO_PUBLIC_CLINIC_OS_DEV_SUBJECT` to a registered development subject such as the seeded assistant identity.

Native camera/audio packages are not registered in this lane because root lockfile reconciliation is integration-owned. The app uses typed provider contracts and honest unavailable states until an approved Expo camera/audio adapter is installed and reconciled.
