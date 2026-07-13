import { RazorpayBoundaryError } from "./errors.js";

const MAX_RAZORPAY_RESPONSE_BYTES = 512 * 1024;

export interface RazorpayHttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
}

export interface RazorpayHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string;
}

export type RazorpayHttpTransport = (request: RazorpayHttpRequest) => Promise<RazorpayHttpResponse>;

export interface RazorpayApiClientOptions {
  readonly keyId: string;
  readonly keySecret: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly transport?: RazorpayHttpTransport;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface CreateRazorpayCollectionInput {
  readonly kind: "payment_link" | "invoice_qr";
  readonly invoiceId: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly amountMinor: number;
  readonly currency: "INR";
  readonly acceptPartial: boolean;
  readonly minimumPartialAmountMinor?: number | null;
  readonly expiresAt?: string | null;
}

export interface RazorpayCollectionResult {
  readonly providerRequestId: string;
  readonly kind: CreateRazorpayCollectionInput["kind"];
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly hostedUrl: string | null;
  readonly qrPayload: string | null;
  readonly expiresAt: string | null;
}

export interface RazorpayPaymentSnapshot {
  readonly providerPaymentId: string;
  readonly amountMinor: number;
  readonly amountRefundedMinor: number;
  readonly currency: string;
  readonly status: string;
  readonly captured: boolean;
  readonly providerRequestId: string | null;
}

export class RazorpayApiClient {
  readonly #keyId: string;
  readonly #keySecret: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #transport: RazorpayHttpTransport;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: RazorpayApiClientOptions) {
    if (!options.keyId.trim() || !options.keySecret) {
      throw new RazorpayBoundaryError({
        code: "NOT_CONFIGURED",
        message: "Razorpay API credentials are not configured."
      });
    }
    this.#keyId = options.keyId;
    this.#keySecret = options.keySecret;
    this.#baseUrl = (options.baseUrl ?? "https://api.razorpay.com/v1").replace(/\/$/u, "");
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 250 ||
      this.#timeoutMs > 30_000
    ) {
      throw new Error("Razorpay timeout must be between 250 and 30000 milliseconds.");
    }
    this.#transport = options.transport ?? defaultTransport;
    this.#sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async createCollection(input: CreateRazorpayCollectionInput): Promise<RazorpayCollectionResult> {
    assertCollectionInput(input);
    const expiresAt = input.expiresAt ? validFutureEpoch(input.expiresAt) : null;
    const notes = {
      clinic_os_tenant_id: input.tenantId,
      clinic_os_clinic_id: input.clinicId,
      clinic_os_invoice_id: input.invoiceId
    };
    if (input.kind === "payment_link") {
      const entity = await this.#requestObject("POST", "/payment_links", {
        amount: input.amountMinor,
        currency: input.currency,
        accept_partial: input.acceptPartial,
        ...(input.acceptPartial ? { first_min_partial_amount: minimumPartial(input) } : {}),
        reference_id: input.invoiceId,
        ...(expiresAt !== null ? { expire_by: expiresAt } : {}),
        notify: { sms: false, email: false },
        reminder_enable: false,
        notes
      });
      return {
        providerRequestId: requiredString(entity.id, "id"),
        kind: input.kind,
        status: optionalString(entity.status) ?? "created",
        amountMinor: requiredMinor(entity.amount, "amount"),
        currency: requiredString(entity.currency, "currency"),
        hostedUrl: optionalString(entity.short_url),
        qrPayload: optionalString(entity.short_url),
        expiresAt: input.expiresAt ?? null
      };
    }
    const entity = await this.#requestObject("POST", "/payments/qr_codes", {
      type: "upi_qr",
      usage: "single_use",
      fixed_amount: true,
      payment_amount: input.amountMinor,
      ...(expiresAt !== null ? { close_by: expiresAt } : {}),
      notes
    });
    return {
      providerRequestId: requiredString(entity.id, "id"),
      kind: input.kind,
      status: optionalString(entity.status) ?? "active",
      amountMinor: input.amountMinor,
      currency: input.currency,
      hostedUrl: optionalString(entity.image_url),
      qrPayload: optionalString(entity.qr_string),
      expiresAt: input.expiresAt ?? null
    };
  }

  async fetchPayment(providerPaymentId: string): Promise<RazorpayPaymentSnapshot> {
    const id = requiredOpaqueId(providerPaymentId, "providerPaymentId");
    const entity = await this.#requestObject("GET", `/payments/${encodeURIComponent(id)}`);
    return {
      providerPaymentId: requiredString(entity.id, "id"),
      amountMinor: requiredMinor(entity.amount, "amount"),
      amountRefundedMinor: requiredMinor(entity.amount_refunded ?? 0, "amount_refunded"),
      currency: requiredString(entity.currency, "currency"),
      status: requiredString(entity.status, "status"),
      captured: entity.captured === true,
      providerRequestId: optionalString(entity.invoice_id) ?? optionalString(entity.order_id)
    };
  }

  async #requestObject(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const attempts = method === "GET" ? 3 : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.#transport({
          method,
          url: `${this.#baseUrl}${path}`,
          headers: {
            authorization: `Basic ${Buffer.from(`${this.#keyId}:${this.#keySecret}`).toString("base64")}`,
            accept: "application/json",
            ...(body ? { "content-type": "application/json" } : {})
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          timeoutMs: this.#timeoutMs
        });
        if (Buffer.byteLength(response.body, "utf8") > MAX_RAZORPAY_RESPONSE_BYTES) {
          throw new RazorpayBoundaryError({
            code: "PROVIDER_REJECTED",
            message: "Razorpay API response exceeded its configured body limit.",
            safeDetails: {
              operation: `${method} ${path}`,
              maxResponseBytes: MAX_RAZORPAY_RESPONSE_BYTES
            }
          });
        }
        if (response.status >= 200 && response.status < 300)
          return parseResponseObject(response.body);
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < attempts) {
          await this.#sleep(retryDelay(response.headers, attempt));
          continue;
        }
        throw new RazorpayBoundaryError({
          code:
            response.status === 429
              ? "PROVIDER_RATE_LIMITED"
              : retryable
                ? "PROVIDER_UNAVAILABLE"
                : "PROVIDER_REJECTED",
          message: `Razorpay API request failed with HTTP ${response.status}.`,
          retryable,
          outcomeUnknown: method === "POST" && retryable,
          safeDetails: { status: response.status, operation: `${method} ${path}` }
        });
      } catch (error) {
        if (error instanceof RazorpayBoundaryError) throw error;
        lastError = error;
        if (method === "GET" && attempt < attempts) {
          await this.#sleep(100 * 2 ** (attempt - 1));
          continue;
        }
        throw new RazorpayBoundaryError({
          code: "PROVIDER_UNAVAILABLE",
          message: "Razorpay API transport is unavailable.",
          retryable: true,
          outcomeUnknown: method === "POST",
          safeDetails: { operation: `${method} ${path}`, errorClass: errorName(error) }
        });
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Razorpay request attempts exhausted.");
  }
}

