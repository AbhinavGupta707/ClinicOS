import { describe, expect, it } from "vitest";

import { fireworksModelDefaults, parseClinicOsEnv, safeParseClinicOsEnv } from "./index.js";

const baseEnv = {
  NODE_ENV: "development",
  CLINIC_OS_ENV: "local",
  DATABASE_URL: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
  REDIS_URL: "redis://localhost:6379",
  TEMPORAL_ADDRESS: "localhost:7233",
  KEYCLOAK_BASE_URL: "http://localhost:8080",
  KEYCLOAK_REALM: "clinic-os-local",
  KEYCLOAK_CLIENT_ID: "clinic-os-web",
  S3_REGION: "ap-south-1",
  S3_BUCKET: "clinic-os-local",
  WHATSAPP_PROVIDER: "simulator",
  PAYMENT_PROVIDER: "simulator",
  TELEPHONY_PROVIDER: "simulator",
  LLM_PROVIDER: "simulator",
  TRANSCRIPTION_PROVIDER: "simulator",
  AWS_REGION: "ap-south-1",
  AWS_DR_REGION: "ap-south-2",
  ALERTING_PROVIDER: "unconfigured",
  BACKUP_RESTORE_DRILL_MODE: "dry_run",
  BACKUP_RESTORE_ALLOW_DESTRUCTIVE: "false",
  BACKUP_RESTORE_RPO_MINUTES: "60",
  BACKUP_RESTORE_RTO_MINUTES: "240"
} as const;

