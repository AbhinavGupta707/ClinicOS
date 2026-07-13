import { createHash } from "node:crypto";
import type { UUID } from "@clinic-os/domain";
import type { SqlConnectionFactory } from "./postgres.ts";
import { buildSetLocalRlsStatements } from "./rls.ts";

export type OfficialProviderKey = "meta_whatsapp_cloud" | "razorpay";
export type ProviderActivationState =
  | "absent"
  | "registered"
  | "configured"
  | "sandbox_verified"
  | "production_verified"
  | "degraded"
  | "disabled";

export interface ProviderCallbackRegistration {
  readonly registrationId: UUID;
  readonly tenantId: UUID;
  readonly clinicId: UUID;
  readonly externalAccountId: UUID;
  readonly providerKey: OfficialProviderKey;
  readonly activationState: ProviderActivationState;
  readonly providerMode: "test" | "live";
  readonly providerAccountId: string;
  readonly providerEndpointId: string | null;
  readonly apiVersion: string | null;
  readonly apiCredentialRef: string | null;
  readonly webhookSecretRef: string | null;
  readonly webhookSecretVersion: string | null;
  readonly previousWebhookSecretRef: string | null;
  readonly previousWebhookSecretVersion: string | null;
  readonly previousSecretAcceptUntil: string | null;
  readonly verificationTokenRef: string | null;
}

export interface ProviderRegistrationHealthRecord {
  readonly registrationId: UUID;
  readonly providerKey: OfficialProviderKey;
  readonly activationState: ProviderActivationState;
  readonly providerMode: "test" | "live";
  readonly sandboxVerifiedAt: string | null;
  readonly productionVerifiedAt: string | null;
  readonly lastHealthCheckAt: string | null;
  readonly lastVerifiedCallbackAt: string | null;
  readonly lastReconciledAt: string | null;
  readonly lastFailureCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RegistrationHealthRow {
  registration_id: string;
  provider_key: string;
  activation_state: string;
  provider_mode: string;
  sandbox_verified_at: string | null;
  production_verified_at: string | null;
  last_health_check_at: string | null;
  last_verified_callback_at: string | null;
  last_reconciled_at: string | null;
  last_failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProviderOperationsRegistryPort {
  list(input: {
    readonly tenantId: UUID;
    readonly clinicId: UUID;
    readonly actorUserId: UUID;
  }): Promise<readonly ProviderRegistrationHealthRecord[]>;
}

export class PostgresProviderOperationsRegistry implements ProviderOperationsRegistryPort {
  readonly #database: SqlConnectionFactory;

  constructor(database: SqlConnectionFactory) {
    if (!database.connect) {
      throw new Error("Provider operations registry requires a connection-capable database.");
    }
    this.#database = database;
  }

  async list(input: {
    readonly tenantId: UUID;
    readonly clinicId: UUID;
    readonly actorUserId: UUID;
  }): Promise<readonly ProviderRegistrationHealthRecord[]> {
    const client = await this.#database.connect!();
    try {
      await client.query("begin");
      for (const statement of buildSetLocalRlsStatements({
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        userId: input.actorUserId
      })) {
        await client.query(statement.sql, statement.values);
      }
      const result = await client.query<RegistrationHealthRow>(
        `select
           id::text as registration_id,
           provider_key,
           activation_state,
           provider_mode,
           sandbox_verified_at::text,
           production_verified_at::text,
           last_health_check_at::text,
           last_verified_callback_at::text,
           last_reconciled_at::text,
           last_failure_code,
           created_at::text,
           updated_at::text
         from provider_callback_registrations
         where tenant_id = $1
           and clinic_id = $2
         order by provider_key, created_at, id`,
        [input.tenantId, input.clinicId]
      );
      await client.query("commit");
      return Object.freeze(result.rows.map(parseHealthRecord));
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release?.();
    }
  }
}

interface RegistrationRow {
  registration_id: string;
  tenant_id: string;
  clinic_id: string;
  external_account_id: string;
  provider_key: string;
  activation_state: string;
  provider_mode: string;
  provider_account_id: string;
  provider_endpoint_id: string | null;
  api_version: string | null;
  api_credential_ref: string | null;
  webhook_secret_ref: string | null;
  webhook_secret_version: string | null;
  previous_webhook_secret_ref: string | null;
  previous_webhook_secret_version: string | null;
  previous_secret_accept_until: string | null;
  verification_token_ref: string | null;
}

const CALLBACK_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ACTIVATION_STATES = new Set<ProviderActivationState>([
  "absent",
  "registered",
  "configured",
  "sandbox_verified",
  "production_verified",
  "degraded",
  "disabled"
]);

export class PostgresProviderCallbackRegistrationResolver {
  readonly #database: SqlConnectionFactory;

  constructor(database: SqlConnectionFactory) {
    this.#database = database;
  }

  async resolve(
    providerKey: OfficialProviderKey,
    registrationKey: string
  ): Promise<ProviderCallbackRegistration | null> {
    if (!CALLBACK_KEY_PATTERN.test(registrationKey)) return null;
    const digest = createHash("sha256").update(registrationKey, "utf8").digest("hex");
    const result = await this.#database.query<RegistrationRow>(
      `select * from clinic_os.resolve_provider_callback_registration($1, $2::char(64))`,
      [providerKey, digest]
    );
    const row = result.rows[0];
    if (!row) return null;
    return parseRegistration(row, providerKey);
  }
}

export type ProviderAccountResolution =
  | { readonly outcome: "resolved"; readonly registration: ProviderCallbackRegistration }
  | { readonly outcome: "absent" | "ambiguous" };

export class PostgresOfficialProviderAccountResolver {
  readonly #database: SqlConnectionFactory;

