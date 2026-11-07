import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectOriginRequired,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), send: vi.fn(), enqueue: vi.fn(),
}));
vi.mock("@/lib/auth/password-recovery", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth/password-recovery")>(),
  enqueuePasswordRecovery: mocks.enqueue,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $queryRaw: vi.fn(async () => [{ count: 1, resetAt: new Date(Date.now() + 60_000) }]),
  user: { findUnique: mocks.findUser },
  userInvitation: { create: mocks.createInvitation, delete: mocks.deleteInvitation },
} }));
vi.mock("@/lib/email/resend", () => ({
  getAppUrl: () => "https://app.example.test", sendPasswordResetEmail: mocks.send,
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
}));

const routePath = "/api/password-reset/request";

describe("/api/password-reset/request route", () => {
  describe("delivery privacy and success", () => {
    const user = { id: "user-1", tenantId: "tenant-1", email: "user@example.test", name: "User", role: "USER", status: "ACTIVE", passwordHash: "hash", securityVersion: 1 };
    const request = (email = "user@example.test") => new Request(`https://app.example.test${routePath}`, {
      method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    beforeEach(() => {
      vi.stubEnv("RESEND_API_KEY", "test-key");
      vi.stubEnv("RESEND_FROM_EMAIL", "sender@example.test");
      vi.stubEnv("APP_URL", "https://app.example.test");
      mocks.enqueue.mockReset().mockResolvedValue(undefined);
      mocks.findUser.mockReset().mockResolvedValue(user);
      mocks.createInvitation.mockReset().mockResolvedValue({ id: "invitation-1" });
      mocks.deleteInvitation.mockReset().mockResolvedValue({});
      mocks.send.mockReset().mockResolvedValue(undefined);
    });
    afterEach(() => vi.unstubAllEnvs());

    it("enqueues a tenant-scoped reset without creating tokens or waiting for email", async () => {
      const response = await POST(request("USER@EXAMPLE.TEST"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(mocks.findUser).toHaveBeenCalledWith(expect.objectContaining({ where: { email: user.email } }));
      expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ userId: user.id, tenantId: user.tenantId,
        resetStamp: expect.stringMatching(/^[a-f0-9]{64}$/), securityVersion: 1 }));
      expect(JSON.stringify(mocks.enqueue.mock.calls)).not.toContain(user.email);
      expect(mocks.createInvitation).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.deleteInvitation).not.toHaveBeenCalled();
    });

    it.each(["not-an-email", `${"a".repeat(254)}@example.test`])(
      "keeps invalid reset addresses private and does not create a token",
      async (email) => {
        const response = await POST(request(email));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(mocks.findUser).not.toHaveBeenCalled();
        expect(mocks.createInvitation).not.toHaveBeenCalled();
      },
    );
    it("performs the same enqueue path for unknown and inactive accounts", async () => {
      for (const found of [null, { ...user, status: "BLOCKED" }]) {
        mocks.findUser.mockResolvedValueOnce(found);
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        expect(mocks.enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ userId: null, tenantId: null, resetStamp: null, securityVersion: null }));
      }
      expect(mocks.send).not.toHaveBeenCalled();
    });

    it("returns honest uniform unavailability before lookup when provider is missing", async () => {
      vi.stubEnv("RESEND_API_KEY", "");
      const response = await POST(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "RECOVERY_UNAVAILABLE" } });
      expect(mocks.findUser).not.toHaveBeenCalled();
      expect(mocks.createInvitation).not.toHaveBeenCalled();
      expect(mocks.enqueue).not.toHaveBeenCalled();
    });

    it("reports queue failure without exposing account or provider details", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        mocks.enqueue.mockRejectedValueOnce(new Error("private-user@example.test provider details"));
        const failed = await POST(request());
        expect(failed.status).toBe(503);
        expect(await failed.text()).not.toContain(user.email);
        expect(JSON.stringify(log.mock.calls)).not.toContain("private-user@example.test");
      } finally { log.mockRestore(); }
    });
  });

  it("rejects POST requests without a trusted origin", async () => {
    await expectOriginRequired(
      POST as unknown as TestRouteHandler,
      "POST",
      routePath,
    );
  });

  it.each([
    { method: "GET", handler: GET, allow: "POST" },
  ])("returns 405 for unsupported $method requests", async ({ method, handler, allow }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      allow,
    );
  });
});
