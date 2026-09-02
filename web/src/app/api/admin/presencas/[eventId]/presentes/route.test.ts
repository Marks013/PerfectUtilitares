import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    presenceGift: { aggregate: vi.fn(), create: vi.fn() },
    presenceActivity: { create: vi.fn() },
    presenceEvent: { update: vi.fn() },
  };
  const prisma = {
    presenceEvent: { findFirst: vi.fn(), update: vi.fn() },
    presenceGiftCategory: { findFirst: vi.fn() },
    presenceGuest: { findFirst: vi.fn() },
    presenceGift: { count: vi.fn(), update: vi.fn() },
    presenceActivity: { create: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma, transaction, auth: vi.fn() };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/api/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/security")>()),
  enforcePersistentRateLimit: vi.fn(async () => null),
}));

import { PATCH, POST } from "./route";

const context = { params: Promise.resolve({ eventId: "cm00000000000000000000001" }) };
const request = (method: "POST" | "PATCH", body: unknown) =>
  new Request("http://localhost/api/admin/presencas/event/presentes", {
    method,
    headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify(body),
  });

describe("admin presence gifts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: {
        id: "admin-1",
        tenantId: "tenant-1",
        role: "ADMIN",
        status: "ACTIVE",
      },
      expires: "2026-09-01T00:00:00.000Z",
    });
    mocks.prisma.presenceEvent.findFirst.mockResolvedValue({ id: "cm00000000000000000000001" });
    mocks.transaction.presenceGift.aggregate.mockResolvedValue({ _max: { position: 4 } });
    mocks.transaction.presenceGift.create.mockResolvedValue({
      id: "cm00000000000000000000002",
      categoryId: null,
      emoji: "🎁",
      title: "Jogo de taças",
      description: null,
      externalUrl: null,
      position: 5,
      active: true,
      reservedManually: false,
      reservedAt: null,
    });
    mocks.prisma.$transaction.mockImplementation(async (callback: unknown) =>
      typeof callback === "function"
        ? callback(mocks.transaction)
        : Promise.resolve([]),
    );
  });

  it("creates the gift, activity and revision in one transaction", async () => {
    const response = await POST(
      request("POST", { emoji: "🍷", title: "Jogo de taças", active: true }),
      context,
    );

    expect(response.status).toBe(201);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction.presenceActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "CREATE" }) }),
    );
    expect(mocks.transaction.presenceEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { publicRevision: { increment: 1 } } }),
    );
  });

  it("rejects partial ordering lists", async () => {
    mocks.prisma.presenceGift.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);

    const response = await PATCH(
      request("PATCH", { orderedIds: ["cm00000000000000000000002"] }),
      context,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_GIFT_ORDER" },
    });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
