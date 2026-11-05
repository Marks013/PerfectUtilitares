import JSZip from "jszip";
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
import { DEFAULT_JORNADA_RULES } from "@/lib/jornada/default-rules";
import { prisma } from "@/lib/prisma";

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

describe("Jornada batch validation upload", () => {
  it("validates a real XLSX sent as multipart", async () => {
    mocks.enforceSharedRateLimit.mockResolvedValue(null);
    vi.mocked(prisma.jornadaRule.findMany).mockResolvedValue(
      DEFAULT_JORNADA_RULES as Awaited<ReturnType<typeof prisma.jornadaRule.findMany>>,
    );
    vi.mocked(prisma.codigoJornada.findMany).mockResolvedValue([]);
    const zip = new JSZip();
    zip.file("xl/worksheets/sheet1.xml", `<worksheet><sheetData>
      <row r="3"><c r="A3" t="inlineStr"><is><t>TESTE01</t></is></c>
      <c r="B3" t="inlineStr"><is><t>08:00 às 12:00 e 13:00 às 17:00</t></is></c></row>
      </sheetData></worksheet>`);
    const bytes = await zip.generateAsync({ type: "uint8array" });
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)]), "jornada-teste.xlsx");
    form.set("usarHorariosAgrupados", "true");
    const response = await POST(new Request("http://localhost/api/jornada/validar-lote", {
      method: "POST",
      headers: { origin: "http://localhost" },
      body: form,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      totalLinhas: 1,
      validos: 1,
      erros: 0,
      linhas: [{ matricula: "TESTE01", resultado: { duracaoCalculada: "08:00" } }],
    });
  });

  it("rejects a multipart stream over 8 MiB without relying on Content-Length", async () => {
    mocks.enforceSharedRateLimit.mockResolvedValue(null);
    const start = new TextEncoder().encode(
      "--boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"jornada.xlsx\"\r\n\r\n",
    );
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) controller.enqueue(start);
        else if (sent <= 8) controller.enqueue(new Uint8Array(1024 * 1024));
        else controller.close();
        sent += 1;
      },
    });
    const request = new Request("http://localhost/api/jornada/validar-lote", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=boundary",
        origin: "http://localhost",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    expect(request.headers.has("content-length")).toBe(false);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
    expect(prisma.jornadaRule.findMany).not.toHaveBeenCalled();
  });
});
