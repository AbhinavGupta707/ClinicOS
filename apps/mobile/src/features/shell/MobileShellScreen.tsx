import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState
} from "expo-audio";
import { CameraView, useCameraPermissions } from "expo-camera";
import { File } from "expo-file-system";
import * as Network from "expo-network";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  ClinicOsApiClient,
  type ConsentEnforcementState,
  type EncounterSummary,
  type MobileSession,
  type PatientSummary,
  type QueueEntrySummary
} from "../../lib/apiClient";
import { mobileSystemClock } from "../../lib/clock";
import {
  ClinicOsCaptureAuthorization,
  ClinicOsCaptureTransport
} from "../capture/adapters/clinicOsCaptureTransport";
import { ExpoEncryptedCaptureBlobStore } from "../capture/adapters/encryptedBlobStore";
import { ExpoCaptureDigestProvider } from "../capture/adapters/expoCrypto";
import { ExpoNetworkReachability } from "../capture/adapters/networkReachability";
import { ProtectedCaptureDirectory } from "../capture/adapters/protectedDirectory";
import { SecureCaptureKeyVault } from "../capture/adapters/secureKeyVault";
import { ExpoSqlCipherQueueRepository } from "../capture/adapters/sqliteQueueRepository";
import { UnavailableLiveCaptureBoundary } from "../capture/adapters/unavailableLiveBackend";
import {
  audioConsentState,
  evaluateAudioControl,
  permissionStateFromResponse,
  type PermissionState
} from "../capture/audioConsent";
import { BoundedDiagnosticBuffer } from "../capture/diagnostics";
import { performSecureSignOut } from "../capture/secureSignOut";
import type { CaptureBinding, UploadQueueItem } from "../capture/types";
import { CaptureQueueError, DurableCaptureQueue } from "../capture/uploadQueue";

const apiOrigin = process.env.EXPO_PUBLIC_CLINIC_OS_API_URL?.trim() ?? "";
const allowDevSubject =
  typeof __DEV__ !== "undefined" &&
  __DEV__ &&
  process.env.EXPO_PUBLIC_CLINIC_OS_ALLOW_DEV_SUBJECT === "true";
const configuredDevSubject = allowDevSubject
  ? process.env.EXPO_PUBLIC_CLINIC_OS_DEV_SUBJECT?.trim() || null
  : null;
const activeEncounterStatuses = new Set(["drafting", "ready_for_sign"]);

type RuntimeState =
  | { status: "native_unavailable" }
  | { status: "starting" }
  | { status: "ready"; queue: DurableCaptureQueue; keys: SecureCaptureKeyVault }
  | { status: "failed"; message: string };

type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "failed"; message: string };

