import type { IncomingMessage, ServerResponse } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomUUID } from "node:crypto";
import { systemClock } from "@clinic-os/domain";
import {
  readStaffIdentityConfiguration,
  loopbackOrigin,
  RedisRuntimeDependency,
  WebSessionError,
  OAuthFlowError,
  AuthenticationError
} from "@clinic-os/auth";
import {
  assertTrustedRequestBoundary,
  assertBrowserMutationRequest,
  BoundaryError
} from "@clinic-os/security";
import { Cp14BffError, type Cp14BffRequest } from "../lib/cp14-session/bff-contract.ts";
import { createStaffIdentityRuntime } from "./identity-runtime.mts";

export const PRIVATE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
};
const boundary = new AsyncLocalStorage<{ peer: string; protocol: string }>();

export function assertRawLocalRequest(request: IncomingMessage, webOrigin: string) {
  const peer = request.socket.remoteAddress;
  if (!peer || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)) throw denied();
  if (
    !request.url?.startsWith("/") ||
    request.url.startsWith("//") ||
    request.url.includes("\\") ||
    request.url.length > 8192
  )
    throw denied();
  const seen = new Set<string>();
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    const name = request.rawHeaders[i]!.toLowerCase();
    if (name.startsWith("x-forwarded-") || name === "forwarded" || name === "authorization")
      throw denied();
    if (
      seen.has(name) &&
      ["host", "origin", "cookie", "content-type", "content-length", "x-csrf-token"].includes(name)
    )
      throw denied();
    seen.add(name);
  }
  if (
    request.headers.host !== new URL(webOrigin).host ||
    (request.socket as { encrypted?: boolean }).encrypted
  )
    throw denied();
  return { peer, protocol: "http" };
}

