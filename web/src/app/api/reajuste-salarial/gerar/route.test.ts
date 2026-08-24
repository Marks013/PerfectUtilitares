import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireReajusteAccess: vi.fn(),
  requireSameOrigin: vi.fn(),
  rateLimit: vi.fn(),
  parseWorkbook: vi.fn(),
  generatePdf: vi.fn(),
  recordUsage: vi.fn(),
  prepareArchive: vi.fn((bytes: Buffer) => bytes),
}));

vi.mock("@/lib/reajuste-salarial/access.server", () => ({
  requireReajusteAccess: mocks.requireReajusteAccess,
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/api/security", () => ({
  enforcePersistentRateLimit: mocks.rateLimit,
  jsonError: (status: number, code: string, message: string, details?: unknown) =>
    Response.json({ error: { code, message, details } }, { status }),
  methodNotAllowed: (allowed: string[]) =>
    new Response(null, { status: 405, headers: { Allow: allowed.join(", ") } }),
  requireContentType: vi.fn(() => null),
  requireMaxContentLength: vi.fn(() => null),
  requireSameOrigin: mocks.requireSameOrigin,
}));
vi.mock("@/lib/api/resource-capacity", () => ({
  requireResourceCapacity: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/spreadsheets/xlsx-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spreadsheets/xlsx-security")>();
  return { ...actual, prepareXlsxArchive: mocks.prepareArchive };
});
vi.mock("@/lib/reajuste-salarial/parser", () => ({
  parseSalaryAdvanceWorkbook: mocks.parseWorkbook,
}));
vi.mock("@/lib/reajuste-salarial/pdf", () => ({
  generateSalaryAdvancePdf: mocks.generatePdf,
}));
vi.mock("@/lib/usage/record", () => ({ recordUserUsage: mocks.recordUsage }));
vi.mock("@/lib/system/resource-capacity", () => ({
  getRequestContentLength: vi.fn(() => 100),
}));

import { GET, POST } from "./route";

function request(files: File[], percentage = "4,42") {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  form.set("percentage", percentage);
  return new Request("http://localhost/api/reajuste-salarial/gerar", {
    method: "POST",
    headers: { origin: "http://localhost" },
    body: form,
  });
}

function xlsx(name = "06-2026.xlsx") {
  return new File([Buffer.from("xlsx")], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSameOrigin.mockReturnValue(null);
  mocks.rateLimit.mockResolvedValue(null);
  mocks.auth.mockResolvedValue(null);
  mocks.requireReajusteAccess.mockResolvedValue({
    ok: true,
    moduleSessionId: "module-session-1",
    operatorName: "Dp Planalto",
    tenantId: "tenant-1",
  });
  mocks.parseWorkbook.mockImplementation(async (_bytes, competency, sourceFile) => ({
    competency,
    sourceFile,
    sourceSheet: "Plan1",
    rows: [{
      competency,
      sourceFile,
      sourceSheet: "Plan1",
      sourceRow: 7,
      branchAlias: "MATRIZ",
      registration: "0001",
      employeeName: "ANA TESTE",
      baseCents: 100_000n,
    }],
  }));
  mocks.generatePdf.mockResolvedValue(Buffer.from("%PDF-test"));
});

describe("salary adjustment PDF API", () => {
  it("accepts only POST", () => {
    expect(GET().status).toBe(405);
    expect(GET().headers.get("allow")).toBe("POST");
  });

  it("requires the module password session", async () => {
    mocks.requireReajusteAccess.mockResolvedValueOnce({
      ok: false,
      response: Response.json(
        { error: { code: "REAJUSTE_ACCESS_REQUIRED" } },
        { status: 401 },
      ),
    });
    expect((await POST(request([xlsx()]))).status).toBe(401);
    expect(mocks.parseWorkbook).not.toHaveBeenCalled();
  });

  it("rejects formats other than xlsx", async () => {
    const response = await POST(
      request([new File(["x"], "06-2026.xls", { type: "application/vnd.ms-excel" })]),
    );
    expect(response.status).toBe(400);
    expect(mocks.prepareArchive).not.toHaveBeenCalled();
  });

  it("generates a static PDF anonymously after module unlock", async () => {
    const response = await POST(request([xlsx(), xlsx("07-2026.xlsx")]));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-disposition")).toContain("06-2026-a-07-2026.pdf");
    expect(mocks.prepareArchive).toHaveBeenCalledTimes(2);
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "PDF",
        operation: "ANTECIPACAO_SALARIAL",
        userId: undefined,
      }),
    );
  });
});
