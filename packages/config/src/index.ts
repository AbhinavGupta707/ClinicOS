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

export const transcriptionProviders = [
  "simulator",
  "unconfigured",
  "fireworks",
  "openai",
  "deepgram"
] as const;
export type TranscriptionProvider = (typeof transcriptionProviders)[number];

export const fireworksModelDefaults = {
  clinicalStructuredDraft: "accounts/fireworks/models/deepseek-v4-pro",
  clinicalSafetyReview: "accounts/fireworks/models/glm-5p2",
  boundedExtraction: "accounts/fireworks/models/deepseek-v4-flash",
  longContextSummary: "accounts/fireworks/models/kimi-k2p6",
  retrievalEmbedding: "fireworks/qwen3-embedding-8b",
  retrievalRerank: "fireworks/qwen3-reranker-8b",
  speechQuality: "whisper-v3",
  speechLowLatency: "whisper-v3-turbo"
} as const;

export const mediaStorageProviders = ["local_simulator", "aws_s3"] as const;
export type MediaStorageProvider = (typeof mediaStorageProviders)[number];

export const mediaInspectionProviders = ["local_pending_simulator", "guardduty_s3"] as const;
export type MediaInspectionProvider = (typeof mediaInspectionProviders)[number];

export const alertingProviders = ["unconfigured", "email", "slack", "sentry"] as const;
export type AlertingProvider = (typeof alertingProviders)[number];

export const backupRestoreDrillModes = ["dry_run", "local_execute"] as const;
export type BackupRestoreDrillMode = (typeof backupRestoreDrillModes)[number];

const productionLikeSet = new Set<string>(productionLikeEnvironments);
const pilotProdCloudSet = new Set<string>(["pilot-prod", "prod"]);

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

const nonNegativeIntegerFromEnv = (defaultValue: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;

    const normalized = value.trim();
    if (!/^\d+$/.test(normalized)) return value;
    return Number(normalized);
  }, z.number().int().nonnegative());

