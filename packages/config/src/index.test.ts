import { describe, expect, it } from "vitest";

import { parseClinicOsEnv, safeParseClinicOsEnv } from "./index.js";

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
      CLINIC_OS_ABUSE_BUDGET_KEY_SECRET: "staging-abuse-budget-key-secret-0001",
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
    expect(config.security.abuseBudgetKeySecret).toBe(
      "staging-abuse-budget-key-secret-0001"
    );
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
});
