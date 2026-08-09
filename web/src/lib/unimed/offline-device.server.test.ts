import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedOfflineDevice: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

import {
  registerOrRefreshUnimedOfflineDevice,
  UnimedOfflineDeviceError,
} from "@/lib/unimed/offline-device.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(null);
  mocks.upsert.mockImplementation(({ create }) =>
    Promise.resolve({
      deviceKey: create.deviceKey,
      label: create.label,
      offlineExpiresAt: create.offlineExpiresAt,
    }),
  );
});

describe("Unimed offline device registration", () => {
  it("sanitizes the label and stores only a user-agent hash", async () => {
    const device = await registerOrRefreshUnimedOfflineDevice({
      deviceKey: "10000000-0000-4000-8000-000000000001",
      label: "  PC\u0000 Financeiro  ",
      operatorName: "Operador",
      tenantId: "tenant-1",
      userAgent: "secret-user-agent",
    });

    expect(device.label).toBe("PC Financeiro");
    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          label: "PC Financeiro",
          userAgentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(JSON.stringify(mocks.upsert.mock.calls)).not.toContain(
      "secret-user-agent",
    );
  });

  it("does not reactivate a revoked device", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "device-1",
      revokedAt: new Date(),
    });

    await expect(
      registerOrRefreshUnimedOfflineDevice({
        deviceKey: "10000000-0000-4000-8000-000000000001",
        label: "PC",
        operatorName: "Operador",
        tenantId: "tenant-1",
        userAgent: null,
      }),
    ).rejects.toBeInstanceOf(UnimedOfflineDeviceError);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
