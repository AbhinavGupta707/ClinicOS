import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { safeParseClinicOsEnv } from "../packages/config/dist/index.js";

const templatePath = resolve(process.cwd(), ".env.example");
const template = readFileSync(templatePath, "utf8");
const parsedEnv = parseDotEnvTemplate(template);
const result = safeParseClinicOsEnv(parsedEnv);

if (!result.success) {
  console.error(".env.example does not satisfy @clinic-os/config.");
  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

const productionLikeProbe = safeParseClinicOsEnv({
  ...parsedEnv,
  NODE_ENV: "production",
  CLINIC_OS_ENV: "prod"
});

if (productionLikeProbe.success) {
  console.error(
    ".env.example unexpectedly parses as production with simulator providers. Production-like environments must use official providers or unconfigured unavailable states."
  );
  process.exit(1);
}

console.log(
  ".env.example satisfies @clinic-os/config, and simulator providers are blocked for production-like environments."
);

function parseDotEnvTemplate(contents) {
  const env = {};

  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      throw new Error(`Invalid .env template line ${index + 1}: expected KEY=value`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) throw new Error(`Invalid .env template line ${index + 1}: empty key`);

    env[key] = unquote(value);
  }

  return env;
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
