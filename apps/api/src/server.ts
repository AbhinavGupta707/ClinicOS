import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { safeParseClinicOsEnv, type ClinicOsConfig } from "@clinic-os/config";
import { AuthenticationError, type KeycloakAccessTokenClaims } from "@clinic-os/auth";
import type { IdentityRepository } from "@clinic-os/db";
import type { AuditEventRecord } from "@clinic-os/security";
import { ApiError, toApiErrorBody } from "./errors.ts";
import { KeycloakJwtVerifier } from "./keycloak-verifier.ts";
import {
  createLocalFixtureClaims,
  InMemoryAuditSink,
  LocalFixtureIdentityRepository
} from "./local-fixture.ts";
import { getMe } from "./me.ts";

interface AuditSink {
  appendAuditEvent(event: AuditEventRecord): Promise<void>;
}

interface TokenVerifier {
  verifyAuthorizationHeader(
    authorizationHeader: string | undefined
  ): Promise<KeycloakAccessTokenClaims>;
}

export interface ClinicOsApiServerOptions {
  config: ClinicOsConfig;
  identityRepository: IdentityRepository;
  auditSink?: AuditSink;
  tokenVerifier?: TokenVerifier;
  useLocalAuthFixture?: boolean;
  fixtureSubject?: string;
}

interface RuntimeOptions {
  server: Server;
  port: number;
}

const DEFAULT_PORT = 4000;
const DEFAULT_API_AUDIENCE = "clinic-os-api";

export function createClinicOsApiServer(options: ClinicOsApiServerOptions): Server {
  const expectedIssuer = buildExpectedIssuer(options.config);
  const acceptedAudience = process.env.CLINIC_OS_API_AUDIENCE ?? DEFAULT_API_AUDIENCE;
  const tokenVerifier =
    options.tokenVerifier ??
    new KeycloakJwtVerifier({
      expectedIssuer,
      jwksUri: `${expectedIssuer}/protocol/openid-connect/certs`
    });

  return createServer(async (request, response) => {
    const requestId = getRequestId(request);
    response.setHeader("x-request-id", requestId);

    try {
      if (request.method === "GET" && request.url === "/health/live") {
        return sendJson(response, 200, {
          status: "ok",
          service: "clinic-os-api",
          request_id: requestId
        });
      }

      if (request.method === "GET" && request.url === "/health/ready") {
        return sendJson(response, 200, {
          status: "ready",
          auth: options.useLocalAuthFixture ? "local_synthetic_fixture" : "keycloak_jwks",
          repository: "identity_repository_configured",
          request_id: requestId
        });
      }

      if (request.method === "GET" && request.url === "/v1/me") {
        const verifiedKeycloakClaims = await resolveClaims({
          request,
          tokenVerifier,
          useLocalAuthFixture: options.useLocalAuthFixture ?? false,
          fixtureSubject: options.fixtureSubject,
          expectedIssuer,
          acceptedAudience
        });

        const result = await getMe(
          {
            requestId,
            verifiedKeycloakClaims,
            ipAddress: request.socket.remoteAddress ?? null,
            userAgent: request.headers["user-agent"] ?? null
          },
          {
            keycloak: {
              expectedIssuer,
              acceptedAudiences: [
                acceptedAudience,
                options.config.auth.keycloakClientId,
                "clinicos-api"
              ],
              acceptedClientIds: [acceptedAudience, options.config.auth.keycloakClientId]
            },
            identityRepository: options.identityRepository,
            auditSink: options.auditSink
          }
        );

        return sendJson(response, result.status, result.body);
      }

      throw new ApiError(404, "NOT_FOUND", "Route not found.", {
        method: request.method,
        path: request.url
      });
    } catch (error) {
      return sendApiError(response, normalizeApiError(error), requestId);
    }
  });
}

export function createRuntimeApiServer(env: NodeJS.ProcessEnv = process.env): RuntimeOptions {
  const parsed = safeParseClinicOsEnv(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message
    }));
    throw new ApiError(503, "CONFIGURATION_ERROR", "ClinicOS API configuration is invalid.", {
      issues
    });
  }

  const useLocalAuthFixture = parseBoolean(env.CLINIC_OS_API_USE_DEV_AUTH_FIXTURE);

  if (parsed.data.isProductionLike && useLocalAuthFixture) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "CLINIC_OS_API_USE_DEV_AUTH_FIXTURE is forbidden outside local/dev environments."
    );
  }

  const identityRepository = new LocalFixtureIdentityRepository();
  const auditSink = new InMemoryAuditSink();
  const port = parsePort(env.PORT ?? env.API_PORT);

  const serverOptions: ClinicOsApiServerOptions = {
    config: parsed.data,
    identityRepository,
    auditSink,
    useLocalAuthFixture
  };

  if (env.CLINIC_OS_API_DEV_SUBJECT) {
    serverOptions.fixtureSubject = env.CLINIC_OS_API_DEV_SUBJECT;
  }

  return {
    port,
    server: createClinicOsApiServer(serverOptions)
  };
}

function resolveClaims(input: {
  request: IncomingMessage;
  tokenVerifier: TokenVerifier;
  useLocalAuthFixture: boolean;
  fixtureSubject?: string | undefined;
  expectedIssuer: string;
  acceptedAudience: string;
}): Promise<KeycloakAccessTokenClaims> {
  if (input.useLocalAuthFixture) {
    const subject =
      headerValue(input.request, "x-clinic-os-dev-subject") ??
      input.fixtureSubject ??
      "seed-assistant";

    return Promise.resolve(
      createLocalFixtureClaims({
        subject,
        expectedIssuer: input.expectedIssuer,
        acceptedAudience: input.acceptedAudience
      })
    );
  }

  return input.tokenVerifier.verifyAuthorizationHeader(headerValue(input.request, "authorization"));
}

function buildExpectedIssuer(config: ClinicOsConfig): string {
  return `${config.auth.keycloakBaseUrl.replace(/\/$/, "")}/realms/${config.auth.keycloakRealm}`;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? DEFAULT_PORT);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new ApiError(503, "CONFIGURATION_ERROR", "API port is invalid.", { value });
  }

  return parsed;
}

function getRequestId(request: IncomingMessage): string {
  return headerValue(request, "x-request-id") ?? randomUUID();
}

function headerValue(request: IncomingMessage, header: string): string | undefined {
  const value = request.headers[header];

  if (Array.isArray(value)) return value[0];
  return value;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
}

function sendApiError(response: ServerResponse, error: ApiError, requestId: string) {
  sendJson(response, error.status, toApiErrorBody(error, requestId));
}

function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AuthenticationError)
    return new ApiError(401, "UNAUTHENTICATED", error.message);
  if (error instanceof Error) return new ApiError(500, "CONFIGURATION_ERROR", error.message);
  return new ApiError(500, "CONFIGURATION_ERROR", "Unexpected API error.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { server, port } = createRuntimeApiServer();

    server.listen(port, "127.0.0.1", () => {
      console.log(`ClinicOS API listening on http://127.0.0.1:${port}`);
    });
  } catch (error) {
    const normalized = normalizeApiError(error);
    console.error(JSON.stringify(toApiErrorBody(normalized, "startup"), null, 2));
    process.exitCode = 1;
  }
}