const positiveIntegerFromEnv = (defaultValue: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === "") return defaultValue;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;

    const normalized = value.trim();
    if (!/^\d+$/u.test(normalized)) return value;
    return Number(normalized);
  }, z.number().int().positive());

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
    CLINIC_OS_ABUSE_BUDGET_KEY_SECRET: optionalString,
    CLINIC_OS_TOKEN_REVOCATION_KEY_SECRET: optionalString,
    TEMPORAL_ADDRESS: requiredString.default("localhost:7233"),

    KEYCLOAK_BASE_URL: requiredUrl,
    KEYCLOAK_REALM: requiredString,
    KEYCLOAK_CLIENT_ID: requiredString,

    S3_REGION: requiredString.default("ap-south-1"),
    S3_BUCKET: requiredString,
    CLINIC_OS_MEDIA_STORAGE_PROVIDER: z.enum(mediaStorageProviders).default("local_simulator"),
    CLINIC_OS_MEDIA_INSPECTION_PROVIDER: z
      .enum(mediaInspectionProviders)
      .default("local_pending_simulator"),
    CLINIC_OS_MEDIA_KMS_KEY_ID: optionalString,
    CLINIC_OS_MEDIA_BINDING_SECRET: optionalString,
    CLINIC_OS_MEDIA_SCANNER_FUNCTION_ARN: optionalString,
    CLINIC_OS_MEDIA_SCANNER_SIGNING_KEY_ID: optionalString,
    CLINIC_OS_MEDIA_PRESIGNED_ORIGINS: optionalString,
    CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED: booleanFromEnv.default(false),
    CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET: optionalString,
    CLINIC_OS_PROVIDER_RAW_WEBHOOK_BUCKET: optionalString,
    CLINIC_OS_PROVIDER_RAW_WEBHOOK_PREFIX: requiredString.default(
      "restricted/provider-webhooks/meta-whatsapp"
    ),
    CLINIC_OS_PROVIDER_RAW_WEBHOOK_KMS_KEY_ID: optionalString,

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
    FIREWORKS_API_KEY_SECRET_REF: optionalString,
    FIREWORKS_SERVICE_ACCOUNT_ID: optionalString,
    FIREWORKS_CHAT_COMPLETIONS_URL: requiredUrl.default(
      "https://api.fireworks.ai/inference/v1/chat/completions"
    ),
    FIREWORKS_AUDIO_QUALITY_URL: requiredUrl.default(
      "https://audio-prod.api.fireworks.ai/v1/audio/transcriptions"
    ),
    FIREWORKS_AUDIO_TURBO_URL: requiredUrl.default(
      "https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions"
    ),
    FIREWORKS_MODEL_CLINICAL_DRAFT: requiredString.default(
      fireworksModelDefaults.clinicalStructuredDraft
    ),
    FIREWORKS_MODEL_SAFETY_REVIEW: requiredString.default(
      fireworksModelDefaults.clinicalSafetyReview
    ),
    FIREWORKS_MODEL_BOUNDED_EXTRACTION: requiredString.default(
      fireworksModelDefaults.boundedExtraction
    ),
    FIREWORKS_MODEL_LONG_CONTEXT_SUMMARY: requiredString.default(
      fireworksModelDefaults.longContextSummary
    ),
    FIREWORKS_MODEL_RETRIEVAL_EMBEDDING: requiredString.default(
      fireworksModelDefaults.retrievalEmbedding
    ),
    FIREWORKS_MODEL_RETRIEVAL_RERANK: requiredString.default(
      fireworksModelDefaults.retrievalRerank
    ),
    FIREWORKS_TRANSCRIPTION_MODEL_QUALITY: requiredString.default(
      fireworksModelDefaults.speechQuality
    ),
    FIREWORKS_TRANSCRIPTION_MODEL_LOW_LATENCY: requiredString.default(
      fireworksModelDefaults.speechLowLatency
    ),
    OPENAI_API_KEY: optionalString,

    TRANSCRIPTION_PROVIDER: z.enum(transcriptionProviders).default("simulator"),
    TRANSCRIPTION_MODEL: optionalString,
    DEEPGRAM_API_KEY: optionalString,
    AI_DATA_RESIDENCY_NOTES: optionalString,
    CLINIC_OS_AI_LIVE_CALLS_ENABLED: booleanFromEnv.default(false),
    CLINIC_OS_AI_KILL_SWITCH: booleanFromEnv.default(true),
    CLINIC_OS_AI_PROVIDER_CONTRACT_APPROVED: booleanFromEnv.default(false),
    CLINIC_OS_AI_NO_TRAINING_APPROVED: booleanFromEnv.default(false),
    CLINIC_OS_AI_ZERO_RETENTION_APPROVED: booleanFromEnv.default(false),
    CLINIC_OS_AI_DATA_RESIDENCY_APPROVED: booleanFromEnv.default(false),
    CLINIC_OS_AI_CLINICAL_EVAL_APPROVED: booleanFromEnv.default(false),
    CLINIC_OS_AI_MAX_INPUT_TOKENS: positiveIntegerFromEnv(32768),
    CLINIC_OS_AI_MAX_OUTPUT_TOKENS: positiveIntegerFromEnv(4096),
    CLINIC_OS_AI_MAX_AUDIO_BYTES: positiveIntegerFromEnv(26214400),
    CLINIC_OS_AI_MAX_AUDIO_DURATION_SECONDS: positiveIntegerFromEnv(7200),
    CLINIC_OS_AI_MAX_ATTEMPTS: positiveIntegerFromEnv(3),
    CLINIC_OS_AI_MONTHLY_BUDGET_CENTS: nonNegativeIntegerFromEnv(0),
    CLINIC_OS_AI_PER_CLINIC_DAILY_BUDGET_CENTS: nonNegativeIntegerFromEnv(0),

    CLINIC_OS_FHIR_R4_ENABLED: booleanFromEnv.default(false),
    CLINIC_OS_CP16_PAYLOAD_KMS_KEY_ID: optionalString,

    AWS_PROFILE: optionalString,
    AWS_REGION: requiredString.default("ap-south-1"),
    AWS_DR_REGION: requiredString.default("ap-south-2"),
    AWS_ACCOUNT_ID: z.preprocess(
      emptyStringToUndefined,
      z
        .string()
        .trim()
        .regex(/^\d{12}$/, "AWS_ACCOUNT_ID must be a 12 digit AWS account id.")
        .optional()
    ),
    AWS_TERRAFORM_STATE_BUCKET: optionalString,
    AWS_TERRAFORM_LOCK_TABLE: optionalString,
    AWS_KMS_KEY_ALIAS: optionalString,

    ALERTING_PROVIDER: z.enum(alertingProviders).default("unconfigured"),
    ALERTING_CONTACT_EMAIL: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().email().optional()
    ),
    ALERTING_SLACK_WEBHOOK_URL: optionalUrl,
    SENTRY_DSN: optionalUrl,

    BACKUP_RESTORE_DRILL_MODE: z.enum(backupRestoreDrillModes).default("dry_run"),
    BACKUP_RESTORE_TARGET_DATABASE_URL: optionalUrl.refine(
      (url) =>
        url === undefined || url.startsWith("postgresql://") || url.startsWith("postgres://"),
      "BACKUP_RESTORE_TARGET_DATABASE_URL must use postgres:// or postgresql://"
    ),
    BACKUP_RESTORE_ALLOW_DESTRUCTIVE: booleanFromEnv.default(false),
    BACKUP_RESTORE_RPO_MINUTES: nonNegativeIntegerFromEnv(60),
    BACKUP_RESTORE_RTO_MINUTES: nonNegativeIntegerFromEnv(240),

    PILOT_SYNTHETIC_DATA_ONLY: booleanFromEnv.default(true),
    PILOT_PATIENT_EXPORT_PATH: optionalString,
    PILOT_APPOINTMENT_EXPORT_PATH: optionalString,
    PILOT_PRICEBOOK_PATH: optionalString,
    PILOT_TEMPLATES_DIR: optionalString,
    PILOT_XRAY_SAMPLE_DIR: optionalString
  })
  .superRefine((env, context) => {
    const productionLike = isProductionLikeEnvironment(env.CLINIC_OS_ENV);
    const pilotProdCloud = requiresPilotProdCloudPosture(env.CLINIC_OS_ENV);

    if (productionLike) {
      if (
        !env.CLINIC_OS_ABUSE_BUDGET_KEY_SECRET ||
        Buffer.byteLength(env.CLINIC_OS_ABUSE_BUDGET_KEY_SECRET, "utf8") < 32
      ) {
        context.addIssue({
          code: "custom",
          path: ["CLINIC_OS_ABUSE_BUDGET_KEY_SECRET"],
          message:
            "Production-like API runtime requires CLINIC_OS_ABUSE_BUDGET_KEY_SECRET with at least 32 UTF-8 bytes."
        });
      }
      if (
        !env.CLINIC_OS_TOKEN_REVOCATION_KEY_SECRET ||
        Buffer.byteLength(env.CLINIC_OS_TOKEN_REVOCATION_KEY_SECRET, "utf8") < 32
      ) {
        context.addIssue({
          code: "custom",
          path: ["CLINIC_OS_TOKEN_REVOCATION_KEY_SECRET"],
          message:
            "Production-like identity runtime requires CLINIC_OS_TOKEN_REVOCATION_KEY_SECRET with at least 32 UTF-8 bytes."
        });
      }

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

      if (env.CLINIC_OS_MEDIA_STORAGE_PROVIDER !== "aws_s3") {
        context.addIssue({
          code: "custom",
          path: ["CLINIC_OS_MEDIA_STORAGE_PROVIDER"],
          message: "Production-like private media requires the aws_s3 storage provider."
        });
      }
      if (env.CLINIC_OS_MEDIA_INSPECTION_PROVIDER !== "guardduty_s3") {
        context.addIssue({
          code: "custom",
          path: ["CLINIC_OS_MEDIA_INSPECTION_PROVIDER"],
          message: "Production-like private media requires the guardduty_s3 inspection provider."
        });
      }
      requireFields(
        context,
        env,
        true,
        [
          "CLINIC_OS_MEDIA_KMS_KEY_ID",
          "CLINIC_OS_MEDIA_BINDING_SECRET",
          "CLINIC_OS_MEDIA_SCANNER_FUNCTION_ARN",
          "CLINIC_OS_MEDIA_SCANNER_SIGNING_KEY_ID",
          "CLINIC_OS_MEDIA_PRESIGNED_ORIGINS"
        ],
        "Production-like private media requires exact S3/KMS/scanner composition inputs."
      );
      if (
        env.CLINIC_OS_MEDIA_BINDING_SECRET &&
        Buffer.byteLength(env.CLINIC_OS_MEDIA_BINDING_SECRET, "utf8") < 32
      ) {
        context.addIssue({
          code: "custom",
          path: ["CLINIC_OS_MEDIA_BINDING_SECRET"],
          message:
            "Production-like private media requires CLINIC_OS_MEDIA_BINDING_SECRET with at least 32 UTF-8 bytes."
        });
      }
    }

    if (env.AWS_REGION === env.AWS_DR_REGION) {
      context.addIssue({
        code: "custom",
        path: ["AWS_DR_REGION"],
        message: "AWS_DR_REGION must be distinct from AWS_REGION for DR posture."
      });
    }

    if (pilotProdCloud) {
      if (env.AWS_REGION !== "ap-south-1") {
        context.addIssue({
          code: "custom",
          path: ["AWS_REGION"],
          message: "Pilot-prod/prod primary AWS region must be ap-south-1."
        });
      }

      if (env.AWS_DR_REGION !== "ap-south-2") {
        context.addIssue({
          code: "custom",
          path: ["AWS_DR_REGION"],
          message: "Pilot-prod/prod DR AWS region must be ap-south-2."
        });
      }

      requireFields(
        context,
        env,
        true,
        [
          "AWS_ACCOUNT_ID",
          "AWS_TERRAFORM_STATE_BUCKET",
          "AWS_TERRAFORM_LOCK_TABLE",
          "AWS_KMS_KEY_ALIAS"
        ],
        "Pilot-prod/prod cloud posture requires AWS account, Terraform backend, and KMS alias fields."
      );

      if (env.ALERTING_PROVIDER === "unconfigured") {
        context.addIssue({
          code: "custom",
          path: ["ALERTING_PROVIDER"],
          message:
            "Pilot-prod/prod requires an alerting provider or an explicit deferred go-live decision."
        });
      }
    }

    if (
      env.CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED &&
      (!env.CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET ||
        Buffer.byteLength(env.CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET, "utf8") < 32)
    ) {
      context.addIssue({
        code: "custom",
        path: ["CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET"],
        message:
          "Official provider callbacks require a provider endpoint HMAC secret with at least 32 UTF-8 bytes."
      });
    }

    requireFields(
      context,
      env,
      env.CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED,
      [
        "CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET",
        "CLINIC_OS_PROVIDER_RAW_WEBHOOK_BUCKET",
        "CLINIC_OS_PROVIDER_RAW_WEBHOOK_KMS_KEY_ID"
      ],
      "Official provider callbacks require restricted S3/KMS storage and endpoint-HMAC configuration."
    );

    requireFields(
      context,
      env,
      env.ALERTING_PROVIDER === "email",
      ["ALERTING_CONTACT_EMAIL"],
      "Email alerting is selected but ALERTING_CONTACT_EMAIL is missing."
    );

    requireFields(
      context,
      env,
      env.ALERTING_PROVIDER === "slack",
      ["ALERTING_SLACK_WEBHOOK_URL"],
      "Slack alerting is selected but ALERTING_SLACK_WEBHOOK_URL is missing."
    );

    requireFields(
      context,
      env,
      env.ALERTING_PROVIDER === "sentry",
      ["SENTRY_DSN"],
      "Sentry alerting is selected but SENTRY_DSN is missing."
    );

    if (productionLike && env.BACKUP_RESTORE_DRILL_MODE === "local_execute") {
      context.addIssue({
        code: "custom",
        path: ["BACKUP_RESTORE_DRILL_MODE"],
        message:
          "Restore drills may execute locally only in local/dev; production-like runs must use dry_run plus approved runbook steps."
      });
    }

    if (
      env.BACKUP_RESTORE_ALLOW_DESTRUCTIVE &&
      (productionLike || env.BACKUP_RESTORE_DRILL_MODE !== "local_execute")
    ) {
      context.addIssue({
        code: "custom",
        path: ["BACKUP_RESTORE_ALLOW_DESTRUCTIVE"],
        message:
          "Destructive restore drill operations require BACKUP_RESTORE_DRILL_MODE=local_execute in local/dev only."
      });
    }

    if (env.BACKUP_RESTORE_DRILL_MODE === "local_execute") {
      requireFields(
        context,
        env,
        true,
        ["BACKUP_RESTORE_TARGET_DATABASE_URL"],
        "Local restore execution requires BACKUP_RESTORE_TARGET_DATABASE_URL."
      );

      if (!env.PILOT_SYNTHETIC_DATA_ONLY) {
        context.addIssue({
          code: "custom",
          path: ["PILOT_SYNTHETIC_DATA_ONLY"],
          message: "Local restore execution requires PILOT_SYNTHETIC_DATA_ONLY=true."
        });
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
      ["FIREWORKS_API_KEY_SECRET_REF", "FIREWORKS_SERVICE_ACCOUNT_ID"],
      "Fireworks is selected but its service-account credential settings are missing."
    );

    requireFields(
      context,
      env,
      env.TRANSCRIPTION_PROVIDER === "fireworks",
      ["FIREWORKS_API_KEY_SECRET_REF", "FIREWORKS_SERVICE_ACCOUNT_ID"],
      "Fireworks transcription is selected but its service-account credential settings are missing."
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

    if (env.LLM_PROVIDER === "fireworks" || env.TRANSCRIPTION_PROVIDER === "fireworks") {
      assertExactFireworksUrl(
        context,
        "FIREWORKS_CHAT_COMPLETIONS_URL",
        env.FIREWORKS_CHAT_COMPLETIONS_URL,
        "https://api.fireworks.ai/inference/v1/chat/completions"
      );
      assertExactFireworksUrl(
        context,
        "FIREWORKS_AUDIO_QUALITY_URL",
        env.FIREWORKS_AUDIO_QUALITY_URL,
        "https://audio-prod.api.fireworks.ai/v1/audio/transcriptions"
      );
      assertExactFireworksUrl(
        context,
        "FIREWORKS_AUDIO_TURBO_URL",
        env.FIREWORKS_AUDIO_TURBO_URL,
        "https://audio-turbo.api.fireworks.ai/v1/audio/transcriptions"
      );
    }

    if (env.CLINIC_OS_AI_LIVE_CALLS_ENABLED) {
      if (env.LLM_PROVIDER !== "fireworks" || env.TRANSCRIPTION_PROVIDER !== "fireworks") {
        context.addIssue({
          code: "custom",
          path: ["CLINIC_OS_AI_LIVE_CALLS_ENABLED"],
          message:
            "The CP16 live AI path requires both LLM_PROVIDER=fireworks and TRANSCRIPTION_PROVIDER=fireworks."
        });
      }

      const approvals = [
        "CLINIC_OS_AI_PROVIDER_CONTRACT_APPROVED",
        "CLINIC_OS_AI_NO_TRAINING_APPROVED",
        "CLINIC_OS_AI_ZERO_RETENTION_APPROVED",
        "CLINIC_OS_AI_DATA_RESIDENCY_APPROVED",
        "CLINIC_OS_AI_CLINICAL_EVAL_APPROVED"
      ] as const;
      for (const approval of approvals) {
        if (!env[approval]) {
          context.addIssue({
            code: "custom",
            path: [approval],
            message: `${approval}=true is required before live AI/STT calls can be enabled.`
          });
        }
      }

      if (env.CLINIC_OS_AI_KILL_SWITCH) {
        context.addIssue({
          code: "custom",
          path: ["CLINIC_OS_AI_KILL_SWITCH"],
          message:
            "Live AI/STT activation requires an explicit CLINIC_OS_AI_KILL_SWITCH=false decision."
        });
      }
      if (
        env.CLINIC_OS_AI_MONTHLY_BUDGET_CENTS === 0 ||
        env.CLINIC_OS_AI_PER_CLINIC_DAILY_BUDGET_CENTS === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["CLINIC_OS_AI_MONTHLY_BUDGET_CENTS"],
          message:
            "Live AI/STT activation requires non-zero account and per-clinic budget ceilings."
        });
      }
    }

    requireFields(
      context,
      env,
      env.CLINIC_OS_FHIR_R4_ENABLED,
      ["CLINIC_OS_CP16_PAYLOAD_KMS_KEY_ID"],
      "FHIR R4 exchange is enabled but its protected-payload KMS key is missing."
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
  security: {
    abuseBudgetKeySecret?: string | undefined;
    tokenRevocationKeySecret?: string | undefined;
  };
  auth: {
    keycloakBaseUrl: string;
    keycloakRealm: string;
    keycloakClientId: string;
  };
  storage: {
    region: string;
    bucket: string;
    mediaStorageProvider: MediaStorageProvider;
    mediaInspectionProvider: MediaInspectionProvider;
    mediaKmsKeyId?: string | undefined;
    mediaBindingSecret?: string | undefined;
    mediaScannerFunctionArn?: string | undefined;
    mediaScannerSigningKeyId?: string | undefined;
    mediaPresignedOrigins?: string | undefined;
  };
  providerCallbacks: {
    enabled: boolean;
    endpointHmacSecret?: string | undefined;
    rawWebhookBucket?: string | undefined;
    rawWebhookPrefix: string;
    rawWebhookKmsKeyId?: string | undefined;
  };
  interoperability?: {
    fhirR4Enabled: boolean;
    payloadKmsKeyId?: string | undefined;
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
      fireworksApiKeySecretRef?: string | undefined;
      fireworksServiceAccountId?: string | undefined;
      fireworks: {
        chatCompletionsUrl: string;
        audioQualityUrl: string;
        audioTurboUrl: string;
        models: {
          clinicalStructuredDraft: string;
          clinicalSafetyReview: string;
          boundedExtraction: string;
          longContextSummary: string;
          retrievalEmbedding: string;
          retrievalRerank: string;
          speechQuality: string;
          speechLowLatency: string;
        };
      };
      openaiApiKey?: string | undefined;
      transcriptionProvider: TranscriptionProvider;
      transcriptionModel?: string | undefined;
      deepgramApiKey?: string | undefined;
      dataResidencyNotes?: string | undefined;
      activation: {
        liveCallsEnabled: boolean;
        killSwitch: boolean;
        providerContractApproved: boolean;
        noTrainingApproved: boolean;
        zeroRetentionApproved: boolean;
        dataResidencyApproved: boolean;
        clinicalEvalApproved: boolean;
      };
      limits: {
        maxInputTokens: number;
        maxOutputTokens: number;
        maxAudioBytes: number;
        maxAudioDurationSeconds: number;
        maxAttempts: number;
        monthlyBudgetCents: number;
        perClinicDailyBudgetCents: number;
      };
    };
  };
  operations: {
    cloud: {
      profile?: string | undefined;
      primaryRegion: string;
      drRegion: string;
      accountId?: string | undefined;
      terraformStateBucket?: string | undefined;
      terraformLockTable?: string | undefined;
      kmsKeyAlias?: string | undefined;
    };
    alerting: {
      provider: AlertingProvider;
      contactEmail?: string | undefined;
      slackWebhookUrl?: string | undefined;
      sentryDsn?: string | undefined;
    };
    backupRestore: {
      drillMode: BackupRestoreDrillMode;
      targetDatabaseUrl?: string | undefined;
      allowDestructive: boolean;
      rpoMinutes: number;
      rtoMinutes: number;
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

export function requiresPilotProdCloudPosture(environment: ClinicOsEnvironment): boolean {
  return pilotProdCloudSet.has(environment);
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
    security: {
      abuseBudgetKeySecret: env.CLINIC_OS_ABUSE_BUDGET_KEY_SECRET,
      tokenRevocationKeySecret: env.CLINIC_OS_TOKEN_REVOCATION_KEY_SECRET
    },
    auth: {
      keycloakBaseUrl: env.KEYCLOAK_BASE_URL,
      keycloakRealm: env.KEYCLOAK_REALM,
      keycloakClientId: env.KEYCLOAK_CLIENT_ID
    },
    storage: {
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      mediaStorageProvider: env.CLINIC_OS_MEDIA_STORAGE_PROVIDER,
      mediaInspectionProvider: env.CLINIC_OS_MEDIA_INSPECTION_PROVIDER,
      mediaKmsKeyId: env.CLINIC_OS_MEDIA_KMS_KEY_ID,
      mediaBindingSecret: env.CLINIC_OS_MEDIA_BINDING_SECRET,
      mediaScannerFunctionArn: env.CLINIC_OS_MEDIA_SCANNER_FUNCTION_ARN,
      mediaScannerSigningKeyId: env.CLINIC_OS_MEDIA_SCANNER_SIGNING_KEY_ID,
      mediaPresignedOrigins: env.CLINIC_OS_MEDIA_PRESIGNED_ORIGINS
    },
    providerCallbacks: {
      enabled: env.CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED,
      endpointHmacSecret: env.CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET,
      rawWebhookBucket: env.CLINIC_OS_PROVIDER_RAW_WEBHOOK_BUCKET,
      rawWebhookPrefix: env.CLINIC_OS_PROVIDER_RAW_WEBHOOK_PREFIX,
      rawWebhookKmsKeyId: env.CLINIC_OS_PROVIDER_RAW_WEBHOOK_KMS_KEY_ID
    },
    interoperability: {
      fhirR4Enabled: env.CLINIC_OS_FHIR_R4_ENABLED,
      payloadKmsKeyId: env.CLINIC_OS_CP16_PAYLOAD_KMS_KEY_ID
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
        fireworksApiKeySecretRef: env.FIREWORKS_API_KEY_SECRET_REF,
        fireworksServiceAccountId: env.FIREWORKS_SERVICE_ACCOUNT_ID,
        fireworks: {
          chatCompletionsUrl: env.FIREWORKS_CHAT_COMPLETIONS_URL,
          audioQualityUrl: env.FIREWORKS_AUDIO_QUALITY_URL,
          audioTurboUrl: env.FIREWORKS_AUDIO_TURBO_URL,
          models: {
            clinicalStructuredDraft: env.FIREWORKS_MODEL_CLINICAL_DRAFT,
            clinicalSafetyReview: env.FIREWORKS_MODEL_SAFETY_REVIEW,
            boundedExtraction: env.FIREWORKS_MODEL_BOUNDED_EXTRACTION,
            longContextSummary: env.FIREWORKS_MODEL_LONG_CONTEXT_SUMMARY,
            retrievalEmbedding: env.FIREWORKS_MODEL_RETRIEVAL_EMBEDDING,
            retrievalRerank: env.FIREWORKS_MODEL_RETRIEVAL_RERANK,
            speechQuality: env.FIREWORKS_TRANSCRIPTION_MODEL_QUALITY,
            speechLowLatency: env.FIREWORKS_TRANSCRIPTION_MODEL_LOW_LATENCY
          }
        },
        openaiApiKey: env.OPENAI_API_KEY,
        transcriptionProvider: env.TRANSCRIPTION_PROVIDER,
        transcriptionModel: env.TRANSCRIPTION_MODEL,
        deepgramApiKey: env.DEEPGRAM_API_KEY,
        dataResidencyNotes: env.AI_DATA_RESIDENCY_NOTES,
        activation: {
          liveCallsEnabled: env.CLINIC_OS_AI_LIVE_CALLS_ENABLED,
          killSwitch: env.CLINIC_OS_AI_KILL_SWITCH,
          providerContractApproved: env.CLINIC_OS_AI_PROVIDER_CONTRACT_APPROVED,
          noTrainingApproved: env.CLINIC_OS_AI_NO_TRAINING_APPROVED,
          zeroRetentionApproved: env.CLINIC_OS_AI_ZERO_RETENTION_APPROVED,
          dataResidencyApproved: env.CLINIC_OS_AI_DATA_RESIDENCY_APPROVED,
          clinicalEvalApproved: env.CLINIC_OS_AI_CLINICAL_EVAL_APPROVED
        },
        limits: {
          maxInputTokens: env.CLINIC_OS_AI_MAX_INPUT_TOKENS,
          maxOutputTokens: env.CLINIC_OS_AI_MAX_OUTPUT_TOKENS,
          maxAudioBytes: env.CLINIC_OS_AI_MAX_AUDIO_BYTES,
          maxAudioDurationSeconds: env.CLINIC_OS_AI_MAX_AUDIO_DURATION_SECONDS,
          maxAttempts: env.CLINIC_OS_AI_MAX_ATTEMPTS,
          monthlyBudgetCents: env.CLINIC_OS_AI_MONTHLY_BUDGET_CENTS,
          perClinicDailyBudgetCents: env.CLINIC_OS_AI_PER_CLINIC_DAILY_BUDGET_CENTS
        }
      }
    },
    operations: {
      cloud: {
        profile: env.AWS_PROFILE,
        primaryRegion: env.AWS_REGION,
        drRegion: env.AWS_DR_REGION,
        accountId: env.AWS_ACCOUNT_ID,
        terraformStateBucket: env.AWS_TERRAFORM_STATE_BUCKET,
        terraformLockTable: env.AWS_TERRAFORM_LOCK_TABLE,
        kmsKeyAlias: env.AWS_KMS_KEY_ALIAS
      },
      alerting: {
        provider: env.ALERTING_PROVIDER,
        contactEmail: env.ALERTING_CONTACT_EMAIL,
        slackWebhookUrl: env.ALERTING_SLACK_WEBHOOK_URL,
        sentryDsn: env.SENTRY_DSN
      },
      backupRestore: {
        drillMode: env.BACKUP_RESTORE_DRILL_MODE,
        targetDatabaseUrl: env.BACKUP_RESTORE_TARGET_DATABASE_URL,
        allowDestructive: env.BACKUP_RESTORE_ALLOW_DESTRUCTIVE,
        rpoMinutes: env.BACKUP_RESTORE_RPO_MINUTES,
        rtoMinutes: env.BACKUP_RESTORE_RTO_MINUTES
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

function assertExactFireworksUrl(
  context: z.RefinementCtx,
  field: RuntimeEnvKey,
  actual: string,
  expected: string
): void {
  if (actual === expected) return;
  context.addIssue({
    code: "custom",
    path: [field],
    message: `${field} must use the reviewed official Fireworks endpoint ${expected}.`
  });
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
