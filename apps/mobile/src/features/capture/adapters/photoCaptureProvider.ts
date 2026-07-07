import type { CapturedPhoto, CaptureCapability, PatientCaptureContext, PhotoCaptureProvider } from "../types";

export class UnavailablePhotoCaptureProvider implements PhotoCaptureProvider {
  readonly #reason: string;

  constructor(reason: string) {
    this.#reason = reason;
  }

  async getCapability(): Promise<CaptureCapability> {
    return {
      state: "unavailable",
      reason: this.#reason,
      setupAction: "Install and reconcile an approved Expo camera adapter before enabling device capture."
    };
  }

  async capturePhoto(_context: PatientCaptureContext): Promise<CapturedPhoto> {
    throw new Error(this.#reason);
  }
}

export class StaticPhotoCaptureProvider implements PhotoCaptureProvider {
  readonly #photo: CapturedPhoto;

  constructor(photo: CapturedPhoto) {
    this.#photo = photo;
  }

  async getCapability(): Promise<CaptureCapability> {
    return { state: "ready" };
  }

  async capturePhoto(_context: PatientCaptureContext): Promise<CapturedPhoto> {
    return {
      ...this.#photo,
      bytes: new Uint8Array(this.#photo.bytes)
    };
  }
}

export function createDefaultPhotoCaptureProvider(): PhotoCaptureProvider {
  return new UnavailablePhotoCaptureProvider(
    "Native camera capture is not registered in this worktree. The typed provider contract is present, but expo-camera is not installed and package-lock reconciliation is integration-owned."
  );
}