describe("parseClinicOsEnv", () => {
  it("allows local simulator providers for development and test contracts", () => {
    const config = parseClinicOsEnv(baseEnv);

    expect(config.clinicOsEnv).toBe("local");
    expect(config.isProductionLike).toBe(false);
    expect(config.providers.whatsapp.provider).toBe("simulator");
    expect(config.providers.payment.provider).toBe("simulator");
    expect(config.operations.cloud.primaryRegion).toBe("ap-south-1");
    expect(config.operations.cloud.drRegion).toBe("ap-south-2");
    expect(config.operations.backupRestore.drillMode).toBe("dry_run");
    expect(config.operations.backupRestore.rpoMinutes).toBe(60);
    expect(config.security.abuseBudgetKeySecret).toBeUndefined();
    expect(config.storage.mediaStorageProvider).toBe("local_simulator");
    expect(config.storage.mediaInspectionProvider).toBe("local_pending_simulator");
  });

  it("rejects simulator providers in production-like environments", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      CLINIC_OS_ENV: "staging"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining([
        "WHATSAPP_PROVIDER",
        "PAYMENT_PROVIDER",
        "TELEPHONY_PROVIDER",
        "LLM_PROVIDER",
        "TRANSCRIPTION_PROVIDER"
      ])
    );
  });

  it("permits explicit unavailable provider states in production-like environments", () => {
    const config = parseClinicOsEnv({
      ...baseEnv,
      NODE_ENV: "production",
      CLINIC_OS_ENV: "pilot-prod",
      WHATSAPP_PROVIDER: "unconfigured",
      PAYMENT_PROVIDER: "manual_clinic_approved",
      TELEPHONY_PROVIDER: "unconfigured",
      LLM_PROVIDER: "unconfigured",
      TRANSCRIPTION_PROVIDER: "unconfigured",
      CLINIC_OS_MEDIA_STORAGE_PROVIDER: "aws_s3",
      CLINIC_OS_MEDIA_INSPECTION_PROVIDER: "guardduty_s3",
      CLINIC_OS_MEDIA_KMS_KEY_ID: "alias/clinicos-pilot-prod-data",
      CLINIC_OS_MEDIA_BINDING_SECRET: "staging-media-binding-secret-000001",
      CLINIC_OS_MEDIA_SCANNER_FUNCTION_ARN:
        "arn:aws:lambda:ap-south-1:123456789012:function:clinicos-pilot-prod-media-scanner",
      CLINIC_OS_MEDIA_SCANNER_SIGNING_KEY_ID:
        "arn:aws:kms:ap-south-1:123456789012:key/11111111-1111-1111-1111-111111111111",
      CLINIC_OS_MEDIA_PRESIGNED_ORIGINS: "https://clinic-os-local.s3.ap-south-1.amazonaws.com",
      CLINIC_OS_ABUSE_BUDGET_KEY_SECRET: "staging-abuse-budget-key-secret-0001",
      CLINIC_OS_TOKEN_REVOCATION_KEY_SECRET: "staging-token-revocation-key-secret-0001",
      AWS_ACCOUNT_ID: "123456789012",
      AWS_TERRAFORM_STATE_BUCKET: "clinic-os-terraform-state",
      AWS_TERRAFORM_LOCK_TABLE: "clinic-os-terraform-locks",
      AWS_KMS_KEY_ALIAS: "alias/clinic-os-pilot-prod",
      ALERTING_PROVIDER: "email",
      ALERTING_CONTACT_EMAIL: "ops@example.test"
    });

    expect(config.isProductionLike).toBe(true);
    expect(config.providers.whatsapp.provider).toBe("unconfigured");
    expect(config.providers.payment.provider).toBe("manual_clinic_approved");
    expect(config.operations.alerting.provider).toBe("email");
    expect(config.security.abuseBudgetKeySecret).toBe("staging-abuse-budget-key-secret-0001");
    expect(config.security.tokenRevocationKeySecret).toBe(
      "staging-token-revocation-key-secret-0001"
    );
    expect(config.storage.mediaStorageProvider).toBe("aws_s3");
    expect(config.storage.mediaInspectionProvider).toBe("guardduty_s3");
  });

  it("requires a strong abuse-budget key secret in production-like environments", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      CLINIC_OS_ENV: "staging",
      WHATSAPP_PROVIDER: "unconfigured",
      PAYMENT_PROVIDER: "unconfigured",
      TELEPHONY_PROVIDER: "unconfigured",
      LLM_PROVIDER: "unconfigured",
      TRANSCRIPTION_PROVIDER: "unconfigured",
      CLINIC_OS_ABUSE_BUDGET_KEY_SECRET: "too-short"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
      "CLINIC_OS_ABUSE_BUDGET_KEY_SECRET"
    );
  });

  it("requires pilot-prod cloud backend, KMS, and alerting posture", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      NODE_ENV: "production",
      CLINIC_OS_ENV: "pilot-prod",
      WHATSAPP_PROVIDER: "unconfigured",
      PAYMENT_PROVIDER: "manual_clinic_approved",
      TELEPHONY_PROVIDER: "unconfigured",
      LLM_PROVIDER: "unconfigured",
      TRANSCRIPTION_PROVIDER: "unconfigured"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining([
        "AWS_ACCOUNT_ID",
        "AWS_TERRAFORM_STATE_BUCKET",
        "AWS_TERRAFORM_LOCK_TABLE",
        "AWS_KMS_KEY_ALIAS",
        "ALERTING_PROVIDER"
      ])
    );
  });

  it("rejects same-region primary and DR configuration", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      AWS_DR_REGION: "ap-south-1"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("AWS_DR_REGION");
  });

  it("requires alerting destination details when an alerting provider is selected", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      ALERTING_PROVIDER: "slack"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
      "ALERTING_SLACK_WEBHOOK_URL"
    );
  });

  it("guards destructive restore drill execution behind local synthetic data", () => {
    const config = parseClinicOsEnv({
      ...baseEnv,
      BACKUP_RESTORE_DRILL_MODE: "local_execute",
      BACKUP_RESTORE_ALLOW_DESTRUCTIVE: "true",
      BACKUP_RESTORE_TARGET_DATABASE_URL:
        "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os_restore_drill",
      PILOT_SYNTHETIC_DATA_ONLY: "true"
    });

    expect(config.operations.backupRestore.drillMode).toBe("local_execute");
    expect(config.operations.backupRestore.allowDestructive).toBe(true);
  });

  it("blocks destructive restore drill execution in production-like environments", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      NODE_ENV: "production",
      CLINIC_OS_ENV: "staging",
      WHATSAPP_PROVIDER: "unconfigured",
      PAYMENT_PROVIDER: "unconfigured",
      TELEPHONY_PROVIDER: "unconfigured",
      LLM_PROVIDER: "unconfigured",
      TRANSCRIPTION_PROVIDER: "unconfigured",
      BACKUP_RESTORE_DRILL_MODE: "local_execute",
      BACKUP_RESTORE_ALLOW_DESTRUCTIVE: "true",
      BACKUP_RESTORE_TARGET_DATABASE_URL:
        "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os_restore_drill",
      PILOT_SYNTHETIC_DATA_ONLY: "true"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["BACKUP_RESTORE_DRILL_MODE", "BACKUP_RESTORE_ALLOW_DESTRUCTIVE"])
    );
  });

  it("requires official provider credentials when those providers are selected", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      PAYMENT_PROVIDER: "razorpay"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"])
    );
  });

  it("allows Razorpay sandbox credentials while hosted webhook URL registration is deferred", () => {
    const config = parseClinicOsEnv({
      ...baseEnv,
      PAYMENT_PROVIDER: "razorpay",
      RAZORPAY_KEY_ID: "rzp_test_key",
      RAZORPAY_KEY_SECRET: "rzp_test_secret",
      RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
      RAZORPAY_WEBHOOK_URL: ""
    });

    expect(config.providers.payment.provider).toBe("razorpay");
    expect(config.providers.payment.razorpayWebhookUrl).toBeUndefined();
  });

  it("fails closed when official callback storage or endpoint binding is incomplete", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED: "true",
      CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET: "too-short"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining([
        "CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET",
        "CLINIC_OS_PROVIDER_RAW_WEBHOOK_BUCKET",
        "CLINIC_OS_PROVIDER_RAW_WEBHOOK_KMS_KEY_ID"
      ])
    );
  });

  it("parses a complete official callback envelope without putting provider secrets in config", () => {
    const config = parseClinicOsEnv({
      ...baseEnv,
      CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED: "true",
      CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET: "endpoint-binding-secret-value-00001",
      CLINIC_OS_PROVIDER_RAW_WEBHOOK_BUCKET: "clinic-os-restricted-callbacks",
      CLINIC_OS_PROVIDER_RAW_WEBHOOK_PREFIX: "restricted/provider-webhooks/meta-whatsapp",
      CLINIC_OS_PROVIDER_RAW_WEBHOOK_KMS_KEY_ID: "alias/clinic-os-provider-callbacks"
    });

    expect(config.providerCallbacks).toEqual({
      enabled: true,
      endpointHmacSecret: "endpoint-binding-secret-value-00001",
      rawWebhookBucket: "clinic-os-restricted-callbacks",
      rawWebhookPrefix: "restricted/provider-webhooks/meta-whatsapp",
      rawWebhookKmsKeyId: "alias/clinic-os-provider-callbacks"
    });
  });

  it("parses Meta WhatsApp and Razorpay sandbox credentials when supplied", () => {
    const config = parseClinicOsEnv({
      ...baseEnv,
      WHATSAPP_PROVIDER: "meta_cloud",
      WHATSAPP_ACCESS_TOKEN: "test-token",
      WHATSAPP_APP_ID: "app-id",
      WHATSAPP_APP_SECRET: "app-secret",
      WHATSAPP_BUSINESS_ACCOUNT_ID: "waba-id",
      WHATSAPP_PHONE_NUMBER_ID: "phone-id",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-token",
      WHATSAPP_WEBHOOK_APP_SECRET_PROOF_REQUIRED: "true",
      PAYMENT_PROVIDER: "razorpay",
      RAZORPAY_KEY_ID: "rzp_test_key",
      RAZORPAY_KEY_SECRET: "rzp_test_secret",
      RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
      RAZORPAY_WEBHOOK_URL: "https://api.example.test/webhooks/razorpay"
    });

    expect(config.providers.whatsapp.provider).toBe("meta_cloud");
    expect(config.providers.whatsapp.appSecretProofRequired).toBe(true);
    expect(config.providers.payment.provider).toBe("razorpay");
    expect(config.providers.payment.razorpayWebhookUrl).toBe(
      "https://api.example.test/webhooks/razorpay"
    );
  });

  it("defaults the Fireworks catalogue to disabled, budget-zero activation", () => {
    const config = parseClinicOsEnv(baseEnv);

    expect(config.providers.ai.fireworks.models).toEqual({
      clinicalStructuredDraft: fireworksModelDefaults.clinicalStructuredDraft,
      clinicalSafetyReview: fireworksModelDefaults.clinicalSafetyReview,
      boundedExtraction: fireworksModelDefaults.boundedExtraction,
      longContextSummary: fireworksModelDefaults.longContextSummary,
      retrievalEmbedding: fireworksModelDefaults.retrievalEmbedding,
      retrievalRerank: fireworksModelDefaults.retrievalRerank,
      speechQuality: fireworksModelDefaults.speechQuality,
      speechLowLatency: fireworksModelDefaults.speechLowLatency
    });
    expect(config.providers.ai.activation).toMatchObject({
      liveCallsEnabled: false,
      killSwitch: true,
      providerContractApproved: false,
      noTrainingApproved: false,
      zeroRetentionApproved: false,
      dataResidencyApproved: false,
      clinicalEvalApproved: false
    });
    expect(config.providers.ai.limits.monthlyBudgetCents).toBe(0);
    expect(config.providers.ai.limits.perClinicDailyBudgetCents).toBe(0);
  });

  it("accepts credential-ready Fireworks configuration while live processing stays disabled", () => {
    const config = parseClinicOsEnv({
      ...baseEnv,
      LLM_PROVIDER: "fireworks",
      TRANSCRIPTION_PROVIDER: "fireworks",
      FIREWORKS_API_KEY_SECRET_REF: "clinicos/local/fireworks-inference-key",
      FIREWORKS_SERVICE_ACCOUNT_ID: "clinicos-staging-inference"
    });

    expect(config.providers.ai.llmProvider).toBe("fireworks");
    expect(config.providers.ai.transcriptionProvider).toBe("fireworks");
    expect(config.providers.ai.activation.liveCallsEnabled).toBe(false);
    expect(config.providers.ai.activation.killSwitch).toBe(true);
  });

  it("does not treat a legacy raw Fireworks key as production credential wiring", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      LLM_PROVIDER: "fireworks",
      TRANSCRIPTION_PROVIDER: "fireworks",
      FIREWORKS_API_KEY: "must-not-be-consumed",
      FIREWORKS_SERVICE_ACCOUNT_ID: "clinicos-staging-inference"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
      "FIREWORKS_API_KEY_SECRET_REF"
    );
  });

  it("rejects live Fireworks activation without every approval, kill-switch and budget gate", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      LLM_PROVIDER: "fireworks",
      TRANSCRIPTION_PROVIDER: "fireworks",
      FIREWORKS_API_KEY_SECRET_REF: "clinicos/local/fireworks-inference-key",
      FIREWORKS_SERVICE_ACCOUNT_ID: "clinicos-staging-inference",
      CLINIC_OS_AI_LIVE_CALLS_ENABLED: "true"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining([
        "CLINIC_OS_AI_PROVIDER_CONTRACT_APPROVED",
        "CLINIC_OS_AI_SERVICE_ACCOUNT_APPROVED",
        "CLINIC_OS_AI_DPA_APPROVED",
        "CLINIC_OS_AI_HEALTHCARE_CONTRACT_APPROVED",
        "CLINIC_OS_AI_NO_TRAINING_APPROVED",
        "CLINIC_OS_AI_ZERO_RETENTION_APPROVED",
        "CLINIC_OS_AI_DATA_RESIDENCY_APPROVED",
        "CLINIC_OS_AI_CLINICAL_EVAL_APPROVED",
        "CLINIC_OS_AI_KILL_SWITCH",
        "CLINIC_OS_AI_MONTHLY_BUDGET_CENTS"
      ])
    );
  });

  it("parses an explicitly approved and bounded Fireworks activation envelope", () => {
    const config = parseClinicOsEnv({
      ...baseEnv,
      LLM_PROVIDER: "fireworks",
      TRANSCRIPTION_PROVIDER: "fireworks",
      FIREWORKS_API_KEY_SECRET_REF: "clinicos/local/fireworks-inference-key",
      FIREWORKS_SERVICE_ACCOUNT_ID: "clinicos-staging-inference",
      CLINIC_OS_AI_LIVE_CALLS_ENABLED: "true",
      CLINIC_OS_AI_KILL_SWITCH: "false",
      CLINIC_OS_AI_PROVIDER_CONTRACT_APPROVED: "true",
      CLINIC_OS_AI_SERVICE_ACCOUNT_APPROVED: "true",
      CLINIC_OS_AI_DPA_APPROVED: "true",
      CLINIC_OS_AI_HEALTHCARE_CONTRACT_APPROVED: "true",
      CLINIC_OS_AI_NO_TRAINING_APPROVED: "true",
      CLINIC_OS_AI_ZERO_RETENTION_APPROVED: "true",
      CLINIC_OS_AI_DATA_RESIDENCY_APPROVED: "true",
      CLINIC_OS_AI_CLINICAL_EVAL_APPROVED: "true",
      CLINIC_OS_AI_MONTHLY_BUDGET_CENTS: "25000",
      CLINIC_OS_AI_PER_CLINIC_DAILY_BUDGET_CENTS: "1000",
      FIREWORKS_MODEL_AVAILABILITY_EVIDENCE_JSON: "{}",
      FIREWORKS_CLINICAL_EVALUATION_EVIDENCE_JSON: "{}",
      CLINIC_OS_CP16_PAYLOAD_KMS_KEY_ID:
        "arn:aws:kms:ap-south-1:123456789012:key/11111111-1111-1111-1111-111111111111"
    });

    expect(config.providers.ai.activation).toMatchObject({
      liveCallsEnabled: true,
      killSwitch: false,
      providerContractApproved: true,
      serviceAccountApproved: true,
      dataProcessingAgreementApproved: true,
      healthcareContractApproved: true,
      noTrainingApproved: true,
      zeroRetentionApproved: true,
      dataResidencyApproved: true,
      clinicalEvalApproved: true
    });
    expect(config.providers.ai.limits.monthlyBudgetCents).toBe(25000);
    expect(config.providers.ai.limits.perClinicDailyBudgetCents).toBe(1000);
  });

  it("rejects an unreviewed Fireworks endpoint override", () => {
    const result = safeParseClinicOsEnv({
      ...baseEnv,
      LLM_PROVIDER: "fireworks",
      FIREWORKS_API_KEY_SECRET_REF: "clinicos/local/fireworks-inference-key",
      FIREWORKS_SERVICE_ACCOUNT_ID: "clinicos-staging-inference",
      FIREWORKS_CHAT_COMPLETIONS_URL: "https://example.test/inference/v1/chat/completions"
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain(
      "FIREWORKS_CHAT_COMPLETIONS_URL"
    );
  });
});
