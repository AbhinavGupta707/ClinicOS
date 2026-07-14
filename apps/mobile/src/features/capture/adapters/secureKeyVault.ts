import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { AuthTokenProvider } from "../../../lib/apiClient";

const keychainService = "com.clinicos.mobile.secure-capture";
const storeOptions: SecureStore.SecureStoreOptions = {
  keychainService,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false
};

const databaseKeyName = "capture_database_key_v1";
const mediaKeyName = "capture_media_key_v1";
const accessTokenName = "session_access_token_v1";
const refreshTokenName = "session_refresh_token_v1";

export class SecureCaptureKeyVault implements AuthTokenProvider {
  async assertAvailable(): Promise<void> {
    if (!(await SecureStore.isAvailableAsync())) {
      throw new Error("OS secure storage is unavailable on this platform.");
    }
  }

  getDatabaseKeyHex(): Promise<string> {
    return this.#getOrCreateKey(databaseKeyName);
  }

  getMediaKeyHex(): Promise<string> {
    return this.#getOrCreateKey(mediaKeyName);
  }

  async getAccessToken(): Promise<string | null> {
    await this.assertAvailable();
    return SecureStore.getItemAsync(accessTokenName, storeOptions);
  }

  async getRefreshToken(): Promise<string | null> {
    await this.assertAvailable();
    return SecureStore.getItemAsync(refreshTokenName, storeOptions);
  }

  async setSessionTokens(input: { accessToken: string; refreshToken: string | null }): Promise<void> {
    await this.assertAvailable();
    assertToken(input.accessToken);
    await SecureStore.setItemAsync(accessTokenName, input.accessToken, storeOptions);
    if (input.refreshToken) {
      assertToken(input.refreshToken);
      await SecureStore.setItemAsync(refreshTokenName, input.refreshToken, storeOptions);
    } else {
      await SecureStore.deleteItemAsync(refreshTokenName, storeOptions);
    }
  }

  async clearSessionTokens(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(accessTokenName, storeOptions),
      SecureStore.deleteItemAsync(refreshTokenName, storeOptions)
    ]);
  }

  async destroyCaptureKeysAfterVerifiedPurge(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(databaseKeyName, storeOptions),
      SecureStore.deleteItemAsync(mediaKeyName, storeOptions)
    ]);
  }

  async #getOrCreateKey(name: string): Promise<string> {
    await this.assertAvailable();
    const existing = await SecureStore.getItemAsync(name, storeOptions);
    if (existing) {
      assertHexKey(existing);
      return existing;
    }
    const generated = bytesToHex(await Crypto.getRandomBytesAsync(32));
    await SecureStore.setItemAsync(name, generated, storeOptions);
    return generated;
  }
}

function assertHexKey(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Protected key material is invalid.");
}

function assertToken(value: string): void {
  if (value.length < 16 || value.length > 16_384 || /\s/.test(value)) {
    throw new TypeError("Session token does not meet the protected storage contract.");
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
