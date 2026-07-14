# ClinicOS Native Capture

This is the CP16 native photo/audio and secure-offline slice. It is an Expo development-build/internal-distribution app, not an Expo Go feature: SQLCipher and the private storage module require native prebuild and signing.

## Production boundary

- `expo-camera` captures patient-consented photos. `expo-audio` records AAC in an MP4/M4A container for at most 899 seconds. Background recording and playback are disabled.
- Capture fails closed unless a live session, clinic, patient, current consent, native permission, and (for audio) active verified encounter are present. Denied, permanently denied, unavailable, interrupted, offline, retry, outcome-uncertain, quarantine, and purge-failed states remain explicit.
- Temporary camera/recorder files are read once, AES-256-GCM sealed, and deleted in `finally`. They are never copied to the photo library or shared storage. The OS capture cache is transient plaintext until this immediate conversion completes.
- Media lives under an app-private, backup-excluded native directory. iOS verifies `NSFileProtectionComplete` and resource backup exclusion; Android uses `noBackupFilesDir` and the app also declares `allowBackup=false`.
- AES-GCM additional authenticated data binds the format version and opaque blob ID. Queue metadata and signed-target state use SQLCipher with cipher integrity checks, HMAC-backed page authentication, WAL, secure delete, and a per-install 256-bit key.
- AES and SQLCipher keys plus session tokens use SecureStore with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Biometric gating is deliberately not attached to background queue keys because an authentication-set change can orphan data; device passcode, device-only keychain storage, app screen-capture prevention, and app-switcher protection provide the platform boundary.
- The upload sequence is canonical: reserve, mediated/signed PUT, complete. `audio` maps to `mediaType: audio_chunk`, `mimeType: audio/mp4`; photos map to `intraoral_photo`. Nest mutations use persisted queue keys such as `<queue-id>:reserve`, `<queue-id>:content`, and `<queue-id>:complete`. A renewed expired reservation advances a persisted generation so network replay keeps the same key while a genuinely new reservation does not replay an expired target.
- The client never supplies scan authority and never treats a local PUT as proof of completion. Encrypted bytes are deleted only after the completion response validates the tenant-bound patient/encounter result. A completion conflict is `outcome uncertain`, not success.

## Durable queue and destructive purge

The `capture_queue` SQLCipher table binds every item to tenant, clinic, patient, optional encounter, media kind/MIME, digest, capture time, duration, byte count, retry state, lease owner/expiry, reservation generation, encrypted target JSON, and safe diagnostic code. The claim transaction moves due `queued`/`retry_wait` items to a two-minute lease and increments the attempt count. Startup releases expired interrupted leases; exponential backoff uses bounded jitter, eight automatic attempts, a 15-minute cap, 25 items, 250 MiB total, 15 MiB/photo, 24 MiB/audio, and a 200 MiB post-write free-space floor.

States are `queued → leased → reserved → uploading → completing → purging → removed`. Failures become `retry_wait`, `manual_retry_required`, `quarantined`, or `purge_failed`. Process death may leave a lease until its two-minute expiry; no success/deletion message is shown during that interval.

Logout and administrative revocation use a destructive contract:

1. The UI becomes signed out and SecureStore session-token deletion is attempted independently of disk deletion.
2. Active network work is aborted and joined.
3. Sealed and quarantine directories are deleted and absence is verified.
4. SQLCipher is checkpointed and closed; the DB, `-wal`, `-shm`, and journal files are deleted and absence is verified.
5. Only after steps 3–4 succeed are the media/database keys destroyed (cryptographic erase).

If physical deletion fails, the UI stays signed out, tokens are not intentionally retained, capture keys are kept so an administrator can retry deletion, and the app reports that purge was not verified. An online 401/admin session revocation runs the same destructive path. An offline lost device cannot receive a server revocation; clinic policy must additionally use the enrolled platform’s MDM/device-wipe control. Neither remote revocation nor wipe is claimed without physical-device/provider evidence.

## Public configuration

Copy `.env.example` to an ignored local environment file. `EXPO_PUBLIC_CLINIC_OS_API_URL` must be an approved HTTPS origin; loopback HTTP is accepted only under `__DEV__`. Public environment variables must never contain credentials, secrets, tokens, or identifiers. SecureStore can consume tokens provisioned by the official authentication activation flow; this lane does not invent a Keycloak client or credentials. The development-subject header is ignored unless both `__DEV__` and `EXPO_PUBLIC_CLINIC_OS_ALLOW_DEV_SUBJECT=true` are present.

