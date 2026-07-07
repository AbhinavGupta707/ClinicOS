import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const KNOWN_ENV_KEYS = [
  "NODE_ENV",
  "CLINIC_OS_ENV",
  "DATABASE_URL",
  "REDIS_URL",
  "TEMPORAL_ADDRESS",
  "KEYCLOAK_BASE_URL",
  "KEYCLOAK_REALM",
  "KEYCLOAK_CLIENT_ID",
  "S3_REGION",
  "S3_BUCKET",
  "WHATSAPP_PROVIDER",
  "PAYMENT_PROVIDER",
  "TELEPHONY_PROVIDER",
  "LLM_PROVIDER",
  "TRANSCRIPTION_PROVIDER",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_DR_REGION",
  "AWS_ACCOUNT_ID",
  "AWS_TERRAFORM_STATE_BUCKET",
  "AWS_TERRAFORM_LOCK_TABLE",
  "AWS_KMS_KEY_ALIAS",
  "ALERTING_PROVIDER",
  "ALERTING_CONTACT_EMAIL",
  "ALERTING_SLACK_WEBHOOK_URL",
  "SENTRY_DSN",
  "BACKUP_RESTORE_DRILL_MODE",
  "BACKUP_RESTORE_TARGET_DATABASE_URL",
  "BACKUP_RESTORE_ALLOW_DESTRUCTIVE",
  "BACKUP_RESTORE_RPO_MINUTES",
  "BACKUP_RESTORE_RTO_MINUTES",
  "PILOT_SYNTHETIC_DATA_ONLY",
  "PILOT_PATIENT_EXPORT_PATH",
  "PILOT_APPOINTMENT_EXPORT_PATH",
  "PILOT_PRICEBOOK_PATH",
  "PILOT_TEMPLATES_DIR",
  "PILOT_XRAY_SAMPLE_DIR"
];

const DEFAULT_FIXTURE_PATHS = {
  patients: "fixtures/synthetic/patients.csv",
  appointments: "fixtures/synthetic/appointments.csv",
  pricebook: "fixtures/synthetic/pricebook.csv",
  templates: "fixtures/synthetic/templates",
  media: "fixtures/synthetic/media"
};

const REQUIRED_COLUMNS = {
  patients: [
    "external_id",
    "full_name",
    "phone",
    "email",
    "date_of_birth",
    "gender",
    "preferred_language",
    "whatsapp_opt_in",
    "notes"
  ],
  appointments: [
    "external_id",
    "patient_external_id",
    "source",
    "appointment_type",
    "scheduled_start",
    "scheduled_end",
    "status",
    "chair",
    "doctor",
    "notes"
  ],
  pricebook: [
    "procedure_code",
    "procedure_name",
    "specialty",
    "default_price_inr",
    "tax_rate_percent",
    "notes"
  ]
};

