import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireAccess: vi.fn(),
  requireOrigin: vi.fn(),
  rateLimit: vi.fn(),
  parseWorkbook: vi.fn(),
  generatePdf: vi.fn(),
  prepareArchive: vi.fn((bytes: Buffer) => bytes),
  recordUsage: vi.fn(),
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
vi.mock("@/lib/reajuste-salarial/salary-revision-pdf", () => ({
  generateSalaryRevisionPdf: mocks.generatePdf,
}));
vi.mock("@/lib/usage/record", () => ({ recordUserUsage: mocks.recordUsage }));
vi.mock("@/lib/system/resource-capacity", () => ({
  getRequestContentLength: vi.fn(() => 100),
}));

import { GET, POST } from "./route";

const fileBytes = Buffer.from("xlsx");
const fileHash = createHash("sha256").update(fileBytes).digest("hex");

function request(hash = fileHash) {
  const form = new FormData();
  form.set(
    "file",
    new File([fileBytes], "FPRE131.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  form.set("fileHash", hash);
  form.set("percentage", "4,42");
  form.set("rules", "[]");
  return new Request("http://localhost/api/reajuste-salarial/reajuste/gerar", {
    method: "POST",
    headers: { origin: "http://localhost" },
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireOrigin.mockReturnValue(null);
  mocks.rateLimit.mockResolvedValue(null);
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
  mocks.generatePdf.mockResolvedValue(Buffer.from("%PDF-test"));
});

describe("salary revision PDF API", () => {
  it("accepts only POST", () => {
    expect(GET().status).toBe(405);
  });

  it("reparses the file and generates a PDF from server calculations", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("reajuste-salarial.pdf");
    expect(mocks.parseWorkbook).toHaveBeenCalledOnce();
    expect(mocks.generatePdf).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "REAJUSTE_SALARIAL" }),
    );
  });

  it("rejects a file changed after analysis", async () => {
    const response = await POST(request("a".repeat(64)));
    expect(response.status).toBe(400);
    expect(mocks.parseWorkbook).not.toHaveBeenCalled();
  });
});
