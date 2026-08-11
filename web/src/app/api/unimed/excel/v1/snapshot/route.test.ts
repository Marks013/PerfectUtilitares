import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  createSnapshot: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/unimed/excel-device", () => ({
  authenticateUnimedExcelDevice: mocks.authenticate,
}));

vi.mock("@/lib/unimed/excel-snapshot", () => ({
  createUnimedExcelSnapshot: mocks.createSnapshot,
}));

import { GET, POST } from "@/app/api/unimed/excel/v1/snapshot/route";

const snapshot = {
  schemaVersion: 1,
  branches: [],
  competencies: [{ year: 2026, month: 8, beneficiaries: [] }],
  configuration: { priceHistory: [] },
  snapshotVersion: "abc123",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    ok: true,
    deviceId: "device-1",
    tenantId: "tenant-1",
    label: "Planilha DP",
  });
  mocks.createSnapshot.mockResolvedValue(snapshot);
});

describe("Unimed Excel snapshot API", () => {
  it("returns a versioned private snapshot for an authorized device", async () => {
    const response = await GET(
      new Request("http://localhost/api/unimed/excel/v1/snapshot", {
        headers: {
          authorization: "Bearer pu_unimed_test",
          "x-forwarded-for": "127.2.0.3",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"abc123"');
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=0, must-revalidate",
    );
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(mocks.createSnapshot).toHaveBeenCalledWith("tenant-1");
  });

  it("returns 304 when the local cache is current", async () => {
    const response = await GET(
      new Request("http://localhost/api/unimed/excel/v1/snapshot", {
        headers: {
          authorization: "Bearer pu_unimed_test",
          "if-none-match": '"abc123"',
          "x-forwarded-for": "127.2.0.4",
        },
      }),
    );

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"abc123"');
  });

  it("rejects writes", () => {
    const response = POST();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});
