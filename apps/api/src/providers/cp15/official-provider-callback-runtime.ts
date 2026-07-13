import { timingSafeEqual } from "node:crypto";
import type {
  PostgresProviderCallbackRegistrationResolver,
  ProviderCallbackRegistration
} from "@clinic-os/db";
import { systemClock } from "@clinic-os/domain";
import {
  MetaWebhookBoundary,
  MetaWebhookService,
  MetaWhatsAppError,
  RazorpayBoundaryError,
  verifyAndNormalizeRazorpayWebhook,
  type MetaEncryptedRawBodyStore,
  type ProviderSecretResolver,
  type RazorpayWebhookRouteBinding
} from "@clinic-os/integrations";
import { processRawRazorpayWebhook } from "../../features/cp15-razorpay/service.ts";
import type { OfficialProviderCallbackRuntime } from "../../server.ts";
import { PostgresMetaWebhookPersistence } from "./postgres-meta-whatsapp.ts";
import { PostgresRazorpayUnitOfWork } from "./postgres-razorpay.ts";

interface ProviderUnitOfWork {
  run<T>(
    callback: (context: {
      readonly sqlClient?: import("@clinic-os/db").SqlQueryClient;
    }) => Promise<T>
  ): Promise<T>;
}

export class ProviderCallbackRegistrationNotFoundError extends Error {
  constructor() {
    super("Provider callback registration was not found.");
    this.name = "ProviderCallbackRegistrationNotFoundError";
  }
}

export class ProviderCallbackUnavailableError extends Error {
  constructor() {
    super("Provider callback registration is not operational.");
    this.name = "ProviderCallbackUnavailableError";
  }
}

export class PostgresOfficialProviderCallbackRuntime implements OfficialProviderCallbackRuntime {
  readonly #registrations: PostgresProviderCallbackRegistrationResolver;
  readonly #secrets: ProviderSecretResolver;
  readonly #rawBodyStore: MetaEncryptedRawBodyStore;
  readonly #unitOfWork: ProviderUnitOfWork;
  readonly #endpointHmacSecret: Uint8Array;
  readonly #now: () => Date;

  constructor(input: {
    readonly registrations: PostgresProviderCallbackRegistrationResolver;
    readonly secrets: ProviderSecretResolver;
    readonly rawBodyStore: MetaEncryptedRawBodyStore;
    readonly unitOfWork: ProviderUnitOfWork;
    readonly endpointHmacSecret: Uint8Array;
    readonly now?: () => Date;
  }) {
    if (input.endpointHmacSecret.byteLength < 32) {
      throw new Error("Provider endpoint HMAC secret must contain at least 32 bytes.");
    }
    this.#registrations = input.registrations;
    this.#secrets = input.secrets;
    this.#rawBodyStore = input.rawBodyStore;
    this.#unitOfWork = input.unitOfWork;
    this.#endpointHmacSecret = input.endpointHmacSecret;
    this.#now = input.now ?? (() => systemClock.now());
  }

  async verifyMetaChallenge(input: {
    readonly registrationKey: string;
    readonly mode: string;
    readonly verifyToken: string;
    readonly challenge: string;
  }): Promise<string> {
    const registration = await this.#metaRegistration(input.registrationKey, true);
    if (!registration.verificationTokenRef) throw new ProviderCallbackUnavailableError();
    const expected = await this.#secrets.resolveSecret(registration.verificationTokenRef);
    if (
      input.mode !== "subscribe" ||
      input.challenge.length < 1 ||
      input.challenge.length > 1024 ||
      !constantTimeEqual(expected, input.verifyToken)
    ) {
      throw new MetaWhatsAppError({
        code: "invalid_signature",
        message: "Meta callback challenge is invalid.",
        httpStatus: 401,
        retryable: false
      });
    }
    return input.challenge;
  }

