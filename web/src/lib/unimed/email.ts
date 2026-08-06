import { Prisma } from "@/generated/prisma/client";
import nodemailer, { type Transporter } from "nodemailer";
import { applicationTimeZone, periodGreeting } from "@/lib/email/greeting";
import { escapeHtml, formatCpf } from "@/lib/email/html";
import { prisma } from "@/lib/prisma";
import { DEFAULT_UNIMED_EMAIL_SUBJECT } from "@/lib/unimed/defaults";

const DEFAULT_SIGNATURE_URL =
  "https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEi0wOmIf_vL4iasN_lQEurWxAA2-ssiov-epwgZ2iprtRbPuxTypYvHIYlKkcEKS1QK2pLyENS4YOVFgsvp9E28ZJ5FpbLZORKS92b_ssQhkN5MFMBaQamVeV5aB2TdOgYNE083gvfXVBSDmJSx_aBkcAU5AqaWFraEyAD5vqnEOwUcwZfwdcTyjKXy/s320/45ed08d31e851604dcd0ba65ed259804.jpg";

const EMAIL_SEQUENCE_RETENTION_DAYS = 90;

export function buildUnimedEmailSubject(sequence: number) {
  if (sequence <= 1) return DEFAULT_UNIMED_EMAIL_SUBJECT;
  if (sequence <= 21) {
    return `${DEFAULT_UNIMED_EMAIL_SUBJECT}${".".repeat(sequence - 1)}`;
  }
  return `${DEFAULT_UNIMED_EMAIL_SUBJECT} (${sequence})`;
}


function businessDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: applicationTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return new Date(
    `${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`,
  );
}

async function nextDailySequence(tenantId: string, now = new Date()) {
  const day = businessDay(now);
  const retentionBoundary = new Date(
    day.getTime() - EMAIL_SEQUENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  await prisma.unimedEmailDailySequence.deleteMany({
    where: { tenantId, day: { lt: retentionBoundary } },
  });

  const sequence = await prisma.unimedEmailDailySequence.upsert({
    where: { tenantId_day: { tenantId, day } },
    create: { tenantId, day, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });

  return sequence.count;
}

export function buildUnimedEmailHtml(
  name: string,
  cpf: string,
  now = new Date(),
  includeSignature = true,
) {
  const signatureUrl =
    process.env.UNIMED_EMAIL_SIGNATURE_URL?.trim() || DEFAULT_SIGNATURE_URL;
  return `
    <html>
    <body style="font-family: Calibri, Arial, sans-serif; font-size: 12pt;">
      <p>${periodGreeting(now)},</p>
      <p>Segue em anexo.</p>
      <p>
        <strong>Titular:</strong> ${escapeHtml(name)}<br />
        <strong>CPF:</strong> ${escapeHtml(formatCpf(cpf))}
      </p>
      <br /><br />
      <p><strong>Att.</strong><br />
      <strong>Departamento Pessoal</strong></p>
      ${
        includeSignature
          ? `<img src="${escapeHtml(signatureUrl)}" alt="Supermercado Planalto" style="height: 60px;" /><br />`
          : ""
      }
      <p><strong>Supermercado Planalto - Matriz</strong><br />
      Av. Paraná, Nº 5080, Centro, Cep : 87.502-000<br />
      Umuarama - Paraná.<br />
      Fone: (44) 3621-3100</p>
    </body>
    </html>
  `;
}

const EMAIL_PENDING_TIMEOUT_MS = 5 * 60_000;

export class UnimedEmailInProgressError extends Error {
  constructor() {
    super("UNIMED_EMAIL_IN_PROGRESS");
    this.name = "UnimedEmailInProgressError";
  }
}

type SendUnimedEmailInput = {
  accessLevel: "OPERATOR" | "MANAGER" | "ADMIN";
  tenantId: string;
  beneficiaryId: string;
  idempotencyKey: string;
  moduleSessionId: string;
  operatorName: string;
};

type SmtpConfiguration = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromEmail: string;
  fromName: string;
};

type SmtpErrorLike = Error & {
  code?: string;
  command?: string;
  responseCode?: number;
};

let smtpTransporter: Transporter | null = null;
let smtpTransporterKey = "";

function emailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/[\r\n]/.test(value);
}