export async function runCli(argv = process.argv.slice(2), options = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(helpText());
    return;
  }

  const cwd = options.cwd ?? process.cwd();
  const env = loadEnv({
    cwd,
    envFile: args.envFile,
    processEnv: options.processEnv ?? process.env
  });
  const parsedConfig = await safeParseRuntimeConfig(env);
  if (!parsedConfig.success) {
    console.error("CP9 restore drill configuration is invalid.");
    for (const issue of parsedConfig.issues) {
      console.error(`- ${issue.path}: ${issue.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const evidence = buildRestoreDrillEvidence({
    cwd,
    env,
    mode: args.mode,
    generatedAt: options.generatedAt ?? new Date()
  });

  if (args.mode === "local_execute") {
    const execution = runLocalRestoreSmoke({ cwd, env, evidence });
    evidence.restoreExecution = execution;
    evidence.destructiveOperationsExecuted = execution.executed;
  }

  if (args.evidenceOut) {
    const outputPath = resolve(cwd, args.evidenceOut);
    writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`CP9 restore drill evidence written to ${outputPath}`);
  }

  console.log(summarizeEvidence(evidence));
}

export function parseArgs(argv) {
  const args = {
    mode: "dry_run",
    envFile: ".env.example",
    evidenceOut: undefined,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--dry-run") {
      args.mode = "dry_run";
      continue;
    }
    if (arg === "--local-execute") {
      args.mode = "local_execute";
      continue;
    }
    if (arg === "--env-file") {
      const value = argv[index + 1];
      if (!value) throw new Error("--env-file requires a path.");
      args.envFile = value;
      index += 1;
      continue;
    }
    if (arg === "--evidence-out") {
      const value = argv[index + 1];
      if (!value) throw new Error("--evidence-out requires a path.");
      args.evidenceOut = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function loadEnv({ cwd, envFile, processEnv }) {
  const filePath = resolve(cwd, envFile);
  const fileEnv = existsSync(filePath) ? parseDotEnv(readFileSync(filePath, "utf8")) : {};
  const selectedProcessEnv = {};
  for (const key of KNOWN_ENV_KEYS) {
    if (processEnv[key] !== undefined) selectedProcessEnv[key] = processEnv[key];
  }
  return { ...fileEnv, ...selectedProcessEnv };
}

export function parseDotEnv(contents) {
  const env = {};
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      throw new Error(`Invalid env line ${index + 1}: expected KEY=value`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) throw new Error(`Invalid env line ${index + 1}: empty key`);
    env[key] = unquote(value);
  }
  return env;
}

export function buildRestoreDrillEvidence({
  cwd,
  env,
  mode = "dry_run",
  generatedAt = new Date()
}) {
  if (!parseBoolean(env.PILOT_SYNTHETIC_DATA_ONLY, true)) {
    throw new Error("PILOT_SYNTHETIC_DATA_ONLY must be true for CP9 restore drill evidence.");
  }

  const paths = {
    patients: resolve(cwd, env.PILOT_PATIENT_EXPORT_PATH || DEFAULT_FIXTURE_PATHS.patients),
    appointments: resolve(
      cwd,
      env.PILOT_APPOINTMENT_EXPORT_PATH || DEFAULT_FIXTURE_PATHS.appointments
    ),
    pricebook: resolve(cwd, env.PILOT_PRICEBOOK_PATH || DEFAULT_FIXTURE_PATHS.pricebook),
    templates: resolve(cwd, env.PILOT_TEMPLATES_DIR || DEFAULT_FIXTURE_PATHS.templates),
    media: resolve(cwd, env.PILOT_XRAY_SAMPLE_DIR || DEFAULT_FIXTURE_PATHS.media)
  };

  const patients = readCsvDataset(paths.patients, "patients");
  const appointments = readCsvDataset(paths.appointments, "appointments");
  const pricebook = readCsvDataset(paths.pricebook, "pricebook");
  validatePatientReferences(patients.rows, appointments.rows);
  validateAppointmentTimes(appointments.rows);
  validatePricebook(pricebook.rows);

  const templateFiles = listFiles(paths.templates);
  const mediaFiles = listFiles(paths.media);
  const fileHashes = [
    fileEvidence("patients", paths.patients, cwd, patients.rows.length),
    fileEvidence("appointments", paths.appointments, cwd, appointments.rows.length),
    fileEvidence("pricebook", paths.pricebook, cwd, pricebook.rows.length)
  ];

  const warnings = [];
  const nonReadmeMediaFiles = mediaFiles.filter(
    (filePath) => basename(filePath).toLowerCase() !== "readme.md"
  );
  if (nonReadmeMediaFiles.length === 0) {
    warnings.push(
      "Synthetic media directory contains no binary sample files; restore dry-run validated the directory contract only."
    );
  }

  return {
    checkpoint: "CP9",
    drill: "synthetic-backup-restore",
    generatedAt: generatedAt.toISOString(),
    mode,
    status: "passed",
    syntheticDataOnly: true,
    destructiveOperationsExecuted: false,
    rpoMinutes: parseInteger(env.BACKUP_RESTORE_RPO_MINUTES, 60),
    rtoMinutes: parseInteger(env.BACKUP_RESTORE_RTO_MINUTES, 240),
    primaryRegion: env.AWS_REGION || "ap-south-1",
    drRegion: env.AWS_DR_REGION || "ap-south-2",
    dataSources: fileHashes,
    directorySources: [
      directoryEvidence("templates", paths.templates, cwd, templateFiles),
      directoryEvidence("media", paths.media, cwd, mediaFiles)
    ],
    validations: [
      "synthetic-only guard is true",
      "patients CSV has required columns and unique external ids",
      "appointments CSV has required columns and references known synthetic patients",
      "appointment scheduled_end values are after scheduled_start values",
      "pricebook CSV has required columns and non-negative INR prices",
      "template and media directories exist for restore bundle shape",
      "dry-run does not read or print secrets",
      "dry-run does not connect to AWS or mutate any database"
    ],
    restorePlan: [
      "take encrypted pilot-prod database snapshot or pg_dump from approved backup source",
      "restore only into an isolated restore-drill database or staging account",
      "load synthetic pilot data fixtures when proving local drill mechanics",
      "verify row counts, patient-reference integrity, provider-health unavailable states, and audit evidence",
      "record evidence and destroy the isolated restore-drill target after review"
    ],
    warnings
  };
}

export function runLocalRestoreSmoke({ cwd, env, evidence }) {
  assertLocalRestoreGuards(env);
  const psqlVersion = spawnSync("psql", ["--version"], { encoding: "utf8" });
  if (psqlVersion.error || psqlVersion.status !== 0) {
    throw new Error("psql is required for --local-execute restore smoke but was not available.");
  }

  const target = new URL(env.BACKUP_RESTORE_TARGET_DATABASE_URL);
  const tempDir = mkdtempSync(join(tmpdir(), "clinicos-cp9-restore-"));
  const sqlPath = join(tempDir, "restore-smoke.sql");
  writeFileSync(sqlPath, buildRestoreSmokeSql({ cwd, evidence }));

  const result = spawnSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "-d", target.pathname.slice(1), "-f", sqlPath],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PGHOST: target.hostname,
        PGPORT: target.port || "5432",
        PGUSER: decodeURIComponent(target.username || ""),
        PGPASSWORD: decodeURIComponent(target.password || ""),
        PGDATABASE: target.pathname.slice(1)
      }
    }
  );

  if (result.status !== 0) {
    throw new Error(
      `Local restore smoke failed. psql exit=${result.status}. stderr=${redact(result.stderr)}`
    );
  }

  return {
    executed: true,
    target: "local restore-drill database",
    schema: "cp9_restore_drill",
    sqlPath,
    psqlVersion: psqlVersion.stdout.trim(),
    stdoutDigest: sha256(result.stdout)
  };
}

export function assertLocalRestoreGuards(env) {
  if (env.BACKUP_RESTORE_DRILL_MODE !== "local_execute") {
    throw new Error("BACKUP_RESTORE_DRILL_MODE must be local_execute for --local-execute.");
  }
  if (!parseBoolean(env.BACKUP_RESTORE_ALLOW_DESTRUCTIVE, false)) {
    throw new Error("BACKUP_RESTORE_ALLOW_DESTRUCTIVE=true is required for --local-execute.");
  }
  if (!parseBoolean(env.PILOT_SYNTHETIC_DATA_ONLY, true)) {
    throw new Error("PILOT_SYNTHETIC_DATA_ONLY=true is required for --local-execute.");
  }
  if (!env.BACKUP_RESTORE_TARGET_DATABASE_URL) {
    throw new Error("BACKUP_RESTORE_TARGET_DATABASE_URL is required for --local-execute.");
  }

  const target = new URL(env.BACKUP_RESTORE_TARGET_DATABASE_URL);
  const databaseName = target.pathname.slice(1);
  if (!["localhost", "127.0.0.1", "::1"].includes(target.hostname)) {
    throw new Error("Local restore smoke target must be localhost/127.0.0.1/::1.");
  }
  if (!databaseName.includes("restore_drill")) {
    throw new Error("Local restore smoke target database name must include restore_drill.");
  }
}

export function buildRestoreSmokeSql({ cwd, evidence }) {
  const datasetByName = Object.fromEntries(
    evidence.dataSources.map((source) => [source.name, source])
  );
  const patients = parseCsv(readFileSync(resolve(cwd, datasetByName.patients.path), "utf8")).rows;
  const appointments = parseCsv(
    readFileSync(resolve(cwd, datasetByName.appointments.path), "utf8")
  ).rows;
  const pricebook = parseCsv(readFileSync(resolve(cwd, datasetByName.pricebook.path), "utf8")).rows;

  return [
    "begin;",
    "drop schema if exists cp9_restore_drill cascade;",
    "create schema cp9_restore_drill;",
    "create table cp9_restore_drill.patients (external_id text primary key, full_name text not null, phone text not null, email text not null);",
    "create table cp9_restore_drill.appointments (external_id text primary key, patient_external_id text not null references cp9_restore_drill.patients(external_id), scheduled_start timestamptz not null, scheduled_end timestamptz not null, status text not null);",
    "create table cp9_restore_drill.pricebook (procedure_code text primary key, procedure_name text not null, default_price_inr numeric not null check (default_price_inr >= 0));",
    ...patients.map(
      (row) =>
        `insert into cp9_restore_drill.patients values (${sql(row.external_id)}, ${sql(row.full_name)}, ${sql(row.phone)}, ${sql(row.email)});`
    ),
    ...appointments.map(
      (row) =>
        `insert into cp9_restore_drill.appointments values (${sql(row.external_id)}, ${sql(row.patient_external_id)}, ${sql(row.scheduled_start)}, ${sql(row.scheduled_end)}, ${sql(row.status)});`
    ),
    ...pricebook.map(
      (row) =>
        `insert into cp9_restore_drill.pricebook values (${sql(row.procedure_code)}, ${sql(row.procedure_name)}, ${Number(row.default_price_inr)});`
    ),
    "select 'patients' as dataset, count(*) from cp9_restore_drill.patients;",
    "select 'appointments' as dataset, count(*) from cp9_restore_drill.appointments;",
    "select 'pricebook' as dataset, count(*) from cp9_restore_drill.pricebook;",
    "commit;",
    ""
  ].join("\n");
}

function readCsvDataset(filePath, dataset) {
  if (!existsSync(filePath)) throw new Error(`${dataset} fixture not found: ${filePath}`);
  const parsed = parseCsv(readFileSync(filePath, "utf8"));
  const missingColumns = REQUIRED_COLUMNS[dataset].filter(
    (column) => !parsed.headers.includes(column)
  );
  if (missingColumns.length > 0) {
    throw new Error(`${dataset} fixture missing columns: ${missingColumns.join(", ")}`);
  }

  const ids = new Set();
  for (const row of parsed.rows) {
    const id = row.external_id || row.procedure_code;
    if (!id) throw new Error(`${dataset} fixture contains a row without an external id.`);
    if (ids.has(id)) throw new Error(`${dataset} fixture has duplicate id: ${id}`);
    ids.add(id);
  }

  return parsed;
}

export function parseCsv(contents) {
  const rows = [];
  const records = [];
  let field = "";
  let record = [];
  let inQuotes = false;

  for (let index = 0; index < contents.length; index += 1) {
    const char = contents[index];
    const next = contents[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      record.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      record.push(field);
      if (record.some((value) => value.trim() !== "")) records.push(record);
      record = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (field || record.length > 0) {
    record.push(field);
    if (record.some((value) => value.trim() !== "")) records.push(record);
  }

  if (records.length === 0) throw new Error("CSV is empty.");
  const headers = records[0].map((header) => header.trim());
  for (const values of records.slice(1)) {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

function validatePatientReferences(patients, appointments) {
  const patientIds = new Set(patients.map((row) => row.external_id));
  for (const appointment of appointments) {
    if (!patientIds.has(appointment.patient_external_id)) {
      throw new Error(
        `appointment ${appointment.external_id} references unknown patient ${appointment.patient_external_id}`
      );
    }
  }
}

function validateAppointmentTimes(appointments) {
  for (const appointment of appointments) {
    const start = Date.parse(appointment.scheduled_start);
    const end = Date.parse(appointment.scheduled_end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error(`appointment ${appointment.external_id} has an invalid time window.`);
    }
  }
}

function validatePricebook(pricebook) {
  for (const item of pricebook) {
    const amount = Number(item.default_price_inr);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`pricebook item ${item.procedure_code} has an invalid INR price.`);
    }
  }
}

function fileEvidence(name, filePath, cwd, rowCount) {
  return {
    name,
    path: relative(cwd, filePath),
    rowCount,
    sha256: hashFile(filePath)
  };
}

function directoryEvidence(name, directoryPath, cwd, files) {
  if (!existsSync(directoryPath)) throw new Error(`${name} directory not found: ${directoryPath}`);
  const digest = createHash("sha256");
  for (const filePath of files) {
    digest.update(relative(directoryPath, filePath));
    digest.update(hashFile(filePath));
  }
  return {
    name,
    path: relative(cwd, directoryPath),
    fileCount: files.length,
    sha256: digest.digest("hex")
  };
}

function listFiles(directoryPath) {
  if (!existsSync(directoryPath)) throw new Error(`directory not found: ${directoryPath}`);
  const entries = [];
  for (const name of readdirSync(directoryPath)) {
    const entryPath = join(directoryPath, name);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) entries.push(...listFiles(entryPath));
    if (stat.isFile()) entries.push(entryPath);
  }
  return entries.sort();
}

function hashFile(filePath) {
  return sha256(readFileSync(filePath));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalized)) return true;
  if (["false", "0", "no", "n"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseInteger(value, defaultValue) {
  if (value === undefined || value === "") return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid integer value: ${value}`);
  return parsed;
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

function summarizeEvidence(evidence) {
  const datasetSummary = evidence.dataSources
    .map((source) => `${source.name}:${source.rowCount}`)
    .join(", ");
  const directorySummary = evidence.directorySources
    .map((source) => `${source.name}:${source.fileCount} files`)
    .join(", ");
  const lines = [
    `CP9 restore drill ${evidence.status} (${evidence.mode}).`,
    `Synthetic datasets: ${datasetSummary}.`,
    `Synthetic directories: ${directorySummary}.`,
    `RPO/RTO target: ${evidence.rpoMinutes}/${evidence.rtoMinutes} minutes.`,
    `Regions: primary=${evidence.primaryRegion}, dr=${evidence.drRegion}.`,
    `Destructive operations executed: ${evidence.destructiveOperationsExecuted}.`
  ];
  if (evidence.warnings.length > 0) {
    lines.push(`Warnings: ${evidence.warnings.join(" ")}`);
  }
  return lines.join("\n");
}

async function safeParseRuntimeConfig(env) {
  const configPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../packages/config/dist/index.js"
  );
  if (!existsSync(configPath)) {
    return {
      success: false,
      issues: [
        {
          path: "packages/config/dist/index.js",
          message: "Run `npm --workspace @clinic-os/config run build` before the restore drill."
        }
      ]
    };
  }

  const { safeParseClinicOsEnv } = await import(pathToFileURL(configPath).href);
  const result = safeParseClinicOsEnv(env);
  if (result.success) return { success: true };
  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join(".") || "(root)",
      message: issue.message
    }))
  };
}

function redact(value) {
  return String(value).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://[redacted]");
}

function helpText() {
  return `ClinicOS CP9 restore drill

Usage:
  node scripts/cp9-restore-drill.mjs --dry-run
  node scripts/cp9-restore-drill.mjs --dry-run --evidence-out /tmp/cp9-restore-drill.json
  node scripts/cp9-restore-drill.mjs --local-execute --env-file .env.local

Default mode is --dry-run. Local execution requires:
  BACKUP_RESTORE_DRILL_MODE=local_execute
  BACKUP_RESTORE_ALLOW_DESTRUCTIVE=true
  PILOT_SYNTHETIC_DATA_ONLY=true
  BACKUP_RESTORE_TARGET_DATABASE_URL pointing to localhost and a database name containing restore_drill

The dry-run path validates synthetic fixtures only and does not connect to AWS or mutate a database.`;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
