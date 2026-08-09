import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  parseAddressRows: vi.fn(),
  parseBeneficiaryCsvFiles: vi.fn(),
  parseInvoiceCsvFiles: vi.fn(),
  parseUnimedMasterWorkbook: vi.fn(),
  publishUnimedImport: vi.fn(),
  readXlsxFile: vi.fn(),
  requireUnimedAccess: vi.fn(),
  validateUnimedXlsxArchive: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/unimed/importer", () => {
  class UnimedImportValidationError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "UnimedImportValidationError";
    }
  }

  return {
    UNIMED_IMPORT_LIMITS: {
      maxFiles: 50,
      maxFileBytes: 10 * 1024 * 1024,
      maxTotalBytes: 20 * 1024 * 1024,
    },
    parseAddressRows: mocks.parseAddressRows,
    parseBeneficiaryCsvFiles: mocks.parseBeneficiaryCsvFiles,
    parseInvoiceCsvFiles: mocks.parseInvoiceCsvFiles,
    UnimedImportValidationError,
  };
});

vi.mock("@/lib/unimed/publisher", () => {
  class UnimedPublishError extends Error {
    constructor(
      readonly code:
        | "IMPORT_REJECTED"
        | "IMPORT_IN_PROGRESS"
        | "INVALID_ACTOR"
        | "MISSING_BRANCH",
      message: string,
    ) {
      super(message);
      this.name = "UnimedPublishError";
    }
  }

  return {
    publishUnimedImport: mocks.publishUnimedImport,
    UnimedPublishError,
  };
});

vi.mock("@/lib/unimed/master-workbook", () => ({
  parseUnimedMasterWorkbook: mocks.parseUnimedMasterWorkbook,
}));

vi.mock("read-excel-file/node", () => ({
  default: mocks.readXlsxFile,
}));

vi.mock("@/lib/unimed/xlsx-security", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/unimed/xlsx-security")>();
  return {
    ...actual,
    validateUnimedXlsxArchive: mocks.validateUnimedXlsxArchive,
  };
});

import { GET, POST } from "@/app/api/unimed/imports/route";
import { UnimedImportValidationError } from "@/lib/unimed/importer";
import { UnimedPublishError } from "@/lib/unimed/publisher";

const beneficiarySource = {
  fileCount: 1,
  checksum: "beneficiary-checksum",
  rows: [{ sourceKey: "beneficiary-1" }],
  rejectedCount: 0,
  skippedCount: 0,
  diagnostics: [],
};

const invoiceSource = {
  fileCount: 1,
  checksum: "invoice-checksum",
  rows: [{ sourceKey: "invoice-1" }],
  rejectedCount: 0,
  skippedCount: 0,
  diagnostics: [],
};

const addressSource = {
  fileCount: 1,
  checksum: "address-checksum",
  rows: [{ registration: "address-1" }],
  rejectedCount: 0,
  skippedCount: 0,
  diagnostics: [],
};

let requestSequence = 1;

