import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordPresenceResendEvent } from "@/lib/presence/webhook";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  eventCreate: vi.fn(),
  deliveryUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    presenceDelivery: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
  },
}));

describe("presence Resend webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue({ id: "delivery-1" });
    mocks.eventCreate.mockResolvedValue({});
    mocks.deliveryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        presenceWebhookEvent: { create: mocks.eventCreate },
        presenceDelivery: { updateMany: mocks.deliveryUpdateMany },
      }),
    );
  });

  it("records a delivered event without storing recipient payload", async () => {
    const result = await recordPresenceResendEvent({
      webhookId: "evt-webhook-1",
      event: {
        type: "email.delivered",
        created_at: "2026-08-13T12:00:00.000Z",
        data: { email_id: "provider-1" },
      },
    });

    expect(result).toEqual({ kind: "RECORDED" });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "evt-webhook-1",
        deliveryId: "delivery-1",
        providerMessageId: "provider-1",
        type: "email.delivered",
      }),
    });
    expect(mocks.deliveryUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DELIVERED",
          providerStatus: "delivered",
        }),
      }),
    );
  });

  it("ignores events unrelated to email delivery", async () => {
    await expect(
      recordPresenceResendEvent({
        webhookId: "evt-webhook-2",
        event: {
          type: "contact.created",
          created_at: "2026-08-13T12:00:00.000Z",
          data: {},
        },
      }),
    ).resolves.toEqual({ kind: "IGNORED" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
