import {
  GetSecretValueCommand,
  SecretsManagerClient,
  type SecretsManagerClientConfig
} from "@aws-sdk/client-secrets-manager";
import { MetaWhatsAppError } from "./cp15/meta-whatsapp/errors.js";

export interface ProviderSecretResolver {
  resolveSecret(secretRef: string): Promise<string>;
}

interface SecretClient {
  send(command: GetSecretValueCommand): Promise<{
    SecretString?: string;
    SecretBinary?: Uint8Array;
  }>;
}

export class AwsSecretsManagerProviderSecretResolver implements ProviderSecretResolver {
  readonly #client: SecretClient;

  constructor(input: { readonly region: string; readonly client?: SecretClient }) {
    if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(input.region)) {
      throw configurationError();
    }
    this.#client = input.client ?? new SecretsManagerClient({ region: input.region });
  }

  async resolveSecret(secretRef: string): Promise<string> {
    if (!validSecretRef(secretRef)) throw configurationError();
    let result: Awaited<ReturnType<SecretClient["send"]>>;
    try {
      result = await this.#client.send(new GetSecretValueCommand({ SecretId: secretRef }));
    } catch {
      throw configurationError();
    }
    const value =
      result.SecretString ??
      (result.SecretBinary ? Buffer.from(result.SecretBinary).toString("utf8") : null);
    if (!value || Buffer.byteLength(value, "utf8") > 65_536) throw configurationError();
    return value;
  }
}

export function createAwsProviderSecretResolver(
  config: SecretsManagerClientConfig
): AwsSecretsManagerProviderSecretResolver {
  if (!config.region || typeof config.region !== "string") throw configurationError();
  return new AwsSecretsManagerProviderSecretResolver({
    region: config.region,
    client: new SecretsManagerClient(config)
  });
}

function validSecretRef(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 2048 &&
    !/[\s\0\r\n]/u.test(value) &&
    (/^arn:aws(?:-[a-z]+)?:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/u.test(
      value
    ) || /^[A-Za-z0-9/_+=.@-]{1,512}$/u.test(value))
  );
}

function configurationError(): MetaWhatsAppError {
  return new MetaWhatsAppError({
    code: "not_configured",
    message: "Provider secret resolution is unavailable.",
    httpStatus: 503,
    retryable: true
  });
}
