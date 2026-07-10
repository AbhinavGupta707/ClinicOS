import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";

const safeEnvironments = new Set(["local", "synthetic"]);
const rollbackPlans = new Set([
  "discard_isolated_restore",
  "drain_synthetic_queue",
  "remove_fault_injection",
  "restart_local_target",
  "stop_load_and_drain"
]);

export function parseCp14Arguments(argv) {
  const parsed = {};
  for (const argument of argv) {
    if (!argument.startsWith("--")) throw new Error("CP14_ARGUMENT_FORMAT_INVALID");
    const separator = argument.indexOf("=");
    if (separator === -1) {
      parsed[argument.slice(2)] = true;
      continue;
    }
    const key = argument.slice(2, separator);
    const value = argument.slice(separator + 1);
    if (!key || !value || Object.hasOwn(parsed, key)) throw new Error("CP14_ARGUMENT_INVALID");
    parsed[key] = value;
  }
  return parsed;
}

export function authorizeSyntheticHarness(args, kind) {
  if (typeof args.environment !== "string" || !safeEnvironments.has(args.environment)) {
    throw new Error("CP14_SYNTHETIC_ENVIRONMENT_REQUIRED");
  }
  if (args["synthetic-only"] !== true) throw new Error("CP14_SYNTHETIC_AUTHORIZATION_REQUIRED");
  if (typeof args["stop-file"] !== "string") throw new Error("CP14_STOP_CONTROL_REQUIRED");
  const stopFile = validateStopFile(args["stop-file"]);
  if (typeof args["rollback-plan"] !== "string" || !rollbackPlans.has(args["rollback-plan"])) {
    throw new Error("CP14_ROLLBACK_CONTROL_REQUIRED");
  }
  if (!/^[a-z][a-z0-9_-]{2,48}$/u.test(kind)) throw new Error("CP14_HARNESS_KIND_INVALID");
  return Object.freeze({
    environment: args.environment,
    dataClassification: "synthetic-only",
    stopFile,
    rollbackPlan: args["rollback-plan"],
    harness: kind,
    liveInfrastructureMutationAllowed: false
  });
}

export function assertLoopbackTarget(value, allowedPaths) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("CP14_LOOPBACK_TARGET_INVALID");
  }
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "::1", "localhost"].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !allowedPaths.includes(target.pathname)
  ) {
    throw new Error("CP14_LOOPBACK_TARGET_FORBIDDEN");
  }
  return target.toString();
}

export function stopRequested(stopFile) {
  if (!existsSync(stopFile)) return false;
  const value = readFileSync(stopFile, "utf8").trim();
  return value === "STOP";
}

export function boundedInteger(value, fallback, minimum, maximum, errorCode) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(errorCode);
  }
  return parsed;
}

export function safeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function readSyntheticJson(path) {
  const absolute = resolve(path);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absolute, "utf8"));
  } catch {
    throw new Error("CP14_SYNTHETIC_INPUT_INVALID");
  }
  return parsed;
}

function validateStopFile(value) {
  if (!isAbsolute(value)) throw new Error("CP14_STOP_FILE_MUST_BE_ABSOLUTE");
  const absolute = resolve(value);
  const systemTemp = `${resolve(tmpdir())}/`;
  if (
    !absolute.startsWith("/tmp/") &&
    !absolute.startsWith("/private/tmp/") &&
    !absolute.startsWith(systemTemp)
  ) {
    throw new Error("CP14_STOP_FILE_OUTSIDE_TEMP");
  }
  return absolute;
}