  constructor(database: SqlConnectionFactory) {
    if (!database.connect) {
      throw new Error("Official provider account resolver requires a connection-capable database.");
    }
    this.#database = database;
  }

  async resolveForClinic(input: {
    readonly providerKey: OfficialProviderKey;
    readonly tenantId: UUID;
    readonly clinicId: UUID;
    readonly actorUserId: UUID;
  }): Promise<ProviderAccountResolution> {
    const client = await this.#database.connect!();
    try {
      await client.query("begin");
      for (const statement of buildSetLocalRlsStatements({
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        userId: input.actorUserId
      })) {
        await client.query(statement.sql, statement.values);
      }
      const result = await client.query<RegistrationRow>(
        `select
           id as registration_id,
           tenant_id,
           clinic_id,
           external_account_id,
           provider_key,
           activation_state,
           provider_mode,
           provider_account_id,
           provider_endpoint_id,
           api_version,
           api_credential_ref,
           webhook_secret_ref,
           webhook_secret_version,
           previous_webhook_secret_ref,
           previous_webhook_secret_version,
           previous_secret_accept_until::text,
           verification_token_ref
         from provider_callback_registrations
         where tenant_id = $1
           and clinic_id = $2
           and provider_key = $3
           and activation_state in ('configured', 'sandbox_verified', 'production_verified', 'degraded')
         order by id
         limit 2`,
        [input.tenantId, input.clinicId, input.providerKey]
      );
      await client.query("commit");
      if (result.rows.length === 0) return { outcome: "absent" };
      if (result.rows.length > 1) return { outcome: "ambiguous" };
      return {
        outcome: "resolved",
        registration: parseRegistration(result.rows[0]!, input.providerKey)
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release?.();
    }
  }
}

function parseRegistration(
  row: RegistrationRow,
  expectedProvider: OfficialProviderKey
): ProviderCallbackRegistration {
  if (row.provider_key !== expectedProvider) throw invalidRegistration();
  if (!ACTIVATION_STATES.has(row.activation_state as ProviderActivationState)) {
    throw invalidRegistration();
  }
  if (row.provider_mode !== "test" && row.provider_mode !== "live") {
    throw invalidRegistration();
  }
  for (const value of [
    row.registration_id,
    row.tenant_id,
    row.clinic_id,
    row.external_account_id
  ]) {
    if (!UUID_PATTERN.test(value)) throw invalidRegistration();
  }
  if (!/^[A-Za-z0-9_-]{4,128}$/u.test(row.provider_account_id)) {
    throw invalidRegistration();
  }
  return Object.freeze({
    registrationId: row.registration_id as UUID,
    tenantId: row.tenant_id as UUID,
    clinicId: row.clinic_id as UUID,
    externalAccountId: row.external_account_id as UUID,
    providerKey: expectedProvider,
    activationState: row.activation_state as ProviderActivationState,
    providerMode: row.provider_mode,
    providerAccountId: row.provider_account_id,
    providerEndpointId: row.provider_endpoint_id,
    apiVersion: row.api_version,
    apiCredentialRef: row.api_credential_ref,
    webhookSecretRef: row.webhook_secret_ref,
    webhookSecretVersion: row.webhook_secret_version,
    previousWebhookSecretRef: row.previous_webhook_secret_ref,
    previousWebhookSecretVersion: row.previous_webhook_secret_version,
    previousSecretAcceptUntil: row.previous_secret_accept_until,
    verificationTokenRef: row.verification_token_ref
  });
}

function parseHealthRecord(row: RegistrationHealthRow): ProviderRegistrationHealthRecord {
  if (!UUID_PATTERN.test(row.registration_id)) throw invalidRegistration();
  if (row.provider_key !== "meta_whatsapp_cloud" && row.provider_key !== "razorpay") {
    throw invalidRegistration();
  }
  if (!ACTIVATION_STATES.has(row.activation_state as ProviderActivationState)) {
    throw invalidRegistration();
  }
  if (row.provider_mode !== "test" && row.provider_mode !== "live") {
    throw invalidRegistration();
  }
  for (const value of [
    row.sandbox_verified_at,
    row.production_verified_at,
    row.last_health_check_at,
    row.last_verified_callback_at,
    row.last_reconciled_at,
    row.created_at,
    row.updated_at
  ]) {
    if (value !== null && !validInstant(value)) throw invalidRegistration();
  }
  if (
    row.last_failure_code !== null &&
    !/^[a-z][a-z0-9_.-]{0,127}$/u.test(row.last_failure_code)
  ) {
    throw invalidRegistration();
  }
  return Object.freeze({
    registrationId: row.registration_id as UUID,
    providerKey: row.provider_key,
    activationState: row.activation_state as ProviderActivationState,
    providerMode: row.provider_mode,
    sandboxVerifiedAt: row.sandbox_verified_at,
    productionVerifiedAt: row.production_verified_at,
    lastHealthCheckAt: row.last_health_check_at,
    lastVerifiedCallbackAt: row.last_verified_callback_at,
    lastReconciledAt: row.last_reconciled_at,
    lastFailureCode: row.last_failure_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function validInstant(value: string): boolean {
  return value.length <= 64 && Number.isFinite(Date.parse(value));
}

function invalidRegistration(): Error {
  return new Error("Provider callback registration returned an invalid bounded projection.");
}
