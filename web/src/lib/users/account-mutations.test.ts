import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  findUnique: vi.fn(),
  count: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  findPdfJobs: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import {
  deleteAccountWithAdminInvariant,
  updateUserWithAdminInvariant,
} from "@/lib/users/account-mutations";

const transactionClient = {
  $queryRaw: mocks.queryRaw,
  user: {
    findUnique: mocks.findUnique,
    count: mocks.count,
    update: mocks.update,
    delete: mocks.delete,
  },
  pdfJob: {
    findMany: mocks.findPdfJobs,
  },
  auditLog: {
    create: mocks.createAuditLog,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(
    async (callback: (transaction: typeof transactionClient) => unknown) =>
      callback(transactionClient),
  );
  mocks.queryRaw.mockResolvedValue([]);
  mocks.findPdfJobs.mockResolvedValue([]);
  mocks.createAuditLog.mockResolvedValue({ id: "audit-1" });
});

describe("active administrator invariant", () => {
  it("blocks demoting the last active administrator", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      status: "ACTIVE",
    });
    mocks.count.mockResolvedValue(1);

    const result = await updateUserWithAdminInvariant({
      targetUserId: "admin-1",
      actorUserId: "admin-2",
      data: { role: "OPERATOR" },
    });

    expect(result).toEqual({ ok: false, reason: "LAST_ACTIVE_ADMIN" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("updates an administrator when another active administrator remains", async () => {
    const updatedUser = {
      id: "admin-1",
      tenantId: null,
      tenant: null,
      email: "admin@example.com",
      name: "Admin",
      role: "OPERATOR",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    mocks.findUnique.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      status: "ACTIVE",
    });
    mocks.count.mockResolvedValue(2);
    mocks.update.mockResolvedValue(updatedUser);

    const result = await updateUserWithAdminInvariant({
      targetUserId: "admin-1",
      actorUserId: "admin-2",
      data: { role: "OPERATOR" },
    });

    expect(result).toEqual({ ok: true, user: updatedUser });
    expect(mocks.createAuditLog).toHaveBeenCalledOnce();
  });

  it("blocks deleting the last active administrator", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      tenantId: null,
      role: "ADMIN",
      status: "ACTIVE",
    });
    mocks.count.mockResolvedValue(1);

    const result = await deleteAccountWithAdminInvariant({
      targetUserId: "admin-1",
      actorUserId: "admin-1",
      action: "SELF_DELETE",
    });

    expect(result).toEqual({ ok: false, reason: "LAST_ACTIVE_ADMIN" });
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("deletes a regular user and returns PDF jobs for disk cleanup", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      tenantId: "tenant-1",
      role: "OPERATOR",
      status: "ACTIVE",
    });
    mocks.findPdfJobs.mockResolvedValue([{ id: "pdf-1" }, { id: "pdf-2" }]);
    mocks.delete.mockResolvedValue({ id: "user-1" });

    const result = await deleteAccountWithAdminInvariant({
      targetUserId: "user-1",
      actorUserId: "admin-1",
      action: "DELETE",
    });

    expect(result).toMatchObject({
      ok: true,
      pdfJobIds: ["pdf-1", "pdf-2"],
    });
    expect(mocks.createAuditLog).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledOnce();
  });
});
