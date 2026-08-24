import { createHmac } from "node:crypto";
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
    reajusteSalarialSession: {
      findMany: mocks.sessionFindMany,
      findFirst: mocks.sessionFindFirst,
      updateMany: mocks.sessionUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  createReajusteModuleSession,
  decodeReajusteSessionCookie,
  encodeReajusteSessionCookie,
  revokeReajusteModuleSessionCookie,
  verifyReajusteModuleSessionCookie,
} from "./access-session";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REAJUSTE_ACCESS_COOKIE_SECRET = "r".repeat(48);
  process.env.REAJUSTE_ACCESS_SESSION_TTL_MINUTES = "60";
  process.env.DEFAULT_TENANT_SLUG = "principal";
  mocks.tenantFindUnique.mockResolvedValue({ id: "tenant-1" });
  mocks.sessionFindMany.mockResolvedValue([]);
  mocks.sessionDeleteMany.mockResolvedValue({ count: 0 });
  mocks.sessionCreate.mockResolvedValue({ id: "session-1" });
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      reajusteSalarialSession: {
        deleteMany: mocks.sessionDeleteMany,
        create: mocks.sessionCreate,
      },
      auditLog: { create: mocks.auditCreate },
    }),
  );
});

describe("salary adjustment module session", () => {
  it("uses a module-bound signature that rejects an Unimed cookie", () => {
    const token = "a".repeat(43);
    const value = encodeReajusteSessionCookie(token);
    const unimedSignature = createHmac(
      "sha256",
      process.env.REAJUSTE_ACCESS_COOKIE_SECRET ?? "",
    )
      .update(token)
      .digest("base64url");

    expect(decodeReajusteSessionCookie(value)).toBe(token);
    expect(
      decodeReajusteSessionCookie(`${token}.${unimedSignature}`),
    ).toBeNull();
  });

  it("stores the session only in the dedicated Reajuste table", async () => {
    const created = await createReajusteModuleSession();

    expect(created.role).toBe("STANDARD");
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 19, take: 1_000 }),
    );
    expect(mocks.sessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        operatorName: "Dp Planalto",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      select: { id: true },
    });
  });

  it("accepts only an active dedicated database session", async () => {
    mocks.sessionFindFirst.mockResolvedValue({
      id: "session-1",
      tenantId: "tenant-1",
      operatorName: "Dp Planalto",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      verifyReajusteModuleSessionCookie(
        encodeReajusteSessionCookie("b".repeat(43)),
      ),
    ).resolves.toMatchObject({ role: "STANDARD", tenantId: "tenant-1" });
  });

  it("revokes only the matching dedicated session", async () => {
    await revokeReajusteModuleSessionCookie(
      encodeReajusteSessionCookie("c".repeat(43)),
    );
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