function importRequest(
  options: {
    addressName?: string;
    includeAddress?: boolean;
    includeBeneficiaries?: boolean;
    includeInvoices?: boolean;
    includeMaster?: boolean;
    origin?: string;
  } = {},
) {
  const data = new FormData();
  data.set("year", "2026");
  data.set("month", "7");
  if (options.includeMaster) {
    data.set(
      "workbookFile",
      new File(["xlsm"], "CALCULO UNIMED.xlsm", {
        type: "application/vnd.ms-excel.sheet.macroEnabled.12",
      }),
    );
  }
  if (!options.includeMaster && options.includeBeneficiaries !== false) {
    data.append(
      "beneficiaryFiles",
      new File(["beneficiaries"], "beneficiarios.csv", {
        type: "text/csv",
      }),
    );
  }
  if (!options.includeMaster && options.includeInvoices !== false) {
    data.append(
      "invoiceFiles",
      new File(["invoices"], "faturas.csv", {
        type: "text/csv",
      }),
    );
  }
  if (!options.includeMaster && options.includeAddress !== false) {
    data.set(
      "addressFile",
      new File(["xlsx"], options.addressName ?? "enderecos.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
  }

  const request = new Request("http://localhost/api/unimed/imports", {
    method: "POST",
    headers: {
      origin: options.origin ?? "http://localhost",
      "x-forwarded-for": `127.0.1.${requestSequence++}`,
    },
    body: data,
  });
  return request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUnimedAccess.mockResolvedValue({
    ok: true,
    moduleSessionId: "module-session-1",
    tenantId: "tenant-12345678",
    accessLevel: "MANAGER",
  });
  mocks.parseBeneficiaryCsvFiles.mockReturnValue(beneficiarySource);
  mocks.parseInvoiceCsvFiles.mockReturnValue(invoiceSource);
  mocks.parseAddressRows.mockReturnValue(addressSource);
  mocks.parseUnimedMasterWorkbook.mockReturnValue({
    beneficiaries: beneficiarySource,
    invoiceItems: invoiceSource,
    addresses: addressSource,
  });
  mocks.readXlsxFile.mockResolvedValue([
    {
      sheet: "Endereços",
      data: [["CADASTRO"], ["1"]],
    },
  ]);
  mocks.publishUnimedImport.mockResolvedValue({
    idempotent: false,
    ready: true,
    missingSources: [],
    competencyId: "competency-1",
    batchId: "batch-1",
    summary: {
      beneficiaries: 1,
      invoiceItems: 1,
      addresses: 1,
      branches: 1,
      skippedRows: 0,
      warnings: {
        unmatchedInvoiceItems: 0,
        unmatchedDependents: 0,
        ambiguousPlanCodes: 0,
      },
      information: { addressOnlyRows: 0 },
    },
  });
});

describe("Unimed import API", () => {
  it("accepts only POST", () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("rejects another origin before checking module access", async () => {
    const response = await POST(
      importRequest({ origin: "https://attacker.test" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).not.toHaveBeenCalled();
  });

  it("requires PUBLISH permission", async () => {
    mocks.requireUnimedAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: "UNIMED_FORBIDDEN" } },
        { status: 403 },
      ),
    });

    const response = await POST(importRequest());

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).toHaveBeenCalledWith("PUBLISH");
    expect(mocks.parseBeneficiaryCsvFiles).not.toHaveBeenCalled();
  });

  it("accepts one source independently and validates an address when present", async () => {
    const partial = await POST(
      importRequest({ includeInvoices: false, includeAddress: false }),
    );
    const wrongAddress = await POST(
      importRequest({ addressName: "enderecos.csv" }),
    );

    expect(partial.status).toBe(201);
    expect(mocks.parseInvoiceCsvFiles).not.toHaveBeenCalled();
    expect(mocks.readXlsxFile).not.toHaveBeenCalled();
    expect(mocks.publishUnimedImport).toHaveBeenCalledWith(
      expect.objectContaining({
        beneficiaries: beneficiarySource,
        invoiceItems: undefined,
        addresses: undefined,
      }),
    );
    expect(wrongAddress.status).toBe(400);
    await expect(wrongAddress.json()).resolves.toMatchObject({
      error: { code: "UNIMED_ADDRESS_FILE_INVALID" },
    });
  });

  it("rejects a request without any source", async () => {
    const response = await POST(
      importRequest({
        includeBeneficiaries: false,
        includeInvoices: false,
        includeAddress: false,
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNIMED_FILES_REQUIRED" },
    });
  });

  it("rejects an oversized multipart body before reading files", async () => {
    const request = importRequest();
    request.headers.set(
      "content-length",
      String(20 * 1024 * 1024 + 1024 * 1024 + 1),
    );

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(mocks.parseBeneficiaryCsvFiles).not.toHaveBeenCalled();
    expect(mocks.readXlsxFile).not.toHaveBeenCalled();
  });

  it("parses every source in memory and publishes inside the session tenant", async () => {
    const response = await POST(importRequest());

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.parseBeneficiaryCsvFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "beneficiarios.csv",
        bytes: expect.any(Buffer),
      }),
    ]);
    expect(mocks.parseInvoiceCsvFiles).toHaveBeenCalledWith([
      expect.objectContaining({
        name: "faturas.csv",
        bytes: expect.any(Buffer),
      }),
    ]);
    expect(mocks.readXlsxFile).toHaveBeenCalledWith(expect.any(Buffer));
    expect(mocks.parseAddressRows).toHaveBeenCalledWith("enderecos.xlsx", [
      ["CADASTRO"],
      ["1"],
    ]);
    expect(mocks.publishUnimedImport).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-12345678",
        moduleSessionId: "module-session-1",
        year: 2026,
        month: 7,
        beneficiaries: beneficiarySource,
        invoiceItems: invoiceSource,
        addresses: addressSource,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      import: {
        idempotent: false,
        competencyId: "competency-1",
        batchId: "batch-1",
      },
    });
  });

  it("imports the master XLSM as one idempotent publication", async () => {
    mocks.readXlsxFile.mockResolvedValue([
      { sheet: "Unimed", data: [["CODIGO"], ["1"]] },
      { sheet: "Fatura", data: [["CONTRATO"], ["1"]] },
      { sheet: "Endereço", data: [["CADASTRO"], ["1"]] },
    ]);

    const response = await POST(importRequest({ includeMaster: true }));

    expect(response.status).toBe(201);
    expect(mocks.validateUnimedXlsxArchive).toHaveBeenCalledWith(
      expect.any(Buffer),
    );
    expect(mocks.parseUnimedMasterWorkbook).toHaveBeenCalledWith(
      "CALCULO UNIMED.xlsm",
      expect.arrayContaining([
        expect.objectContaining({ sheet: "Unimed" }),
        expect.objectContaining({ sheet: "Fatura" }),
        expect.objectContaining({ sheet: "Endereço" }),
      ]),
    );
    expect(mocks.publishUnimedImport).toHaveBeenCalledWith(
      expect.objectContaining({
        beneficiaries: beneficiarySource,
        invoiceItems: invoiceSource,
        addresses: addressSource,
      }),
    );
  });

  it("uses the current read-excel-file workbook sheet shape", async () => {
    mocks.readXlsxFile.mockResolvedValue([
      { sheet: "Primeira", data: [["A"]] },
      { sheet: "Segunda", data: [["B"]] },
    ]);

    const response = await POST(importRequest());

    expect(response.status).toBe(201);
    expect(mocks.parseAddressRows).toHaveBeenCalledWith("enderecos.xlsx", [
      ["A"],
    ]);
  });

  it("maps publication conflicts without exposing internal messages", async () => {
    mocks.publishUnimedImport.mockRejectedValue(
      new UnimedPublishError(
        "IMPORT_IN_PROGRESS",
        "CPF 12345678900 já estava sendo processado",
      ),
    );

    const response = await POST(importRequest());
    const text = await response.text();

    expect(response.status).toBe(409);
    expect(text).toContain("IMPORT_IN_PROGRESS");
    expect(text).not.toContain("12345678900");
  });

  it("does not misreport unexpected failures as a file validation error", async () => {
    mocks.parseBeneficiaryCsvFiles.mockImplementation(() => {
      throw new Error("Linha de Fulano, CPF 12345678900, inválida");
    });

    const response = await POST(importRequest());
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("UNIMED_IMPORT_FAILED");
    expect(text).not.toContain("Fulano");
    expect(text).not.toContain("12345678900");
  });

  it("identifies an unreadable address workbook", async () => {
    mocks.readXlsxFile.mockRejectedValue(new Error("corrupt XLSX internals"));

    const response = await POST(importRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: { code: "UNIMED_ADDRESS_FILE_INVALID" },
    });
    expect(body.error.message).toContain("não pôde ser lida como XLSX");
    expect(body.error.message).not.toContain("internals");
  });

  it("returns safe actionable details for known file validation errors", async () => {
    mocks.parseBeneficiaryCsvFiles.mockImplementation(() => {
      throw new UnimedImportValidationError(
        "UNIMED_BENEFICIARY_FILES_INVALID",
        "Arquivos de beneficiários: ANCHIETA.csv não possui as colunas NOME e CPF. Confira os campos corretos.",
      );
    });

    const response = await POST(importRequest());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      error: {
        code: "UNIMED_BENEFICIARY_FILES_INVALID",
      },
    });
    expect(body.error.message).toContain("Arquivos de beneficiários");
    expect(body.error.message).toContain("ANCHIETA.csv");
  });
});
