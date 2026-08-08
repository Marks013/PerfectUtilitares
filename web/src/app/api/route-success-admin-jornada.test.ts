import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  overrides: new Map<string, unknown>(),
}));

const session = {
  user: {
    id: "test-admin-id",
    tenantId: "test-tenant-id",
    email: "admin@example.test",
    name: "Administrador",
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
  },
  expires: "2099-01-01T00:00:00.000Z",
};

vi.mock("@/lib/api/security", () => ({
  enforceRateLimit: () => null,
  enforceSharedRateLimit: async () => null,
  getOptionalSession: async () => session,
  jsonError: (
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) => Response.json({ error: { code, message, details } }, { status }),
  methodNotAllowed: (allowed: string[]) =>
    Response.json(
      { error: { code: "METHOD_NOT_ALLOWED" } },
      { status: 405, headers: { Allow: allowed.join(", ") } },
    ),
  readJsonBody: async (request: Request) => {
    try {
      return { ok: true as const, data: await request.json() };
    } catch {
      return {
        ok: false as const,
        response: Response.json(
          { error: { code: "INVALID_JSON" } },
          { status: 400 },
        ),
      };
    }
  },
  requireAdmin: async () => ({ ok: true as const, session }),
  requireContentType: () => null,
  requireMaxContentLength: () => null,
  requireSameOrigin: () => null,
  requireSession: async () => ({ ok: true as const, session }),
}));

vi.mock("@/lib/api/resource-capacity", () => ({
  requireResourceCapacity: async () => null,
}));

vi.mock("@/lib/usage/record", () => ({
  recordUserUsage: vi.fn(),
}));

vi.mock("@/lib/codigos/importer", () => ({
  parseCodigoImportBuffer: vi.fn(() => [
    {
      codigo: "A1",
      nome: "Horario teste",
      horariosOriginal: "08:00 17:00",
      horariosNormalizado: "08:00 17:00",
    },
  ]),
  parseCodigoJson: vi.fn(() => [
    {
      codigo: "A1",
      nome: "Horario teste",
      horariosOriginal: "08:00 17:00",
      horariosNormalizado: "08:00 17:00",
    },
  ]),
}));

vi.mock("@/lib/codigos/repository", () => ({
  persistCodigoImport: vi.fn(async () => ({
    created: 1,
    updated: 0,
    total: 1,
  })),
}));

vi.mock("@/lib/jornada/pdf", () => ({
  generateJornadaHistoryPdf: vi.fn(async () => Buffer.from("%PDF-test")),
}));

vi.mock("@/lib/jornada/validator", () => {
  const result = {
    valido: true,
    mensagem: "Jornada valida",
    horariosNormalizado: "08:00 17:00",
    codigo: "A1",
    regra: null,
  };
  return {
    validarJornadaComInterjornada: vi.fn(() => ({
      valido: true,
      jornada1: result,
      jornada2: result,
    })),
    validarJornadaManual: vi.fn(() => result),
  };
});

vi.mock("@/lib/jornada/batch-validation", () => ({
  DEFAULT_JORNADA_BATCH_CONFIG: {
    validarPeriodos: true,
    validarJornada: true,
    validarIntervalos: true,
    usarHorariosAgrupados: true,
    linhaInicio: 2,
    colunaHorariosAgrupados: 1,
  },
  validarJornadaBatchXlsx: vi.fn(async () => ({
    total: 1,
    validos: 1,
    invalidos: 0,
    rows: [],
  })),
}));

vi.mock("@/lib/jornada/batch-pdf", () => ({
  generateJornadaBatchReportPdf: vi.fn(async () => Buffer.from("%PDF-test")),
}));

vi.mock("@/lib/email/resend", () => ({
  getAppUrl: () => "http://localhost:3000",
  sendInvitationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");
  const base = {
    id: "test-resource-id",
    tenantId: "test-tenant-id",
    userId: "test-admin-id",
    email: "user@example.test",
    name: "Recurso de teste",
    passwordHash: "$2b$12$test",
    role: "ADMIN",
    status: "ACTIVE",
    slug: "test-tenant",
    active: true,
    acceptedAt: null,
    expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    createdAt: now,
    updatedAt: now,
    codigo: "A1",
    horariosOriginal: "08:00 17:00",
    horariosNormalizado: "08:00 17:00",
    sabadoNormalizado: null,
    valido: true,
    mensagem: "Valido",
    tipoDia: "util",
    detalhes: null,
    user: { name: "Administrador", email: "admin@example.test" },
  };

  let prisma: Record<string, unknown>;
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method) => async (...args: unknown[]) => {
          const key = `${name}.${String(method)}`;
          mocks.calls.push(key);
          if (mocks.overrides.has(key)) {
            const value = mocks.overrides.get(key);
            return typeof value === "function"
              ? (value as (...input: unknown[]) => unknown)(...args)
              : value;
          }
          if (method === "findMany" || method === "groupBy") return [];
          if (method === "count") return 0;
          if (method === "aggregate") {
            return { _count: 0, _sum: { inputBytes: 0n, outputBytes: 0n } };
          }
          return { ...base };
        },
      },
    );

  prisma = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "$transaction") {
          return async (work: unknown) => {
            if (typeof work === "function") {
              return (work as (client: unknown) => unknown)(prisma);
            }
            return Promise.all(work as Promise<unknown>[]);
          };
        }
        return model(String(property));
      },
    },
  );

  return { prisma };
});

