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

export function verifyResendWebhook(input: {
  payload: string;
  id: string;
  timestamp: string;
  signature: string;
}): unknown {
  const apiKey = process.env.RESEND_API_KEY;
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) throw new Error("RESEND_WEBHOOK_NOT_CONFIGURED");

  return getResendClient(apiKey).webhooks.verify({
    payload: input.payload,
    headers: {
      id: input.id,
      timestamp: input.timestamp,
      signature: input.signature,
    },
    webhookSecret,
  });
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

function resendErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const candidate = "name" in error ? error.name : null;
  if (typeof candidate !== "string") return "UNKNOWN";
  return candidate.replace(/[^A-Za-z0-9_]+/g, "_").toUpperCase().slice(0, 80);
}

export async function sendPresenceInvitationEmail({
  to,
  name,
  eventTitle,
  eventDate,
  venueName,
  inviteUrl,
  idempotencyKey,
}: {
  to: string;
  name: string;
  eventTitle: string;
  eventDate: string;
  venueName: string | null;
  inviteUrl: string;
  idempotencyKey: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("RESEND_NOT_CONFIGURED");

  const safeName = escapeHtml(name);
  const safeEventTitle = escapeHtml(eventTitle);
  const safeEventDate = escapeHtml(eventDate);
  const safeVenueName = venueName ? escapeHtml(venueName) : null;
  const safeInviteUrl = escapeHtml(inviteUrl);
  const result = await getResendClient(apiKey).emails.send(
    {
      from,
      to,
      subject: `Confirme sua presença em ${eventTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #171717;">
          <h1 style="font-size: 24px;">${safeEventTitle}</h1>
          <p>Olá, ${safeName}.</p>
          <p>Seu convite está pronto. Confirme ou atualize sua presença pelo link individual abaixo.</p>
          <p><strong>Data:</strong> ${safeEventDate}</p>
          ${safeVenueName ? `<p><strong>Local:</strong> ${safeVenueName}</p>` : ""}
          <p style="margin: 24px 0;"><a href="${safeInviteUrl}" style="background: #2563eb; border-radius: 8px; color: #ffffff; display: inline-block; font-weight: 700; padding: 12px 18px; text-decoration: none;">Responder convite</a></p>
          <p style="font-size: 13px; color: #525252;">Este link é pessoal. Não encaminhe para outras pessoas.</p>
        </div>
      `,
      text: `Olá, ${name}. Confirme sua presença em ${eventTitle}. Data: ${eventDate}.${venueName ? ` Local: ${venueName}.` : ""} Acesse: ${inviteUrl}`,
    },
    { idempotencyKey },
  );

  if (result.error) throw new Error(`RESEND_${resendErrorCode(result.error)}`);
  if (!result.data?.id) throw new Error("RESEND_EMPTY_RESPONSE");
  return result.data.id;
}

export async function sendPresenceReminderEmail({
  to,
  name,
  eventTitle,
  eventDate,
  venueName,
  inviteUrl,
  idempotencyKey,
}: {
  to: string;
  name: string;
  eventTitle: string;
  eventDate: string;
  venueName: string | null;
  inviteUrl: string;
  idempotencyKey: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("RESEND_NOT_CONFIGURED");

  const safeName = escapeHtml(name);
  const safeEventTitle = escapeHtml(eventTitle);
  const safeEventDate = escapeHtml(eventDate);
  const safeVenueName = venueName ? escapeHtml(venueName) : null;
  const safeInviteUrl = escapeHtml(inviteUrl);
  const result = await getResendClient(apiKey).emails.send(
    {
      from,
      to,
      subject: `Lembrete: confirme sua presença em ${eventTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #171717;">
          <h1 style="font-size: 24px;">${safeEventTitle}</h1>
          <p>Olá, ${safeName}.</p>
          <p>Passando para lembrar que sua confirmação ainda está pendente.</p>
          <p><strong>Data:</strong> ${safeEventDate}</p>
          ${safeVenueName ? `<p><strong>Local:</strong> ${safeVenueName}</p>` : ""}
          <p style="margin: 24px 0;"><a href="${safeInviteUrl}" style="background: #2563eb; border-radius: 8px; color: #ffffff; display: inline-block; font-weight: 700; padding: 12px 18px; text-decoration: none;">Responder agora</a></p>
          <p style="font-size: 13px; color: #525252;">Este link é pessoal. Não encaminhe para outras pessoas.</p>
        </div>
      `,
      text: `Olá, ${name}. Sua confirmação para ${eventTitle} ainda está pendente. Data: ${eventDate}.${venueName ? ` Local: ${venueName}.` : ""} Responda em: ${inviteUrl}`,
    },
    { idempotencyKey },
  );

  if (result.error) throw new Error(`RESEND_${resendErrorCode(result.error)}`);
  if (!result.data?.id) throw new Error("RESEND_EMPTY_RESPONSE");
  return result.data.id;
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
