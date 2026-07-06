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
    state: "registered_unavailable",
    checkpoint: 8,
    apiBoundary: "POST /v1/patients/{id}/media"
  },
  {
    id: "voice-note",
    label: "Clinical voice note",
    state: "registered_unavailable",
    checkpoint: 8,
    apiBoundary: "POST /v1/encounters/{id}/voice-notes"
  },
  {
    id: "offline-upload",
    label: "Consent-gated upload queue",
    state: "registered_unavailable",
    checkpoint: 8,
    apiBoundary: "POST /v1/mobile/upload-queue"
  }
] as const;

export function getAvailableMobileSurfaces() {
  return mobileSurfaces.filter((surface) => surface.state === "available");
}

export function getUnavailableMobileSurfaces() {
  return mobileSurfaces.filter((surface) => surface.state === "registered_unavailable");
}