function smtpConfiguration(): SmtpConfiguration {
  const host = process.env.SMTP_HOST?.trim() || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || "465");
  const secure = (process.env.SMTP_SECURE || "true").toLowerCase() !== "false";
  const user = process.env.SMTP_USER?.trim() || "";
  // Senhas de aplicativo podem ser copiadas em grupos separados por espaços.
  const password = (process.env.SMTP_PASSWORD || "").replace(/\s+/g, "");
  const fromEmail = process.env.SMTP_FROM_EMAIL?.trim() || user;
  const fromName =
    process.env.SMTP_FROM_NAME?.trim() || "Departamento Pessoal";

  if (
    !host ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !user ||
    !password ||
    !emailAddress(user) ||
    !emailAddress(fromEmail) ||
    /[\r\n]/.test(fromName)
  ) {
    throw new Error("SMTP_NOT_CONFIGURED");
  }

  return { host, port, secure, user, password, fromEmail, fromName };
}

function transporterFor(configuration: SmtpConfiguration) {
  const key = JSON.stringify(configuration);
  if (!smtpTransporter || smtpTransporterKey !== key) {
    smtpTransporter = nodemailer.createTransport({
      host: configuration.host,
      port: configuration.port,
      secure: configuration.secure,
      auth: {
        user: configuration.user,
        pass: configuration.password,
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      tls: {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
    });
    smtpTransporterKey = key;
  }
  return smtpTransporter;
}

function smtpFailureCode(error: unknown) {
  const smtpError = error as SmtpErrorLike;
  if (
    smtpError?.code === "EAUTH" ||
    smtpError?.responseCode === 534 ||
    smtpError?.responseCode === 535
  ) {
    return "SMTP_AUTH_ERROR";
  }
  if (
    ["ECONNECTION", "ECONNREFUSED", "EDNS", "ESOCKET", "ETIMEDOUT"].includes(
      smtpError?.code ?? "",
    )
  ) {
    return "SMTP_CONNECTION_ERROR";
  }
  if (
    smtpError?.command === "RCPT TO" ||
    [550, 551, 552, 553, 554].includes(smtpError?.responseCode ?? 0)
  ) {
    return "SMTP_RECIPIENT_ERROR";
  }
  return "UNIMED_EMAIL_DELIVERY_FAILED";
}

function publicFailureCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return [
    "UNIMED_EMAIL_DISABLED",
    "UNIMED_BENEFICIARY_NOT_FOUND",
    "SMTP_NOT_CONFIGURED",
    "SMTP_AUTH_ERROR",
    "SMTP_CONNECTION_ERROR",
    "SMTP_RECIPIENT_ERROR",
  ].includes(code)
    ? code
    : "UNIMED_EMAIL_DELIVERY_FAILED";
}

async function reserveEmailEvent(input: SendUnimedEmailInput) {
  try {
    return {
      state: "RESERVED" as const,
      event: await prisma.unimedEmailEvent.create({
        data: {
          tenantId: input.tenantId,
          moduleSessionId: input.moduleSessionId,
          beneficiaryId: input.beneficiaryId,
          idempotencyKey: input.idempotencyKey,
          status: "PENDING",
          operatorName: input.operatorName,
        },
        select: { id: true, subjectSequence: true },
      }),
    };
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }
  }

  const existing = await prisma.unimedEmailEvent.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    select: {
      id: true,
      beneficiaryId: true,
      recipientCount: true,
      status: true,
      subjectSequence: true,
      updatedAt: true,
    },
  });
  if (!existing || existing.beneficiaryId !== input.beneficiaryId) {
    throw new Error("UNIMED_EMAIL_IDEMPOTENCY_CONFLICT");
  }
  if (existing.status === "SENT") {
    return { state: "SENT" as const, event: existing };
  }

  const staleBefore = new Date(Date.now() - EMAIL_PENDING_TIMEOUT_MS);
  const reclaimed = await prisma.unimedEmailEvent.updateMany({
    where: {
      id: existing.id,
      OR: [
        { status: "FAILED" },
        { status: "PENDING", updatedAt: { lt: staleBefore } },
      ],
    },
    data: {
      attempts: { increment: 1 },
      completedAt: null,
      errorCode: null,
      moduleSessionId: input.moduleSessionId,
      operatorName: input.operatorName,
      status: "PENDING",
    },
  });
  if (reclaimed.count !== 1) throw new UnimedEmailInProgressError();
  return {
    state: "RESERVED" as const,
    event: { id: existing.id, subjectSequence: existing.subjectSequence },
  };
}

