import { RazorpayBoundaryError } from "./errors.js";
import type {
  RazorpayHttpRequest,
  RazorpayHttpResponse,
  RazorpayHttpTransport,
  RazorpayPaymentSnapshot
} from "./client.js";

const MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_QR_PAGES = 5;
const QR_PAGE_SIZE = 100;
const CREATION_WINDOW_SECONDS = 15 * 60;
const OFFICIAL_BASE_URL = "https://api.razorpay.com/v1";
const GET_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 2_000;
const CREATION_LOOKUP_GETS = 1 + MAX_QR_PAGES;

type RazorpayReadOperation =
  "fetch_payment_by_id" | "fetch_payment_links_by_reference" | "list_qr_codes_for_creation_window";

export interface RazorpayCollectionReconciliationClientOptions {
  readonly keyId: string;
  readonly keySecret: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly transport?: RazorpayHttpTransport;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface RazorpayCollectionLookupInput {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly invoiceId: string;
  readonly providerRequestReference: string;
  readonly jobCreatedAt: string;
}

export interface RazorpayCollectionSnapshot {
  readonly providerRequestId: string;
  readonly kind: "payment_link" | "invoice_qr";
  readonly referenceId: string;
  readonly amountMinor: number;
  readonly currency: string | null;
  readonly status: string;
  readonly createdAtEpochSeconds: number;
}

export type RazorpayCollectionLookupResult =
  | {
      readonly outcome: "found";
      readonly collection: RazorpayCollectionSnapshot;
      readonly searchedQrPages: number;
    }
  | {
      readonly outcome: "not_found" | "inconclusive";
      readonly searchedQrPages: number;
    }
  | {
      readonly outcome: "ambiguous";
      readonly collections: readonly RazorpayCollectionSnapshot[];
      readonly searchedQrPages: number;
      readonly reason: "multiple_matches" | "scope_mismatch";
    };

export type RazorpayPaymentLookupResult =
  | { readonly outcome: "found"; readonly payment: RazorpayPaymentSnapshot }
  | { readonly outcome: "not_found" };

/**
 * Official, read-only recovery boundary for a Razorpay collection POST whose response was lost.
 * Payment Links support an exact reference_id filter. QR Codes support only bounded time/pagination
 * filters, so QR results are additionally bound to the exact tenant/clinic/invoice notes written by
 * the creation client. No collection status is projected as paid/captured settlement truth here.
 */
export class RazorpayCollectionReconciliationClient {
  readonly maximumPaymentLookupDurationMs: number;
  readonly maximumCreationLookupDurationMs: number;
  readonly #keyId: string;
  readonly #keySecret: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #transport: RazorpayHttpTransport;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: RazorpayCollectionReconciliationClientOptions) {
    if (
      !/^rzp_(?:test|live)_[A-Za-z0-9]{6,128}$/u.test(options.keyId) ||
      options.keySecret.length < 16 ||
      options.keySecret.length > 512
    ) {
      throw boundary("NOT_CONFIGURED", "Razorpay API credentials are not configured.");
    }
    this.#keyId = options.keyId;
    this.#keySecret = options.keySecret;
    this.#baseUrl = officialBaseUrl(options.baseUrl ?? OFFICIAL_BASE_URL);
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(this.#timeoutMs) ||
      this.#timeoutMs < 250 ||
      this.#timeoutMs > 30_000
    ) {
      throw new Error("Razorpay timeout must be between 250 and 30000 milliseconds.");
    }
    const maximumGetDurationMs = this.#timeoutMs * GET_ATTEMPTS + MAX_RETRY_DELAY_MS * 2;
    this.maximumPaymentLookupDurationMs = maximumGetDurationMs;
    this.maximumCreationLookupDurationMs = maximumGetDurationMs * CREATION_LOOKUP_GETS;
    this.#transport = options.transport ?? defaultTransport;
    this.#sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async lookupPayment(providerPaymentId: string): Promise<RazorpayPaymentLookupResult> {
    const id = requiredPaymentId(providerPaymentId);
    const response = await this.#request(
      "fetch_payment_by_id",
      `/payments/${encodeURIComponent(id)}`,
      [400, 404]
    );
    if (response.status === 400 || response.status === 404) {
      const providerError = classifyProviderError(response.body);
      if (
        providerError.code === "BAD_REQUEST_ERROR" &&
        providerError.description === "The id provided does not exist."
      ) {
        return { outcome: "not_found" };
      }
      throw new RazorpayBoundaryError({
        code: "PROVIDER_REJECTED",
        message: "Razorpay payment lookup returned a non-authoritative client error.",
        safeDetails: {
          status: response.status,
          operation: "fetch_payment_by_id",
          ...(providerError.code ? { providerErrorCode: providerError.code } : {})
        }
      });
    }

