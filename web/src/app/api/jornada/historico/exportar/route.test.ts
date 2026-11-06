import { PDFDocument } from "pdf-lib";
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
  it.each([
    {
      name: "exports a real PDF for the operator at the exact cutoff",
      role: "OPERATOR",
      ownerId: "operator-1",
      offsetMs: 0,
      expectedStatus: 200,
    },
    {
      name: "exports retained records for the administrator",
      role: "ADMIN",
      ownerId: "operator-2",
      offsetMs: 0,
      expectedStatus: 200,
    },
    {
      name: "rejects a record expired by 1 ms for the owner",
      role: "OPERATOR",
      ownerId: "operator-1",
      offsetMs: -1,
      expectedStatus: 404,
    },
    {
      name: "rejects an expired record for the administrator",
      role: "ADMIN",
      ownerId: "operator-2",
      offsetMs: -1,
      expectedStatus: 404,
    },
    {
      name: "rejects a retained record owned by another operator",
      role: "OPERATOR",
      ownerId: "operator-2",
      offsetMs: 0,
      expectedStatus: 404,
    },
  ])("$name", async ({ role, ownerId, offsetMs, expectedStatus }) => {
    const userId = "operator-1";
    const id = "clabc123def456ghi789jklmn";
    const now = Date.UTC(2026, 10, 5, 12);
    const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const record = {
      id,
      userId: ownerId,
      createdAt: new Date(cutoff.getTime() + offsetMs),
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
    };
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    mocks.audit.mockClear();
    mocks.findMany.mockClear();
    mocks.auth.mockResolvedValueOnce({
      user: { id: userId, role, status: "ACTIVE" },
    });
    mocks.findMany.mockImplementationOnce(
      async ({ where }: {
        where: {
          id: { in: string[] };
          valido: boolean;
          userId?: string;
          createdAt?: { gte: Date };
        };
      }) => [record].filter(
        (row) =>
          where.id.in.includes(row.id) &&
          row.valido === where.valido &&
          (where.userId === undefined || row.userId === where.userId) &&
          (where.createdAt === undefined || row.createdAt >= where.createdAt.gte),
      ),
    );

    try {
      const response = await POST(
        new Request(`https://app.example.test${routePath}`, {
          method: "POST",
          headers: { origin: "https://app.example.test", "content-type": "application/json" },
          body: JSON.stringify({
            entries: [{ ids: [id], nome: "Pessoa Teste", dataAlteracao: "2026-11-05" }],
          }),
        }),
      );

      expect(response.status).toBe(expectedStatus);
      expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        where: {
          id: { in: [id] },
          valido: true,
          createdAt: { gte: cutoff },
          ...(role === "ADMIN" ? {} : { userId }),
        },
      }));

      if (expectedStatus === 200) {
        expect(response.headers.get("content-type")).toBe("application/pdf");
        const pdf = await PDFDocument.load(await response.arrayBuffer());
        expect(pdf.getPageCount()).toBeGreaterThan(0);
        expect(mocks.audit).toHaveBeenCalledTimes(1);
      } else {
        expect(mocks.audit).not.toHaveBeenCalled();
      }
    } finally {
      clock.mockRestore();
    }
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
