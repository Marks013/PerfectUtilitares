import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionDeleteMany: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    unimedModuleSession: {
      findMany: mocks.sessionFindMany,
      findFirst: mocks.sessionFindFirst,
      deleteMany: mocks.sessionDeleteMany,
      create: mocks.sessionCreate,
      updateMany: mocks.sessionUpdateMany,
    },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

import {
  createUnimedModuleSession,
  decodeUnimedSessionCookie,
  encodeUnimedSessionCookie,
  revokeUnimedModuleSessionCookie,
  verifyUnimedModuleSessionCookie,
} from "@/lib/unimed/module-session";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.UNIMED_ACCESS_COOKIE_SECRET = "x".repeat(48);
  process.env.UNIMED_ACCESS_SESSION_TTL_MINUTES = "60";
  process.env.DEFAULT_TENANT_SLUG = "principal";
  mocks.tenantFindUnique.mockResolvedValue({ id: "tenant-1" });
  mocks.sessionFindMany.mockResolvedValue([]);
  mocks.sessionDeleteMany.mockReturnValue(Promise.resolve({ count: 0 }));
  mocks.sessionCreate.mockReturnValue(Promise.resolve({ id: "session-1" }));
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(
    async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        unimedModuleSession: {
          deleteMany: mocks.sessionDeleteMany,
          create: mocks.sessionCreate,
        },
        auditLog: { create: mocks.auditCreate },
      }),
  );
});

describe("Unimed module session", () => {
  it("signs the opaque cookie and rejects tampering", () => {
    const token = "a".repeat(43);
    const value = encodeUnimedSessionCookie(token);
    expect(decodeUnimedSessionCookie(value)).toBe(token);
    expect(decodeUnimedSessionCookie(`${value}x`)).toBeNull();
    expect(value).not.toContain("STANDARD");
    expect(value).not.toContain("ADMIN");
  });

  it("stores only a token hash and performs bounded cleanup", async () => {
    mocks.sessionFindMany.mockResolvedValue([{ id: "excess-1" }]);
    const created = await createUnimedModuleSession("ADMIN", "Operador Teste");

    expect(created.role).toBe("ADMIN");
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 19, take: 1_000 }),
    );
    expect(mocks.sessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        level: "ADMIN",
        operatorName: "Operador Teste",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      select: { id: true },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it("accepts only an active non-revoked database session", async () => {
    mocks.sessionFindFirst.mockResolvedValue({
      id: "session-1",
      tenantId: "tenant-1",
      level: "OPERATOR",
      operatorName: "Operador Teste",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const value = encodeUnimedSessionCookie("b".repeat(43));
    await expect(verifyUnimedModuleSessionCookie(value)).resolves.toMatchObject(
      {
        role: "STANDARD",
        tenantId: "tenant-1",
      },
    );
    expect(mocks.sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revokedAt: null }),
      }),
    );
  });

  it("revokes the server-side session using its token hash", async () => {
    const value = encodeUnimedSessionCookie("c".repeat(43));
    await revokeUnimedModuleSessionCookie(value);
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
