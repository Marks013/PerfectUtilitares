import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  requireUnimedAccess: vi.fn(),
  updateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

import { DELETE } from "@/app/api/unimed/excel/devices/[id]/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUnimedAccess.mockResolvedValue({
    ok: true,
    tenantId: "tenant-1",
    moduleSessionId: "session-1",
    accessLevel: "MANAGER",
  });
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      unimedExcelDevice: { updateMany: mocks.updateMany },
      auditLog: { create: mocks.auditCreate },
    }),
  );
});

describe("Unimed Excel device revoke API", () => {
  it("revokes only a device from the current tenant", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/unimed/excel/devices/device-1", {
        method: "DELETE",
        headers: { origin: "http://localhost", "x-forwarded-for": "127.2.0.2" },
      }),
      { params: Promise.resolve({ id: "device-1" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: true });
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "device-1", tenantId: "tenant-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
  });
});
