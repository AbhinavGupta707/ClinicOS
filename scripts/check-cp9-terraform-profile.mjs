import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const profileDir = resolve(process.cwd(), "infra/terraform/pilot-prod");
const terraformFiles = readdirSync(profileDir)
  .filter((file) => file.endsWith(".tf"))
  .map((file) => join(profileDir, file));

if (terraformFiles.length === 0) {
  fail("No Terraform files found in infra/terraform/pilot-prod.");
}

const combined = terraformFiles.map((file) => readFileSync(file, "utf8")).join("\n");

const forbiddenBlocks = [/^\s*resource\s+"/m, /^\s*provider\s+"/m, /^\s*backend\s+"/m];
for (const pattern of forbiddenBlocks) {
  if (pattern.test(combined)) {
    fail(
      "CP9 pilot-prod profile must remain validate/plan-only with no resource/provider/backend blocks."
    );
  }
}

const requiredTokens = [
  "ap-south-1",
  "ap-south-2",
  "allow_resource_creation",
  "database_publicly_accessible",
  "database_storage_encrypted",
  "database_pitr_enabled",
  "object_storage_encrypted",
  "cross_region_backup_replication_enabled",
  "secrets_manager_enabled",
  "provider_health_alerts_enabled",
  "backup_failure_alerts_enabled"
];

for (const token of requiredTokens) {
  if (!combined.includes(token)) fail(`Missing required CP9 Terraform control token: ${token}`);
}

console.log("CP9 Terraform pilot-prod profile static check passed.");

function fail(message) {
  console.error(message);
  process.exit(1);
}
