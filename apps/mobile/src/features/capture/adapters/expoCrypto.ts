import * as Crypto from "expo-crypto";
import type { CaptureDigestProvider } from "../types";

export class ExpoCaptureDigestProvider implements CaptureDigestProvider {
  async sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await Crypto.digest(
      Crypto.CryptoDigestAlgorithm.SHA256,
      new Uint8Array(bytes).buffer
    );
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  randomId(): string {
    return Crypto.randomUUID();
  }
}
