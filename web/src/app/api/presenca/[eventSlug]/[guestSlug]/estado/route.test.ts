import { beforeEach, describe, expect, it, vi } from "vitest";
const { resolvePresenceSessionMock, readPresenceStateMock } = vi.hoisted(() => ({
  resolvePresenceSessionMock: vi.fn(),
  readPresenceStateMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/presence/session", () => ({
  resolvePresenceSession: resolvePresenceSessionMock,
}));
vi.mock("@/lib/presence/state", () => ({
  readPresenceState: readPresenceStateMock,
}));
vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/rate-limit")>()),
  checkRateLimit: vi.fn(() => ({
    limited: false,
    remaining: 29,
    resetAt: Date.now() + 60_000,
  })),
}));

import { GET } from "./route";

const params = Promise.resolve({
  eventSlug: "casamento-ana-e-joao",
  guestSlug: "maico-rafael",
});

describe("presence state route", () => {
  beforeEach(() => {
    resolvePresenceSessionMock.mockReset();
    readPresenceStateMock.mockReset();
  });

  it("returns only the invited guest state and sanitized gifts", async () => {
    resolvePresenceSessionMock.mockResolvedValue({
      sessionId: "session-1",
      eventId: "event-1",
      guestId: "guest-1",
    });
    readPresenceStateMock.mockResolvedValue({
      revision: 3,
      event: { title: "Ana e João" },
      guest: { name: "Maico", rsvpStatus: "PENDING" },
      gifts: [{ id: "gift-1", title: "Jogo de copos", reserved: false }],
    });

    const response = await GET(
      new Request(
        "http://localhost/api/presenca/casamento-ana-e-joao/maico-rafael/estado",
      ),
      { params },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('W/"presence-3"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      guest: { name: "Maico" },
      gifts: [{ reserved: false }],
    });
  });

  it("returns 404 when the guest session is missing", async () => {
    resolvePresenceSessionMock.mockResolvedValue(null);
    const response = await GET(
      new Request(
        "http://localhost/api/presenca/casamento-ana-e-joao/maico-rafael/estado",
      ),
      { params },
    );
    expect(response.status).toBe(404);
  });
});
