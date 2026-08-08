import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  beneficiaryFind: vi.fn(),
  createTransport: vi.fn(),
  eventCreate: vi.fn(),
  eventFind: vi.fn(),
  eventUpdate: vi.fn(),
  eventUpdateMany: vi.fn(),
  sendMail: vi.fn(),
  sequenceDelete: vi.fn(),
  sequenceUpsert: vi.fn(),
  settingFind: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: mocks.createTransport },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    auditLog: { create: mocks.auditCreate },
    unimedBeneficiary: { findFirst: mocks.beneficiaryFind },
    unimedEmailDailySequence: {
      deleteMany: mocks.sequenceDelete,
      upsert: mocks.sequenceUpsert,
    },
    unimedEmailEvent: {
      create: mocks.eventCreate,
      findUnique: mocks.eventFind,
      update: mocks.eventUpdate,
      updateMany: mocks.eventUpdateMany,
    },
    unimedEmailSetting: { findUnique: mocks.settingFind },
  },
}));

import { sendUnimedExclusionEmail } from "./email";

const input = {
  accessLevel: "ADMIN" as const,
  tenantId: "tenant-1",
  beneficiaryId: "beneficiary-1",
  idempotencyKey: "request-1",
  moduleSessionId: "session-1",
  operatorName: "Operador",
};

describe("Unimed SMTP delivery workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "true";
    process.env.SMTP_USER = "sender@example.test";
    process.env.SMTP_PASSWORD = "app password";
    process.env.SMTP_FROM_EMAIL = "sender@example.test";
    process.env.SMTP_FROM_NAME = "Departamento Pessoal";

    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
    mocks.eventCreate.mockResolvedValue({
      id: "event-1",
      subjectSequence: null,
    });
    mocks.settingFind.mockResolvedValue({
      enabled: true,
      recipients: ["recipient@example.test"],
    });
    mocks.beneficiaryFind.mockResolvedValue({
      fullName: "Pessoa Teste",
      cpf: "12345678901",
    });
    mocks.sequenceDelete.mockResolvedValue({ count: 0 });
    mocks.sequenceUpsert.mockResolvedValue({ count: 1 });
    mocks.eventUpdate.mockResolvedValue({ id: "event-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    mocks.transaction.mockImplementation((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
    mocks.sendMail.mockResolvedValue({
      accepted: ["recipient@example.test"],
      messageId: "message-1",
    });
  });

  it("reserves, sequences, sends and atomically marks the event as sent", async () => {
    await expect(sendUnimedExclusionEmail(input)).resolves.toEqual({
      idempotent: false,
      recipients: 1,
      subject: "Solicitação de Coparticipação",
    });

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.test",
        port: 465,
        secure: true,
        auth: {
          user: "sender@example.test",
          pass: "apppassword",
        },
        tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
      }),
    );
    expect(mocks.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["recipient@example.test"],
        subject: "Solicitação de Coparticipação",
      }),
    );
    expect(mocks.transaction).toHaveBeenCalled();
    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SENT", subjectSequence: 1 }),
      }),
    );
  });

  it("persists a safe public failure when e-mail is disabled", async () => {
    mocks.settingFind.mockResolvedValueOnce({
      enabled: false,
      recipients: [],
    });

    await expect(sendUnimedExclusionEmail(input)).rejects.toThrow(
      "UNIMED_EMAIL_DISABLED",
    );
    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorCode: "UNIMED_EMAIL_DISABLED",
          status: "FAILED",
        }),
      }),
    );
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("classifies SMTP authentication errors without exposing credentials", async () => {
    mocks.sendMail.mockRejectedValueOnce(
      Object.assign(new Error("authentication failed"), { code: "EAUTH" }),
    );

    await expect(sendUnimedExclusionEmail(input)).rejects.toThrow(
      "SMTP_AUTH_ERROR",
    );
    expect(mocks.eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorCode: "SMTP_AUTH_ERROR",
          status: "FAILED",
        }),
      }),
    );
  });

  it("rejects incomplete SMTP configuration before network access", async () => {
    delete process.env.SMTP_USER;

    await expect(sendUnimedExclusionEmail(input)).rejects.toThrow(
      "SMTP_NOT_CONFIGURED",
    );
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });
});