export async function sendUnimedExclusionEmail(input: SendUnimedEmailInput) {
  const reservation = await reserveEmailEvent(input);
  if (reservation.state === "SENT") {
    const sequence = reservation.event.subjectSequence ?? 1;
    return {
      idempotent: true,
      recipients: reservation.event.recipientCount ?? 0,
      subject: buildUnimedEmailSubject(sequence),
    };
  }

  const { tenantId, beneficiaryId } = input;
  try {
    const [setting, beneficiary] = await Promise.all([
      prisma.unimedEmailSetting.findUnique({ where: { tenantId } }),
      prisma.unimedBeneficiary.findFirst({
        where: {
          id: beneficiaryId,
          tenantId,
          competency: { status: { in: ["ACTIVE", "PREVIOUS"] } },
        },
        select: { fullName: true, cpf: true },
      }),
    ]);
    if (!setting?.enabled || setting.recipients.length === 0) {
      throw new Error("UNIMED_EMAIL_DISABLED");
    }
    if (!beneficiary?.cpf) {
      throw new Error("UNIMED_BENEFICIARY_NOT_FOUND");
    }

    const smtp = smtpConfiguration();
    const sequence =
      reservation.event.subjectSequence ?? (await nextDailySequence(tenantId));
    if (reservation.event.subjectSequence === null) {
      await prisma.unimedEmailEvent.update({
        where: { id: reservation.event.id },
        data: { subjectSequence: sequence },
      });
    }
    const subject = buildUnimedEmailSubject(sequence);

    try {
      const info = await transporterFor(smtp).sendMail({
        from: { name: smtp.fromName, address: smtp.fromEmail },
        to: setting.recipients,
        subject,
        html: buildUnimedEmailHtml(beneficiary.fullName, beneficiary.cpf),
      });
      if (!info.messageId && (info.accepted?.length ?? 0) === 0) {
        throw new Error("SMTP_NO_ACCEPTED_RECIPIENT");
      }
    } catch (error) {
      console.error("UNIMED_EMAIL_SMTP_REJECTED", {
        code: (error as SmtpErrorLike)?.code ?? null,
        command: (error as SmtpErrorLike)?.command ?? null,
        responseCode: (error as SmtpErrorLike)?.responseCode ?? null,
      });
      throw new Error(smtpFailureCode(error));
    }

    await prisma.$transaction([
      prisma.unimedEmailEvent.update({
        where: { id: reservation.event.id },
        data: {
          completedAt: new Date(),
          errorCode: null,
          recipientCount: setting.recipients.length,
          status: "SENT",
          subjectSequence: sequence,
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "SEND",
          entity: "UnimedEmail",
          entityId: reservation.event.id,
          metadata: {
            accessChannel: "UNIMED_MODULE_PASSWORD",
            accessLevel: input.accessLevel,
            moduleSessionId: input.moduleSessionId,
            operatorName: input.operatorName,
            provider: "SMTP",
            recipientCount: setting.recipients.length,
            status: "SENT",
            subjectSequence: sequence,
          },
        },
      }),
    ]);

    return {
      idempotent: false,
      recipients: setting.recipients.length,
      subject,
    };
  } catch (error) {
    const errorCode = publicFailureCode(error);
    await prisma
      .$transaction([
        prisma.unimedEmailEvent.update({
          where: { id: reservation.event.id },
          data: { completedAt: new Date(), errorCode, status: "FAILED" },
        }),
        prisma.auditLog.create({
          data: {
            action: "SEND_FAILED",
            entity: "UnimedEmail",
            entityId: reservation.event.id,
            metadata: {
              accessChannel: "UNIMED_MODULE_PASSWORD",
              accessLevel: input.accessLevel,
              moduleSessionId: input.moduleSessionId,
              operatorName: input.operatorName,
              provider: "SMTP",
              status: "FAILED",
              errorCode,
            },
          },
        }),
      ])
      .catch(() => undefined);
    throw error;
  }
}
