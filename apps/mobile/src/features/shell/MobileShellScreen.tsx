import { useEffect, useMemo, useState } from "react";
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { ClinicOsApiClient, type MobileSession, type PatientSummary, type QueueEntrySummary } from "../../lib/apiClient";
import { createDefaultPhotoCaptureProvider } from "../capture/adapters/photoCaptureProvider";
import {
  applyNativeAudioCapability,
  evaluateAudioControl,
  type AudioControlDecision,
  type NativeAudioCapability
} from "../capture/audioConsent";
import { InMemorySecureCaptureCache } from "../capture/secureCache";
import type { CaptureCapability, PatientCaptureContext, UploadQueueItem } from "../capture/types";
import { completedAssetMessage, MobileUploadQueue } from "../capture/uploadQueue";
import { getAvailableMobileSurfaces, getUnavailableMobileSurfaces } from "./surfaceModel";

const apiBaseUrl = process.env.EXPO_PUBLIC_CLINIC_OS_API_URL ?? "http://127.0.0.1:4000";
const devSubject = process.env.EXPO_PUBLIC_CLINIC_OS_DEV_SUBJECT ?? null;
const nativeAudioCapability: NativeAudioCapability = {
  state: "unavailable",
  reason:
    "Native recording packages are not installed or reconciled in the release-candidate mobile app."
};

