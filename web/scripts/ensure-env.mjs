import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(".env");
const examplePath = resolve(".env.example");

function generateSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function parseEnv(content) {
  const values = new Map();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function setEnvLine(content, key, value) {
  const replacement = `${key}=${quote(value)}`;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^(?:export\\s+)?${escapedKey}=.*$`);
  const lines = content.split(/\r?\n/);
  const output = [];
  let replaced = false;

  for (const line of lines) {
    if (!pattern.test(line)) {
      output.push(line);
      continue;
    }
    if (!replaced) {
      output.push(replacement);
      replaced = true;
    }
  }

  if (!replaced) {
    while (output.length > 0 && output.at(-1) === "") output.pop();
    if (output.length > 0) output.push("");
    output.push(replacement);
  }

  return output.join("\n");
}

function setIfMissingOrDefault(values, key, defaults, createValue, changed) {
  const current = values.get(key);
  if (!current || defaults.includes(current)) {
    values.set(key, createValue());
    changed.add(key);
  }
}

const fileExisted = existsSync(envPath);
const baseContent = fileExisted
  ? readFileSync(envPath, "utf8")
  : existsSync(examplePath)
    ? readFileSync(examplePath, "utf8")
    : "";

const values = parseEnv(baseContent);
const changed = new Set();

const processEnvKeys = [
  "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "POSTGRES_DATA_DIR",
  "PDF_DATA_DIR", "UNIMED_TEMPLATE_DIR", "UNIMED_ACCESS_ENV_FILE",
  "DATABASE_URL", "AUTH_SECRET", "JORNADA_EXCEL_API_KEY", "APP_PORT",
  "APP_BIND_ADDRESS", "AUTH_URL", "NEXTAUTH_URL", "APP_URL", "APP_TIME_ZONE",
  "AUTH_TRUST_HOST",
  "ADMIN_EMAIL", "ADMIN_PASSWORD", "DEFAULT_TENANT_NAME",
  "DEFAULT_TENANT_SLUG", "APP_DATABASE_POOL_MAX",
  "PDF_WORKER_DATABASE_POOL_MAX", "MIGRATE_DATABASE_POOL_MAX",
  "DATABASE_CONNECTION_TIMEOUT_MS", "DATABASE_IDLE_TIMEOUT_MS",
  "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD",
  "SMTP_FROM_EMAIL", "SMTP_FROM_NAME", "UNIMED_EMAIL_SIGNATURE_URL",
  "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_ORG", "SENTRY_PROJECT", "SENTRY_AUTH_TOKEN",
  "SENTRY_TRACES_SAMPLE_RATE", "SENTRY_PROFILES_SAMPLE_RATE",
  "SENTRY_REPLAYS_SESSION_SAMPLE_RATE", "SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE",
  "PDF_ANONYMOUS_SESSION_TTL_MINUTES", "PDF_MAX_ACTIVE_JOBS",
  "PDF_MAX_ACTIVE_INPUT_BYTES", "PDF_MAX_PUBLIC_ACTIVE_JOBS",
  "PDF_WORKER_CONCURRENCY", "PDF_WORKER_AUTHENTICATED_GROUP_CONCURRENCY",
  "STORAGE_BLOCK_USED_PERCENT", "STORAGE_MIN_FREE_BYTES",
  "DB_CPU_LIMIT", "DB_MEMORY_LIMIT", "DB_MEMORY_RESERVATION",
  "APP_CPU_LIMIT", "APP_MEMORY_LIMIT", "APP_MEMORY_RESERVATION",
  "PDF_WORKER_CPU_LIMIT", "PDF_WORKER_MEMORY_LIMIT",
  "PDF_WORKER_MEMORY_RESERVATION", "APP_UID", "APP_GID",
];

for (const key of processEnvKeys) {
  const value = process.env[key];
  if (value !== undefined && value !== "") {
    values.set(key, value);
    changed.add(key);
  }
}

setIfMissingOrDefault(
  values, "POSTGRES_PASSWORD", ["postgres"], () => generateSecret(18), changed,
);
setIfMissingOrDefault(
  values, "AUTH_SECRET", ["troque-este-segredo-local"],
  () => generateSecret(32), changed,
);
setIfMissingOrDefault(
  values, "JORNADA_EXCEL_API_KEY", ["troque-no-servidor"],
  () => generateSecret(32), changed,
);
setIfMissingOrDefault(
  values, "ADMIN_PASSWORD", ["admin123", "troque-esta-senha"],
  () => generateSecret(18), changed,
);

const defaults = {
  POSTGRES_USER: "postgres",
  POSTGRES_DB: "perfectutilitares",
  POSTGRES_DATA_DIR: "../storage/postgres",
  PDF_DATA_DIR: "../storage/pdf-jobs",
  UNIMED_TEMPLATE_DIR: "../storage/unimed-templates",
  UNIMED_ACCESS_ENV_FILE: "../storage/unimed-access.env",
  APP_PORT: "3002",
  APP_BIND_ADDRESS: "127.0.0.1",
  AUTH_TRUST_HOST: "true",
  APP_TIME_ZONE: "America/Sao_Paulo",
  ADMIN_EMAIL: "admin@local.test",
  DEFAULT_TENANT_NAME: "Principal",
  DEFAULT_TENANT_SLUG: "principal",
  PDF_ANONYMOUS_SESSION_TTL_MINUTES: "120",
  APP_DATABASE_POOL_MAX: "10",
  PDF_WORKER_DATABASE_POOL_MAX: "5",
  MIGRATE_DATABASE_POOL_MAX: "2",
  DATABASE_CONNECTION_TIMEOUT_MS: "5000",
  DATABASE_IDLE_TIMEOUT_MS: "300000",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!values.get(key)) {
    values.set(key, value);
    changed.add(key);
  }
}

for (const key of ["AUTH_URL", "APP_URL", "NEXTAUTH_URL"]) {
  const current = values.get(key);
  if (!current || current === "http://localhost:3000") {
    values.set(key, `http://localhost:${values.get("APP_PORT")}`);
    changed.add(key);
  }
}

const currentDatabaseUrl = values.get("DATABASE_URL") ?? "";
if (!currentDatabaseUrl || currentDatabaseUrl.includes("postgres:postgres@")) {
  const user = encodeURIComponent(values.get("POSTGRES_USER"));
  const password = encodeURIComponent(values.get("POSTGRES_PASSWORD"));
  const db = encodeURIComponent(values.get("POSTGRES_DB"));
  values.set(
    "DATABASE_URL",
    `postgresql://${user}:${password}@localhost:5432/${db}?schema=public`,
  );
  changed.add("DATABASE_URL");
}

let output = baseContent.replace(/\r\n/g, "\n").replace(/\n+$/, "");
for (const [key, value] of values) {
  output = setEnvLine(output, key, value);
}
output = `${output.replace(/\n+$/, "")}\n`;

if (!fileExisted || output !== baseContent.replace(/\r\n/g, "\n")) {
  if (fileExisted) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(envPath, `${envPath}.backup.${stamp}`);
  }
  writeFileSync(envPath, output, "utf8");
}

chmodSync(envPath, 0o600);

console.log(
  changed.size > 0
    ? `.env atualizado com segurança: ${[...changed].sort().join(", ")}`
    : ".env ja estava pronto; chaves personalizadas preservadas",
);
