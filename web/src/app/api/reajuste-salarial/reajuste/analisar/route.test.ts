import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireAccess: vi.fn(),
  requireOrigin: vi.fn(),
  rateLimit: vi.fn(),
  parseWorkbook: vi.fn(),
  prepareArchive: vi.fn((bytes: Buffer) => bytes),
  recordUsage: vi.fn(),
  runWithGate: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/reajuste-salarial/access.server", () => ({
  requireReajusteAccess: mocks.requireAccess,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/api/security", () => ({
  enforcePersistentRateLimit: mocks.rateLimit,
  jsonError: (status: number, code: string, message: string, details?: unknown) =>
    Response.json({ error: { code, message, details } }, { status }),
  methodNotAllowed: (allowed: string[]) =>
    new Response(null, { status: 405, headers: { Allow: allowed.join(", ") } }),
  requireContentType: vi.fn(() => null),
  requireMaxContentLength: vi.fn(() => null),
  requireSameOrigin: mocks.requireOrigin,
}));
vi.mock("@/lib/api/resource-capacity", () => ({
  requireResourceCapacity: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/spreadsheets/xlsx-security", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spreadsheets/xlsx-security")>();
  return { ...actual, prepareXlsxArchive: mocks.prepareArchive };
});
vi.mock("@/lib/reajuste-salarial/fpre131-parser", () => ({
  parseFpre131Workbook: mocks.parseWorkbook,
}));
vi.mock("@/lib/reajuste-salarial/processing-gate", () => ({
  runWithReajusteProcessingSlot: mocks.runWithGate,
}));
vi.mock("@/lib/usage/record", () => ({ recordUserUsage: mocks.recordUsage }));
vi.mock("@/lib/system/resource-capacity", () => ({
  getRequestContentLength: vi.fn(() => 100),
}));

import { GET, POST } from "./route";

function request() {
  const form = new FormData();
  form.set(
    "file",
    new File([Buffer.from("xlsx")], "FPRE131.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  return new Request("http://localhost/api/reajuste-salarial/reajuste/analisar", {
    method: "POST",
    headers: { "content-length": "1024", origin: "http://localhost" },
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrigin.mockReturnValue(null);
  mocks.rateLimit.mockResolvedValue(null);
  mocks.runWithGate.mockImplementation(async (operation: () => Promise<Response>) => ({
    status: "acquired",
    value: await operation(),
  }));
  mocks.auth.mockResolvedValue(null);
  mocks.requireAccess.mockResolvedValue({ ok: true, moduleSessionId: "module-1" });
  mocks.parseWorkbook.mockResolvedValue({
    sourceFile: "FPRE131.xlsx",
    sourceSheet: "Plan1",
    employees: [{
      sourceFile: "FPRE131.xlsx",
      sourceSheet: "Plan1",
      sourceRow: 4,
      branchAlias: "Matriz",
      registration: "4",
      employeeName: "ANA TESTE",
      role: "CAIXA",
      currentSalaryCents: 203_194n,
    }],
  });
});

describe("FPRE131 analysis API", () => {
  it("accepts only POST", () => {
    expect(GET().status).toBe(405);
  });

  it("returns a real analysis after module unlock", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.analysis).toMatchObject({
      sourceFile: "FPRE131.xlsx",
      employeeCount: 1,
      branchCount: 1,
      distinctSalaryCount: 1,
    });
    expect(body.analysis.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.analysis.employees[0].currentSalaryCents).toBe("203194");
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "REAJUSTE_SALARIAL_ANALISE" }),
    );
  });
});
