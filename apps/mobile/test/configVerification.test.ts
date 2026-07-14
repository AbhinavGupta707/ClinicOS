import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const app = readJson("app.json") as { expo: Record<string, any> };
const pkg = readJson("package.json") as { dependencies: Record<string, string> };
const eas = readJson("eas.json") as { build: Record<string, Record<string, unknown>> };

test("Expo config declares camera/audio permissions, SQLCipher, privacy, and backup exclusion", () => {
  const expo = app.expo;
  const plugins = expo.plugins as unknown[];
  assert.equal(pluginOptions(plugins, "expo-camera").recordAudioAndroid, false);
  assert.equal(pluginOptions(plugins, "expo-audio").recordAudioAndroid, true);
  assert.equal(pluginOptions(plugins, "expo-audio").enableBackgroundRecording, false);
  assert.equal(pluginOptions(plugins, "expo-sqlite").useSQLCipher, true);
  assert.equal(pluginOptions(plugins, "expo-build-properties").android.minSdkVersion, 24);
  assert.equal(pluginOptions(plugins, "expo-build-properties").ios.deploymentTarget, "16.4");
  assert.equal(expo.android.allowBackup, false);
  assert.deepEqual(
    (expo.android.permissions as string[]).sort(),
    ["android.permission.CAMERA", "android.permission.RECORD_AUDIO"]
  );
  assert.equal(expo.ios.infoPlist.NSFileProtectionKey, "NSFileProtectionComplete");
  assert.equal(expo.ios.infoPlist.UIFileSharingEnabled, false);
  assert.equal(expo.ios.privacyManifests.NSPrivacyTracking, false);
  const collected = expo.ios.privacyManifests.NSPrivacyCollectedDataTypes as Record<string, unknown>[];
  for (const expected of [
    "NSPrivacyCollectedDataTypeHealth",
    "NSPrivacyCollectedDataTypePhotosorVideos",
    "NSPrivacyCollectedDataTypeAudioData",
    "NSPrivacyCollectedDataTypeUserID"
  ]) {
    assert.ok(collected.some((entry) => entry.NSPrivacyCollectedDataType === expected));
  }
});

test("native provider dependencies and internal distribution templates are declared", () => {
  for (const dependency of [
    "expo-audio",
    "expo-build-properties",
    "expo-camera",
    "expo-crypto",
    "expo-file-system",
    "expo-network",
    "expo-screen-capture",
    "expo-secure-store",
    "expo-sqlite"
  ]) {
    assert.ok(pkg.dependencies[dependency], `${dependency} must be declared`);
  }
  assert.equal(eas.build.preview?.distribution, "internal");
  assert.equal(eas.build.development?.developmentClient, true);
  assert.equal(eas.build.production?.distribution, "store");
});

test("private native storage module has no placeholder pod metadata", () => {
  const podspec = readFileSync(
    new URL("modules/clinic-secure-storage/ios/ClinicSecureStorage.podspec", root),
    "utf8"
  );
  assert.doesNotMatch(podspec, /invalid\.local|:git\s*=>\s*['"]['"]/i);
  assert.match(podspec, /ClinicOS\.git/);
  const android = readFileSync(
    new URL(
      "modules/clinic-secure-storage/android/src/main/java/com/clinicos/securestorage/ClinicSecureStorageModule.kt",
      root
    ),
    "utf8"
  );
  assert.match(android, /noBackupFilesDir/);
});

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, root), "utf8"));
}

function pluginOptions(plugins: unknown[], name: string): Record<string, any> {
  const entry = plugins.find(
    (candidate) => Array.isArray(candidate) && candidate[0] === name
  );
  assert.ok(Array.isArray(entry), `${name} plugin must be configured`);
  return entry[1] as Record<string, any>;
}