export function MobileShellScreen() {
  const api = useMemo(
    () => new ClinicOsApiClient({ baseUrl: apiBaseUrl, devSubject }),
    []
  );
  const captureProvider = useMemo(() => createDefaultPhotoCaptureProvider(), []);
  const uploadQueue = useMemo(
    () => new MobileUploadQueue({ api, cache: new InMemorySecureCaptureCache() }),
    [api]
  );

  const [sessionState, setSessionState] = useState<LoadState<MobileSession>>({ status: "loading" });
  const [patientsState, setPatientsState] = useState<LoadState<PatientSummary[]>>({ status: "idle" });
  const [queueState, setQueueState] = useState<LoadState<QueueEntrySummary[]>>({ status: "idle" });
  const [captureCapability, setCaptureCapability] = useState<CaptureCapability>({
    state: "unavailable",
    reason: "Checking capture device registration."
  });
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedQueueEntryId, setSelectedQueueEntryId] = useState<string | null>(null);
  const [encounterId, setEncounterId] = useState("");
  const [audioDecision, setAudioDecision] = useState<AudioControlDecision>(
    evaluateAudioControl({ patientId: null, enforcementState: null })
  );
  const [queueItems, setQueueItems] = useState<readonly UploadQueueItem[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const renderedAudioDecision = applyNativeAudioCapability(audioDecision, nativeAudioCapability);

  const selectedPatient = selectedPatientId
    ? patientsState.status === "loaded"
      ? patientsState.data.find((patient) => patient.id === selectedPatientId) ?? null
      : null
    : null;

  const selectedContext: PatientCaptureContext | null = selectedPatientId
    ? {
        patientId: selectedPatientId,
        patientLabel: selectedPatient ? patientLabel(selectedPatient) : "Selected patient",
        encounterId: encounterId.trim() || null,
        encounterLabel: encounterId.trim() ? `Encounter ${encounterId.trim()}` : "No encounter selected"
      }
    : null;

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const session = await api.getSession();
        if (!cancelled) setSessionState({ status: "loaded", data: session });
      } catch (error) {
        if (!cancelled) setSessionState({ status: "failed", message: errorMessage(error) });
      }
    }
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    async function loadCaptureCapability() {
      const capability = await captureProvider.getCapability();
      if (!cancelled) setCaptureCapability(capability);
    }
    void loadCaptureCapability();
    return () => {
      cancelled = true;
    };
  }, [captureProvider]);

  async function refreshWorklist() {
    setPatientsState({ status: "loading" });
    setQueueState({ status: "loading" });
    setActionMessage(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [patients, queue] = await Promise.all([api.listPatients(), api.listQueue(today)]);
      setPatientsState({ status: "loaded", data: patients });
      setQueueState({ status: "loaded", data: queue });
      if (!selectedPatientId && patients[0]) setSelectedPatientId(patients[0].id);
    } catch (error) {
      const message = errorMessage(error);
      setPatientsState({ status: "failed", message });
      setQueueState({ status: "failed", message });
    }
  }

  async function selectPatient(patientId: string) {
    setSelectedPatientId(patientId);
    setSelectedQueueEntryId(null);
    setActionMessage(null);
    setAudioDecision(evaluateAudioControl({ patientId, enforcementState: null }));
    try {
      const enforcementState = await api.getPatientConsents(patientId);
      setAudioDecision(evaluateAudioControl({ patientId, enforcementState }));
    } catch (error) {
      setAudioDecision(evaluateAudioControl({ patientId, enforcementState: null }));
      setActionMessage(`Consent check unavailable: ${errorMessage(error)}`);
    }
  }

  async function selectQueueEntry(entry: QueueEntrySummary) {
    setSelectedQueueEntryId(entry.id);
    await selectPatient(entry.patientId);
  }

  async function capturePhoto() {
    if (!selectedContext) return;
    setActionMessage(null);
    try {
      const photo = await captureProvider.capturePhoto(selectedContext);
      await uploadQueue.enqueuePhoto(selectedContext, photo);
      setQueueItems(uploadQueue.items);
      setActionMessage("Photo queued for backend-mediated upload.");
    } catch (error) {
      setActionMessage(errorMessage(error));
    }
  }

  async function processUploadQueue() {
    setActionMessage(null);
    const processed = await uploadQueue.processNext();
    setQueueItems(uploadQueue.items);
    if (!processed) {
      setActionMessage("No queued photo is waiting for upload.");
      return;
    }
    setActionMessage(
      processed.mediaAsset ? completedAssetMessage(processed.mediaAsset) : processed.lastError ?? "Upload updated."
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>ClinicOS Mobile Capture</Text>
          <Text style={styles.title}>Chairside capture workspace</Text>
          <Text style={styles.body}>
            Select a registered clinic session, patient, queue context, and encounter before
            capturing media. Photo uploads use the durable media reservation, upload, and completion
            route family.
          </Text>
          <Text style={styles.apiText}>API {apiBaseUrl}</Text>
        </View>

        <View style={styles.grid}>
          <StatusPanel title="Session" state={sessionState} loadedText={(session) => session.user.displayName} />
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Available Capture Surfaces</Text>
            {getAvailableMobileSurfaces().map((surface) => (
              <Text key={surface.id} style={styles.metaLine}>
                {surface.label}: {surface.apiBoundary}
              </Text>
            ))}
            <Text style={styles.subTitle}>Registered Unavailable</Text>
            {getUnavailableMobileSurfaces().map((surface) => (
              <Text key={surface.id} style={styles.unavailableLine}>
                {surface.label}: {surface.apiBoundary}
              </Text>
            ))}
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.rowHeader}>
            <Text style={styles.panelTitle}>Patient And Queue</Text>
            <Pressable style={styles.secondaryButton} onPress={refreshWorklist}>
              <Text style={styles.secondaryButtonText}>Refresh</Text>
            </Pressable>
          </View>
          <StateText state={patientsState} emptyText="Refresh to load registered patients." />
          <View style={styles.list}>
            {patientsState.status === "loaded"
              ? patientsState.data.slice(0, 6).map((patient) => (
                  <Pressable
                    key={patient.id}
                    style={[styles.listRow, selectedPatientId === patient.id && styles.selectedRow]}
                    onPress={() => void selectPatient(patient.id)}
                  >
                    <View style={styles.flexText}>
                      <Text style={styles.itemTitle}>{patientLabel(patient)}</Text>
                      <Text style={styles.itemMeta}>Patient ID {patient.id}</Text>
                    </View>
                    <Text style={styles.badge}>{selectedPatientId === patient.id ? "Selected" : "Patient"}</Text>
                  </Pressable>
                ))
              : null}
          </View>
          <Text style={styles.subTitle}>Today&apos;s Queue</Text>
          <StateText state={queueState} emptyText="Refresh to load today's queue." />
          <View style={styles.list}>
            {queueState.status === "loaded"
              ? queueState.data.slice(0, 6).map((entry) => (
                  <Pressable
                    key={entry.id}
                    style={[styles.listRow, selectedQueueEntryId === entry.id && styles.selectedRow]}
                    onPress={() => void selectQueueEntry(entry)}
                  >
                    <View style={styles.flexText}>
                      <Text style={styles.itemTitle}>Queue {entry.status}</Text>
                      <Text style={styles.itemMeta}>Patient {entry.patientId}</Text>
                    </View>
                    <Text style={styles.badge}>{selectedQueueEntryId === entry.id ? "Selected" : "Queue"}</Text>
                  </Pressable>
                ))
              : null}
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Encounter</Text>
          <Text style={styles.panelBody}>
            Enter an active encounter ID when the chairside visit is already open on the clinical
            workstation. Without it, photos remain patient-scoped only.
          </Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setEncounterId}
            placeholder="Encounter UUID"
            style={styles.input}
            value={encounterId}
          />
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Photo Capture</Text>
          <Text style={styles.panelBody}>
            {captureCapability.state === "ready"
              ? "Device capture is registered. Captured photos are queued locally until uploaded."
              : captureCapability.reason}
          </Text>
          <View style={styles.actions}>
            <Pressable
              disabled={!selectedContext || captureCapability.state !== "ready"}
              style={[
                styles.primaryButton,
                (!selectedContext || captureCapability.state !== "ready") && styles.disabledButton
              ]}
              onPress={() => void capturePhoto()}
            >
              <Text style={styles.primaryButtonText}>Capture Photo</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => void processUploadQueue()}>
              <Text style={styles.secondaryButtonText}>Process Queue</Text>
            </Pressable>
          </View>
          {queueItems.length === 0 ? (
            <Text style={styles.mutedText}>No local photo uploads are queued.</Text>
          ) : (
            queueItems.map((item) => (
              <View key={item.id} style={styles.queueRow}>
                <View style={styles.flexText}>
                  <Text style={styles.itemTitle}>{item.status}</Text>
                  <Text style={styles.itemMeta}>
                    {item.byteLength} bytes; scan {item.mediaAsset?.scanStatus ?? "not completed"}
                  </Text>
                </View>
                <Text style={styles.badge}>{item.attempts} attempt(s)</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Audio Capture</Text>
          <Text style={styles.audioTitle}>{renderedAudioDecision.title}</Text>
          <Text style={styles.panelBody}>{renderedAudioDecision.detail}</Text>
          <Pressable
            accessibilityState={{ disabled: !renderedAudioDecision.enabled }}
            disabled={!renderedAudioDecision.enabled}
            style={[styles.primaryButton, !renderedAudioDecision.enabled && styles.disabledButton]}
          >
            <Text style={styles.primaryButtonText}>
              {renderedAudioDecision.enabled ? "Start Audio" : "Audio adapter unavailable"}
            </Text>
          </Pressable>
        </View>

        {actionMessage ? (
          <View style={styles.messagePanel}>
            <Text style={styles.messageText}>{actionMessage}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; data: T }
  | { status: "failed"; message: string };

function StatusPanel<T>({
  title,
  state,
  loadedText
}: {
  title: string;
  state: LoadState<T>;
  loadedText: (data: T) => string;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      <StateText state={state} emptyText="Not loaded." loadedText={loadedText} />
    </View>
  );
}

function StateText<T>({
  state,
  emptyText,
  loadedText
}: {
  state: LoadState<T>;
  emptyText: string;
  loadedText?: (data: T) => string;
}) {
  if (state.status === "idle") return <Text style={styles.mutedText}>{emptyText}</Text>;
  if (state.status === "loading") return <Text style={styles.mutedText}>Loading...</Text>;
  if (state.status === "failed") return <Text style={styles.errorText}>{state.message}</Text>;
  return <Text style={styles.successText}>{loadedText ? loadedText(state.data) : "Loaded"}</Text>;
}

function patientLabel(patient: PatientSummary): string {
  return patient.displayName ?? patient.preferredName ?? patient.legalName ?? "Registered patient";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected mobile capture error.";
}

const colors = {
  background: "#f4f6f8",
  border: "#d6dde5",
  ink: "#18212b",
  inkSoft: "#516070",
  paper: "#ffffff",
  teal: "#087f73",
  tealSoft: "#e1f6f2",
  red: "#9f2d2d",
  redSoft: "#fdecec",
  amber: "#8a5a0a",
  amberSoft: "#fff5dd"
};

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 12
  },
  apiText: {
    color: colors.inkSoft,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 14
  },
  audioTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6
  },
  badge: {
    backgroundColor: colors.tealSoft,
    borderColor: "#b8e7df",
    borderRadius: 999,
    borderWidth: 1,
    color: "#075e55",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  body: {
    color: colors.inkSoft,
    fontSize: 16,
    lineHeight: 23,
    marginTop: 10
  },
  container: {
    gap: 14,
    padding: 16,
    paddingBottom: 32
  },
  disabledButton: {
    opacity: 0.55
  },
  errorText: {
    color: colors.red,
    fontSize: 14,
    lineHeight: 20
  },
  eyebrow: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase"
  },
  flexText: {
    flex: 1
  },
  grid: {
    gap: 14
  },
  header: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 18
  },
  input: {
    backgroundColor: "#fbfcfd",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 15,
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  itemMeta: {
    color: colors.inkSoft,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3
  },
  itemTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  list: {
    gap: 8,
    marginTop: 10
  },
  listRow: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    padding: 12
  },
  messagePanel: {
    backgroundColor: colors.amberSoft,
    borderColor: "#eed08a",
    borderRadius: 8,
    borderWidth: 1,
    padding: 14
  },
  messageText: {
    color: colors.amber,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20
  },
  metaLine: {
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 5
  },
  mutedText: {
    color: colors.inkSoft,
    fontSize: 14,
    lineHeight: 20
  },
  panel: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 16
  },
  panelBody: {
    color: colors.inkSoft,
    fontSize: 14,
    lineHeight: 21
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.teal,
    borderRadius: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900"
  },
  queueRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    marginTop: 12,
    paddingTop: 12
  },
  rowHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#edf1f5",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "900"
  },
  selectedRow: {
    backgroundColor: colors.tealSoft,
    borderColor: "#7dd6ca"
  },
  subTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 16
  },
  successText: {
    color: "#0b6b42",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20
  },
  unavailableLine: {
    backgroundColor: colors.amberSoft,
    borderColor: "#eed08a",
    borderRadius: 8,
    borderWidth: 1,
    color: colors.amber,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 20,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  title: {
    color: colors.ink,
    fontSize: 32,
    fontWeight: "900",
    lineHeight: 36,
    marginTop: 8
  }
});
