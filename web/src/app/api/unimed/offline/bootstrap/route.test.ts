import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  buildBundle: vi.fn(),
  registerDevice: vi.fn(),
  requireUnimedAccess: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/unimed/offline-bundle", () => ({
  buildUnimedOfflineBundle: mocks.buildBundle,
}));

vi.mock("@/lib/unimed/offline-device.server", () => {
  class UnimedOfflineDeviceError extends Error {
    readonly code = "UNIMED_OFFLINE_DEVICE_REVOKED";
  }
  return {
    registerOrRefreshUnimedOfflineDevice: mocks.registerDevice,
    UnimedOfflineDeviceError,
  };
});

import { GET, POST } from "./route";

function request(deviceId = "10000000-0000-4000-8000-000000000001") {
  return new Request("http://localhost/api/unimed/offline/bootstrap", {
    headers: {
      "x-forwarded-for": "127.8.0.1",
      "x-unimed-device-id": deviceId,
      "x-unimed-device-label": "PC Financeiro",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUnimedAccess.mockResolvedValue({
    ok: true,
    accessLevel: "OPERATOR",
    moduleSessionId: "session-1",
    operatorName: "Operador",
    tenantId: "tenant-1",
  });
  mocks.registerDevice.mockResolvedValue({
    deviceKey: "10000000-0000-4000-8000-000000000001",
    label: "PC Financeiro",
    offlineExpiresAt: new Date("2026-08-15T00:00:00.000Z"),
  });
  mocks.buildBundle.mockResolvedValue({
    version: "bundle-v1",
    beneficiaries: [],
  });
});

describe("Unimed offline bootstrap API", () => {
  it("accepts only GET", () => {
    const response = POST();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it("returns a tenant-scoped bundle for a registered device", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.registerDevice).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceKey: "10000000-0000-4000-8000-000000000001",
        label: "PC Financeiro",
        operatorName: "Operador",
        tenantId: "tenant-1",
      }),
    );
    expect(mocks.buildBundle).toHaveBeenCalledWith(
      "tenant-1",
      new Date("2026-08-15T00:00:00.000Z"),
    );
    await expect(response.json()).resolves.toMatchObject({
      bundle: { version: "bundle-v1" },
      device: { label: "PC Financeiro" },
    });
  });

  it("rejects an invalid device identifier before reading data", async () => {
    const response = await GET(request("not-a-uuid"));
    expect(response.status).toBe(400);
    expect(mocks.registerDevice).not.toHaveBeenCalled();
    expect(mocks.buildBundle).not.toHaveBeenCalled();
  });
});
