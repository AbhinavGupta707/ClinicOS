import type { Pool } from "pg";
import { PostgresOfficialProviderAccountResolver, type ProviderCallbackRegistration } from "@clinic-os/db";
import {
  PaymentProviderError,
  RazorpayApiClient,
  type AdapterCapability,
  type CreatePaymentProviderRequestInput,
  type PaymentProvider,
  type PaymentProviderRequestResult,
  type PaymentProviderWebhookEvent,
  type PaymentWebhookVerificationResult,
  type ProviderHealth,
  type ProviderPaymentSnapshot,
  type ProviderSecretResolver,
  type RawPaymentWebhook
} from "@clinic-os/integrations";
import type { UUID } from "@clinic-os/domain";

const CAPABILITIES = [
  "CREATE_PAYMENT_QR",
  "CREATE_PAYMENT_LINKS",
  "FETCH_PAYMENT_STATUS"
] as const satisfies readonly AdapterCapability[];

export interface ScopedPaymentProviderResolver {
  resolve(input: {
    readonly tenantId: string;
    readonly clinicId: string;
    readonly actorUserId: string;
  }): Promise<PaymentProvider>;
}

export function createScopedRazorpayPaymentProviderResolver(input: {
  readonly pool: Pool;
  readonly secrets: ProviderSecretResolver;
  readonly now?: () => Date;
  readonly clientFactory?: (
    credential: Readonly<{ keyId: string; keySecret: string }>
  ) => Pick<RazorpayApiClient, "createCollection" | "fetchPayment">;
}): ScopedPaymentProviderResolver {
  const accounts = new PostgresOfficialProviderAccountResolver(input.pool);
  return {
    async resolve(scope) {
      const resolved = await accounts.resolveForClinic({
        providerKey: "razorpay",
        tenantId: scope.tenantId as UUID,
        clinicId: scope.clinicId as UUID,
        actorUserId: scope.actorUserId as UUID
      });
      if (resolved.outcome !== "resolved") {
        throw unavailable("Razorpay provider registration is not uniquely available.");
      }
      const registration = resolved.registration;
      if (
        !["sandbox_verified", "production_verified"].includes(registration.activationState) ||
        !registration.apiCredentialRef
      ) {
        throw unavailable("Razorpay outbound collection is disabled until verification passes.");
      }
      const credential = parseCredential(
        await input.secrets.resolveSecret(registration.apiCredentialRef)
      );
      return new ScopedRazorpayPaymentProvider({
        registration,
        client: input.clientFactory?.(credential) ?? new RazorpayApiClient(credential),
        now: input.now
      });
    }
  };
}

class ScopedRazorpayPaymentProvider implements PaymentProvider {
  readonly providerKey = "razorpay";
  readonly #registration: ProviderCallbackRegistration;
  readonly #client: Pick<RazorpayApiClient, "createCollection" | "fetchPayment">;
  readonly #now: () => Date;

  constructor(input: {
    readonly registration: ProviderCallbackRegistration;
    readonly client: Pick<RazorpayApiClient, "createCollection" | "fetchPayment">;
    readonly now?: () => Date;
  }) {
    this.#registration = input.registration;
    this.#client = input.client;
    this.#now = input.now ?? (() => new Date());
  }

