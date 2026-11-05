import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectOriginRequired,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  findUser: vi.fn(), createInvitation: vi.fn(), deleteInvitation: vi.fn(), send: vi.fn(),
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
      mocks.findUser.mockReset().mockResolvedValue(user);
      mocks.createInvitation.mockReset().mockResolvedValue({ id: "invitation-1" });
      mocks.deleteInvitation.mockReset().mockResolvedValue({});
      mocks.send.mockReset().mockResolvedValue(undefined);
    });
    afterEach(() => vi.unstubAllEnvs());

    it("creates a tenant-scoped reset token and submits the real route delivery", async () => {
      const response = await POST(request("USER@EXAMPLE.TEST"));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(mocks.findUser).toHaveBeenCalledWith(expect.objectContaining({ where: { email: user.email } }));
      expect(mocks.createInvitation).toHaveBeenCalledWith({ data: expect.objectContaining({ purpose: "PASSWORD_RESET", resetUserId: "user-1", tenantId: "tenant-1", tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), expiresAt: expect.any(Date) }) });
      expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ to: user.email, resetUrl: expect.stringMatching(/^https:\/\/app\.example\.test\/convite\//) }));
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
    it("keeps delivery failure indistinguishable from an unknown account", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        mocks.findUser.mockResolvedValueOnce(null);
        const absent = await POST(request());
        const absentBody = await absent.text();
        mocks.send.mockRejectedValueOnce(new Error("private-user@example.test provider details"));
        const failed = await POST(request());
        expect(failed.status).toBe(absent.status);
        expect(await failed.text()).toBe(absentBody);
        expect(mocks.deleteInvitation).toHaveBeenCalledWith({ where: { id: "invitation-1" } });
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
