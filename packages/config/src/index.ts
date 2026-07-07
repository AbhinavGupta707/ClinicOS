import { z } from "zod";

export const clinicOsEnvironments = ["local", "dev", "staging", "pilot-prod", "prod"] as const;
export type ClinicOsEnvironment = (typeof clinicOsEnvironments)[number];

export const productionLikeEnvironments = ["staging", "pilot-prod", "prod"] as const;
export type ProductionLikeEnvironment = (typeof productionLikeEnvironments)[number];

export const whatsappProviders = [
  "simulator",
  "unconfigured",
  "meta_cloud",
  "gupshup",
  "wati",
  "interakt"
] as const;
export type WhatsAppProvider = (typeof whatsappProviders)[number];

export const paymentProviders = [
  "simulator",
  "unconfigured",
  "manual_clinic_approved",
  "razorpay"
] as const;
export type PaymentProvider = (typeof paymentProviders)[number];

export const paymentQrModes = ["payment_link_qr", "razorpay_qr"] as const;
export type PaymentQrMode = (typeof paymentQrModes)[number];

export const telephonyProviders = [
  "simulator",
  "unconfigured",
  "exotel",
  "knowlarity",
  "twilio"
] as const;
export type TelephonyProvider = (typeof telephonyProviders)[number];

export const llmProviders = ["simulator", "unconfigured", "fireworks", "openai"] as const;
export type LlmProvider = (typeof llmProviders)[number];

export const transcriptionProviders = ["simulator", "unconfigured", "openai", "deepgram"] as const;
export type TranscriptionProvider = (typeof transcriptionProviders)[number];

const productionLikeSet = new Set<string>(productionLikeEnvironments);

const emptyStringToUndefined = (value: unknown) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const requiredString = z.preprocess(emptyStringToUndefined, z.string().trim().min(1));
const optionalString = z.preprocess(emptyStringToUndefined, z.string().trim().min(1).optional());
const requiredUrl = z.preprocess(emptyStringToUndefined, z.string().trim().url());
const optionalUrl = z.preprocess(emptyStringToUndefined, z.string().trim().url().optional());

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;

  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  return value;
}, z.boolean());

const runtimeEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    CLINIC_OS_ENV: z.enum(clinicOsEnvironments).default("local"),

    DATABASE_URL: requiredUrl.refine(
      (url) => url.startsWith("postgresql://") || url.startsWith("postgres://"),
      "DATABASE_URL must use postgres:// or postgresql://"
    ),
    REDIS_URL: requiredUrl.refine(
      (url) => url.startsWith("redis://") || url.startsWith("rediss://"),
      "REDIS_URL must use redis:// or rediss://"
    ),
    TEMPORAL_ADDRESS: requiredString.default("localhost:7233"),

    KEYCLOAK_BASE_URL: requiredUrl,
    KEYCLOAK_REALM: requiredString,
    KEYCLOAK_CLIENT_ID: requiredString,

    S3_REGION: requiredString.default("ap-south-1"),
    S3_BUCKET: requiredString,

    WHATSAPP_PROVIDER: z.enum(whatsappProviders).default("simulator"),
    WHATSAPP_ACCESS_TOKEN: optionalString,
    WHATSAPP_APP_ID: optionalString,
    WHATSAPP_APP_SECRET: optionalString,
    WHATSAPP_BUSINESS_ACCOUNT_ID: optionalString,
    WHATSAPP_PHONE_NUMBER_ID: optionalString,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalString,
    WHATSAPP_WEBHOOK_APP_SECRET_PROOF_REQUIRED: booleanFromEnv.default(false),
    WHATSAPP_TEMPLATE_NAMESPACE: optionalString,

    PAYMENT_PROVIDER: z.enum(paymentProviders).default("simulator"),
    PAYMENT_QR_MODE: z.enum(paymentQrModes).default("payment_link_qr"),
    RAZORPAY_KEY_ID: optionalString,
    RAZORPAY_KEY_SECRET: optionalString,
    RAZORPAY_WEBHOOK_SECRET: optionalString,
    RAZORPAY_WEBHOOK_URL: optionalUrl,

    TELEPHONY_PROVIDER: z.enum(telephonyProviders).default("simulator"),
    TELEPHONY_ACCOUNT_SID: optionalString,
    TELEPHONY_API_KEY: optionalString,
    TELEPHONY_API_TOKEN: optionalString,
    TELEPHONY_AUTH_TOKEN: optionalString,
    TELEPHONY_REGION_SUBDOMAIN: requiredString.default("api.in.exotel.com"),
    TELEPHONY_VIRTUAL_NUMBER: optionalString,
    TELEPHONY_WEBHOOK_SECRET: optionalString,

    LLM_PROVIDER: z.enum(llmProviders).default("simulator"),
    LLM_BASE_URL: optionalUrl,
    LLM_MODEL_PRIMARY: optionalString,
    FIREWORKS_API_KEY: optionalString,
    OPENAI_API_KEY: optionalString,

    TRANSCRIPTION_PROVIDER: z.enum(transcriptionProviders).default("simulator"),
    TRANSCRIPTION_MODEL: optionalString,
    DEEPGRAM_API_KEY: optionalString,
    AI_DATA_RESIDENCY_NOTES: optionalString,

    PILOT_SYNTHETIC_DATA_ONLY: booleanFromEnv.default(true),
    PILOT_PATIENT_EXPORT_PATH: optionalString,
    PILOT_APPOINTMENT_EXPORT_PATH: optionalString,
    PILOT_PRICEBOOK_PATH: optionalString,
    PILOT_TEMPLATES_DIR: optionalString,
    PILOT_XRAY_SAMPLE_DIR: optionalString
  })
  .superRefine((env, context) => {
    const productionLike = isProductionLikeEnvironment(env.CLINIC_OS_ENV);

    if (productionLike) {
      const simulatorFields = [
        "WHATSAPP_PROVIDER",
        "PAYMENT_PROVIDER",
        "TELEPHONY_PROVIDER",
        "LLM_PROVIDER",
        "TRANSCRIPTION_PROVIDER"
      ] as const;

      for (const field of simulatorFields) {
        if (env[field] === "simulator") {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `${field}=simulator is allowed only for local/dev test surfaces, not ${env.CLINIC_OS_ENV}. Use an official provider or unconfigured unavailable state.`
          });
        }
      }
    }

    requireFields(
      context,
      env,
      env.WHATSAPP_PROVIDER === "meta_cloud",
      [
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_APP_ID",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_BUSINESS_ACCOUNT_ID",
        "WHATSAPP_PHONE_NUMBER_ID",
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN"
      ],
      "Meta Cloud WhatsApp is selected but required Meta credentials are missing."
    );

    requireFields(
      context,
      env,
      ["gupshup", "wati", "interakt"].includes(env.WHATSAPP_PROVIDER),
      ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_WEBHOOK_VERIFY_TOKEN"],
      "A WhatsApp BSP is selected but required BSP credentials are missing."
    );

    requireFields(
      context,
      env,
      env.PAYMENT_PROVIDER === "razorpay",
      ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
      "Razorpay is selected but required API/webhook signing credentials are missing."
    );

    requireFields(
      context,
      env,
      env.TELEPHONY_PROVIDER === "exotel",
      [
        "TELEPHONY_ACCOUNT_SID",
        "TELEPHONY_API_KEY",
        "TELEPHONY_API_TOKEN",
        "TELEPHONY_VIRTUAL_NUMBER",
        "TELEPHONY_WEBHOOK_SECRET"
      ],
      "Exotel is selected but required telephony credentials are missing."
    );

    requireFields(
      context,
      env,
      env.LLM_PROVIDER === "fireworks",
      ["LLM_BASE_URL", "LLM_MODEL_PRIMARY", "FIREWORKS_API_KEY"],
      "Fireworks is selected but required LLM settings are missing."
    );

    requireFields(
      context,
      env,
      env.LLM_PROVIDER === "openai",
      ["LLM_MODEL_PRIMARY", "OPENAI_API_KEY"],
      "OpenAI LLM is selected but required model/API key settings are missing."
    );

    requireFields(
      context,
      env,
      env.TRANSCRIPTION_PROVIDER === "openai",
      ["TRANSCRIPTION_MODEL", "OPENAI_API_KEY"],
      "OpenAI transcription is selected but required transcription settings are missing."
    );

    requireFields(
      context,
      env,
      env.TRANSCRIPTION_PROVIDER === "deepgram",
      ["TRANSCRIPTION_MODEL", "DEEPGRAM_API_KEY"],
      "Deepgram transcription is selected but required transcription settings are missing."
    );
  });

type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;
type EnvInput = Record<string, string | boolean | undefined>;
type RuntimeEnvKey = keyof RuntimeEnv;

export type ClinicOsConfig = {
  nodeEnv: RuntimeEnv["NODE_ENV"];
  clinicOsEnv: ClinicOsEnvironment;
  isProductionLike: boolean;
  services: {
    databaseUrl: string;
    redisUrl: string;
    temporalAddress: string;
  };
  auth: {
    keycloakBaseUrl: string;
    keycloakRealm: string;
    keycloakClientId: string;
  };
  storage: {
    region: string;
    bucket: string;
  };
  providers: {
    whatsapp: {
      provider: WhatsAppProvider;
      accessToken?: string | undefined;
      appId?: string | undefined;
      appSecret?: string | undefined;
      businessAccountId?: string | undefined;
      phoneNumberId?: string | undefined;
      webhookVerifyToken?: string | undefined;
      appSecretProofRequired: boolean;
      templateNamespace?: string | undefined;
    };
    payment: {
      provider: PaymentProvider;
      qrMode: PaymentQrMode;
      razorpayKeyId?: string | undefined;
      razorpayKeySecret?: string | undefined;
      razorpayWebhookSecret?: string | undefined;
      razorpayWebhookUrl?: string | undefined;
    };
    telephony: {
      provider: TelephonyProvider;
      accountSid?: string | undefined;
      apiKey?: string | undefined;
      apiToken?: string | undefined;
      authToken?: string | undefined;
      regionSubdomain: string;
      virtualNumber?: string | undefined;
      webhookSecret?: string | undefined;
    };
    ai: {
      llmProvider: LlmProvider;
      llmBaseUrl?: string | undefined;
      llmModelPrimary?: string | undefined;
      fireworksApiKey?: string | undefined;
      openaiApiKey?: string | undefined;
      transcriptionProvider: TranscriptionProvider;
      transcriptionModel?: string | undefined;
      deepgramApiKey?: string | undefined;
      dataResidencyNotes?: string | undefined;
    };
  };
  pilotInputs: {
    syntheticDataOnly: boolean;
    patientExportPath?: string | undefined;
    appointmentExportPath?: string | undefined;
    pricebookPath?: string | undefined;
    templatesDir?: string | undefined;
    xraySampleDir?: string | undefined;
  };
};