export function createStaffRequestHandler(env: Readonly<Record<string, string | undefined>>) {
  const config = readStaffIdentityConfiguration(env);
  const webOrigin = config ? loopbackOrigin(env.CLINICOS_WEB_ORIGIN) : null;
  const policy = webOrigin
    ? {
        productionLike: false,
        trustedHosts: [new URL(webOrigin).host],
        trustedOrigins: [webOrigin],
        proxyBoundary: "direct_canonical" as const,
        hsts: "disabled_until_domain_ready" as const
      }
    : null;
  const trusted = (request: Cp14BffRequest) => {
    const transport = boundary.getStore();
    if (!transport || !policy) throw denied();
    if (request.headers.authorization || request.headers.forwarded) throw denied();
    return {
      policy,
      hostHeader: request.headers.host,
      originHeader: request.headers.origin,
      directProtocol: transport.protocol,
      untrustedForwardedHostHeader: request.headers["x-forwarded-host"],
      untrustedForwardedProtoHeader: request.headers["x-forwarded-proto"]
    };
  };
  const identity = createStaffIdentityRuntime(env, {
    assertBoundary(request) {
      assertTrustedRequestBoundary(trusted(request));
    },
    assertMutation(request, verifyCsrfToken) {
      assertBrowserMutationRequest({
        ...trusted(request),
        method: request.method,
        csrfHeader: request.headers["x-csrf-token"],
        contentTypeHeader: request.headers["content-type"],
        authorizationHeader: request.headers.authorization,
        secFetchSiteHeader: request.headers["sec-fetch-site"],
        verifyCsrfToken
      });
    },
    sensitiveHeaders: () => PRIVATE_HEADERS
  });
  const budget = config ? new RedisRuntimeDependency({ redisUrl: config.redisUrl }) : null;
  let active = 0;
  return {
    enabled: !!identity,
    webOrigin,
    async close() {
      await Promise.allSettled([identity?.close(), budget?.close()]);
    },
    async handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
      const path = request.url?.split("?", 1)[0] ?? "";
      if (
        !path.startsWith("/auth/") &&
        !path.startsWith("/bff/") &&
        !(identity && path.startsWith("/v1/"))
      )
        return false;
      for (const [key, value] of Object.entries(PRIVATE_HEADERS)) response.setHeader(key, value);
      const requestId = randomUUID();
      response.setHeader("x-request-id", requestId);
      if (!identity || !config || !webOrigin || !budget) {
        sendError(response, 503, "IDENTITY_UNAVAILABLE", requestId);
        return true;
      }
      if (path.startsWith("/v1/")) {
        sendError(response, 404, "NOT_FOUND", requestId);
        return true;
      }
      if (active >= 32) {
        response.setHeader("retry-after", "1");
        sendError(response, 429, "RATE_LIMITED", requestId);
        return true;
      }
      active++;
      try {
        const transport = assertRawLocalRequest(request, webOrigin);
        await boundary.run(transport, async () => {
          const translated: Cp14BffRequest = {
            method: request.method ?? "",
            url: `${webOrigin}${request.url}`,
            headers: request.headers
          };
          assertTrustedRequestBoundary(trusted(translated));
          const login = path === "/auth/login" || path === "/auth/callback";
          const bucket = createHmac("sha256", config.storeKey)
            .update(`${login ? "login" : "requests"}:${transport.peer}`)
            .digest("hex");
          const result = await deadline(
            budget.evaluate(
              "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n",
              [`${config.namespace}:budget:${bucket}`],
              [login ? "300000" : "60000"]
            ),
            3000
          );
          if (typeof result !== "number" || result > (login ? 20 : 240)) {
            response.setHeader("retry-after", login ? "300" : "60");
            sendError(response, 429, "RATE_LIMITED", requestId);
            return;
          }
          // Session inspection supplies logout CSRF. A stopped delivery worker must
          // not prevent revocation while the durable stores/audit writes still work.
          // Login and all clinic API access continue to require the delivery lease.
          await identity.readiness(path !== "/auth/session" && path !== "/auth/logout");
          if (path === "/auth/health") {
            if (translated.method !== "GET") throw denied();
            sendJson(response, 200, { status: "ready", loginAllowed: true });
            return;
          }
          if (!["GET", "HEAD"].includes(translated.method))
            translated.body = await readBody(request, 1_048_576);
          const now = systemClock.now();
          const output =
            path === "/auth/login"
              ? await identity.runtime.beginLogin(translated, now)
              : path === "/auth/callback"
                ? await identity.runtime.completeLogin(translated, now)
                : path === "/auth/session"
                  ? await identity.runtime.sessionStatus(translated, now)
                  : path === "/auth/logout"
                    ? await identity.runtime.logout(translated, now)
                    : path.startsWith("/bff/v1/")
                      ? await identity.runtime.proxyApi(translated, request.url!.slice(4), now)
                      : null;
          if (!output) {
            sendError(response, 404, "NOT_FOUND", requestId);
            return;
          }
          response.statusCode = output.status;
          for (const [key, value] of Object.entries(output.headers))
            response.setHeader(key, typeof value === "string" ? value : [...value]);
          if (output.body === null || translated.method === "HEAD" || output.status === 204)
            response.end();
          else if (output.body instanceof Uint8Array) response.end(output.body);
          else sendJson(response, output.status, output.body);
        });
      } catch (error) {
        response.setHeader("connection", "close");
        const status =
          error instanceof BoundaryError
            ? error.status
            : error instanceof WebSessionError &&
                ["rotation_conflict", "refresh_recovery_required"].includes(error.code)
              ? 503
              : error instanceof AuthenticationError ||
                  error instanceof OAuthFlowError ||
                  error instanceof WebSessionError
                ? 401
                : error instanceof Cp14BffError
                  ? {
                      BAD_REQUEST: 400,
                      UNAUTHENTICATED: 401,
                      PERMISSION_DENIED: 403,
                      PAYLOAD_TOO_LARGE: 413,
                      UPSTREAM_REJECTED: 502
                    }[error.code]
                  : 503;
        if (status === 401) response.setHeader("set-cookie", identity.sessions.clearCookie());
        if (path === "/auth/callback") {
          response.statusCode = 303;
          response.setHeader(
            "location",
            status === 401 ? "/?signIn=denied" : "/?signIn=unavailable"
          );
          response.end();
          return true;
        }
        sendError(
          response,
          status,
          status === 401
            ? "AUTH_REQUIRED"
            : status === 403
              ? "PERMISSION_DENIED"
              : "IDENTITY_UNAVAILABLE",
          requestId
        );
      } finally {
        active--;
      }
      return true;
    }
  };
}

export async function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  const length = request.headers["content-length"];
  if (length && (!/^\d+$/.test(length) || Number(length) > limit))
    throw new Cp14BffError("PAYLOAD_TOO_LARGE", "Request exceeds policy.");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.off("data", data);
      request.off("end", end);
      request.off("error", fail);
      request.off("aborted", aborted);
    };
    const fail = (error: Error) => {
      cleanup();
      request.pause();
      reject(error);
    };
    const aborted = () => fail(new Error("Request body interrupted."));
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) {
        fail(new Cp14BffError("PAYLOAD_TOO_LARGE", "Request exceeds policy."));
        return;
      }
      chunks.push(Buffer.from(chunk));
    };
    const end = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(
      () => fail(new Cp14BffError("BAD_REQUEST", "Request body deadline exceeded.")),
      10_000
    );
    request.on("data", data);
    request.once("end", end);
    request.once("error", fail);
    request.once("aborted", aborted);
  });
}
function denied() {
  return new BoundaryError({
    code: "PERMISSION_DENIED",
    message: "Request boundary is not accepted."
  });
}
function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
function sendError(response: ServerResponse, status: number, code: string, requestId: string) {
  if (response.writableEnded || response.destroyed) return;
  sendJson(response, status, {
    error: {
      code,
      message: status === 401 ? "Sign in to continue." : "The request could not be completed.",
      request_id: requestId
    }
  });
}
async function deadline<T>(operation: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Dependency unavailable.")), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