    const entity = parseObject(response.body);
    return {
      outcome: "found",
      payment: {
        providerPaymentId: requiredIdentifier(entity.id, "payment.id"),
        amountMinor: requiredMinor(entity.amount, "payment.amount"),
        amountRefundedMinor: requiredMinor(entity.amount_refunded ?? 0, "payment.amount_refunded"),
        currency: requiredBoundedString(entity.currency, "payment.currency"),
        status: requiredBoundedString(entity.status, "payment.status"),
        captured: requiredBoolean(entity.captured, "payment.captured"),
        providerRequestId: optionalString(entity.invoice_id) ?? optionalString(entity.order_id)
      }
    };
  }

  async findCollectionByInvoiceReference(
    input: RazorpayCollectionLookupInput
  ): Promise<RazorpayCollectionLookupResult> {
    const tenantId = boundedIdentifier(input.tenantId, "tenantId", 128);
    const clinicId = boundedIdentifier(input.clinicId, "clinicId", 128);
    const invoiceId = boundedIdentifier(input.invoiceId, "invoiceId", 40);
    boundedIdentifier(input.providerRequestReference, "providerRequestReference", 256);
    const createdAt = Date.parse(input.jobCreatedAt);
    if (!Number.isFinite(createdAt)) throw new Error("jobCreatedAt must be an ISO timestamp.");

    const linkObject = await this.#getObject(
      "fetch_payment_links_by_reference",
      `/payment_links/?reference_id=${encodeURIComponent(invoiceId)}`
    );
    const linkEntities = requiredArray(linkObject.payment_links, "payment_links");
    const matches: RazorpayCollectionSnapshot[] = [];
    let scopeMismatch = false;

    for (const entity of linkEntities) {
      const link = requiredObject(entity, "payment_link");
      if (optionalString(link.reference_id) !== invoiceId) continue;
      if (!notesMatch(link.notes, { tenantId, clinicId, invoiceId })) {
        scopeMismatch = true;
        continue;
      }
      matches.push({
        providerRequestId: requiredIdentifier(link.id, "payment_link.id"),
        kind: "payment_link",
        referenceId: invoiceId,
        amountMinor: requiredMinor(link.amount, "payment_link.amount"),
        currency: optionalString(link.currency),
        status: requiredBoundedString(link.status, "payment_link.status"),
        createdAtEpochSeconds: requiredEpoch(link.created_at, "payment_link.created_at")
      });
    }

    const jobEpoch = Math.floor(createdAt / 1_000);
    const from = Math.max(0, jobEpoch - CREATION_WINDOW_SECONDS);
    const to = jobEpoch + CREATION_WINDOW_SECONDS;
    let searchedQrPages = 0;
    let qrSearchComplete = false;

    for (let page = 0; page < MAX_QR_PAGES; page += 1) {
      const skip = page * QR_PAGE_SIZE;
      const qrObject = await this.#getObject(
        "list_qr_codes_for_creation_window",
        `/payments/qr_codes?from=${from}&to=${to}&count=${QR_PAGE_SIZE}&skip=${skip}`
      );
      searchedQrPages += 1;
      const qrEntities = requiredArray(qrObject.items, "items");
      for (const entity of qrEntities) {
        const qr = requiredObject(entity, "qr_code");
        const createdAtEpochSeconds = requiredEpoch(qr.created_at, "qr_code.created_at");
        if (createdAtEpochSeconds < from || createdAtEpochSeconds > to) {
          throw boundary(
            "PROVIDER_REJECTED",
            "Razorpay QR reconciliation returned an entity outside the requested time window."
          );
        }
        const notes = optionalObject(qr.notes);
        const referencesInvoice = notes?.clinic_os_invoice_id === invoiceId;
        if (!referencesInvoice) continue;
        if (!notesMatch(notes, { tenantId, clinicId, invoiceId })) {
          scopeMismatch = true;
          continue;
        }
        matches.push({
          providerRequestId: requiredIdentifier(qr.id, "qr_code.id"),
          kind: "invoice_qr",
          referenceId: invoiceId,
          amountMinor: requiredMinor(qr.payment_amount, "qr_code.payment_amount"),
          currency: optionalString(qr.currency),
          status: requiredBoundedString(qr.status, "qr_code.status"),
          createdAtEpochSeconds
        });
      }
      if (qrEntities.length < QR_PAGE_SIZE) {
        qrSearchComplete = true;
        break;
      }
    }

    const uniqueMatches = uniqueCollections(matches);
    if (scopeMismatch) {
      return {
        outcome: "ambiguous",
        collections: uniqueMatches,
        searchedQrPages,
        reason: "scope_mismatch"
      };
    }
    if (uniqueMatches.length > 1) {
      return {
        outcome: "ambiguous",
        collections: uniqueMatches,
        searchedQrPages,
        reason: "multiple_matches"
      };
    }
    if (uniqueMatches.length === 1) {
      return { outcome: "found", collection: uniqueMatches[0]!, searchedQrPages };
    }
    return {
      outcome: qrSearchComplete ? "not_found" : "inconclusive",
      searchedQrPages
    };
  }

  async #getObject(
    operation: RazorpayReadOperation,
    path: string
  ): Promise<Record<string, unknown>> {
    return parseObject((await this.#request(operation, path)).body);
  }

  async #request(
    operation: RazorpayReadOperation,
    path: string,
    acceptedErrorStatuses: readonly number[] = []
  ): Promise<RazorpayHttpResponse> {
    for (let attempt = 1; attempt <= GET_ATTEMPTS; attempt += 1) {
      let response: RazorpayHttpResponse;
      try {
        response = await this.#transport({
          method: "GET",
          url: `${this.#baseUrl}${path}`,
          headers: {
            authorization: `Basic ${Buffer.from(`${this.#keyId}:${this.#keySecret}`).toString("base64")}`,
            accept: "application/json"
          },
          timeoutMs: this.#timeoutMs
        });
      } catch (error) {
        if (error instanceof RazorpayBoundaryError) throw error;
        if (attempt < GET_ATTEMPTS) {
          await this.#sleep(100 * 2 ** (attempt - 1));
          continue;
        }
        throw new RazorpayBoundaryError({
          code: "PROVIDER_UNAVAILABLE",
          message: "Razorpay reconciliation API transport is unavailable.",
          retryable: true,
          safeDetails: { operation, errorClass: errorName(error) }
        });
      }
      if (Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE_BYTES) {
        throw boundary(
          "PROVIDER_REJECTED",
          "Razorpay reconciliation response exceeded its configured body limit."
        );
      }
      if (
        (response.status >= 200 && response.status < 300) ||
        acceptedErrorStatuses.includes(response.status)
      ) {
        return response;
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < GET_ATTEMPTS) {
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
        message: `Razorpay reconciliation API request failed with HTTP ${response.status}.`,
        retryable,
        safeDetails: { status: response.status, operation }
      });
    }
    throw new Error("Razorpay reconciliation request attempts exhausted.");
  }
}