import { PATCH as patchAccount } from "@/app/api/account/route";
import { GET as getInvitations } from "@/app/api/admin/invitations/route";
import { GET as getTenants } from "@/app/api/admin/tenants/route";
import { GET as getUsage } from "@/app/api/admin/usage/route";
import { GET as getAdminUser } from "@/app/api/admin/users/[id]/route";
import { GET as getAdminUsers } from "@/app/api/admin/users/route";
import { POST as acceptInvitation } from "@/app/api/invitations/accept/route";
import { GET as getCodigo } from "@/app/api/jornada/codigos/[id]/route";
import { POST as importCodigos } from "@/app/api/jornada/codigos/import/route";
import { GET as getCodigos } from "@/app/api/jornada/codigos/route";
import { PATCH as patchExcecao } from "@/app/api/jornada/excecoes/[id]/route";
import { GET as getExcecoes } from "@/app/api/jornada/excecoes/route";
import { POST as exportHistorico } from "@/app/api/jornada/historico/exportar/route";
import { GET as getHistorico } from "@/app/api/jornada/historico/route";
import { GET as getRegra } from "@/app/api/jornada/regras/[id]/route";
import { GET as getRegras } from "@/app/api/jornada/regras/route";
import { POST as validarJornada } from "@/app/api/jornada/validar/route";
import { POST as validarLote } from "@/app/api/jornada/validar-lote/route";
import { POST as requestPasswordReset } from "@/app/api/password-reset/request/route";

const origin = "http://localhost:3000";

function jsonRequest(path: string, data: unknown) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-forwarded-for": `route-functional-${path}`,
    },
    body: JSON.stringify(data),
  });
}

function getRequest(path: string) {
  return new Request(`${origin}${path}`, {
    headers: { origin, "x-forwarded-for": `route-functional-${path}` },
  });
}

type FunctionalRouteCase = {
  route: string;
  expectedStatus: 200 | 201;
  run: () => Promise<Response> | Response;
  persistence?: string;
};

const validationId = "cjld2cjxh0000qzrmn831i7rn";

