import { Resend } from "resend";

let resendClient: Resend | null = null;

export function getAppUrl(request: Request) {
  const envUrl = process.env.APP_URL ?? process.env.AUTH_URL;
  if (envUrl) {
    return new URL(envUrl).origin;
  }

  return new URL(request.url).origin;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getResendClient(apiKey: string) {
  const baseUrl = process.env.RESEND_API_BASE_URL?.trim();
  resendClient ??= new Resend(
    apiKey,
    baseUrl ? { baseUrl: new URL(baseUrl).origin } : undefined,
  );
  return resendClient;
}

export async function sendInvitationEmail({
  to,
  name,
  tenantName,
  inviteUrl,
}: {
  to: string;
  name: string;
  tenantName: string;
  inviteUrl: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("RESEND_NOT_CONFIGURED");
  }

  const client = getResendClient(apiKey);
  const safeName = escapeHtml(name);
  const safeTenantName = escapeHtml(tenantName);
  const safeInviteUrl = escapeHtml(inviteUrl);

  await client.emails.send({
    from,
    to,
    subject: "Convite para o Sistema Web",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h1>Convite para o Sistema Web</h1>
        <p>Olá, ${safeName}.</p>
        <p>Você foi convidado para acessar o tenant <strong>${safeTenantName}</strong>.</p>
        <p><a href="${safeInviteUrl}">Aceitar convite</a></p>
        <p>Este convite expira em 7 dias.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail({
  to,
  name,
  resetUrl,
}: {
  to: string;
  name: string;
  resetUrl: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    throw new Error("RESEND_NOT_CONFIGURED");
  }

  const client = getResendClient(apiKey);
  const safeName = escapeHtml(name);
  const safeResetUrl = escapeHtml(resetUrl);

  await client.emails.send({
    from,
    to,
    subject: "Redefinição de senha",
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h1>Redefinição de senha</h1>
        <p>Olá, ${safeName}.</p>
        <p>Use o link abaixo para definir uma nova senha.</p>
        <p><a href="${safeResetUrl}">Redefinir senha</a></p>
        <p>Este link expira em 1 hora.</p>
      </div>
    `,
  });
}
