import { sanitizedFireworksError } from "./errors.js";

export interface FireworksHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: Uint8Array;
}

export interface FireworksJsonTransport {
  postJson(input: {
    readonly url: string;
    readonly authorization: string;
    readonly body: Uint8Array;
    readonly timeoutMs: number;
    readonly maximumResponseBytes: number;
  }): Promise<FireworksHttpResponse>;
}

export interface FireworksAudioTransport {
  postMultipart(input: {
    readonly url: string;
    readonly authorization: string;
    readonly contentType: string;
    readonly body: Uint8Array;
    readonly timeoutMs: number;
    readonly maximumResponseBytes: number;
  }): Promise<FireworksHttpResponse>;
}

export type FireworksHttpTransport = FireworksJsonTransport & FireworksAudioTransport;

const JSON_URLS = new Set([
  "https://api.fireworks.ai/inference/v1/chat/completions",
  "https://api.fireworks.ai/inference/v1/embeddings",
  "https://api.fireworks.ai/inference/v1/rerank"
]);
const AUDIO_URLS = new Set([
  "https://audio-prod.api.fireworks.ai/v1/audio/transcriptions",
  "https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions"
]);

export class FetchFireworksHttpTransport implements FireworksHttpTransport {
  async postJson(input: Parameters<FireworksJsonTransport["postJson"]>[0]): Promise<FireworksHttpResponse> {
    if (!JSON_URLS.has(input.url)) throw invalidEndpoint();
    return this.#post({
      ...input,
      headers: {
        authorization: bearerAuthorization(input.authorization),
        "content-type": "application/json"
      }
    });
  }

  async postMultipart(
    input: Parameters<FireworksAudioTransport["postMultipart"]>[0]
  ): Promise<FireworksHttpResponse> {
    if (!AUDIO_URLS.has(input.url)) throw invalidEndpoint();
    if (!/^multipart\/form-data; boundary=[A-Za-z0-9_-]{16,80}$/u.test(input.contentType)) {
      throw sanitizedFireworksError("invalid_request", "Fireworks multipart boundary is invalid.");
    }
    return this.#post({
      ...input,
      headers: {
        authorization: bearerAuthorization(input.authorization),
        "content-type": input.contentType
      }
    });
  }

  async #post(input: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly timeoutMs: number;
    readonly maximumResponseBytes: number;
  }): Promise<FireworksHttpResponse> {
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 60_000) {
      throw sanitizedFireworksError("invalid_request", "Fireworks timeout is invalid.");
    }
    if (
      !Number.isSafeInteger(input.maximumResponseBytes) ||
      input.maximumResponseBytes < 1_024 ||
      input.maximumResponseBytes > 16 * 1024 * 1024
    ) {
      throw sanitizedFireworksError("invalid_request", "Fireworks response limit is invalid.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetch(input.url, {
        method: "POST",
        headers: input.headers,
        body: Buffer.from(input.body),
        redirect: "error",
        signal: controller.signal
      });
      const body = await boundedResponseBody(response, input.maximumResponseBytes);
      return {
        status: response.status,
        headers: Object.freeze(Object.fromEntries(response.headers.entries())),
        body
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw sanitizedFireworksError(
          "provider_outcome_uncertain",
          "Fireworks request outcome is uncertain after timeout."
        );
      }
      if (error instanceof Error && error.name === "FireworksGatewayError") throw error;
      throw sanitizedFireworksError(
        "provider_outcome_uncertain",
        "Fireworks request outcome is uncertain after a transport failure."
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function boundedResponseBody(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maximum)) {
    throw sanitizedFireworksError("invalid_response", "Fireworks response exceeded its byte limit.", {
      providerHttpStatus: response.status
    });
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw sanitizedFireworksError("invalid_response", "Fireworks response exceeded its byte limit.", {
        providerHttpStatus: response.status
      });
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function invalidEndpoint() {
  return sanitizedFireworksError("invalid_request", "Fireworks endpoint is not allowlisted.");
}

function bearerAuthorization(rawCredential: string): string {
  if (
    typeof rawCredential !== "string" ||
    rawCredential.length < 16 ||
    rawCredential.length > 8_192 ||
    /[\s\0]/u.test(rawCredential) ||
    /^Bearer\s/iu.test(rawCredential)
  ) {
    throw sanitizedFireworksError("invalid_request", "Fireworks authorization credential is invalid.");
  }
  return `Bearer ${rawCredential}`;
}
