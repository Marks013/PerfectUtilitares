import { describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectUnauthenticated,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(async () => null),
  findMany: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => [{ count: 1, resetAt: new Date(Date.now() + 60_000) }]),
    jornadaValidation: { findMany: mocks.findMany },
    auditLog: { create: mocks.audit },
  },
}));

const routePath = "/api/jornada/historico/exportar";

describe("/api/jornada/historico/exportar route", () => {
  it("exports a real PDF for a valid CUID scoped to the current user", async () => {
    const userId = "operator-1";
    const id = "clabc123def456ghi789jklmn";
    mocks.auth.mockResolvedValueOnce({
      user: { id: userId, role: "OPERATOR", status: "ACTIVE" },
    });
    mocks.findMany.mockResolvedValueOnce([
      {
        id,
        createdAt: new Date("2026-11-05T12:00:00Z"),
        horariosOriginal: "08:00 12:00 13:00 17:00",
        horariosNormalizado: "08:00 12:00 13:00 17:00",
        valido: true,
        mensagem: "Jornada válida",
        duracaoCalculada: "08:00",
        tipoDia: "util",
        codigo: "123",
        horasSemanais: 44,
        horasMensais: 220,
        intervalo: "1h",
        user: { name: "Operador", email: "operador@example.test" },
      },
    ]);

    const response = await POST(
      new Request(`https://app.example.test${routePath}`, {
        method: "POST",
        headers: { origin: "https://app.example.test", "content-type": "application/json" },
        body: JSON.stringify({
          entries: [{ ids: [id], nome: "Pessoa Teste", dataAlteracao: "2026-11-05" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const pdf = Buffer.from(await response.arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(500);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [id] }, valido: true, userId },
    }));
  });

  it.each([
    { method: "POST", handler: POST },
  ])("rejects unauthenticated $method requests", async ({ method, handler }) => {
    await expectUnauthenticated(
      handler as unknown as TestRouteHandler,
      method,
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