  async receiveMetaWebhook(input: {
    readonly registrationKey: string;
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly rawBody: Uint8Array;
    readonly receivedAt: string;
    readonly correlationId: string;
  }): Promise<void> {
    const registration = await this.#metaRegistration(input.registrationKey, false);
    if (
      !registration.webhookSecretRef ||
      !registration.webhookSecretVersion ||
      !registration.verificationTokenRef ||
      !registration.providerEndpointId
    ) {
      throw new ProviderCallbackUnavailableError();
    }
    const previousSecretEligible =
      registration.previousWebhookSecretRef !== null &&
      registration.previousWebhookSecretVersion !== null &&
      registration.previousSecretAcceptUntil !== null &&
      Date.parse(input.receivedAt) <= Date.parse(registration.previousSecretAcceptUntil);
    const [appSecret, verifyToken, previousAppSecret] = await Promise.all([
      this.#secrets.resolveSecret(registration.webhookSecretRef),
      this.#secrets.resolveSecret(registration.verificationTokenRef),
      previousSecretEligible
        ? this.#secrets.resolveSecret(registration.previousWebhookSecretRef!)
        : Promise.resolve(undefined)
    ]);
    const service = new MetaWebhookService({
      tenantId: registration.tenantId,
      clinicId: registration.clinicId,
      externalAccountId: registration.externalAccountId,
      expectedBusinessAccountId: registration.providerAccountId,
      expectedPhoneNumberId: registration.providerEndpointId,
      boundary: new MetaWebhookBoundary({
        appSecret,
        appSecretVersion: registration.webhookSecretVersion,
        ...(previousAppSecret &&
        registration.previousWebhookSecretVersion &&
        registration.previousSecretAcceptUntil
          ? {
              previousAppSecret,
              previousAppSecretVersion: registration.previousWebhookSecretVersion,
              previousAppSecretAcceptUntil: registration.previousSecretAcceptUntil
            }
          : {}),
        verifyToken
      }),
      rawBodyStore: this.#rawBodyStore,
      persistence: new PostgresMetaWebhookPersistence({
        unitOfWork: this.#unitOfWork,
        endpointHmacSecret: this.#endpointHmacSecret
      })
    });
    await service.processWebhook(input);
  }

  async receiveRazorpayWebhook(input: {
    readonly registrationKey: string;
    readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly rawBody: Uint8Array;
    readonly receivedAt: string;
    readonly correlationId: string;
  }): Promise<void> {
    const registration = await this.#razorpayRegistration(input.registrationKey);
    if (!registration.webhookSecretRef || !registration.webhookSecretVersion) {
      throw new ProviderCallbackUnavailableError();
    }
    const currentSecret = await this.#secrets.resolveSecret(registration.webhookSecretRef);
    const previousSecret = registration.previousWebhookSecretRef
      ? await this.#secrets.resolveSecret(registration.previousWebhookSecretRef)
      : null;
    const binding: RazorpayWebhookRouteBinding = {
      tenantId: registration.tenantId,
      clinicId: registration.clinicId,
      externalAccountId: registration.externalAccountId,
      razorpayAccountId: registration.providerAccountId,
      mode: registration.providerMode,
      activationState:
        registration.activationState as RazorpayWebhookRouteBinding["activationState"],
      secrets: [
        {
          role: "current",
          version: registration.webhookSecretVersion,
          secret: currentSecret
        },
        ...(previousSecret &&
        registration.previousWebhookSecretVersion &&
        registration.previousSecretAcceptUntil
          ? [
              {
                role: "previous" as const,
                version: registration.previousWebhookSecretVersion,
                secret: previousSecret,
                acceptUntil: registration.previousSecretAcceptUntil
              }
            ]
          : [])
      ]
    };
    await processRawRazorpayWebhook({
      raw: input,
      verifier: {
        verify: (raw) => verifyAndNormalizeRazorpayWebhook(raw, binding)
      },
      unitOfWork: new PostgresRazorpayUnitOfWork(this.#unitOfWork),
      metadata: { requestId: input.correlationId, receivedAt: input.receivedAt },
      now: this.#now
    });
  }

  async #metaRegistration(
    registrationKey: string,
    challenge: boolean
  ): Promise<ProviderCallbackRegistration> {
    const registration = await this.#registrations.resolve("meta_whatsapp_cloud", registrationKey);
    if (!registration || ["absent", "disabled"].includes(registration.activationState)) {
      throw new ProviderCallbackRegistrationNotFoundError();
    }
    const allowed = challenge
      ? ["registered", "configured", "sandbox_verified", "production_verified", "degraded"]
      : ["configured", "sandbox_verified", "production_verified"];
    if (!allowed.includes(registration.activationState)) {
      throw new ProviderCallbackUnavailableError();
    }
    return registration;
  }

  async #razorpayRegistration(registrationKey: string) {
    const registration = await this.#registrations.resolve("razorpay", registrationKey);
    if (!registration || ["absent", "disabled"].includes(registration.activationState)) {
      throw new ProviderCallbackRegistrationNotFoundError();
    }
    if (
      !["configured", "sandbox_verified", "production_verified"].includes(
        registration.activationState
      )
    ) {
      throw new ProviderCallbackUnavailableError();
    }
    return registration;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  const length = Math.max(leftBytes.length, rightBytes.length, 1);
  const paddedLeft = Buffer.alloc(length);
  const paddedRight = Buffer.alloc(length);
  leftBytes.copy(paddedLeft);
  rightBytes.copy(paddedRight);
  return leftBytes.length === rightBytes.length && timingSafeEqual(paddedLeft, paddedRight);
}
