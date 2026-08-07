import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enforceSharedRateLimit: vi.fn(),
  getOptionalSession: vi.fn(),
  requireSameOrigin: vi.fn(),
}));

vi.mock("@/lib/api/security", () => ({
  enforceSharedRateLimit: mocks.enforceSharedRateLimit,
  getOptionalSession: mocks.getOptionalSession,
  jsonError: vi.fn(
    (status: number, code: string, message: string) =>
      Response.json({ error: { code, message } }, { status }),
  ),
  methodNotAllowed: vi.fn(
    (methods: string[]) =>
      new Response(null, {
        status: 405,
        headers: { Allow: methods.join(", ") },
      }),
  ),
  requireContentType: vi.fn(() => null),
  requireMaxContentLength: vi.fn(() => null),
  requireSameOrigin: mocks.requireSameOrigin,
}));

vi.mock("@/lib/api/resource-capacity", () => ({
  requireResourceCapacity: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/jornada/batch-validation", () => ({
  DEFAULT_JORNADA_BATCH_CONFIG: {
    validarPeriodos: true,
    validarJornada: true,
    validarIntervalos: true,
    usarHorariosAgrupados: true,
    linhaInicio: 1,
    colunaHorariosAgrupados: 1,
  },
  validarJornadaBatchXlsx: vi.fn(),
}));

vi.mock("@/lib/jornada/batch-pdf", () => ({
  generateJornadaBatchReportPdf: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    jornadaRule: {
      findMany: vi.fn(),
    },
    codigoJornada: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/usage/record", () => ({
  recordUserUsage: vi.fn(),
}));

vi.mock("@/lib/system/resource-capacity", () => ({
  getRequestContentLength: vi.fn(() => 0),
}));

import { GET, POST } from "@/app/api/jornada/validar-lote/route";

const ORIGINAL_EXCEL_API_KEY = process.env.JORNADA_EXCEL_API_KEY;
const VALID_KEY = "excel-integration-key-1234567890";

function validationRequest(options: {
  authorization?: string;
  origin?: string | null;
} = {}) {
  const headers = new Headers();

  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "http://localhost");
  }

  if (options.authorization) {
    headers.set("authorization", options.authorization);
  }

  return new Request("http://localhost/api/jornada/validar-lote", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  process.env.JORNADA_EXCEL_API_KEY = VALID_KEY;

  mocks.requireSameOrigin.mockReturnValue(null);
  mocks.getOptionalSession.mockResolvedValue(null);

  mocks.enforceSharedRateLimit.mockResolvedValue(
    Response.json(
      { stoppedForTest: true },
      {
        status: 429,
      },
    ),
  );
});

afterEach(() => {
  if (ORIGINAL_EXCEL_API_KEY === undefined) {
    delete process.env.JORNADA_EXCEL_API_KEY;
  } else {
    process.env.JORNADA_EXCEL_API_KEY = ORIGINAL_EXCEL_API_KEY;
  }
});

describe("Jornada batch validation API authorization", () => {
  it("accepts only POST", () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("allows a trusted Excel Bearer request without Origin", async () => {
    const response = await POST(
      validationRequest({
        authorization: `Bearer ${VALID_KEY}`,
        origin: null,
      }),
    );

    expect(response.status).toBe(429);
    expect(mocks.requireSameOrigin).not.toHaveBeenCalled();
    expect(mocks.enforceSharedRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        keyPrefix: "jornada-validar-lote",
        authenticated: true,
      }),
    );
  });

  it("does not trust a Bearer token with a different value", async () => {
    mocks.requireSameOrigin.mockReturnValue(
      Response.json(
        { error: { code: "ORIGIN_REQUIRED" } },
        { status: 403 },
      ),
    );

    const wrongKey = VALID_KEY.replace(/0$/, "1");

    const response = await POST(
      validationRequest({
        authorization: `Bearer ${wrongKey}`,
        origin: null,
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.getOptionalSession).not.toHaveBeenCalled();
    expect(mocks.enforceSharedRateLimit).not.toHaveBeenCalled();
  });

  it("does not trust a Bearer token with a different length", async () => {
    mocks.requireSameOrigin.mockReturnValue(
      Response.json(
        { error: { code: "ORIGIN_REQUIRED" } },
        { status: 403 },
      ),
    );

    const response = await POST(
      validationRequest({
        authorization: `Bearer ${VALID_KEY}-extra`,
        origin: null,
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.enforceSharedRateLimit).not.toHaveBeenCalled();
  });

  it("requires normal origin validation when the Excel key is not configured", async () => {
    delete process.env.JORNADA_EXCEL_API_KEY;

    mocks.requireSameOrigin.mockReturnValue(
      Response.json(
        { error: { code: "ORIGIN_REQUIRED" } },
        { status: 403 },
      ),
    );

    const response = await POST(
      validationRequest({
        authorization: `Bearer ${VALID_KEY}`,
        origin: null,
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.enforceSharedRateLimit).not.toHaveBeenCalled();
  });

  it("keeps anonymous same-origin requests rate limited as unauthenticated", async () => {
    const response = await POST(validationRequest());

    expect(response.status).toBe(429);
    expect(mocks.requireSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.enforceSharedRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        authenticated: false,
      }),
    );
  });

  it("keeps authenticated browser sessions exempt from the public rate limit", async () => {
    mocks.getOptionalSession.mockResolvedValue({
      user: {
        id: "user-123",
        status: "ACTIVE",
      },
    });

    const response = await POST(validationRequest());

    expect(response.status).toBe(429);
    expect(mocks.requireSameOrigin).toHaveBeenCalledOnce();
    expect(mocks.enforceSharedRateLimit).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        authenticated: true,
      }),
    );
  });
});