async function defaultTransport(request: RazorpayHttpRequest): Promise<RazorpayHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      redirect: "error",
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

async function readBoundedResponse(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw boundary(
      "PROVIDER_REJECTED",
      "Razorpay reconciliation response exceeded its configured body limit."
    );
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
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw boundary(
          "PROVIDER_REJECTED",
          "Razorpay reconciliation response exceeded its configured body limit."
        );
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

function parseObject(body: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(body);
    return requiredObject(parsed, "response");
  } catch (error) {
    if (error instanceof RazorpayBoundaryError) throw error;
    throw boundary("PROVIDER_REJECTED", "Razorpay reconciliation API returned invalid JSON.");
  }
}

function requiredObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw boundary("PROVIDER_REJECTED", `Razorpay reconciliation ${field} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredArray(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw boundary("PROVIDER_REJECTED", `Razorpay reconciliation ${field} is invalid.`);
  }
  if (value.length > QR_PAGE_SIZE) {
    throw boundary("PROVIDER_REJECTED", `Razorpay reconciliation ${field} exceeded its limit.`);
  }
  return value;
}

function notesMatch(
  value: unknown,
  scope: { readonly tenantId: string; readonly clinicId: string; readonly invoiceId: string }
): boolean {
  const notes = optionalObject(value);
  return (
    notes?.clinic_os_tenant_id === scope.tenantId &&
    notes.clinic_os_clinic_id === scope.clinicId &&
    notes.clinic_os_invoice_id === scope.invoiceId
  );
}

function uniqueCollections(
  values: readonly RazorpayCollectionSnapshot[]
): readonly RazorpayCollectionSnapshot[] {
  const byIdentity = new Map<string, RazorpayCollectionSnapshot>();
  for (const value of values) byIdentity.set(`${value.kind}:${value.providerRequestId}`, value);
  return [...byIdentity.values()].sort((left, right) =>
    `${left.kind}:${left.providerRequestId}`.localeCompare(
      `${right.kind}:${right.providerRequestId}`
    )
  );
}

function boundedIdentifier(value: string, field: string, maxLength: number): string {
  if (!value.trim() || value.length > maxLength || /[\s/?#\0\r\n]/u.test(value)) {
    throw new Error(`${field} must be a bounded opaque identifier.`);
  }
  return value;
}

function officialBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Razorpay reconciliation base URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.origin !== "https://api.razorpay.com" ||
    url.pathname.replace(/\/$/u, "") !== "/v1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Razorpay reconciliation requires the official API base URL.");
  }
  return OFFICIAL_BASE_URL;
}

function requiredIdentifier(value: unknown, field: string): string {
  const text = requiredBoundedString(value, field);
  if (/[\s/?#]/u.test(text)) {
    throw boundary("PROVIDER_REJECTED", `Razorpay reconciliation ${field} is invalid.`);
  }
  return text;
}

function requiredPaymentId(value: string): string {
  if (!/^pay_[A-Za-z0-9]{6,128}$/u.test(value)) {
    throw new Error("providerPaymentId must be a bounded official Razorpay payment identifier.");
  }
  return value;
}

function requiredBoundedString(value: unknown, field: string): string {
  const text = optionalString(value);
  if (!text || text.length > 256 || /[\r\n\0]/u.test(text)) {
    throw boundary("PROVIDER_REJECTED", `Razorpay reconciliation ${field} is invalid.`);
  }
  return text;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredMinor(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw boundary("PROVIDER_REJECTED", `Razorpay reconciliation ${field} is invalid.`);
  }
  return value as number;
}

function requiredEpoch(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw boundary("PROVIDER_REJECTED", `Razorpay reconciliation ${field} is invalid.`);
  }
  return value as number;
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw boundary("PROVIDER_REJECTED", `Razorpay reconciliation ${field} is invalid.`);
  }
  return value;
}

function classifyProviderError(body: string): {
  readonly code: string | null;
  readonly description: string | null;
} {
  try {
    const parsed: unknown = JSON.parse(body);
    const top = optionalObject(parsed);
    const error = optionalObject(top?.error);
    const code = optionalString(error?.code);
    const description = optionalString(error?.description);
    return {
      code: code && /^[A-Z][A-Z0-9_]{0,63}$/u.test(code) ? code : null,
      description:
        description && description.length <= 256 && !/[\r\n\0]/u.test(description)
          ? description
          : null
    };
  } catch {
    return { code: null, description: null };
  }
}

function retryDelay(headers: RazorpayHttpResponse["headers"], attempt: number): number {
  const seconds = Number(headers["retry-after"]);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.floor(seconds * 1_000));
  }
  return 100 * 2 ** (attempt - 1);
}

function errorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(error.name)
    ? error.name
    : "Error";
}

function boundary(
  code: "NOT_CONFIGURED" | "PROVIDER_REJECTED",
  message: string
): RazorpayBoundaryError {
  return new RazorpayBoundaryError({ code, message });
}
