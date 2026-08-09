import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  requireUnimedAccess: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedOfflineDevice: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

import { DELETE, GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUnimedAccess.mockResolvedValue({
    ok: true,
    tenantId: "tenant-1",
    accessLevel: "ADMIN",
  });
  mocks.findMany.mockResolvedValue([
    {
      deviceKey: "10000000-0000-4000-8000-000000000001",
      label: "PC Financeiro",
    },
  ]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("Unimed offline devices API", () => {
  it("accepts only GET and DELETE", () => {
    const response = POST();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, DELETE");
  });

  it("lists only devices from the active tenant", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-1" } }),
    );
    await expect(response.json()).resolves.toMatchObject({
      devices: [{ label: "PC Financeiro" }],
    });
  });

  it("revokes one tenant-scoped device", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/unimed/offline/devices", {
        method: "DELETE",
        headers: { origin: "http://localhost" },
        body: JSON.stringify({
          deviceKey: "10000000-0000-4000-8000-000000000001",
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-1" }),
      }),
    );
    await expect(response.json()).resolves.toEqual({ revoked: true });
  });
});
