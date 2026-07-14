import { Stack } from "expo-router";
import {
  enableAppSwitcherProtectionAsync,
  preventScreenCaptureAsync,
  usePreventScreenCapture
} from "expo-screen-capture";
import { useEffect, useState } from "react";
import { AppState, Platform, StatusBar, StyleSheet, Text, View } from "react-native";

export default function RootLayout() {
  usePreventScreenCapture("clinicos-phi-surface");
  const [privateCover, setPrivateCover] = useState(AppState.currentState !== "active");

  useEffect(() => {
    if (Platform.OS !== "web") {
      void preventScreenCaptureAsync("clinicos-native-phi").catch(() => undefined);
      if (Platform.OS === "ios") {
        void enableAppSwitcherProtectionAsync(32).catch(() => undefined);
      }
    }
    const subscription = AppState.addEventListener("change", (state) => {
      setPrivateCover(state !== "active");
    });
    return () => subscription.remove();
  }, []);

  return (
    <>
      <StatusBar barStyle="dark-content" />
      <Stack screenOptions={{ headerShown: false }} />
      {privateCover ? (
        <View accessibilityViewIsModal style={styles.cover}>
          <Text style={styles.coverTitle}>ClinicOS</Text>
          <Text style={styles.coverText}>Protected clinical workspace</Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: "#102821",
    justifyContent: "center",
    zIndex: 1000
  },
  coverTitle: { color: "#f7faf8", fontSize: 28, fontWeight: "800" },
  coverText: { color: "#bdd2c9", fontSize: 14, marginTop: 8 }
});
