import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { getAvailableMobileSurfaces, getUnavailableMobileSurfaces } from "./surfaceModel";

const apiBaseUrl = process.env.EXPO_PUBLIC_CLINIC_OS_API_URL ?? "http://127.0.0.1:4000";
const availableSurfaces = getAvailableMobileSurfaces();
const unavailableSurfaces = getUnavailableMobileSurfaces();

export function MobileShellScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>ClinicOS Mobile</Text>
          <Text style={styles.title}>Secure capture shell</Text>
          <Text style={styles.body}>
            Mobile is registered for authenticated clinic context now. Capture workflows stay
            unavailable until their API and consent boundaries ship in Checkpoint 8.
          </Text>
          <View style={styles.statusPill}>
            <Text style={styles.statusPillText}>API {apiBaseUrl}</Text>
          </View>
        </View>

        <View style={styles.metricsRow}>
          <Metric label="Available surfaces" value={availableSurfaces.length.toString()} />
          <Metric label="Registered later" value={unavailableSurfaces.length.toString()} />
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Active foundation</Text>
          {availableSurfaces.map((surface) => (
            <View key={surface.id} style={styles.surfaceRow}>
              <View>
                <Text style={styles.surfaceLabel}>{surface.label}</Text>
                <Text style={styles.surfaceMeta}>{surface.apiBoundary}</Text>
              </View>
              <Text style={styles.activeBadge}>Active</Text>
            </View>
          ))}
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Capture workflows</Text>
          <Text style={styles.panelBody}>
            No patient images, recordings, or offline clinical data are stored by the CP1 shell.
          </Text>
          {unavailableSurfaces.map((surface) => (
            <View key={surface.id} style={styles.surfaceRow}>
              <View style={styles.surfaceText}>
                <Text style={styles.surfaceLabel}>{surface.label}</Text>
                <Text style={styles.surfaceMeta}>
                  Checkpoint {surface.checkpoint}; {surface.apiBoundary}
                </Text>
              </View>
              <Text style={styles.laterBadge}>Later</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const colors = {
  background: "#f5f7fa",
  border: "#d7e0ea",
  ink: "#17202a",
  inkSoft: "#465768",
  mint: "#087f73",
  mintSoft: "#def7f3",
  paper: "#ffffff",
  skySoft: "#e6f0fb",
  warning: "#9a5b08",
  warningSoft: "#fff4da"
};

const styles = StyleSheet.create({
  activeBadge: {
    backgroundColor: colors.mintSoft,
    borderColor: "#b7e8df",
    borderRadius: 999,
    borderWidth: 1,
    color: "#06584f",
    fontSize: 12,
    fontWeight: "800",
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
    paddingBottom: 28
  },
  eyebrow: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
    textTransform: "uppercase"
  },
  hero: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: 18
  },
  laterBadge: {
    backgroundColor: colors.warningSoft,
    borderColor: "#efcd88",
    borderRadius: 999,
    borderWidth: 1,
    color: colors.warning,
    fontSize: 12,
    fontWeight: "800",
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  metric: {
    backgroundColor: colors.paper,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    padding: 14
  },
  metricLabel: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: "800"
  },
  metricValue: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: "900",
    marginTop: 6
  },
  metricsRow: {
    flexDirection: "row",
    gap: 12
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
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 10
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1
  },
  statusPill: {
    alignSelf: "flex-start",
    backgroundColor: colors.skySoft,
    borderColor: "#c7dff9",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 16,
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  statusPillText: {
    color: "#17456f",
    fontSize: 13,
    fontWeight: "800"
  },
  surfaceLabel: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "900"
  },
  surfaceMeta: {
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4
  },
  surfaceRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    paddingVertical: 12
  },
  surfaceText: {
    flex: 1
  },
  title: {
    color: colors.ink,
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 38,
    marginTop: 8
  }
});
