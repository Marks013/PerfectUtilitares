import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(".env");
const examplePath = resolve(".env.example");

function generateSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function parseEnv(content) {
  const lines = content.split(/\r?\n/);
  const values = new Map();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values.set(key, value);
  }

  return values;
}

function quote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function setIfMissingOrDefault(values, key, defaults, createValue) {
  const current = values.get(key);
  if (!current || defaults.includes(current)) {
    values.set(key, createValue());
    return true;
  }

  return false;
}

const baseContent = existsSync(envPath)
  ? readFileSync(envPath, "utf8")
  : existsSync(examplePath)
    ? readFileSync(examplePath, "utf8")
    : "";
const values = parseEnv(baseContent);
const changed = [];

function track(key, updated) {
  if (updated) changed.push(key);
}

track(
  "POSTGRES_PASSWORD",
  setIfMissingOrDefault(values, "POSTGRES_PASSWORD", ["postgres"], () =>
    generateSecret(18),
  ),
);
track(
  "AUTH_SECRET",
  setIfMissingOrDefault(values, "AUTH_SECRET", ["troque-este-segredo-local"], () =>
    generateSecret(32),
  ),
);
track(
  "ADMIN_PASSWORD",
  setIfMissingOrDefault(values, "ADMIN_PASSWORD", ["admin123", "troque-esta-senha"], () =>
    generateSecret(18),
  ),
);

if (!values.get("POSTGRES_USER")) values.set("POSTGRES_USER", "postgres");
if (!values.get("POSTGRES_DB")) values.set("POSTGRES_DB", "perfectutilitares");
if (!values.get("POSTGRES_PORT")) values.set("POSTGRES_PORT", "5433");
if (!values.get("APP_PORT")) values.set("APP_PORT", "3002");
track(
  "AUTH_URL",
  setIfMissingOrDefault(values, "AUTH_URL", ["http://localhost:3000"], () =>
    `http://localhost:${values.get("APP_PORT")}`,
  ),
);
track(
  "APP_URL",
  setIfMissingOrDefault(values, "APP_URL", ["http://localhost:3000"], () =>
    values.get("AUTH_URL"),
  ),
);
if (!values.get("AUTH_TRUST_HOST")) values.set("AUTH_TRUST_HOST", "true");
if (!values.get("ADMIN_EMAIL")) values.set("ADMIN_EMAIL", "admin@local.test");
if (!values.get("DEFAULT_TENANT_NAME")) values.set("DEFAULT_TENANT_NAME", "Principal");
if (!values.get("DEFAULT_TENANT_SLUG")) values.set("DEFAULT_TENANT_SLUG", "principal");

const currentDatabaseUrl = values.get("DATABASE_URL") ?? "";
if (!currentDatabaseUrl || currentDatabaseUrl.includes("postgres:postgres@")) {
  const user = encodeURIComponent(values.get("POSTGRES_USER"));
  const password = encodeURIComponent(values.get("POSTGRES_PASSWORD"));
  const db = encodeURIComponent(values.get("POSTGRES_DB"));
  const port = encodeURIComponent(values.get("POSTGRES_PORT"));
  values.set(
    "DATABASE_URL",
    `postgresql://${user}:${password}@localhost:${port}/${db}?schema=public`,
  );
  changed.push("DATABASE_URL");
}

const orderedKeys = [
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "POSTGRES_PORT",
  "DATABASE_URL",
  "AUTH_SECRET",
  "APP_PORT",
  "AUTH_URL",
  "APP_URL",
  "AUTH_TRUST_HOST",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "DEFAULT_TENANT_NAME",
  "DEFAULT_TENANT_SLUG",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_TRACES_SAMPLE_RATE",
  "SENTRY_PROFILES_SAMPLE_RATE",
  "SENTRY_REPLAYS_SESSION_SAMPLE_RATE",
  "SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE",
];

for (const key of orderedKeys) {
  if (!values.has(key)) values.set(key, "");
}

const output = `${orderedKeys
  .map((key) => `${key}=${quote(values.get(key) ?? "")}`)
  .join("\n")}\n`;

writeFileSync(envPath, output, "utf8");

console.log(
  changed.length
    ? `.env atualizado: ${[...new Set(changed)].join(", ")}`
    : ".env ja estava pronto",
);