export function MobileShellScreen() {
  const clientResult = useMemo(() => createClient(), []);
  const api = clientResult.api;
  const [runtime, setRuntime] = useState<RuntimeState>(
    Platform.OS === "web" ? { status: "native_unavailable" } : { status: "starting" }
  );
  const [session, setSession] = useState<LoadState<MobileSession>>(
    api ? { status: "loading" } : { status: "failed", message: clientResult.message }
  );
  const [patients, setPatients] = useState<LoadState<PatientSummary[]>>({ status: "idle" });
  const [worklist, setWorklist] = useState<LoadState<QueueEntrySummary[]>>({ status: "idle" });
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [encounterInput, setEncounterInput] = useState("");
  const [encounter, setEncounter] = useState<EncounterSummary | null>(null);
  const [consent, setConsent] = useState<ConsentEnforcementState | null | undefined>(undefined);
  const [queueItems, setQueueItems] = useState<readonly UploadQueueItem[]>([]);
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraPermission, requestCameraPermission, refreshCameraPermission] =
    useCameraPermissions();
  const [microphonePermission, setMicrophonePermission] = useState<PermissionState>({
    state: "checking"
  });
  const [showCamera, setShowCamera] = useState(false);
  const cameraRef = useRef<CameraView | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const interruptionMessage = useRef<string | null>(null);
  const recordingBinding = useRef<CaptureBinding | null>(null);
  const protectedAudioUri = useRef<string | null>(null);

  const selectedClinic =
    session.status === "loaded"
      ? (session.data.clinics.find((clinic) => clinic.id === clinicId) ?? null)
      : null;
  const binding: CaptureBinding | null =
    session.status === "loaded" && selectedClinic && patientId
      ? {
          tenantId: session.data.tenant.id,
          clinicId: selectedClinic.id,
          patientId,
          encounterId: encounter?.id ?? null
        }
      : null;
  const nativeReady = runtime.status === "ready";
  const photoConsentReady =
    consent !== null &&
    consent !== undefined &&
    consent.activePurposes.includes("photo_capture") &&
    !consent.revokedPurposes.includes("photo_capture");
  const audioDecision = evaluateAudioControl({
    native: Platform.OS !== "web",
    patientId,
    encounterVerified: encounter !== null,
    consent: audioConsentState(consent),
    permission: microphonePermission
  });

  const refreshProtectedQueue = useCallback(async () => {
    if (runtime.status === "ready") setQueueItems(await runtime.queue.list());
  }, [runtime]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let cancelled = false;
    const keys = new SecureCaptureKeyVault();
    const root = new ProtectedCaptureDirectory();
    const repository = new ExpoSqlCipherQueueRepository(root, keys);
    const blobs = new ExpoEncryptedCaptureBlobStore(root, keys);
    const liveBoundary = api
      ? {
          transport: new ClinicOsCaptureTransport(api),
          authorization: new ClinicOsCaptureAuthorization(api)
        }
      : (() => {
          const unavailable = new UnavailableLiveCaptureBoundary();
          return { transport: unavailable, authorization: unavailable };
        })();
    const queue = new DurableCaptureQueue({
      repository,
      blobs,
      digest: new ExpoCaptureDigestProvider(),
      transport: liveBoundary.transport,
      authorization: liveBoundary.authorization,
      network: new ExpoNetworkReachability(),
      diagnostics: new BoundedDiagnosticBuffer(),
      onSessionRevoked: async (localStorageDeleted) => {
        let sessionTokensCleared = false;
        let captureKeysDestroyed = false;
        try {
          await keys.clearSessionTokens();
          sessionTokensCleared = true;
        } catch {
          // Keep the UI signed out and report the failed secure-store operation.
        }
        if (localStorageDeleted) {
          try {
            await keys.destroyCaptureKeysAfterVerifiedPurge();
            captureKeysDestroyed = true;
          } catch {
            // Ciphertext is verified absent; key deletion still requires operator attention.
          }
        }
        setPatientId(null);
        setEncounter(null);
        setConsent(undefined);
        setSession({
          status: "failed",
          message: "This device session was revoked. Official sign-in is required."
        });
        setQueueItems([]);
        setAction(
          sessionTokensCleared && localStorageDeleted && captureKeysDestroyed
            ? "Administrative revocation verified: session, local media, database files, and capture keys were removed."
            : "Session revoked and UI signed out, but one or more local deletion checks require administrator follow-up."
        );
      }
    });
    void queue
      .initialize()
      .then(async () => {
        if (cancelled) return;
        setQueueItems(await queue.list());
        setRuntime({ status: "ready", queue, keys });
        await queue.drain().catch(() => undefined);
        if (!cancelled) setQueueItems(await queue.list());
      })
      .catch((error: unknown) => {
        if (!cancelled) setRuntime({ status: "failed", message: safeMessage(error) });
      });
    return () => {
      cancelled = true;
      queue.abortActive();
    };
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .getSession()
      .then((loaded) => {
        if (cancelled) return;
        setSession({ status: "loaded", data: loaded });
        const firstClinic = loaded.clinics[0]?.id ?? null;
        setClinicId(firstClinic);
        api.setClinicId(firstClinic);
      })
      .catch((error: unknown) => {
        if (!cancelled) setSession({ status: "failed", message: safeMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (Platform.OS === "web") {
      setMicrophonePermission({ state: "unavailable", reason: "Native microphone required." });
      return;
    }
    let cancelled = false;
    void getRecordingPermissionsAsync().then((response) => {
      if (!cancelled) setMicrophonePermission(permissionStateFromResponse(response));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (runtime.status !== "ready") return;
    const queue = runtime.queue;
    const appSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        queue.abortActive();
        if (recorder.isRecording) {
          interruptionMessage.current =
            "Recording was interrupted when ClinicOS left the foreground.";
          void stopAndProtectAudio(true);
        }
      } else {
        if (api)
          void queue
            .drain()
            .then(refreshProtectedQueue)
            .catch(() => undefined);
        if (interruptionMessage.current) {
          setAction(interruptionMessage.current);
          interruptionMessage.current = null;
        }
        void refreshCameraPermission();
        void getRecordingPermissionsAsync().then((response) => {
          setMicrophonePermission(permissionStateFromResponse(response));
        });
      }
    });
    const networkSubscription = Network.addNetworkStateListener((state) => {
      if (api && state.isConnected && state.isInternetReachable !== false) {
        void queue
          .drain()
          .then(refreshProtectedQueue)
          .catch(() => undefined);
      }
    });
    return () => {
      appSubscription.remove();
      networkSubscription.remove();
    };
  });

  useEffect(() => {
    const uri = recorderState.url;
    if (
      recorderState.isRecording ||
      !uri ||
      recorderState.durationMillis < 1 ||
      protectedAudioUri.current === uri
    ) {
      return;
    }
    protectedAudioUri.current = uri;
    void protectAudioFile(uri, recorderState.durationMillis, true);
  }, [recorderState.durationMillis, recorderState.isRecording, recorderState.url]);

  async function refreshWorklist() {
    if (!api || !selectedClinic) return;
    setPatients({ status: "loading" });
    setWorklist({ status: "loading" });
    setAction(null);
    try {
      const date = dateInTimeZone(selectedClinic.timezone);
      const [patientRows, queueRows] = await Promise.all([api.listPatients(), api.listQueue(date)]);
      setPatients({ status: "loaded", data: patientRows });
      setWorklist({ status: "loaded", data: queueRows });
    } catch (error) {
      const message = safeMessage(error);
      setPatients({ status: "failed", message });
      setWorklist({ status: "failed", message });
    }
  }

  async function selectPatient(nextPatientId: string) {
    if (!api) return;
    setPatientId(nextPatientId);
    setEncounter(null);
    setEncounterInput("");
    setConsent(undefined);
    setAction(null);
    try {
      const nextConsent = await api.getPatientConsents(nextPatientId);
      setConsent(nextConsent);
      if (
        runtime.status === "ready" &&
        (nextConsent.revokedPurposes.includes("ai_audio_capture") ||
          nextConsent.revokedPurposes.includes("raw_audio_retention"))
      ) {
        await runtime.queue.purgeRevokedAudio(nextPatientId);
        await refreshProtectedQueue();
      }
    } catch (error) {
      setConsent(null);
      setAction(`Consent unavailable: ${safeMessage(error)}`);
    }
  }

  async function verifyEncounter() {
    if (!api || !patientId || !encounterInput.trim()) return;
    setBusy(true);
    setEncounter(null);
    try {
      const candidate = await api.getEncounter(encounterInput.trim());
      if (candidate.patientId !== patientId || !activeEncounterStatuses.has(candidate.status)) {
        throw new Error("The encounter is not active for the selected patient.");
      }
      setEncounter(candidate);
      setEncounterInput("");
      setAction("Active encounter verified. Audio capture can now be evaluated.");
    } catch (error) {
      setAction(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function requestMicrophone() {
    if (audioDecision.reason !== "permission_required") return;
    const response = await requestRecordingPermissionsAsync();
    setMicrophonePermission(permissionStateFromResponse(response));
  }

  async function capturePhoto() {
    if (!binding || !nativeReady || !photoConsentReady || !cameraRef.current) return;
    setBusy(true);
    setAction(null);
    let temporary: File | null = null;
    try {
      const picture = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        base64: false,
        exif: false
      });
      temporary = new File(picture.uri);
      const bytes = await temporary.bytes();
      await runtime.queue.enqueue({
        kind: "photo",
        binding,
        bytes,
        mimeType: picture.format === "png" ? "image/png" : "image/jpeg",
        capturedAt: mobileSystemClock.now().toISOString(),
        durationMs: null
      });
      setShowCamera(false);
      setAction(
        "Photo encrypted and queued. No upload is claimed until server completion confirms it."
      );
      await runtime.queue.drain();
    } catch (error) {
      setAction(safeMessage(error));
    } finally {
      if (temporary?.exists) temporary.delete();
      await refreshProtectedQueue().catch(() => undefined);
      setBusy(false);
    }
  }

  async function startAudio() {
    if (!audioDecision.enabled || !binding || !binding.encounterId || runtime.status !== "ready")
      return;
    setBusy(true);
    setAction(null);
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        interruptionMode: "doNotMix"
      });
      await recorder.prepareToRecordAsync();
      recordingBinding.current = { ...binding };
      recorder.record({ forDuration: 899 });
    } catch (error) {
      setAction(safeMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function stopAndProtectAudio(interrupted = false) {
    if (!recorder.isRecording || !recordingBinding.current || runtime.status !== "ready") return;
    setBusy(true);
    const durationMs = Math.max(1, recorderState.durationMillis);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error("The recorder did not return a protected local source.");
      protectedAudioUri.current = uri;
      await protectAudioFile(uri, durationMs, interrupted);
    } catch (error) {
      if (!interrupted) setAction(safeMessage(error));
      else
        interruptionMessage.current =
          "Interrupted recording could not be safely queued and was discarded.";
    } finally {
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      await refreshProtectedQueue().catch(() => undefined);
      setBusy(false);
    }
  }

  async function protectAudioFile(uri: string, durationMs: number, automaticStop: boolean) {
    const capturedBinding = recordingBinding.current;
    if (!capturedBinding || runtime.status !== "ready") return;
    let temporary: File | null = new File(uri);
    try {
      const bytes = await temporary.bytes();
      await runtime.queue.enqueue({
        kind: "audio",
        binding: capturedBinding,
        bytes,
        mimeType: "audio/mp4",
        capturedAt: mobileSystemClock.now().toISOString(),
        durationMs
      });
      setAction(
        automaticStop
          ? "Audio stopped at the foreground or duration boundary, then encrypted and queued."
          : "Audio encrypted and queued after the local consent gate."
      );
      await runtime.queue.drain();
    } catch (error) {
      setAction(safeMessage(error));
    } finally {
      if (temporary.exists) temporary.delete();
      temporary = null;
      recordingBinding.current = null;
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      await refreshProtectedQueue().catch(() => undefined);
    }
  }

  async function processQueue() {
    if (runtime.status !== "ready") return;
    await runQueueAction(async () => {
      await runtime.queue.drain(10);
      setAction(
        "Queue processing finished. Items remain unless server completion and local purge both succeeded."
      );
    });
  }

  async function retryQueueItem(id: string) {
    if (runtime.status !== "ready") return;
    await runQueueAction(async () => {
      await runtime.queue.retry(id);
      await runtime.queue.processNext();
    });
  }

  async function purgeQueueItem(id: string) {
    if (runtime.status !== "ready") return;
    await runQueueAction(async () => {
      await runtime.queue.purge(id);
      setAction("Protected local capture was deleted and its queue record removed.");
    });
  }

  async function purgeAndLogout() {
    if (runtime.status !== "ready") return;
    setBusy(true);
    setPatientId(null);
    setEncounter(null);
    setConsent(undefined);
    setSession({ status: "failed", message: "Signed out. Restart official sign-in to continue." });
    const result = await performSecureSignOut({
      clearSessionTokens: () => runtime.keys.clearSessionTokens(),
      shutdownAndDeleteLocalState: () => runtime.queue.shutdownAndDeleteLocalState(),
      destroyCaptureKeysAfterVerifiedPurge: () =>
        runtime.keys.destroyCaptureKeysAfterVerifiedPurge()
    });
    setQueueItems([]);
    setBusy(false);
    setAction(
      result.sessionTokensCleared && result.localStateDeleted && result.captureKeysDestroyed
        ? "Logout purge verified: session tokens, SQLCipher database files, encrypted media, and capture keys were removed."
        : result.sessionTokensCleared
          ? "Signed out, but local physical deletion was not fully verified. Capture keys were retained unless ciphertext deletion succeeded."
          : "UI signed out, but secure token deletion failed; keep the device isolated and retry the administrative purge."
    );
  }

  async function runQueueAction(task: () => Promise<void>) {
    setBusy(true);
    setAction(null);
    try {
      await task();
    } catch (error) {
      setAction(safeMessage(error));
    } finally {
      await refreshProtectedQueue().catch(() => undefined);
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>ClinicOS · protected native capture</Text>
          <Text style={styles.title}>Chairside media, encrypted before it joins the queue.</Text>
          <Text style={styles.body}>
            Capture is fail-closed on session, clinic, patient, consent, permission, and native
            secure-storage checks.
          </Text>
        </View>

        <Notice tone={api ? "neutral" : "danger"}>
          {api
            ? `Live service configured at ${api.baseUrl}.`
            : `Live backend unavailable: ${clientResult.message}`}
        </Notice>
        {Platform.OS === "web" ? (
          <Notice tone="warning">
            Web is supplemental smoke only. Camera, microphone, SecureStore, SQLCipher, and
            app-private file guarantees require a native development or internal build.
          </Notice>
        ) : null}
        {runtime.status === "starting" ? (
          <Notice tone="neutral">Verifying SQLCipher and protected device storage…</Notice>
        ) : null}
        {runtime.status === "failed" ? (
          <Notice tone="danger">Secure capture unavailable: {runtime.message}</Notice>
        ) : null}

        <Section title="1. Session and clinic">
          <StateLine
            state={session}
            idle="No session loaded."
            loaded={(value) => `${value.user.displayName} · ${value.tenant.displayName}`}
          />
          {session.status === "loaded" ? (
            <View style={styles.chips}>
              {session.data.clinics.map((clinic) => (
                <Chip
                  key={clinic.id}
                  label={clinic.displayName}
                  selected={clinic.id === clinicId}
                  onPress={() => {
                    setClinicId(clinic.id);
                    api?.setClinicId(clinic.id);
                    setPatientId(null);
                    setEncounter(null);
                    setConsent(undefined);
                  }}
                />
              ))}
            </View>
          ) : null}
          <Button
            disabled={!api || !selectedClinic || busy}
            label="Refresh patient worklist"
            onPress={() => void refreshWorklist()}
          />
        </Section>

        <Section title="2. Patient, consent, and encounter">
          <StateLine
            state={patients}
            idle="Refresh the worklist to select a patient."
            loaded={(value) => `${value.length} patient record(s) available.`}
          />
          {patients.status === "loaded"
            ? patients.data.slice(0, 8).map((patient) => (
                <Pressable
                  key={patient.id}
                  style={[styles.listRow, patient.id === patientId && styles.selected]}
                  onPress={() => void selectPatient(patient.id)}
                >
                  <View style={styles.grow}>
                    <Text style={styles.itemTitle}>{patientLabel(patient)}</Text>
                    <Text style={styles.meta}>{patient.status ?? "Patient record"}</Text>
                  </View>
                  <Text style={styles.badge}>
                    {patient.id === patientId ? "Selected" : "Choose"}
                  </Text>
                </Pressable>
              ))
            : null}
          <StateLine
            state={worklist}
            idle="Today’s queue has not been loaded."
            loaded={(value) => `${value.length} worklist item(s) for the clinic-local date.`}
          />
          {worklist.status === "loaded"
            ? worklist.data.slice(0, 8).map((entry) => (
                <Pressable
                  key={entry.id}
                  style={styles.listRow}
                  onPress={() => void selectPatient(entry.patientId)}
                >
                  <Text style={styles.itemTitle}>Queue status: {entry.status}</Text>
                  <Text style={styles.badge}>Select patient</Text>
                </Pressable>
              ))
            : null}
          <Text style={styles.label}>Encounter UUID</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            editable={Boolean(patientId) && !busy}
            onChangeText={(value) => {
              setEncounterInput(value);
              setEncounter(null);
            }}
            placeholder="Verify an active encounter"
            style={styles.input}
            value={encounterInput}
          />
          <Button
            disabled={!api || !patientId || !encounterInput.trim() || busy}
            label="Verify encounter"
            onPress={() => void verifyEncounter()}
          />
          <Text style={encounter ? styles.good : styles.meta}>
            {encounter
              ? `Verified · ${encounter.status}`
              : "Audio remains disabled until verification succeeds."}
          </Text>
          <Text style={photoConsentReady ? styles.good : styles.warningText}>
            {consent === undefined
              ? "Checking consent…"
              : consent === null
                ? "Consent unavailable; capture is disabled."
                : photoConsentReady
                  ? "Photo capture consent active."
                  : "Photo capture consent missing or revoked."}
          </Text>
        </Section>

        <Section title="3. Native photo">
          <PermissionLine label="Camera" state={permissionStateFromResponse(cameraPermission)} />
          {permissionStateFromResponse(cameraPermission).state === "requestable" ? (
            <Button label="Allow camera" onPress={() => void requestCameraPermission()} />
          ) : permissionStateFromResponse(cameraPermission).state === "denied" ? (
            <Button label="Open system settings" onPress={() => void Linking.openSettings()} />
          ) : null}
          {showCamera && Platform.OS !== "web" && cameraPermission?.granted ? (
            <View style={styles.cameraFrame}>
              <CameraView facing="back" mode="picture" ref={cameraRef} style={styles.camera} />
            </View>
          ) : null}
          <View style={styles.actions}>
            <Button
              disabled={
                !binding || !nativeReady || !photoConsentReady || !cameraPermission?.granted || busy
              }
              label={showCamera ? "Close camera" : "Open camera"}
              onPress={() => setShowCamera((value) => !value)}
              secondary
            />
            {showCamera ? (
              <Button
                disabled={busy}
                label="Capture and encrypt"
                onPress={() => void capturePhoto()}
              />
            ) : null}
          </View>
        </Section>

        <Section title="4. Consent-gated clinical audio">
          <Text style={styles.itemTitle}>{audioDecision.title}</Text>
          <Text style={styles.body}>{audioDecision.detail}</Text>
          <PermissionLine label="Microphone" state={microphonePermission} />
          {audioDecision.reason === "permission_required" ? (
            <Button label="Allow microphone" onPress={() => void requestMicrophone()} />
          ) : null}
          {microphonePermission.state === "denied" ? (
            <Button label="Open system settings" onPress={() => void Linking.openSettings()} />
          ) : null}
          {recorderState.isRecording ? (
            <Notice tone="danger">
              Recording · {Math.ceil(recorderState.durationMillis / 1000)}s of 900s maximum. Leaving
              the foreground stops recording.
            </Notice>
          ) : null}
          <Button
            disabled={
              busy || (!recorderState.isRecording && (!audioDecision.enabled || !nativeReady))
            }
            label={recorderState.isRecording ? "Stop, encrypt, and queue" : "Start clinical audio"}
            onPress={() => void (recorderState.isRecording ? stopAndProtectAudio() : startAudio())}
          />
        </Section>

        <Section title="5. Protected offline queue">
          <Text style={styles.body}>
            Queue bindings and signed targets live only in SQLCipher. Media is separately
            AES-256-GCM sealed with authenticated metadata.
          </Text>
          <View style={styles.actions}>
            <Button
              disabled={!nativeReady || busy || !api}
              label="Process due items"
              onPress={() => void processQueue()}
            />
            <Button
              disabled={!nativeReady || busy}
              label="Purge and log out"
              onPress={() => void purgeAndLogout()}
              secondary
            />
          </View>
          {queueItems.length === 0 ? (
            <Text style={styles.meta}>No protected captures are queued.</Text>
          ) : (
            queueItems.map((item) => (
              <View key={item.id} style={styles.queueRow}>
                <View style={styles.grow}>
                  <Text style={styles.itemTitle}>
                    {item.kind === "audio" ? "Clinical audio" : "Photo"} · {queueStatusLabel(item)}
                  </Text>
                  <Text style={styles.meta}>
                    {item.byteLength.toLocaleString()} bytes · attempt {item.attempts}
                  </Text>
                </View>
                <View style={styles.queueActions}>
                  {item.status === "manual_retry_required" ? (
                    <SmallButton
                      label="Retry upload"
                      onPress={() => void retryQueueItem(item.id)}
                    />
                  ) : item.status === "purge_failed" ? (
                    <SmallButton
                      label="Retry delete"
                      onPress={() => void purgeQueueItem(item.id)}
                    />
                  ) : null}
                  <SmallButton label="Purge" onPress={() => void purgeQueueItem(item.id)} />
                </View>
              </View>
            ))
          )}
        </Section>

        {action ? (
          <Notice
            tone={
              action.toLowerCase().includes("failed") ||
              action.toLowerCase().includes("unavailable")
                ? "danger"
                : "neutral"
            }
          >
            {action}
          </Notice>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function createClient(): { api: ClinicOsApiClient | null; message: string } {
  if (!apiOrigin) return { api: null, message: "EXPO_PUBLIC_CLINIC_OS_API_URL is not configured." };
  try {
    const keys = Platform.OS === "web" ? undefined : new SecureCaptureKeyVault();
    const options = {
      baseUrl: apiOrigin,
      ...(keys ? { tokenProvider: keys } : {}),
      ...(configuredDevSubject ? { devSubject: configuredDevSubject } : {})
    };
    return { api: new ClinicOsApiClient(options), message: "" };
  } catch (error) {
    return { api: null, message: safeMessage(error) };
  }
}

function dateInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(mobileSystemClock.now());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function safeMessage(error: unknown): string {
  if (error instanceof CaptureQueueError) return error.message;
  if (
    error instanceof Error &&
    !/token|authorization|object.?key|file:\/|https?:\/\//i.test(error.message)
  ) {
    return error.message.slice(0, 240);
  }
  return "The protected operation failed without a reportable diagnostic.";
}

function patientLabel(patient: PatientSummary): string {
  return patient.preferredName ?? patient.displayName ?? patient.legalName ?? "Patient record";
}

function queueStatusLabel(item: UploadQueueItem): string {
  const labels: Record<UploadQueueItem["status"], string> = {
    queued: "queued offline",
    leased: "claimed locally",
    reserved: "server slot reserved",
    uploading: "upload in progress",
    completing: "awaiting server confirmation",
    retry_wait: "retry scheduled",
    manual_retry_required:
      item.lastErrorCode === "UPLOAD_OUTCOME_UNCERTAIN"
        ? "outcome uncertain"
        : "manual retry required",
    quarantined: "integrity quarantine",
    purging: "deletion in progress",
    purge_failed: "deletion not confirmed"
  };
  return labels[item.status];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Notice({
  tone,
  children
}: {
  tone: "neutral" | "warning" | "danger";
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.notice,
        tone === "warning" && styles.noticeWarning,
        tone === "danger" && styles.noticeDanger
      ]}
    >
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

function StateLine<T>({
  state,
  idle,
  loaded
}: {
  state: LoadState<T>;
  idle: string;
  loaded: (value: T) => string;
}) {
  if (state.status === "idle") return <Text style={styles.meta}>{idle}</Text>;
  if (state.status === "loading") return <Text style={styles.meta}>Loading live records…</Text>;
  if (state.status === "failed") return <Text style={styles.warningText}>{state.message}</Text>;
  return <Text style={styles.good}>{loaded(state.data)}</Text>;
}

function PermissionLine({ label, state }: { label: string; state: PermissionState }) {
  const value =
    state.state === "denied"
      ? state.canAskAgain
        ? "denied; may request again"
        : "denied in system settings"
      : state.state;
  return (
    <Text style={state.state === "granted" ? styles.good : styles.warningText}>
      {label}: {value}
    </Text>
  );
}

function Button({
  label,
  onPress,
  disabled = false,
  secondary = false
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && styles.buttonDisabled
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonSecondaryText]}>{label}</Text>
    </Pressable>
  );
}

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.smallButton}>
      <Text style={styles.smallButtonText}>{label}</Text>
    </Pressable>
  );
}

function Chip({
  label,
  selected,
  onPress
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipSelectedText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "#eef4f1", flex: 1 },
  container: {
    alignSelf: "center",
    gap: 14,
    maxWidth: 880,
    padding: 18,
    paddingBottom: 60,
    width: "100%"
  },
  hero: { backgroundColor: "#12382f", borderRadius: 24, gap: 10, padding: 24 },
  eyebrow: {
    color: "#9ed3bd",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  title: { color: "#f7fbf9", fontSize: 28, fontWeight: "800", lineHeight: 34 },
  body: { color: "#456159", fontSize: 14, lineHeight: 21 },
  panel: {
    backgroundColor: "#ffffff",
    borderColor: "#d9e4df",
    borderRadius: 18,
    borderWidth: 1,
    gap: 11,
    padding: 18
  },
  panelTitle: { color: "#163b31", fontSize: 18, fontWeight: "800" },
  notice: { backgroundColor: "#dcebe5", borderRadius: 12, padding: 13 },
  noticeWarning: { backgroundColor: "#fff0c9" },
  noticeDanger: { backgroundColor: "#f9d8d3" },
  noticeText: { color: "#263e37", fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderColor: "#aac0b7",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  chipSelected: { backgroundColor: "#1b604e", borderColor: "#1b604e" },
  chipText: { color: "#284b41", fontWeight: "700" },
  chipSelectedText: { color: "#ffffff" },
  button: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#1b604e",
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  buttonSecondary: { backgroundColor: "#e5efeb" },
  buttonDisabled: { opacity: 0.42 },
  buttonText: { color: "#ffffff", fontSize: 14, fontWeight: "800" },
  buttonSecondaryText: { color: "#1c4b3f" },
  smallButton: {
    backgroundColor: "#e5efeb",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  smallButtonText: { color: "#1c4b3f", fontSize: 12, fontWeight: "800" },
  actions: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  listRow: {
    alignItems: "center",
    borderColor: "#dfe8e4",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 54,
    padding: 12
  },
  selected: { backgroundColor: "#e5f2ed", borderColor: "#64a48e" },
  grow: { flex: 1 },
  itemTitle: { color: "#183c32", fontSize: 14, fontWeight: "700" },
  meta: { color: "#6d817a", fontSize: 12, lineHeight: 18 },
  badge: { color: "#23624f", fontSize: 11, fontWeight: "800" },
  label: { color: "#29483f", fontSize: 12, fontWeight: "800", marginTop: 4 },
  input: {
    backgroundColor: "#f5f8f7",
    borderColor: "#cddbd5",
    borderRadius: 10,
    borderWidth: 1,
    color: "#173b31",
    minHeight: 46,
    paddingHorizontal: 12
  },
  good: { color: "#177050", fontSize: 13, fontWeight: "700", lineHeight: 19 },
  warningText: { color: "#9c4f17", fontSize: 13, fontWeight: "600", lineHeight: 19 },
  cameraFrame: {
    aspectRatio: 4 / 3,
    backgroundColor: "#102821",
    borderRadius: 16,
    overflow: "hidden",
    width: "100%"
  },
  camera: { flex: 1 },
  queueRow: {
    alignItems: "center",
    borderTopColor: "#e2e9e6",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingTop: 12
  },
  queueActions: { flexDirection: "row", gap: 6 }
});
