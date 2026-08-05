import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { DEFAULT_UNIMED_EMAIL_SUBJECT } from "@/lib/unimed/defaults";

let resendClient: Resend | null = null;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11
    ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
    : value;
}

const EMAIL_TIME_ZONE = "America/Sao_Paulo";
const EMAIL_SEQUENCE_RETENTION_DAYS = 90;

export function buildUnimedEmailSubject(sequence: number) {
  if (sequence <= 1) return DEFAULT_UNIMED_EMAIL_SUBJECT;
  if (sequence <= 21) {
    return `${DEFAULT_UNIMED_EMAIL_SUBJECT}${".".repeat(sequence - 1)}`;
  }
  return `${DEFAULT_UNIMED_EMAIL_SUBJECT} (${sequence})`;
}

function unimedEmailGreeting(now = new Date()) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: process.env.APP_TIME_ZONE || EMAIL_TIME_ZONE,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  if (hour < 12) return "Bom dia";
  if (hour <= 17) return "Boa tarde";
  return "Boa noite";
}

function businessDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIME_ZONE || EMAIL_TIME_ZONE,
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
  return prisma.$transaction(async (transaction) => {
    await transaction.unimedEmailDailySequence.deleteMany({
      where: { tenantId, day: { lt: retentionBoundary } },
    });
    const sequence = await transaction.unimedEmailDailySequence.upsert({
      where: { tenantId_day: { tenantId, day } },
      create: { tenantId, day, count: 1 },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    return sequence.count;
  });
}

export function buildUnimedEmailHtml(
  name: string,
  cpf: string,
  now = new Date(),
) {
  return `
    <html>
    <body style="font-family: Calibri, Arial, sans-serif; font-size: 12pt;">
      <p>${unimedEmailGreeting(now)},</p>
      <p>Segue em anexo.</p>
      <p>
        <strong>Titular:</strong> ${escapeHtml(name)}<br />
        <strong>CPF:</strong> ${escapeHtml(formatCpf(cpf))}
      </p>
      <br /><br />
      <p><strong>Att.</strong><br />
      <strong>Departamento Pessoal</strong></p>
      <img src="cid:planalto-signature" alt="Supermercado Planalto" style="height: 60px;" /><br />
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

function publicFailureCode(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return [
    "UNIMED_EMAIL_DISABLED",
    "UNIMED_BENEFICIARY_NOT_FOUND",
    "RESEND_NOT_CONFIGURED",
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
          competency: { status: "ACTIVE" },
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

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) {
      throw new Error("RESEND_NOT_CONFIGURED");
    }

    const sequence =
      reservation.event.subjectSequence ?? (await nextDailySequence(tenantId));
    if (reservation.event.subjectSequence === null) {
      await prisma.unimedEmailEvent.update({
        where: { id: reservation.event.id },
        data: { subjectSequence: sequence },
      });
    }
    const subject = buildUnimedEmailSubject(sequence);
    const signatureLogo = await readFile(
      path.join(
        process.cwd(),
        "public",
        "assets",
        "unimed-email-signature.jpg",
      ),
    );
    resendClient ??= new Resend(apiKey);
    await resendClient.emails.send(
      {
        from,
        to: setting.recipients,
        subject,
        html: buildUnimedEmailHtml(beneficiary.fullName, beneficiary.cpf),
        attachments: [
          {
            content: signatureLogo,
            contentId: "planalto-signature",
            filename: "assinatura-planalto.jpg",
          },
        ],
      },
      {
        idempotencyKey: createHash("sha256")
          .update(`${tenantId}:${input.idempotencyKey}`)
          .digest("hex"),
      },
    );

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
