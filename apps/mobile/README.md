# Mobile Capture App

Owner: integrations/mobile workstream.

Checkpoint 1 creates the bootable Expo Router app shell. Checkpoint 8 builds chairside photo/audio capture, upload queue, consent gating, secure local cache, and mobile verification.

Runtime commands:

```sh
npm run dev --workspace @clinic-os/mobile
npm run typecheck --workspace @clinic-os/mobile
npm run test --workspace @clinic-os/mobile
npm run build --workspace @clinic-os/mobile
```

Set `EXPO_PUBLIC_CLINIC_OS_API_URL` when the mobile shell should point at a non-default API host. The CP1 app renders authenticated-shell readiness and explicit unavailable states only; it does not store patient media, recordings, offline queues, or clinical data before the Checkpoint 8 API and consent contracts exist.
