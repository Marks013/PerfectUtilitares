import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
  findUnique: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("@/lib/api/security", () => ({
  enforcePersistentRateLimit: mocks.limit,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { presenceGuest: { findUnique: mocks.findUnique } },
}));
vi.mock("@/lib/presence/access", () => ({
  createPresenceSessionForGuest: mocks.createSession,
}));
vi.mock("@/lib/presence/tokens", () => ({
  getPresenceCookieOptions: () => ({ httpOnly: true, path: "/" }),
  hashPresenceSecret: () => "short-code-hash",
}));

import { GET } from "./route";

describe("presence short invitation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.limit.mockResolvedValue(null);
  });

  it("creates a session and redirects without exposing the invitation token", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "guest-1",
      guestSlug: "ana",
      accessVersion: 1,
      accessExpiresAt: new Date("2099-01-01T00:00:00Z"),
      tokenRevokedAt: null,
      event: { eventSlug: "casamento", status: "PUBLISHED" },
    });
    mocks.createSession.mockResolvedValue({
      cookieName: "pu-presence-test",
      sessionToken: `s_${"s".repeat(43)}`,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });

    const response = await GET(
      new Request("https://example.test/p/p_abcdefghijklmnop"),
      { params: Promise.resolve({ code: "p_abcdefghijklmnop" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.test/presenca/casamento/ana",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("does not disclose whether a malformed code exists", async () => {
    const response = await GET(
      new Request("https://example.test/p/invalido"),
      { params: Promise.resolve({ code: "invalido" }) },
    );

    expect(response.status).toBe(307);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