  capabilities(): readonly AdapterCapability[] {
    return CAPABILITIES;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerKey: this.providerKey,
      status: "available",
      checkedAt: this.#now().toISOString(),
      capabilities: [...CAPABILITIES],
      message: `Razorpay ${this.#registration.providerMode} registration is officially verified.`
    };
  }

  async createInvoiceQr(
    input: CreatePaymentProviderRequestInput
  ): Promise<PaymentProviderRequestResult> {
    return this.#create(input, "invoice_qr");
  }

  async createPaymentLink(
    input: CreatePaymentProviderRequestInput
  ): Promise<PaymentProviderRequestResult> {
    return this.#create(input, "payment_link");
  }

  async fetchPayment(input: { providerPaymentId: string }): Promise<ProviderPaymentSnapshot> {
    const snapshot = await this.#client.fetchPayment(input.providerPaymentId);
    return {
      providerKey: this.providerKey,
      providerPaymentId: snapshot.providerPaymentId,
      amountPaise: snapshot.amountMinor,
      currency: snapshot.currency,
      status: snapshot.status,
      captured: snapshot.captured,
      metadata: {
        amountRefundedPaise: snapshot.amountRefundedMinor,
        providerRequestId: snapshot.providerRequestId
      }
    };
  }

  async closeQr(): Promise<{ providerRequestId: string; status: string }> {
    throw unavailable("Razorpay QR cancellation is not an enabled ClinicOS capability.");
  }

  async cancelPaymentLink(): Promise<{ providerRequestId: string; status: string }> {
    throw unavailable("Razorpay Payment Link cancellation is not an enabled ClinicOS capability.");
  }

  async verifyWebhook(_raw: RawPaymentWebhook): Promise<PaymentWebhookVerificationResult> {
    throw unavailable("Razorpay inbound verification is available only on the CP15 callback runtime.");
  }

  async parseWebhook(_raw: RawPaymentWebhook): Promise<PaymentProviderWebhookEvent> {
    throw unavailable("Razorpay inbound parsing is available only on the CP15 callback runtime.");
  }

  async #create(
    input: CreatePaymentProviderRequestInput,
    kind: "invoice_qr" | "payment_link"
  ): Promise<PaymentProviderRequestResult> {
    this.#assertScope(input);
    const result = await this.#client.createCollection({
      kind,
      invoiceId: input.invoiceId,
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      amountMinor: input.amountPaise,
      currency: input.currency === "INR" ? "INR" : invalidCurrency(),
      acceptPartial: kind === "payment_link" && input.metadata?.acceptPartial === true,
      expiresAt: input.expiresAt
    });
    const providerHealth = await this.healthCheck();
    return {
      providerKey: this.providerKey,
      requestKind: kind,
      providerRequestId: result.providerRequestId,
      amountPaise: result.amountMinor,
      currency: result.currency,
      status: "created",
      paymentUrl: kind === "payment_link" ? result.hostedUrl : null,
      qrImageUrl: kind === "invoice_qr" ? result.hostedUrl : null,
      qrString: kind === "invoice_qr" ? result.qrPayload : null,
      expiresAt: result.expiresAt,
      metadata: {
        activationState: this.#registration.activationState,
        providerMode: this.#registration.providerMode
      },
      providerHealth
    };
  }

  #assertScope(input: CreatePaymentProviderRequestInput): void {
    if (
      input.tenantId !== this.#registration.tenantId ||
      input.clinicId !== this.#registration.clinicId
    ) {
      throw unavailable("Razorpay registration scope does not match the durable request.");
    }
  }
}

function parseCredential(value: string): { keyId: string; keySecret: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw unavailable("Razorpay API credential material is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw unavailable("Razorpay API credential material is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["keyId", "keySecret"].includes(key)) ||
    typeof record.keyId !== "string" ||
    !/^rzp_(?:test|live)_[A-Za-z0-9]{6,128}$/u.test(record.keyId) ||
    typeof record.keySecret !== "string" ||
    record.keySecret.length < 16 ||
    record.keySecret.length > 512
  ) {
    throw unavailable("Razorpay API credential material is invalid.");
  }
  return { keyId: record.keyId, keySecret: record.keySecret };
}

function invalidCurrency(): never {
  throw new PaymentProviderError({
    providerKey: "razorpay",
    status: "provider_error",
    message: "Razorpay collection currency is unsupported."
  });
}

function unavailable(message: string): PaymentProviderError {
  return new PaymentProviderError({
    providerKey: "razorpay",
    status: "not_configured",
    message
  });
}
