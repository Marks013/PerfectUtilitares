import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolvePresenceSessionMock, updateConfirmationMock } = vi.hoisted(
  () => ({
    resolvePresenceSessionMock: vi.fn(),
    updateConfirmationMock: vi.fn(),
  }),
);

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/api/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/security")>()),
  enforcePersistentRateLimit: vi.fn(async () => null),
}));
vi.mock("@/lib/presence/session", () => ({
  resolvePresenceSession: resolvePresenceSessionMock,
}));
vi.mock("@/lib/presence/mutations", () => ({
  updatePresenceConfirmation: updateConfirmationMock,
}));

import { PATCH } from "./route";

const context = {
  params: Promise.resolve({
    eventSlug: "casamento-ana-e-joao",
    guestSlug: "maico-rafael",
  }),
};

describe("presence confirmation route", () => {
  beforeEach(() => {
    resolvePresenceSessionMock.mockReset();
    updateConfirmationMock.mockReset();
  });

  it("updates the invited guest confirmation", async () => {
    resolvePresenceSessionMock.mockResolvedValue({
      eventId: "event-1",
      guestId: "guest-1",
    });
    updateConfirmationMock.mockResolvedValue({
      ok: true,
      value: {
        revision: 4,
        rsvpStatus: "CONFIRMED",
        adultCount: 2,
        childCount: 1,
      },
    });
    const response = await PATCH(
      new Request("http://localhost/api/presenca/evento/convidado/confirmacao", {
        method: "PATCH",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "CONFIRMED", adultCount: 2, childCount: 1 }),
      }),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      revision: 4,
      rsvpStatus: "CONFIRMED",
      adultCount: 2,
      childCount: 1,
    });
    expect(updateConfirmationMock).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-1", guestId: "guest-1" }),
      { status: "CONFIRMED", adultCount: 2, childCount: 1 },
    );
  });

  it("reports a closed confirmation period", async () => {
    resolvePresenceSessionMock.mockResolvedValue({
      eventId: "event-1",
      guestId: "guest-1",
    });
    updateConfirmationMock.mockResolvedValue({ ok: false, code: "CLOSED" });
    const response = await PATCH(
      new Request("http://localhost/api/presenca/evento/convidado/confirmacao", {
        method: "PATCH",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "DECLINED", adultCount: 0, childCount: 0 }),
      }),
      context,
    );
    expect(response.status).toBe(409);
  });
});