const cases: FunctionalRouteCase[] = [
  {
    route: "src/app/api/account/route.ts",
    expectedStatus: 200,
    persistence: "user.update",
    run: () =>
      patchAccount(
        new Request(`${origin}/api/account`, {
          method: "PATCH",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify({ name: "Nome atualizado" }),
        }),
      ),
  },
  {
    route: "src/app/api/admin/invitations/route.ts",
    expectedStatus: 200,
    run: () => getInvitations(),
  },
  {
    route: "src/app/api/admin/tenants/route.ts",
    expectedStatus: 200,
    run: () => getTenants(),
  },
  {
    route: "src/app/api/admin/usage/route.ts",
    expectedStatus: 200,
    run: () => getUsage(getRequest("/api/admin/usage?period=day")),
  },
  {
    route: "src/app/api/admin/users/[id]/route.ts",
    expectedStatus: 200,
    run: () =>
      getAdminUser(getRequest("/api/admin/users/test-resource-id"), {
        params: Promise.resolve({ id: "test-resource-id" }),
      }),
  },
  {
    route: "src/app/api/admin/users/route.ts",
    expectedStatus: 200,
    run: () => getAdminUsers(),
  },
  {
    route: "src/app/api/invitations/accept/route.ts",
    expectedStatus: 201,
    persistence: "user.create",
    run: () => {
      mocks.overrides.set("userInvitation.findUnique", {
        id: "invite-id",
        tenantId: "test-tenant-id",
        email: "invited@example.test",
        name: "Usuario Convidado",
        role: "OPERATOR",
        acceptedAt: null,
        expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      });
      mocks.overrides.set("user.findUnique", null);
      return acceptInvitation(
        jsonRequest("/api/invitations/accept", {
          token: "a".repeat(48),
          password: "StrongPassword!123",
        }),
      );
    },
  },
  {
    route: "src/app/api/jornada/codigos/[id]/route.ts",
    expectedStatus: 200,
    run: () =>
      getCodigo(getRequest("/api/jornada/codigos/test-resource-id"), {
        params: Promise.resolve({ id: "test-resource-id" }),
      }),
  },
  {
    route: "src/app/api/jornada/codigos/import/route.ts",
    expectedStatus: 200,
    run: () =>
      importCodigos(
        jsonRequest("/api/jornada/codigos/import", [
          {
            codigo: "A1",
            nome: "Horario teste",
            horarios: "08:00 17:00",
          },
        ]),
      ),
  },
  {
    route: "src/app/api/jornada/codigos/route.ts",
    expectedStatus: 200,
    run: () => getCodigos(),
  },
  {
    route: "src/app/api/jornada/excecoes/[id]/route.ts",
    expectedStatus: 200,
    persistence: "jornadaException.update",
    run: () =>
      patchExcecao(
        jsonRequest("/api/jornada/excecoes/test-resource-id", {
          active: false,
        }),
        { params: Promise.resolve({ id: "test-resource-id" }) },
      ),
  },
  {
    route: "src/app/api/jornada/excecoes/route.ts",
    expectedStatus: 200,
    run: () =>
      getExcecoes(getRequest("/api/jornada/excecoes")),
  },
  {
    route: "src/app/api/jornada/historico/exportar/route.ts",
    expectedStatus: 200,
    run: () => {
      mocks.overrides.set("jornadaValidation.findMany", [
        {
          id: validationId,
          userId: "test-admin-id",
          valido: true,
          horariosOriginal: "08:00 17:00",
          horariosNormalizado: "08:00 17:00",
          mensagem: "Valido",
          tipoDia: "util",
          codigo: "A1",
          detalhes: null,
          createdAt: new Date("2026-08-08T12:00:00.000Z"),
          user: { name: "Administrador", email: "admin@example.test" },
        },
      ]);
      return exportHistorico(
        jsonRequest("/api/jornada/historico/exportar", {
          entries: [
            {
              ids: [validationId],
              nome: "Administrador",
              matricula: "1",
              dataAlteracao: "2026-08-08",
            },
          ],
        }),
      );
    },
  },
  {
    route: "src/app/api/jornada/historico/route.ts",
    expectedStatus: 200,
    run: () => getHistorico(getRequest("/api/jornada/historico")),
  },
  {
    route: "src/app/api/jornada/regras/[id]/route.ts",
    expectedStatus: 200,
    run: () =>
      getRegra(getRequest("/api/jornada/regras/test-resource-id"), {
        params: Promise.resolve({ id: "test-resource-id" }),
      }),
  },
  {
    route: "src/app/api/jornada/regras/route.ts",
    expectedStatus: 200,
    run: () => getRegras(),
  },
  {
    route: "src/app/api/jornada/validar/route.ts",
    expectedStatus: 200,
    persistence: "jornadaValidation.create",
    run: () =>
      validarJornada(
        jsonRequest("/api/jornada/validar", {
          modo: "simples",
          horarios: "08:00 17:00",
        }),
      ),
  },
  {
    route: "src/app/api/jornada/validar-lote/route.ts",
    expectedStatus: 200,
    run: () => {
      const form = new FormData();
      form.set(
        "file",
        new File([Buffer.from("xlsx-test")], "jornadas.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      return validarLote(
        new Request(`${origin}/api/jornada/validar-lote`, {
          method: "POST",
          headers: { origin },
          body: form,
        }),
      );
    },
  },
  {
    route: "src/app/api/password-reset/request/route.ts",
    expectedStatus: 200,
    run: () => {
      mocks.overrides.set("user.findUnique", null);
      return requestPasswordReset(
        jsonRequest("/api/password-reset/request", {
          email: "missing@example.test",
        }),
      );
    },
  },
];

describe("functional success paths for account, admin and Jornada routes", () => {
  beforeEach(() => {
    mocks.calls.length = 0;
    mocks.overrides.clear();
    delete process.env.JORNADA_EXCEL_API_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  for (const routeCase of cases) {
    it(`route-success: ${routeCase.route}`, async () => {
      const response = await routeCase.run();

      expect(response.status).toBe(routeCase.expectedStatus);
      if (routeCase.persistence) {
        const persistence = routeCase.persistence;
        expect(
          mocks.calls.some((call) => call.startsWith(persistence)),
        ).toBe(true);
      }
    });
  }
});
