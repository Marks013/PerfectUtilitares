import { describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectOriginRequired,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(async () => null),
  findRules: vi.fn(),
  saveValidation: vi.fn(async () => ({ id: "validation-1" })),
}));

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    jornadaRule: { findMany: mocks.findRules },
    codigoJornada: { findMany: vi.fn(async () => []) },
    jornadaException: { findMany: vi.fn(async () => []) },
    jornadaValidation: { create: mocks.saveValidation },
    userUsageDaily: { upsert: vi.fn(async () => undefined) },
  },
}));

const routePath = "/api/jornada/validar";

describe("/api/jornada/validar route", () => {
  it.each([
    { body: { tipoDia: "domingo" }, expectedDay: "domingo" },
    { body: {}, expectedDay: "util" },
  ])("validates and saves a simple shift as $expectedDay", async ({ body, expectedDay }) => {
    const userId = "operator-1";
    const horarios = "08:00 12:00";
    mocks.auth.mockResolvedValueOnce({
      user: { id: userId, role: "OPERATOR", status: "ACTIVE" },
    });
    mocks.findRules.mockResolvedValueOnce([
      {
        nome: "Jornada de 04:00",
        duracaoMinutos: 240,
        horasSemanais: 24,
        horasMensais: 120,
        intervaloMin: 0,
        intervaloMax: 0,
        limitePeriodoMinutos: 240,
        diasValidos: [expectedDay],
        active: true,
      },
    ]);
    mocks.saveValidation.mockClear();
    const origin = "https://app.example.test";
    const response = await POST(new Request(`${origin}${routePath}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ horarios, ...body }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "validation-1",
      valido: true,
      tipoDia: expectedDay,
      duracaoCalculada: "04:00",
      savedToHistory: true,
    });
    expect(mocks.saveValidation).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        userId,
        horariosOriginal: horarios,
        valido: true,
        tipoDia: expectedDay,
      }),
    });
  });

  it("rejects POST requests without a trusted origin", async () => {
    await expectOriginRequired(
      POST as unknown as TestRouteHandler,
      "POST",
      routePath,
    );
  });

  it.each([
    { method: "GET", handler: GET, allow: "POST" },
  ])("returns 405 for unsupported $method requests", async ({ method, handler, allow }) => {
    await expectMethodNotAllowed(
      handler as unknown as TestRouteHandler,
      method,
      routePath,
      allow,
    );
  });
});
