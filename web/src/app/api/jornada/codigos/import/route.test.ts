import { describe, expect, it, vi } from "vitest";
import {
  expectMethodNotAllowed,
  expectUnauthenticated,
  type TestRouteHandler,
} from "@/test/api-route-contract";
import { oversizedMultipartRequest } from "@/test/oversized-multipart";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>().mockResolvedValue(null),
  persist: vi.fn(),
}));
vi.mock("@/auth", () => ({
  auth: mocks.auth,
}));
vi.mock("@/lib/api/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/security")>()),
  enforcePersistentRateLimit: vi.fn(async () => null),
  requireSameOrigin: vi.fn(() => null),
}));
vi.mock("@/lib/api/resource-capacity", () => ({
  requireResourceCapacity: vi.fn(async () => null),
}));
vi.mock("@/lib/codigos/repository", () => ({
  persistCodigoImport: mocks.persist,
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const admin = { user: { id: "admin-test", status: "ACTIVE", role: "ADMIN" } };

const routePath = "/api/jornada/codigos/import";

describe("/api/jornada/codigos/import route", () => {
  it("imports a valid CSV through multipart and persists parsed rows", async () => {
    mocks.auth.mockResolvedValueOnce(admin);
    mocks.persist.mockResolvedValueOnce({
      totalLido: 1,
      importados: 1,
      ignorados: 0,
      erros: [],
    });
    const form = new FormData();
    form.append(
      "file",
      new File(["Horario;Descricao\n1038;06:00 10:00 12:00 15:20\n"], "turnos.csv"),
    );
    const response = await POST(
      new Request(`http://localhost${routePath}`, { method: "POST", body: form }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ importados: 1 });
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        importaveis: [expect.objectContaining({ codigo: "1038", origem: "CSV" })],
      }),
    );
  });

  it("returns 413 for a multipart body above the cap without a declared size", async () => {
    mocks.auth.mockResolvedValueOnce(admin);
    mocks.persist.mockClear();
    const response = await POST(oversizedMultipartRequest(routePath, 8));
    expect(response.status).toBe(413);
    expect(mocks.persist).not.toHaveBeenCalled();
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
