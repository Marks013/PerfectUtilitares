import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedExcelDevice: {
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  authenticateUnimedExcelDevice,
  createUnimedExcelToken,
} from "@/lib/unimed/excel-device";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Unimed Excel device authentication", () => {
  it("generates a prefixed token and persists only its hash", () => {
    const generated = createUnimedExcelToken();

    expect(generated.token).toMatch(/^pu_unimed_[A-Za-z0-9_-]{40,}$/);
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.tokenHash).not.toContain(generated.token);
    expect(generated.tokenPrefix).toMatch(/^pu_unimed_.+\.\.\.$/);
  });

  it("rejects malformed bearer credentials without querying the database", async () => {
    const result = await authenticateUnimedExcelDevice(
      new Request("http://localhost/api/unimed/excel/v1/snapshot", {
        headers: { authorization: "Bearer invalid" },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("authenticates an active device and records recent use", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "device-1",
      tenantId: "tenant-1",
      label: "Planilha DP",
      lastUsedAt: null,
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const result = await authenticateUnimedExcelDevice(
      new Request("http://localhost/api/unimed/excel/v1/snapshot", {
        headers: { authorization: "Bearer pu_unimed_valid-token" },
      }),
    );

    expect(result).toEqual({
      ok: true,
      deviceId: "device-1",
      tenantId: "tenant-1",
      label: "Planilha DP",
    });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: {
        id: true,
        tenantId: true,
        label: true,
        lastUsedAt: true,
      },
    });
    expect(mocks.updateMany).toHaveBeenCalledOnce();
  });

  it("rejects an expired or revoked token", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const result = await authenticateUnimedExcelDevice(
      new Request("http://localhost/api/unimed/excel/v1/snapshot", {
        headers: { authorization: "Bearer pu_unimed_expired-token" },
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
