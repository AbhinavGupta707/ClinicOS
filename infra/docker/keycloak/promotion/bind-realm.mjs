import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_BINDINGS = [
  "CLINIC_OS_REALM",
  "CLINIC_OS_WEB_ORIGIN",
  "CLINIC_OS_WEB_CALLBACK_URI",
  "CLINIC_OS_WEB_POST_LOGOUT_URI",
  "CLINIC_OS_MOBILE_REDIRECT_URI"
];
const PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]{2,127})\}/g;
const SECRET_BINDING = /(?:secret|password|token|private.?key|credential)/i;
const SECRET_FIELD =
  /^(?:secret|clientSecret|client_secret|password|credentials|privateKey|private_key)$/i;

export async function bindRealm({ templatePath, bindingPath, outputPath }) {
  const [templateText, bindingText] = await Promise.all([
    readFile(templatePath, "utf8"),
    readFile(bindingPath, "utf8")
  ]);
  const bindings = parseJsonObject(bindingText, "runtime binding");
  const missing = REQUIRED_BINDINGS.filter((name) => !nonEmptyString(bindings[name]));
  const extra = Object.keys(bindings).filter((name) => !REQUIRED_BINDINGS.includes(name));
  if (missing.length || extra.length) {
    throw new Error(
      `Keycloak runtime binding mismatch; missing=[${missing.sort()}], extra=[${extra.sort()}]`
    );
  }
  for (const [name, value] of Object.entries(bindings)) {
    if (SECRET_BINDING.test(name) || SECRET_BINDING.test(String(value))) {
      throw new Error("Keycloak realm promotion bindings must remain secret-free.");
    }
  }

  const referenced = new Set([...templateText.matchAll(PLACEHOLDER)].map((match) => match[1]));
  const unknown = [...referenced].filter((name) => !REQUIRED_BINDINGS.includes(name));
  if (unknown.length) {
    throw new Error(`Realm template references unsupported bindings: ${unknown.sort()}`);
  }
  const rendered = templateText.replace(PLACEHOLDER, (_match, name) =>
    JSON.stringify(String(bindings[name])).slice(1, -1)
  );
  if (PLACEHOLDER.test(rendered)) throw new Error("Realm template contains unresolved bindings.");
  const realm = parseJsonObject(rendered, "rendered realm");
  validateRealm(realm, bindings);
  const canonical = `${JSON.stringify(canonicalize(realm), null, 2)}\n`;
  await writeFile(outputPath, canonical, { encoding: "utf8", flag: "wx" });
  return canonical;
}

export function validateRealm(realm, bindings) {
  if (realm.realm !== bindings.CLINIC_OS_REALM || realm.enabled !== true) {
    throw new Error("Realm identity does not match the runtime binding.");
  }
  if (realm.sslRequired !== "external" || realm.registrationAllowed !== false) {
    throw new Error("Realm transport and self-registration policy must fail closed.");
  }
  if (
    realm.bruteForceProtected !== true ||
    realm.revokeRefreshToken !== true ||
    realm.refreshTokenMaxReuse !== 0 ||
    realm.accessTokenLifespan > 300 ||
    realm.ssoSessionMaxLifespan > 28800
  ) {
    throw new Error("Realm token, session, or brute-force policy is weaker than CP14.");
  }
  if (!Array.isArray(realm.users) || realm.users.length !== 0) {
    throw new Error("Promoted realms cannot contain users or bootstrap credentials.");
  }
  walk(realm, (key, value) => {
    if (SECRET_FIELD.test(key) && value !== undefined && value !== null && value !== "") {
      throw new Error(`Promoted realm contains forbidden secret-bearing field: ${key}`);
    }
  });

  const clients = new Map((realm.clients ?? []).map((client) => [client.clientId, client]));
  if (clients.size !== 3)
    throw new Error("Promoted realm must define exactly three ClinicOS clients.");
  const web = clients.get("clinic-os-web-bff");
  const mobile = clients.get("clinic-os-mobile");
  const api = clients.get("clinic-os-api");
  if (!web || !mobile || !api)
    throw new Error("Promoted realm is missing a required ClinicOS client.");
  assertInteractiveClient(web, false, bindings.CLINIC_OS_WEB_CALLBACK_URI);
  assertInteractiveClient(mobile, true, bindings.CLINIC_OS_MOBILE_REDIRECT_URI);
  if (
    api.bearerOnly !== true ||
    api.standardFlowEnabled !== false ||
    api.directAccessGrantsEnabled !== false
  ) {
    throw new Error("ClinicOS API client must remain bearer-only.");
  }
  if (
    web.webOrigins?.length !== 1 ||
    web.webOrigins[0] !== bindings.CLINIC_OS_WEB_ORIGIN ||
    mobile.webOrigins?.length !== 0
  ) {
    throw new Error("Interactive clients must use exact web-origin policy without wildcards.");
  }
}

function assertInteractiveClient(client, publicClient, redirectUri) {
  if (
    client.publicClient !== publicClient ||
    client.standardFlowEnabled !== true ||
    client.implicitFlowEnabled !== false ||
    client.directAccessGrantsEnabled !== false ||
    client.serviceAccountsEnabled !== false ||
    client.attributes?.["pkce.code.challenge.method"] !== "S256"
  ) {
    throw new Error(`${client.clientId} must use Authorization Code + PKCE S256 only.`);
  }
  if (
    client.redirectUris?.length !== 1 ||
    client.redirectUris[0] !== redirectUri ||
    redirectUri.includes("*")
  ) {
    throw new Error(`${client.clientId} must use one exact redirect URI.`);
  }
  if (client.optionalClientScopes?.includes("offline_access")) {
    throw new Error(`${client.clientId} cannot request offline access.`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)])
  );
}

function walk(value, visitor) {
  if (Array.isArray(value)) {
    value.forEach((entry) => walk(entry, visitor));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    visitor(key, nested);
    walk(nested, visitor);
  }
}

function parseJsonObject(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Keycloak ${label} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Keycloak ${label} must be a JSON object.`);
  }
  return parsed;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function main(argv) {
  const options = Object.fromEntries(
    argv.reduce((entries, value, index) => {
      if (!value.startsWith("--") || index % 2 !== 0) return entries;
      entries.push([value.slice(2), argv[index + 1]]);
      return entries;
    }, [])
  );
  if (!options.template || !options.binding || !options.out) {
    throw new Error("Usage: bind-realm.mjs --template <file> --binding <file> --out <new-file>");
  }
  await bindRealm({
    templatePath: options.template,
    bindingPath: options.binding,
    outputPath: options.out
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Realm promotion failed."}\n`);
    process.exitCode = 1;
  });
}
