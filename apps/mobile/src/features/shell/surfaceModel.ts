export type MobileSurfaceState = "available" | "registered_unavailable";

export interface MobileSurface {
  id: string;
  label: string;
  state: MobileSurfaceState;
  checkpoint: number;
  apiBoundary: string;
}

export const mobileSurfaces: readonly MobileSurface[] = [
  {
    id: "session",
    label: "Secure session shell",
    state: "available",
    checkpoint: 1,
    apiBoundary: "GET /v1/me"
  },
  {
    id: "chairside-media",
    label: "Chairside photo capture",
    state: "available",
    checkpoint: 8,
    apiBoundary:
      "POST /v1/media/upload-urls -> PUT /v1/media/uploads/{uploadId}/content -> POST /v1/media/uploads/{uploadId}/complete"
  },
  {
    id: "voice-note",
    label: "Clinical voice note",
    state: "registered_unavailable",
    checkpoint: 8,
    apiBoundary:
      "Native Expo audio adapter plus POST /v1/encounters/{encounterId}/ai-scribe/sessions after consent and retention gates pass"
  },
  {
    id: "offline-upload",
    label: "Consent-gated upload queue",
    state: "available",
    checkpoint: 8,
    apiBoundary: "Device-local secure cache abstraction plus durable CP4 media upload contract"
  }
] as const;

export function getAvailableMobileSurfaces() {
  return mobileSurfaces.filter((surface) => surface.state === "available");
}

export function getUnavailableMobileSurfaces() {
  return mobileSurfaces.filter((surface) => surface.state === "registered_unavailable");
}

export function getActiveCaptureSurfaces() {
  return mobileSurfaces.filter((surface) => surface.state === "available");
}