async function defaultTransport(request: RazorpayHttpRequest): Promise<RazorpayHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body ? { body: request.body } : {}),
      signal: controller.signal
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await readBoundedResponse(response)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function assertCollectionInput(input: CreateRazorpayCollectionInput): void {
  requiredOpaqueId(input.invoiceId, "invoiceId");
  requiredOpaqueId(input.tenantId, "tenantId");
  requiredOpaqueId(input.clinicId, "clinicId");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new Error("amountMinor must be a positive safe integer.");
  if (input.currency !== "INR") throw new Error("Razorpay collection currency must be INR.");
  if (input.kind === "invoice_qr" && input.acceptPartial) {
    throw new Error("Single-use fixed-amount Razorpay QR cannot accept partial payment.");
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RAZORPAY_RESPONSE_BYTES) {
    throw new RazorpayBoundaryError({
      code: "PROVIDER_REJECTED",
      message: "Razorpay API response exceeded its configured body limit."
    });
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RAZORPAY_RESPONSE_BYTES) {
        await reader.cancel();
        throw new RazorpayBoundaryError({
          code: "PROVIDER_REJECTED",
          message: "Razorpay API response exceeded its configured body limit."
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    total
  ).toString("utf8");
}

function minimumPartial(input: CreateRazorpayCollectionInput): number {
  const value =
    input.minimumPartialAmountMinor ??
    Math.min(input.amountMinor, Math.max(100, Math.ceil(input.amountMinor / 2)));
  if (!Number.isSafeInteger(value) || value <= 0 || value > input.amountMinor)
    throw new Error("minimumPartialAmountMinor is invalid.");
  return value;
}

function validFutureEpoch(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw new Error("expiresAt must be an ISO timestamp.");
  return Math.floor(milliseconds / 1000);
}

function retryDelay(headers: RazorpayHttpResponse["headers"], attempt: number): number {
  const seconds = Number(headers["retry-after"]);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(2_000, Math.floor(seconds * 1000));
  return 100 * 2 ** (attempt - 1);
}

function parseResponseObject(body: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(body);
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    /* mapped below */
  }
  throw new RazorpayBoundaryError({
    code: "PROVIDER_REJECTED",
    message: "Razorpay API returned an invalid response."
  });
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value);
  if (!result)
    throw new RazorpayBoundaryError({
      code: "PROVIDER_REJECTED",
      message: `Razorpay response ${field} is invalid.`
    });
  return result;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredMinor(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new RazorpayBoundaryError({
      code: "PROVIDER_REJECTED",
      message: `Razorpay response ${field} is invalid.`
    });
  return value as number;
}

function requiredOpaqueId(value: string, field: string): string {
  if (!value.trim() || value.length > 128 || /[\s/?#]/u.test(value))
    throw new Error(`${field} must be a bounded opaque identifier.`);
  return value;
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}
