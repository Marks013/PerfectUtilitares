import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupPresenceData } from "@/lib/presence/retention";

const mocks = vi.hoisted(() => ({
  deleteSessions: vi.fn(),
  deleteWebhooks: vi.fn(),
  deleteEvents: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    presenceGuestSession: { deleteMany: mocks.deleteSessions },
    presenceWebhookEvent: { deleteMany: mocks.deleteWebhooks },
    presenceEvent: { deleteMany: mocks.deleteEvents },
    $transaction: mocks.transaction,
  },
}));

describe("presence retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteSessions.mockReturnValue("sessions-query");
    mocks.deleteWebhooks.mockReturnValue("webhooks-query");
    mocks.deleteEvents.mockReturnValue("events-query");
    mocks.transaction.mockResolvedValue([
      { count: 3 },
      { count: 4 },
      { count: 1 },
    ]);
  });

  it("deletes only expired sessions, old webhook events and archived events", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    await expect(cleanupPresenceData(now)).resolves.toEqual({
      sessions: 3,
      webhookEvents: 4,
      events: 1,
    });
    expect(mocks.deleteEvents).toHaveBeenCalledWith({
      where: { status: "ARCHIVED", retentionUntil: { lte: now } },
    });
    expect(mocks.transaction).toHaveBeenCalledWith([
      "sessions-query",
      "webhooks-query",
      "events-query",
    ]);
  });
});
