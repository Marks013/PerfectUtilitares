import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectUnauthenticated,
  type TestRouteHandler,
} from "@/test/api-route-contract";

const { authMock, findManyMock, createMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  findManyMock: vi.fn(),
  createMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    presenceEvent: { findMany: findManyMock, create: createMock },
  },
}));

import { DELETE, GET, PATCH, POST } from "./route";

const routePath = "/api/admin/presencas";
const adminSession = {
  user: {
    id: "user-admin",
    tenantId: "tenant-1",
    role: "ADMIN",
    status: "ACTIVE",
  },
  expires: "2026-09-01T00:00:00.000Z",
};

describe("/api/admin/presencas route", () => {
  beforeEach(() => {
    authMock.mockReset();
    findManyMock.mockReset();
    createMock.mockReset();
  });

  it("lists only events from the administrator tenant", async () => {
    authMock.mockResolvedValue(adminSession);
    findManyMock.mockResolvedValue([{ id: "event-1", title: "Formatura" }]);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { id: "event-1", title: "Formatura" },
    ]);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "tenant-1" } }),
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("creates a validated event with an activity record", async () => {
    authMock.mockResolvedValue(adminSession);
    createMock.mockResolvedValue({
      id: "event-1",
      eventSlug: "formatura-2026",
      title: "Formatura 2026",
      startsAt: new Date("2026-12-20T22:00:00.000Z"),
      confirmationDeadline: new Date("2026-12-01T02:59:59.000Z"),
      status: "DRAFT",
    });

    const response = await POST(
      new Request(`http://localhost${routePath}`, {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eventSlug: "formatura-2026",
          title: "Formatura 2026",
          startsAt: "2026-12-20T19:00:00-03:00",
          confirmationDeadline: "2026-11-30T23:59:59-03:00",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: "tenant-1",
          createdById: "user-admin",
          eventSlug: "formatura-2026",
          activities: expect.any(Object),
        }),
      }),
    );
  });

  it("rejects unauthenticated requests", async () => {
    authMock.mockResolvedValue(null);
    await expectUnauthenticated(
      POST as unknown as TestRouteHandler,
      "POST",
      routePath,
    );
  });

  it.each([
    { method: "PATCH", handler: PATCH },
    { method: "DELETE", handler: DELETE },
  ])("returns 405 for unsupported $method", async ({ method, handler }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      "GET, POST",
    );
  });
});
