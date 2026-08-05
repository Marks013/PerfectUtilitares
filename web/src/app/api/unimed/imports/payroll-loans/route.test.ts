import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  parsePayrollLoanRows: vi.fn(),
  publishPayrollLoanImport: vi.fn(),
  readXlsxFile: vi.fn(),
  requireUnimedAccess: vi.fn(),
  validateUnimedXlsxArchive: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));
vi.mock("read-excel-file/node", () => ({ default: mocks.readXlsxFile }));
vi.mock("@/lib/unimed/xlsx-security", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/unimed/xlsx-security")>();
  return {
    ...actual,
    validateUnimedXlsxArchive: mocks.validateUnimedXlsxArchive,
  };
});
vi.mock("@/lib/unimed/importer", () => ({
  UNIMED_IMPORT_LIMITS: {
    maxFiles: 50,
    maxFileBytes: 10 * 1024 * 1024,
    maxTotalBytes: 20 * 1024 * 1024,
  },
  UnimedImportValidationError: class UnimedImportValidationError extends Error {},
  parsePayrollLoanRows: mocks.parsePayrollLoanRows,
}));
vi.mock("@/lib/unimed/payroll-loan-publisher", () => ({
  publishPayrollLoanImport: mocks.publishPayrollLoanImport,
}));
vi.mock("@/lib/unimed/publisher", () => ({
  UnimedPublishError: class UnimedPublishError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

import { POST } from "@/app/api/unimed/imports/payroll-loans/route";

let requestSequence = 1;

function requestWith(file = true) {
  const body = new FormData();
  body.set("year", "2026");
  body.set("month", "8");
  if (file) {
    body.set(
      "payrollLoanFile",
      new File([new Uint8Array([80, 75, 3, 4])], "consignado.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
  }
  return new Request("http://localhost/api/unimed/imports/payroll-loans", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      "x-forwarded-for": `127.0.2.${requestSequence++}`,
    },
    body,
  });
}

const parsedSource = {
  fileCount: 1,
  checksum: "checksum",
  rows: [
    {
      sourceKey: "loan-1",
      sourceRow: 2,
      competence: "2026-08",
      cpfNormalized: "52998224725",
      registration: "4689",
      employeeName: "JOAO",
      contractNumber: "CTR-1",
      installmentAmount: 100,
      startCompetence: "2026-08",
      endCompetence: "2027-07",
      bankCode: "341",
      bankName: "BANCO",
      totalInstallments: 12,
      loanAmount: 1200,
      releasedAmount: 1100,
      contractStartDate: "2026-08-01",
      contractEndDate: "2027-07-01",
      companyCnpj: "76361807000111",
    },
  ],
  rejectedCount: 0,
  skippedCount: 0,
  diagnostics: [],
  sourceSheet: "Planilha1",
};

describe("Unimed payroll loan import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUnimedAccess.mockResolvedValue({
      ok: true,
      tenantId: "tenant-1",
      moduleSessionId: "module-session-1",
      accessLevel: "MANAGER",
    });
    mocks.readXlsxFile.mockResolvedValue([
      { sheet: "GERAL", data: [["unsafe"]] },
      { sheet: "Planilha1", data: [["safe"]] },
    ]);
    mocks.parsePayrollLoanRows.mockReturnValue(parsedSource);
    mocks.publishPayrollLoanImport.mockResolvedValue({
      idempotent: false,
      competencyId: "competency-1",
      batchId: "batch-1",
      summary: {
        payrollLoans: 1,
        totalInstallmentAmount: 100,
        matchedByCpf: 1,
        matchedByRegistration: 0,
        unmatched: 0,
        warnings: 0,
        sourceSheet: "Planilha1",
      },
    });
  });

  it("requires one XLSX file", async () => {
    const response = await POST(requestWith(false));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNIMED_PAYROLL_LOAN_FILE_REQUIRED" },
    });
  });

  it("prefers Planilha1 and publishes inside the module tenant", async () => {
    const response = await POST(requestWith());
    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.parsePayrollLoanRows).toHaveBeenCalledWith(
      "consignado.xlsx",
      "Planilha1",
      [["safe"]],
      { year: 2026, month: 8 },
    );
    expect(mocks.publishPayrollLoanImport).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        moduleSessionId: "module-session-1",
        year: 2026,
        month: 8,
        loans: parsedSource,
      }),
    );
  });

  it("does not publish rejected rows", async () => {
    mocks.parsePayrollLoanRows.mockReturnValue({
      ...parsedSource,
      rows: [],
      rejectedCount: 1,
      diagnostics: [{ severity: "ERROR", code: "INVALID", row: 2 }],
    });
    const response = await POST(requestWith());
    expect(response.status).toBe(400);
    expect(mocks.publishPayrollLoanImport).not.toHaveBeenCalled();
  });
});
