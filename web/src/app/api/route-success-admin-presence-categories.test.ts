import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  eventFindFirst: vi.fn(),
  eventUpdate: vi.fn(),
  categoryAggregate: vi.fn(),
  categoryCreate: vi.fn(),
  categoryFindFirst: vi.fn(),
  categoryUpdate: vi.fn(),
  activityCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    presenceEvent: {
      findFirst: mocks.eventFindFirst,
      update: mocks.eventUpdate,
    },
    presenceGiftCategory: {
      aggregate: mocks.categoryAggregate,
      create: mocks.categoryCreate,
      findFirst: mocks.categoryFindFirst,
      update: mocks.categoryUpdate,
    },
    presenceActivity: { create: mocks.activityCreate },
    $transaction: mocks.transaction,
  },
}));

import * as categoriesRoute from "./admin/presencas/[eventId]/categorias-presentes/route";
import * as categoryRoute from "./admin/presencas/[eventId]/categorias-presentes/[categoryId]/route";

const context = {
  params: Promise.resolve({ eventId: "event-1", categoryId: "category-1" }),
};

describe("route-success: admin presence gift categories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      user: {
        id: "admin-1",
        tenantId: "tenant-1",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    mocks.eventFindFirst.mockResolvedValue({ id: "event-1" });
    mocks.eventUpdate.mockResolvedValue({});
    mocks.activityCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (value: unknown) => {
      if (typeof value === "function") {
        return value({
          presenceGiftCategory: { create: mocks.categoryCreate, update: mocks.categoryUpdate },
          presenceEvent: { update: mocks.eventUpdate },
          presenceActivity: { create: mocks.activityCreate },
        });
      }
      return Promise.all(value as Promise<unknown>[]);
    });
  });

  const routeCases = [
    {
      route: "src/app/api/admin/presencas/[eventId]/categorias-presentes/route.ts",
      expectedStatus: 201,
    },
    {
      route: "src/app/api/admin/presencas/[eventId]/categorias-presentes/[categoryId]/route.ts",
      expectedStatus: 200,
    },
  ] as const;

  it.each(routeCases)("returns 2xx for $route", async (routeCase) => {
    let response: Response;
    if (routeCase.route.endsWith("categorias-presentes/route.ts")) {
      mocks.categoryAggregate.mockResolvedValue({ _max: { position: 0 } });
      mocks.categoryCreate.mockResolvedValue({
        id: "category-1",
        name: "Cozinha",
        emoji: "🍳",
        position: 1,
        _count: { gifts: 0 },
      });
      response = await categoriesRoute.POST(
        new Request("http://localhost/api/admin/presencas/event-1/categorias-presentes", {
          method: "POST",
          headers: { origin: "http://localhost", "content-type": "application/json" },
          body: JSON.stringify({ name: "Cozinha", emoji: "🍳" }),
        }),
        context,
      );
    } else {
      mocks.categoryFindFirst.mockResolvedValue({ id: "category-1" });
      mocks.categoryUpdate.mockResolvedValue({
        id: "category-1",
        name: "Quarto",
        emoji: "🛏️",
        position: 0,
        _count: { gifts: 2 },
      });
      response = await categoryRoute.PATCH(
        new Request("http://localhost/api/admin/presencas/event-1/categorias-presentes/category-1", {
          method: "PATCH",
          headers: { origin: "http://localhost", "content-type": "application/json" },
          body: JSON.stringify({ name: "Quarto", emoji: "🛏️" }),
        }),
        context,
      );
    }
    expect(response.status).toBe(routeCase.expectedStatus);
  });
});
