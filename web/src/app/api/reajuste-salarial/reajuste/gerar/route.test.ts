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
vi.mock("@/lib/reajuste-salarial/salary-revision-pdf", () => ({
  generateSalaryRevisionPdf: mocks.generatePdf,
}));
vi.mock("@/lib/reajuste-salarial/processing-gate", () => ({
  runWithReajusteProcessingSlot: mocks.runWithGate,
}));
vi.mock("@/lib/usage/record", () => ({ recordUserUsage: mocks.recordUsage }));
vi.mock("@/lib/system/resource-capacity", () => ({
  getRequestContentLength: vi.fn(() => 100),
}));

import { GET, POST } from "./route";

const fileBytes = Buffer.from("xlsx");
const fileHash = createHash("sha256").update(fileBytes).digest("hex");

function request(
  hash = fileHash,
  scope: string | null = "all",
  rules = "[]",
  percentage?: string,
) {
  const form = new FormData();
  form.set(
    "file",
    new File([fileBytes], "FPRE131.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  form.set("fileHash", hash);
  if (scope !== null) form.set("scope", scope);
  if (percentage !== undefined || scope !== "rules_only") form.set("percentage", percentage ?? "4,42");
  form.set("rules", rules);
  return new Request("http://localhost/api/reajuste-salarial/reajuste/gerar", {
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
    employees: [
      {
        sourceFile: "FPRE131.xlsx",
        sourceSheet: "Plan1",
        sourceRow: 4,
        branchAlias: "Matriz",
        registration: "4",
        employeeName: "ANA TESTE",
        role: "CAIXA",
        currentSalaryCents: 203_194n,
      },
      {
        sourceFile: "FPRE131.xlsx",
        sourceSheet: "Plan1",
        sourceRow: 5,
        branchAlias: "Matriz",
        registration: "5",
        employeeName: "BIA TESTE",
        role: "CAIXA",
        currentSalaryCents: 174_570n,
      },
    ],
  });
  mocks.generatePdf.mockResolvedValue(Buffer.from("%PDF-test"));
});

describe("salary revision PDF API", () => {
  it("calculates selected general and own percentage rules on the server", async () => {
    const rules = JSON.stringify([
      { id: "general", name: "Geral", minimumSalaryCents: "203194", maximumSalaryCents: "203194", selectedRegistrations: ["4"], calculation: "general_percentage", roleFilter: "cáixa" },
      { id: "own", name: "Próprio", minimumSalaryCents: "174570", maximumSalaryCents: "174570", selectedRegistrations: ["5"], calculation: "percentage", percentageBasisPoints: "227" },
    ]);
    const response = await POST(request(fileHash, "rules_only", rules, "1,08"));
    expect(response.status).toBe(200);
    const report = mocks.generatePdf.mock.calls[0][0];
    expect(report.generalPercentageBasisPoints).toBe(108n);
    expect(report.employeeCount).toBe(2);
    expect(report.groups[0].employees.map((employee: { adjustmentCents: bigint }) => employee.adjustmentCents)).toEqual([2194n, 3963n]);
    expect(report.totalAdjustmentCents).toBe(6157n);
  });

  it("accepts own percentages without a general value in selected scope", async () => {
    const rules = JSON.stringify([{ id: "own", name: "Próprio", minimumSalaryCents: "0", maximumSalaryCents: "300000", selectedRegistrations: ["5"], calculation: "percentage", percentageBasisPoints: "227" }]);
    expect((await POST(request(fileHash, "rules_only", rules))).status).toBe(200);
    expect(mocks.generatePdf.mock.calls[0][0]).toMatchObject({ generalPercentageBasisPoints: null, employeeCount: 1, totalAdjustmentCents: 3963n });
  });

  it("rejects a selected general rule without its required percentage", async () => {
    const rules = JSON.stringify([{ id: "general", name: "Geral", minimumSalaryCents: "0", maximumSalaryCents: "300000", selectedRegistrations: ["4"], calculation: "general_percentage" }]);
    expect((await POST(request(fileHash, "rules_only", rules))).status).toBe(400);
    expect(mocks.parseWorkbook).not.toHaveBeenCalled();
  });
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

  it("generates only selected employees from multiple rules without a percentage", async () => {
    const rules = JSON.stringify([
      {
        id: "rule-1",
        name: "Categoria",
        minimumSalaryCents: "203194",
        maximumSalaryCents: "203194",
        newSalaryCents: "212000",
        selectedRegistrations: ["4"],
      },
      {
        id: "rule-2",
        name: "Categoria reduzida",
        minimumSalaryCents: "174570",
        maximumSalaryCents: "174570",
        newSalaryCents: "180000",
        selectedRegistrations: ["5"],
      },
    ]);
    const response = await POST(request(fileHash, "rules_only", rules));
    expect(response.status).toBe(200);
    expect(mocks.generatePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        adjustmentScope: "rules_only",
        generalPercentageBasisPoints: null,
        employeeCount: 2,
        generalEmployeeCount: 0,
        specialEmployeeCount: 2,
      }),
    );
  });

  it("keeps the all-employees behavior when older clients omit scope", async () => {
    const response = await POST(request(fileHash, null));
    expect(response.status).toBe(200);
    expect(mocks.generatePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        adjustmentScope: "all",
        generalPercentageBasisPoints: 442n,
        generalEmployeeCount: 2,
      }),
    );
  });

  it("rejects an unknown adjustment scope before parsing the workbook", async () => {
    const response = await POST(request(fileHash, "invalid"));
    expect(response.status).toBe(400);
    expect(mocks.parseWorkbook).not.toHaveBeenCalled();
  });
});
