import "dotenv/config";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";

const envPath = path.resolve(process.env.ENV_FILE ?? ".env");
const temporaryPath = `${envPath}.${process.pid}.tmp`;
const events = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
  "email.opened",
  "email.clicked",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} não está configurada.`);
  return value;
}

async function persistSecret(secret) {
  if (!/^whsec_[A-Za-z0-9_+/=-]+$/.test(secret)) {
    throw new Error("O Resend retornou uma assinatura inválida.");
  }
  const metadata = await stat(envPath);
  const original = await readFile(envPath, "utf8");
  const line = `RESEND_WEBHOOK_SECRET="${secret}"`;
  const updated = /^RESEND_WEBHOOK_SECRET=.*$/m.test(original)
    ? original.replace(/^RESEND_WEBHOOK_SECRET=.*$/m, line)
    : `${original.replace(/\s*$/, "")}\n${line}\n`;
  await writeFile(temporaryPath, updated, { mode: metadata.mode });
  await rename(temporaryPath, envPath);
}

try {
  const apiKey = required("RESEND_API_KEY");
  const appUrl = new URL(required("APP_URL"));
  if (appUrl.protocol !== "https:") {
    throw new Error("APP_URL precisa usar HTTPS para receber webhooks.");
  }
  const endpoint = new URL("/api/webhooks/resend", appUrl).toString();
  const resend = new Resend(apiKey);
  const listed = await resend.webhooks.list();
  if (listed.error) throw new Error("Não foi possível consultar os webhooks.");

  const existing = listed.data?.data.find((webhook) => webhook.endpoint === endpoint);
  let secret;
  if (existing) {
    const retrieved = await resend.webhooks.get(existing.id);
    if (retrieved.error || !retrieved.data?.signing_secret) {
      throw new Error("Não foi possível recuperar a assinatura do webhook.");
    }
    secret = retrieved.data.signing_secret;
    const updated = await resend.webhooks.update(existing.id, {
      events,
      status: "enabled",
    });
    if (updated.error) throw new Error("Não foi possível atualizar o webhook.");
  } else {
    const created = await resend.webhooks.create({ endpoint, events });
    if (created.error || !created.data?.signing_secret) {
      throw new Error("Não foi possível criar o webhook.");
    }
    secret = created.data.signing_secret;
  }

  await persistSecret(secret);
  console.log(`Webhook de presença ativo em ${endpoint}.`);
} catch (error) {
  await rm(temporaryPath, { force: true }).catch(() => undefined);
  console.error(error instanceof Error ? error.message : "Falha ao configurar webhook.");
  process.exitCode = 1;
}
