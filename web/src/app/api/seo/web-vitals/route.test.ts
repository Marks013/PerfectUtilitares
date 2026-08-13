import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectOriginRequired,
  type TestRouteHandler,
} from "@/test/api-route-contract";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));

vi.mock("@/lib/prisma", () => ({
  prisma: { seoWebVital: { create: mocks.create } },
}));

import { GET, POST } from "./route";

const routePath = "/api/seo/web-vitals";

describe("/api/seo/web-vitals route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects POST requests without a trusted origin", async () => {
    await expectOriginRequired(
      POST as unknown as TestRouteHandler,
      "POST",
      routePath,
    );
  });

  it("stores a valid public metric without identity data", async () => {
    const response = await POST(
      new Request(`http://localhost:3002${routePath}`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3002",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: "/pdf/comprimir",
          metric: "LCP",
          value: 1240,
          rating: "good",
          navigationType: "navigate",
        }),
      }),
    );

    expect(response.status).toBe(204);
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        path: "/pdf/comprimir",
        metric: "LCP",
        value: 1240,
        rating: "good",
        navigationType: "navigate",
      },
    });
  });

  it("rejects sensitive paths", async () => {
    const response = await POST(
      new Request(`http://localhost:3002${routePath}`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3002",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: "/convite/private-token",
          metric: "CLS",
          value: 0.01,
          rating: "good",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns 405 for GET", async () => {
    await expectMethodNotAllowed(
      GET as unknown as TestRouteHandler,
      "GET",
      routePath,
      "POST",
    );
  });
});
