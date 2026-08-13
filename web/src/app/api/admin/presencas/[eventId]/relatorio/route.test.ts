import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectUnauthenticated,
  type TestRouteHandler,
} from "@/test/api-route-contract";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), findFirst: vi.fn() }));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { presenceEvent: { findFirst: mocks.findFirst } },
}));

import { DELETE, GET, PATCH, POST } from "./route";

const routePath = "/api/admin/presencas/event-1/relatorio";
const context = { params: Promise.resolve({ eventId: "event-1" }) };
const adminSession = {
  user: {
    id: "admin-1",
    tenantId: "tenant-1",
    role: "ADMIN",
    status: "ACTIVE",
  },
  expires: "2026-09-01T00:00:00.000Z",
};

describe(routePath, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(adminSession);
    mocks.findFirst.mockResolvedValue({
      eventSlug: "formatura-2026",
      guests: [
        {
          name: "=Ana",
          email: "ana@example.test",
          rsvpStatus: "CONFIRMED",
          companionCount: 1,
          respondedAt: new Date("2026-08-13T12:00:00.000Z"),
          reservedGifts: [{ title: "Jogo de pratos" }],
          deliveries: [],
        },
      ],
    });
  });

  it("exports tenant-scoped guests as injection-safe CSV", async () => {
    const response = await GET(
      new Request(`http://localhost${routePath}?status=CONFIRMED`),
      context,
    );
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "presencas-formatura-2026.csv",
    );
    expect(csv).toContain("\"'=Ana\"");
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "event-1", tenantId: "tenant-1" },
      }),
    );
  });

  it("rejects unauthenticated exports", async () => {
    mocks.auth.mockResolvedValue(null);
    await expectUnauthenticated(
      ((request: Request) => GET(request, context)) as TestRouteHandler,
      "GET",
      routePath,
    );
  });

  it.each([
    { method: "POST", handler: POST },
    { method: "PATCH", handler: PATCH },
    { method: "DELETE", handler: DELETE },
  ])("returns 405 for unsupported $method", async ({ method, handler }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      "GET",
    );
  });
});
