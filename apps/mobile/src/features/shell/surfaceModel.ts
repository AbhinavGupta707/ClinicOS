export type MobileSurfaceState = "available_native" | "unavailable_on_web";

export interface MobileSurface {
  id: string;
  label: string;
  state: MobileSurfaceState;
  apiBoundary: string;
}

export const mobileSurfaces: readonly MobileSurface[] = [
  {
    id: "session",
    label: "Protected clinic session",
    state: "available_native",
    apiBoundary: "GET /v1/me with SecureStore token provider"
  },
  {
    id: "chairside-media",
    label: "Native photo and clinical audio capture",
    state: "available_native",
    apiBoundary:
      "POST /v1/media/upload-urls -> PUT /v1/media/uploads/{uploadId}/content -> POST /v1/media/uploads/{uploadId}/complete"
  },
  {
    id: "offline-upload",
    label: "Encrypted durable offline queue",
    state: "available_native",
    apiBoundary: "SQLCipher metadata plus AES-256-GCM app-private media"
  },
  {
    id: "native-on-web",
    label: "Native capture guarantees",
    state: "unavailable_on_web",
    apiBoundary: "Web export is supplemental smoke only"
  }
] as const;

export function getAvailableMobileSurfaces() {
  return mobileSurfaces.filter((surface) => surface.state === "available_native");
}

export function getUnavailableMobileSurfaces() {
  return mobileSurfaces.filter((surface) => surface.state === "unavailable_on_web");
}

export function getActiveCaptureSurfaces() {
  return getAvailableMobileSurfaces();
}