`app.json` declares iOS/Android camera and microphone permissions, no background audio, iOS privacy-manifest categories, iOS 16.4 deployment target, Android API 24 minimum, Android backup disablement, SQLCipher, and blocked shared-media permissions. `eas.json` is a credential-free template for development, simulator, internal preview, and store profiles. Signing remains external.

See `PRIVACY_DISCLOSURES_TEMPLATE.md` before any store submission. Product/legal owners must reconcile the template with deployed telemetry, support, retention, subprocessors, and store-console answers.

## Executable local gates

From the repository root, using this worktree’s dependencies only:

```sh
npm ci --prefer-offline --no-audit
npm run typecheck --workspace @clinic-os/mobile
npm run lint --workspace @clinic-os/mobile
npm test --workspace @clinic-os/mobile
npm run config:verify --workspace @clinic-os/mobile
npm run dependencies:verify --workspace @clinic-os/mobile
npm run build --workspace @clinic-os/mobile
pod ipc spec apps/mobile/modules/clinic-secure-storage/ios/ClinicSecureStorage.podspec >/dev/null
pod lib lint apps/mobile/modules/clinic-secure-storage/ios/ClinicSecureStorage.podspec --private --quick --skip-import-validation
```

Supplemental web smoke (it must show native-unavailable, never fake capture):

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory apps/mobile/dist
MOBILE_WEB_URL=http://127.0.0.1:4173 npm run smoke:web --workspace @clinic-os/mobile
```

Prebuild without adding generated native folders to this worktree:

```sh
rm -rf /tmp/clinicos-mobile-prebuild
mkdir -p /tmp/clinicos-mobile-prebuild
rsync -a --exclude node_modules apps/mobile/ /tmp/clinicos-mobile-prebuild/
ln -s "$PWD/apps/mobile/node_modules" /tmp/clinicos-mobile-prebuild/node_modules
cd /tmp/clinicos-mobile-prebuild
npx expo prebuild --no-install --platform ios
npx expo prebuild --no-install --platform android
```

## External E4 device/signing matrix — required, not executed here

Use synthetic clinic records only. Record device model, OS/build, app commit, EAS build ID, tester, UTC time, expected/actual result, and evidence link for every row.

| Platform | Required device/build | Required scenarios |
|---|---|---|
| iOS minimum | Physical iPhone on iOS 16.4, internal development build | Fresh install; camera/microphone grant, deny, permanent deny, Settings recovery; photo/audio capture; app-switcher privacy; screen capture blocked; locked-device SecureStore behavior |
| iOS current | Physical iPhone on the current clinic-supported iOS release, signed preview build | Phone call/Siri/audio interruption; foreground/background; force quit; reboot; offline-to-online replay; consent revocation; logout file/key purge; low-disk policy |
| Android minimum | Physical Android API 24 device, signed preview build | Fresh install; runtime permission grant/deny/don’t-ask-again; no shared-media permission; airplane mode; force-stop; reboot; upload retry and purge |
| Android current | Physical device on the EAS-generated target SDK/current Play-required release | Camera/microphone interruption; process death; network handoff; app-switcher/screenshot protection; `noBackupFilesDir`; logout DB/WAL/SHM/blob/key purge |
| Lost/admin revoked | One physical iOS and one physical Android device enrolled in the approved admin/MDM path | Queue media offline; revoke the official session; confirm offline device does not claim purge; reconnect; confirm 401-triggered token/data/key purge; separately execute and evidence MDM wipe |
| Distribution | TestFlight/internal Play or approved EAS internal distribution | Install/upgrade/rollback policy, signature/provenance, environment origin, privacy disclosures, crash-free cold start, no Expo Go dependency |

Credentialed build commands (an authorized release owner must run them; no result is claimed here):

```sh
cd apps/mobile
npx eas-cli@latest whoami
npx eas-cli@latest config --platform ios --profile preview
npx eas-cli@latest config --platform android --profile preview
npx eas-cli@latest build --platform ios --profile preview --non-interactive
npx eas-cli@latest build --platform android --profile preview --non-interactive
```

Device interruption examples:

```sh
adb shell am force-stop com.clinicos.mobile
adb reboot
adb shell pm revoke com.clinicos.mobile android.permission.CAMERA
adb shell pm revoke com.clinicos.mobile android.permission.RECORD_AUDIO
adb shell dumpsys package com.clinicos.mobile
```

On iOS, use Xcode Devices and Simulators plus the physical device Settings app to revoke permissions, terminate/relaunch, inspect Data Protection, and capture device logs. Simulator/browser results are supplemental and do not replace the physical matrix, signed installation, MDM revocation/wipe, backup/restore, or store privacy evidence.
