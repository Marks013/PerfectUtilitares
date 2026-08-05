#!/usr/bin/env node
import fs from "node:fs";

const envFile = process.argv[2] || "/home/ubuntu/PerfectUtilitares/web/.env";
const values = { ...process.env };
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1] in process.env) continue;
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

const failures = [];
const rates = [
  "SENTRY_TRACES_SAMPLE_RATE",
  "SENTRY_PROFILES_SAMPLE_RATE",
  "SENTRY_REPLAYS_SESSION_SAMPLE_RATE",
  "SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE",
];
for (const key of rates) {
  if (!values[key]) continue;
  const rate = Number(values[key]);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1)
    failures.push(`${key} deve estar entre 0 e 1`);
}

const dsn = values.NEXT_PUBLIC_SENTRY_DSN?.trim();
if (dsn) {
  try {
    if (new URL(dsn).protocol !== "https:")
      failures.push("NEXT_PUBLIC_SENTRY_DSN deve usar HTTPS");
  } catch {
    failures.push("NEXT_PUBLIC_SENTRY_DSN invalido");
  }
}
if (
  values.SENTRY_AUTH_TOKEN &&
  (!values.SENTRY_ORG || !values.SENTRY_PROJECT)
) {
  failures.push(
    "SENTRY_ORG e SENTRY_PROJECT sao obrigatorios quando ha token de build",
  );
}

if (failures.length) {
  for (const failure of failures) console.error(`ERRO: ${failure}`);
  process.exit(1);
}
console.log(
  dsn
    ? "Observabilidade: Sentry HTTPS habilitado e configuracao valida."
    : "Observabilidade: logs locais estruturados; Sentry desabilitado.",
);
