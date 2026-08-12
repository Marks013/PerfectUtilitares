import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveSessionMock, reserveGiftMock, releaseGiftMock } = vi.hoisted(
  () => ({
    resolveSessionMock: vi.fn(),
    reserveGiftMock: vi.fn(),
    releaseGiftMock: vi.fn(),
  }),
);

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/api/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/security")>()),
  enforcePersistentRateLimit: vi.fn(async () => null),
}));
vi.mock("@/lib/presence/session", () => ({
  resolvePresenceSession: resolveSessionMock,
}));
vi.mock("@/lib/presence/mutations", () => ({
  reservePresenceGift: reserveGiftMock,
  releasePresenceGift: releaseGiftMock,
}));

import { DELETE, POST } from "./route";

const context = {
  params: Promise.resolve({
    eventSlug: "casamento-ana-e-joao",
    guestSlug: "maico-rafael",
    giftId: "cm12345678901234567890123",
  }),
};

describe("presence gift reservation route", () => {
  beforeEach(() => {
    resolveSessionMock.mockReset();
    reserveGiftMock.mockReset();
    releaseGiftMock.mockReset();
    resolveSessionMock.mockResolvedValue({
      eventId: "event-1",
      guestId: "guest-1",
    });
  });

  it("reserves an available gift", async () => {
    reserveGiftMock.mockResolvedValue({
      ok: true,
      value: { revision: 5 },
    });
    const response = await POST(
      new Request("http://localhost/api/presenca/evento/presente/reserva", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
      context,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revision: 5 });
  });

  it("returns a conflict when another guest reserved the gift", async () => {
    reserveGiftMock.mockResolvedValue({ ok: false, code: "CONFLICT" });
    const response = await POST(
      new Request("http://localhost/api/presenca/evento/presente/reserva", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
      context,
    );
    expect(response.status).toBe(409);
  });

  it("releases the current guest gift", async () => {
    releaseGiftMock.mockResolvedValue({
      ok: true,
      value: { revision: 6 },
    });
    const response = await DELETE(
      new Request("http://localhost/api/presenca/evento/presente/reserva", {
        method: "DELETE",
        headers: { origin: "http://localhost" },
      }),
      context,
    );
    expect(response.status).toBe(200);
  });
});
