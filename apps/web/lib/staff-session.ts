/** The browser sees only an opaque HttpOnly cookie and a short-lived CSRF value. */
export const SESSION_INVALIDATED_EVENT = "clinicos:session-invalidated";

export function usesSyntheticBearerTransport(): boolean {
  return (
    process.env.NEXT_PUBLIC_CLINIC_OS_AUTH_TRANSPORT === "synthetic_bearer" &&
    ["local", "test"].includes(process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? "")
  );
}

export function usesStaffSession(): boolean {
  return !usesSyntheticBearerTransport();
}

function browserOrigin(): string {
  return typeof window === "undefined" ? "http://localhost" : window.location.origin;
}

function invalidateSession() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT));
}

async function csrfToken(signal?: AbortSignal | null): Promise<string | Response> {
  const response = await fetch(`${browserOrigin()}/auth/session`, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal
  });
  if (!response.ok) {
    if (response.status === 401) invalidateSession();
    return response;
  }
  const body: unknown = await response.json();
  if (
    !body ||
    typeof body !== "object" ||
    !("csrfToken" in body) ||
    typeof body.csrfToken !== "string" ||
    body.csrfToken.length > 256 ||
    body.csrfToken.length < 32
  ) {
    throw new Error("The staff session response is invalid.");
  }
  return body.csrfToken;
}

export async function staffFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (usesSyntheticBearerTransport()) return fetch(input, init);
  // Callers supply an API URL, never an arbitrary fetch destination or Request credential carrier.
  if (input instanceof Request) throw new Error("Staff requests require an explicit API URL.");
  const target = new URL(String(input), browserOrigin());
  if (
    target.origin !== browserOrigin() ||
    !target.pathname.startsWith("/v1/") ||
    target.hash ||
    target.username ||
    target.password ||
    /%2f|%5c|%2e/i.test(target.pathname)
  ) {
    throw new Error("The staff API destination is not allowed.");
  }
  const headers = new Headers(init?.headers);
  if (headers.has("authorization")) throw new Error("Browser bearer tokens are not accepted.");
  const method = (init?.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD"].includes(method)) {
    const csrf = await csrfToken(init?.signal);
    if (csrf instanceof Response) return csrf;
    headers.set("x-csrf-token", csrf);
  }
  target.pathname = `/bff${target.pathname}`;
  const response = await fetch(target.toString(), {
    ...init,
    headers,
    method,
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error"
  });
  if (response.status === 401) invalidateSession();
  return response;
}

export async function signOut(): Promise<"confirmed" | "local_closed" | "provider_unconfirmed"> {
  const csrf = await csrfToken();
  if (csrf instanceof Response) {
    if (csrf.status === 401) return "local_closed";
    throw new Error("Sign-out could not be confirmed. Please retry.");
  }
  const response = await fetch(`${browserOrigin()}/auth/logout`, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: "{}"
  });
  if (response.status === 503) {
    const body = await response.json().catch(() => null);
    if (body?.error?.code === "IDENTITY_REVOCATION_UNCONFIRMED") {
      invalidateSession();
      return "provider_unconfirmed";
    }
  }
  if (!response.ok && response.status !== 401) {
    throw new Error("Sign-out could not be fully confirmed. Please retry.");
  }
  invalidateSession();
  return response.status === 401 ? "local_closed" : "confirmed";
}
