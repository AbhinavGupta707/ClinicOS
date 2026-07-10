import { ClinicOsApiClient } from "@clinic-os/api-client-generated";

const TOKEN_PROVIDER_KEY = "__clinicOsAccessTokenProvider" as const;

export type ClinicOsAccessTokenProvider = () => string | null | Promise<string | null>;

declare global {
  interface Window {
    __clinicOsAccessTokenProvider?: ClinicOsAccessTokenProvider;
  }
}

export class ClinicOsSessionUnavailableError extends Error {
  readonly code = "SESSION_TOKEN_PROVIDER_UNAVAILABLE";

  constructor(message = "The authenticated ClinicOS token provider is not available.") {
    super(message);
    this.name = "ClinicOsSessionUnavailableError";
  }
}

/**
 * Registration boundary for the authenticated web session runtime. The provider owns its token;
 * CP13 never copies it into a URL, browser storage, a public environment variable, or component
 * state. If no provider is registered, generated-client operations fail closed.
 */
export function registerClinicOsAccessTokenProvider(
  provider: ClinicOsAccessTokenProvider
): () => void {
  window[TOKEN_PROVIDER_KEY] = provider;
  return () => {
    if (window[TOKEN_PROVIDER_KEY] === provider) delete window[TOKEN_PROVIDER_KEY];
  };
}

export function createCp13ApiClient(clinicId: string): ClinicOsApiClient {
  return new ClinicOsApiClient({
    baseUrl: getApiBaseUrl(),
    clinicId,
    getAccessToken: getVerifiedAccessToken,
    fetchImpl: credentialedFetch,
    getRequestId: () => crypto.randomUUID()
  });
}

export function isClinicOsSessionUnavailable(
  error: unknown
): error is ClinicOsSessionUnavailableError {
  return error instanceof ClinicOsSessionUnavailableError;
}

async function getVerifiedAccessToken(): Promise<string> {
  const provider = window[TOKEN_PROVIDER_KEY];
  if (!provider) throw new ClinicOsSessionUnavailableError();
  const token = await provider();
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new ClinicOsSessionUnavailableError(
      "The authenticated ClinicOS session did not provide a usable access token."
    );
  }
  return token;
}

function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_CLINIC_OS_API_BASE_URL?.trim();
  return configured && configured.length > 0 ? configured : window.location.origin;
}

function credentialedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, credentials: "include" });
}
