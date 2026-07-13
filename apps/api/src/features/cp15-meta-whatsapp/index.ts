export interface MetaWebhookProcessor {
  verifyChallenge(input: {
    readonly mode: string | null;
    readonly verifyToken: string | null;
    readonly challenge: string | null;
  }): string;
  processWebhook(input: {
    readonly rawBody: Uint8Array;
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly receivedAt: string;
    readonly correlationId: string;
  }): Promise<{
    readonly outcome: "committed" | "duplicate";
    readonly rawEventId: string;
    readonly acceptedEventKeys: readonly string[];
    readonly duplicateEventKeys: readonly string[];
  }>;
}

export interface MetaApiResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

export interface MetaWebhookPostRequest {
  /** Opaque public registration identifier from the callback path; never a credential. */
  readonly registrationKey: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  readonly receivedAt: string;
  readonly correlationId: string;
}

export interface MetaWebhookRoutesOptions {
  readonly resolveProcessor: (registrationKey: string) => MetaWebhookProcessor | null;
  readonly maxRawBodyBytes?: number;
}

export function createMetaWhatsAppRoutes(options: MetaWebhookRoutesOptions): {
  readonly challenge: (
    registrationKey: string,
    query: Readonly<Record<string, string | readonly string[] | undefined>>
  ) => MetaApiResponse;
  readonly webhook: (request: MetaWebhookPostRequest) => Promise<MetaApiResponse>;
} {
  const maxRawBodyBytes = options.maxRawBodyBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxRawBodyBytes) || maxRawBodyBytes < 1024) {
    throw new Error("Meta WhatsApp raw body limit is invalid.");
  }
  return Object.freeze({
    challenge(registrationKey, query) {
      try {
        const processor = resolveRegisteredProcessor(options, registrationKey);
        const challenge = processor.verifyChallenge({
          mode: singleQuery(query, "hub.mode"),
          verifyToken: singleQuery(query, "hub.verify_token"),
          challenge: singleQuery(query, "hub.challenge")
        });
        return textResponse(200, challenge);
      } catch (error) {
        return errorResponse(error);
      }
    },
    async webhook(request) {
      let processor: MetaWebhookProcessor;
      try {
        processor = resolveRegisteredProcessor(options, request.registrationKey);
      } catch (error) {
        return errorResponse(error);
      }
      let rawBody: Uint8Array;
      try {
        assertDeclaredBodyLength(request.headers, maxRawBodyBytes);
        rawBody = await readBoundedRawBody(request.body, maxRawBodyBytes);
      } catch (error) {
        return errorResponse(error);
      }
      try {
        await processor.processWebhook({
          rawBody,
          headers: request.headers,
          receivedAt: request.receivedAt,
          correlationId: request.correlationId
        });
        // The public callback exposes no message volume or event identifiers.
        return jsonResponse(200, { accepted: true });
      } catch (error) {
        return errorResponse(error);
      }
    }
  });
}

function resolveRegisteredProcessor(
  options: MetaWebhookRoutesOptions,
  registrationKey: string
): MetaWebhookProcessor {
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(registrationKey)) {
    throw routeError("provider_registration_not_found", 404);
  }
  const processor = options.resolveProcessor(registrationKey);
  if (!processor) throw routeError("provider_registration_not_found", 404);
  return processor;
}

function assertDeclaredBodyLength(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  maxBytes: number
): void {
  const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === "content-length");
  if (matches.length === 0) return;
  const value = matches.length === 1 ? matches[0]?.[1] : undefined;
  if (typeof value !== "string" || !/^\d{1,12}$/u.test(value)) {
    throw routeError("invalid_content_length", 400);
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw routeError("invalid_content_length", 400);
  if (length > maxBytes) throw routeError("body_too_large", 413);
}

export async function readBoundedRawBody(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number
): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) throw routeError("invalid_payload", 400);
    total += chunk.byteLength;
    if (total > maxBytes) throw routeError("body_too_large", 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, total);
}

function singleQuery(
  query: Readonly<Record<string, string | readonly string[] | undefined>>,
  key: string
): string | null {
  const value = query[key];
  return typeof value === "string" ? value : null;
}

function errorResponse(error: unknown): MetaApiResponse {
  const safe = classifyError(error);
  return jsonResponse(safe.status, { error: { code: safe.code, retryable: safe.retryable } });
}

function classifyError(error: unknown): { readonly code: string; readonly status: number; readonly retryable: boolean } {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const code = typeof record.code === "string" && /^[a-z0-9_]{1,64}$/u.test(record.code) ? record.code : null;
    const status = typeof record.httpStatus === "number" && Number.isInteger(record.httpStatus) && record.httpStatus >= 400 && record.httpStatus <= 599 ? record.httpStatus : null;
    if (code && status) return { code, status, retryable: record.retryable === true };
  }
  return { code: "provider_webhook_unavailable", status: 503, retryable: true };
}

function routeError(code: string, httpStatus: number): { readonly code: string; readonly httpStatus: number; readonly retryable: false } {
  return { code, httpStatus, retryable: false };
}

function textResponse(status: number, value: string): MetaApiResponse {
  return {
    status,
    headers: Object.freeze({ "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }),
    body: Buffer.from(value, "utf8")
  };
}

function jsonResponse(status: number, value: unknown): MetaApiResponse {
  return {
    status,
    headers: Object.freeze({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }),
    body: Buffer.from(JSON.stringify(value), "utf8")
  };
}
