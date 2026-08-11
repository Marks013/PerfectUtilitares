import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  requireUnimedAccess: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedExcelDevice: {
      findMany: mocks.findMany,
      count: mocks.count,
      create: mocks.create,
    },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

import { GET, POST } from "@/app/api/unimed/excel/devices/route";

const device = {
  id: "device-1",
  tenantId: "tenant-1",
  tokenHash: "hidden",
  tokenPrefix: "pu_unimed_12345678...",
  label: "Planilha DP",
  createdBy: "session-1",
  expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  revokedAt: null,
  lastUsedAt: null,
  createdAt: new Date("2026-08-11T12:00:00.000Z"),
  updatedAt: new Date("2026-08-11T12:00:00.000Z"),
};

function accessOk() {
  return {
    ok: true,
    tenantId: "tenant-1",
    moduleSessionId: "session-1",
    accessLevel: "MANAGER",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUnimedAccess.mockResolvedValue(accessOk());
  mocks.findMany.mockResolvedValue([device]);
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue(device);
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      unimedExcelDevice: { create: mocks.create },
      auditLog: { create: mocks.auditCreate },
    }),
  );
});

describe("Unimed Excel devices API", () => {
  it("lists devices without returning token hashes", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.devices[0]).toMatchObject({
      id: "device-1",
      label: "Planilha DP",
      tokenPrefix: "pu_unimed_12345678...",
    });
    expect(JSON.stringify(body)).not.toContain("hidden");
  });

  it("creates a read-only token and returns it only in the creation response", async () => {
    const response = await POST(
      new Request("http://localhost/api/unimed/excel/devices", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
          "x-forwarded-for": "127.2.0.1",
        },
        body: JSON.stringify({ label: "Planilha DP", expiresInDays: 90 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.token).toMatch(/^pu_unimed_[A-Za-z0-9_-]{40,}$/);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        label: "Planilha DP",
        createdBy: "session-1",
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    });
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin creation before accessing the module", async () => {
    const response = await POST(
      new Request("http://localhost/api/unimed/excel/devices", {
        method: "POST",
        headers: {
          origin: "https://attacker.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ label: "Planilha DP", expiresInDays: 90 }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
