import { describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectUnauthenticated,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { DELETE, GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(callback: () => Promise<void>) => void>(),
  auth: vi.fn().mockResolvedValue(null),
  deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  findMany: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: mocks.after,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    jornadaValidation: {
      deleteMany: mocks.deleteMany,
      findMany: mocks.findMany,
    },
  },
}));
vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rate-limit")>()),
  checkSharedRateLimit: vi.fn().mockResolvedValue({ limited: false }),
}));

const routePath = "/api/jornada/historico";

describe("/api/jornada/historico route", () => {
  it.each([
    { method: "GET", handler: GET },
    { method: "DELETE", handler: DELETE },
  ])("rejects unauthenticated $method requests", async ({ method, handler }) => {
    await expectUnauthenticated(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
    );
  });

  it.each([
    { method: "POST", handler: POST, allow: "GET, DELETE" },
  ])("returns 405 for unsupported $method requests", async ({ method, handler, allow }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      allow,
    );
  });

  it("serves retained history without waiting for one shared cleanup", async () => {
    const now = Date.UTC(2026, 10, 4, 12);
    const hour = 60 * 60 * 1_000;
    const cutoff = new Date(now - 30 * 24 * hour);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.auth.mockResolvedValue({
      user: { id: "operator-1", role: "OPERATOR", status: "ACTIVE" },
    });
    const history = [{ id: "validation-1" }];
    mocks.findMany.mockResolvedValue(history);
    const read = () => GET(new Request("https://example.test" + routePath));

    try {
      const responses = await Promise.all([read(), read()]);
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        expect(await response.json()).toEqual(history);
      }
      expect(mocks.findMany).toHaveBeenCalledTimes(2);
      expect(mocks.findMany).toHaveBeenCalledWith({
        where: { createdAt: { gte: cutoff }, userId: "operator-1" },
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      expect(mocks.after).toHaveBeenCalledTimes(1);
      expect(mocks.deleteMany).not.toHaveBeenCalled();

      const callback = mocks.after.mock.calls[0]?.[0];
      expect(callback).toBeTypeOf("function");
      await callback?.();
      expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({
        where: { createdAt: { lt: cutoff } },
      });

      clock.mockReturnValue(now + hour - 1);
      expect((await read()).status).toBe(200);
      expect(mocks.after).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(now + hour);
      expect((await read()).status).toBe(200);
      expect(mocks.after).toHaveBeenCalledTimes(2);
      mocks.deleteMany.mockRejectedValueOnce(new Error("private test payload"));
      await mocks.after.mock.calls[1]?.[0]();
      expect(mocks.deleteMany).toHaveBeenCalledTimes(2);
      expect(warning).toHaveBeenCalledExactlyOnceWith(
        "[jornada] history retention cleanup failed",
      );
    } finally {
      warning.mockRestore();
      clock.mockRestore();
      mocks.auth.mockResolvedValue(null);
    }
  });
});
