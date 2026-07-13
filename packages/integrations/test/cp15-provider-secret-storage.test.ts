import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import {
  AwsSecretsManagerProviderSecretResolver,
  S3MetaEncryptedRawBodyStore
} from "../dist/index.js";

test("CP15 provider secrets resolve only bounded official Secrets Manager references", async () => {
  const commands: GetSecretValueCommand[] = [];
  const resolver = new AwsSecretsManagerProviderSecretResolver({
    region: "ap-south-1",
    client: {
      async send(command) {
        commands.push(command);
        return { SecretString: "synthetic-provider-secret" };
      }
    }
  });

  assert.equal(
    await resolver.resolveSecret(
      "arn:aws:secretsmanager:ap-south-1:123456789012:secret:clinicos/provider/example"
    ),
    "synthetic-provider-secret"
  );
  assert.equal(commands.length, 1);
  assert.equal(
    commands[0]?.input.SecretId,
    "arn:aws:secretsmanager:ap-south-1:123456789012:secret:clinicos/provider/example"
  );
  await assert.rejects(
    resolver.resolveSecret("secret reference with spaces"),
    (error: unknown) => providerError(error, "not_configured")
  );
  assert.equal(commands.length, 1);
});

test("CP15 provider secret outages expose no provider or credential detail", async () => {
  const resolver = new AwsSecretsManagerProviderSecretResolver({
    region: "ap-south-1",
    client: {
      async send() {
        throw new Error("AccessDenied secret-value-should-never-escape");
      }
    }
  });
  await assert.rejects(
    resolver.resolveSecret("clinicos/provider/razorpay/webhook"),
    (error: unknown) => {
      assert.equal(providerError(error, "not_configured"), true);
      assert.equal(String(error).includes("AccessDenied"), false);
      assert.equal(String(error).includes("secret-value"), false);
      return true;
    }
  );
});

test("CP15 Meta raw bodies use exact-digest SSE-KMS versioned restricted storage", async () => {
  const commands: Array<PutObjectCommand | DeleteObjectCommand> = [];
  const store = new S3MetaEncryptedRawBodyStore({
    client: {
      async send(command) {
        commands.push(command);
        return command instanceof PutObjectCommand ? { VersionId: "version-0001" } : {};
      }
    },
    bucket: "clinicos-provider-webhooks-test",
    prefix: "restricted/provider-webhooks/meta-whatsapp",
    kmsKeyId: "arn:aws:kms:ap-south-1:123456789012:key/00000000-0000-4000-8000-000000000001"
  });
  const bytes = Buffer.from('{"object":"whatsapp_business_account"}', "utf8");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const stored = await store.put({
    tenantId: "10000000-0000-4000-8000-000000000001",
    clinicId: "10000000-0000-4000-8000-000000000002",
    rawEventId: `meta_raw_${sha256}`,
    bytes,
    sha256,
    retentionClass: "provider_webhook_restricted"
  });
  const put = commands[0];
  assert.ok(put instanceof PutObjectCommand);
  assert.equal(put.input.ServerSideEncryption, "aws:kms");
  assert.equal(put.input.BucketKeyEnabled, true);
  assert.equal(put.input.ContentType, "application/octet-stream");
  assert.equal(put.input.Metadata?.sha256, sha256);
  assert.match(stored.ciphertextRef, /#version=version-0001$/u);

  await store.deleteUncommitted({
    ciphertextRef: stored.ciphertextRef,
    reason: "transaction_not_committed"
  });
  const deletion = commands[1];
  assert.ok(deletion instanceof DeleteObjectCommand);
  assert.equal(deletion.input.VersionId, "version-0001");
});

test("CP15 Meta raw storage rejects digest drift before any AWS request", async () => {
  let calls = 0;
  const store = new S3MetaEncryptedRawBodyStore({
    client: {
      async send() {
        calls += 1;
        return {};
      }
    },
    bucket: "clinicos-provider-webhooks-test",
    prefix: "restricted/provider-webhooks/meta-whatsapp",
    kmsKeyId: "kms-test-key"
  });
  await assert.rejects(
    store.put({
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000002",
      rawEventId: `meta_raw_${"0".repeat(64)}`,
      bytes: Buffer.from("{}", "utf8"),
      sha256: "0".repeat(64),
      retentionClass: "provider_webhook_restricted"
    }),
    (error: unknown) => providerError(error, "persistence_failed")
  );
  assert.equal(calls, 0);
});

function providerError(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