export const clinicOsEnvSchema = runtimeEnvSchema;

export function isProductionLikeEnvironment(
  environment: ClinicOsEnvironment
): environment is ProductionLikeEnvironment {
  return productionLikeSet.has(environment);
}

export function parseClinicOsEnv(input: EnvInput = process.env): ClinicOsConfig {
  return toConfig(runtimeEnvSchema.parse(input));
}

export function safeParseClinicOsEnv(input: EnvInput = process.env) {
  const parsed = runtimeEnvSchema.safeParse(input);
  if (!parsed.success) return parsed;
  return { success: true as const, data: toConfig(parsed.data) };
}

function toConfig(env: RuntimeEnv): ClinicOsConfig {
  return {
    nodeEnv: env.NODE_ENV,
    clinicOsEnv: env.CLINIC_OS_ENV,
    isProductionLike: isProductionLikeEnvironment(env.CLINIC_OS_ENV),
    services: {
      databaseUrl: env.DATABASE_URL,
      redisUrl: env.REDIS_URL,
      temporalAddress: env.TEMPORAL_ADDRESS
    },
    auth: {
      keycloakBaseUrl: env.KEYCLOAK_BASE_URL,
      keycloakRealm: env.KEYCLOAK_REALM,
      keycloakClientId: env.KEYCLOAK_CLIENT_ID
    },
    storage: {
      region: env.S3_REGION,
      bucket: env.S3_BUCKET
    },
    providers: {
      whatsapp: {
        provider: env.WHATSAPP_PROVIDER,
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        appId: env.WHATSAPP_APP_ID,
        appSecret: env.WHATSAPP_APP_SECRET,
        businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        webhookVerifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
        appSecretProofRequired: env.WHATSAPP_WEBHOOK_APP_SECRET_PROOF_REQUIRED,
        templateNamespace: env.WHATSAPP_TEMPLATE_NAMESPACE
      },
      payment: {
        provider: env.PAYMENT_PROVIDER,
        qrMode: env.PAYMENT_QR_MODE,
        razorpayKeyId: env.RAZORPAY_KEY_ID,
        razorpayKeySecret: env.RAZORPAY_KEY_SECRET,
        razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
        razorpayWebhookUrl: env.RAZORPAY_WEBHOOK_URL
      },
      telephony: {
        provider: env.TELEPHONY_PROVIDER,
        accountSid: env.TELEPHONY_ACCOUNT_SID,
        apiKey: env.TELEPHONY_API_KEY,
        apiToken: env.TELEPHONY_API_TOKEN,
        authToken: env.TELEPHONY_AUTH_TOKEN,
        regionSubdomain: env.TELEPHONY_REGION_SUBDOMAIN,
        virtualNumber: env.TELEPHONY_VIRTUAL_NUMBER,
        webhookSecret: env.TELEPHONY_WEBHOOK_SECRET
      },
      ai: {
        llmProvider: env.LLM_PROVIDER,
        llmBaseUrl: env.LLM_BASE_URL,
        llmModelPrimary: env.LLM_MODEL_PRIMARY,
        fireworksApiKey: env.FIREWORKS_API_KEY,
        openaiApiKey: env.OPENAI_API_KEY,
        transcriptionProvider: env.TRANSCRIPTION_PROVIDER,
        transcriptionModel: env.TRANSCRIPTION_MODEL,
        deepgramApiKey: env.DEEPGRAM_API_KEY,
        dataResidencyNotes: env.AI_DATA_RESIDENCY_NOTES
      }
    },
    pilotInputs: {
      syntheticDataOnly: env.PILOT_SYNTHETIC_DATA_ONLY,
      patientExportPath: env.PILOT_PATIENT_EXPORT_PATH,
      appointmentExportPath: env.PILOT_APPOINTMENT_EXPORT_PATH,
      pricebookPath: env.PILOT_PRICEBOOK_PATH,
      templatesDir: env.PILOT_TEMPLATES_DIR,
      xraySampleDir: env.PILOT_XRAY_SAMPLE_DIR
    }
  };
}

function requireFields(
  context: z.RefinementCtx,
  env: RuntimeEnv,
  shouldRequire: boolean,
  fields: RuntimeEnvKey[],
  message: string
) {
  if (!shouldRequire) return;

  for (const field of fields) {
    if (env[field] === undefined) {
      context.addIssue({
        code: "custom",
        path: [field],
        message
      });
    }
  }
}
