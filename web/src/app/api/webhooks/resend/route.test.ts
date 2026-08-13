import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  type TestRouteHandler,
} from "@/test/api-route-contract";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), record: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({
  verifyResendWebhook: mocks.verify,
}));
vi.mock("@/lib/presence/webhook", () => ({
  isResendEmailEvent: () => true,
  recordPresenceResendEvent: mocks.record,
}));

import { DELETE, GET, PATCH, POST, PUT } from "./route";

const routePath = "/api/webhooks/resend";

describe(routePath, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockReturnValue({
      type: "email.delivered",
      created_at: "2026-08-13T12:00:00.000Z",
      data: { email_id: "provider-1" },
    });
    mocks.record.mockResolvedValue({ kind: "RECORDED" });
  });

  it("verifies and records a signed email event", async () => {
    const payload = JSON.stringify({ type: "email.delivered" });
    const response = await POST(
      new Request(`http://localhost${routePath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "svix-id": "webhook-1",
          "svix-timestamp": "1786622400",
          "svix-signature": "v1,test",
        },
        body: payload,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith({
      payload,
      id: "webhook-1",
      timestamp: "1786622400",
      signature: "v1,test",
    });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ webhookId: "webhook-1" }),
    );
  });

  it("rejects unsigned requests", async () => {
    const response = await POST(
      new Request(`http://localhost${routePath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each([
    { method: "GET", handler: GET },
    { method: "PUT", handler: PUT },
    { method: "PATCH", handler: PATCH },
    { method: "DELETE", handler: DELETE },
  ])("returns 405 for unsupported $method", async ({ method, handler }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      "POST",
    );
  });
});
