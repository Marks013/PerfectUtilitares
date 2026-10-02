import { beforeEach, describe, expect, it, vi } from "vitest";
import { beforeSendScrubber } from "@/sentry.shared";
import { strToU8, zipSync } from "fflate";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireReajusteAccess: vi.fn(),
  requireSameOrigin: vi.fn(),
  rateLimit: vi.fn(),
  parseWorkbook: vi.fn(),
  generatePdf: vi.fn(),
  recordUsage: vi.fn(),
  prepareArchive: vi.fn((bytes: Buffer) => bytes),
  runWithGate: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/reajuste-salarial/access.server", () => ({
  requireReajusteAccess: mocks.requireReajusteAccess,
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));

vi.mock("@sentry/nextjs", () => ({ captureException: mocks.captureException }));
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
vi.mock("@/lib/reajuste-salarial/parser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reajuste-salarial/parser")>();
  return { ...actual, parseSalaryAdvanceWorkbook: mocks.parseWorkbook };
});
vi.mock("@/lib/reajuste-salarial/pdf", () => ({
  generateSalaryAdvancePdf: mocks.generatePdf,
}));
vi.mock("@/lib/reajuste-salarial/processing-gate", () => ({
  runWithReajusteProcessingSlot: mocks.runWithGate,
}));
vi.mock("@/lib/usage/record", () => ({ recordUserUsage: mocks.recordUsage }));
vi.mock("@/lib/system/resource-capacity", () => ({
  getRequestContentLength: vi.fn(() => 100),
}));

import { GET, POST } from "./route";

function request(files: File[], percentage = "4,42", fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  form.set("percentage", percentage);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request("http://localhost/api/reajuste-salarial/gerar", {
    method: "POST",
    headers: { "content-length": "1024", origin: "http://localhost" },
    body: form,
  });
}

function monthlyWorkbook(name = "06-2026.xlsx", sundayPaid = "170,00", company = "EMPRESA TESTE", status = "Trabalhando", role = "OPERADOR") {
  const rows = [["0001", company, "Pág.:", "1"], ["FOLHA DE PAGAMENTO"], ["Local:", "01 MATRIZ"],
    ["Tipo:", "1", "Colaborador:", "1 - ANA TESTE", "Sit:", status], ["Cargo:", `0001 - ${role}`],
    ["565", "01", "Bonus Convenc. SINDECOMU", "", "1,00", "80,00"],
    ["901", "01", "Indenização Compensatória", "", "0,00", sundayPaid], ["INSS Proc:", "2.000,00"]];
  const xml = rows.map((row, index) => `<row r="${index + 1}">${row.map((cell, column) => `<c r="${String.fromCharCode(65 + column)}${index + 1}" t="inlineStr"><is><t>${cell}</t></is></c>`).join("")}</row>`).join("");
  const bytes = zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Plan1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${xml}</sheetData></worksheet>`),
  });
  return new File([new Uint8Array(bytes)], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const eventFields = { includeEvents: "true", bonusOldValue: "80,00", bonusNewValue: "90,00", sundayOldValue: "85,00", sundayNewValue: "90,00" };

async function useRealPipeline() {
  const parser = await vi.importActual<typeof import("@/lib/reajuste-salarial/parser")>("@/lib/reajuste-salarial/parser");
  const pdf = await vi.importActual<typeof import("@/lib/reajuste-salarial/pdf")>("@/lib/reajuste-salarial/pdf");
  const archive = await vi.importActual<typeof import("@/lib/spreadsheets/xlsx-security")>("@/lib/spreadsheets/xlsx-security");
  mocks.parseWorkbook.mockImplementation(parser.parseSalaryAdvanceWorkbook);
  mocks.generatePdf.mockImplementation(pdf.generateSalaryAdvancePdf);
  mocks.prepareArchive.mockImplementation(archive.prepareXlsxArchive);
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
  mocks.runWithGate.mockImplementation(async (operation: () => Promise<Response>) => ({
    status: "acquired",
    value: await operation(),
  }));
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
  mocks.prepareArchive.mockImplementation((bytes: Buffer) => bytes);
});

describe("salary adjustment PDF API", () => {
  it("applies precise packer percentage and monthly eligibility through real XLSX parsing and PDF generation", async () => {
    await useRealPipeline();
    const response = await POST(request([monthlyWorkbook("06-2026.xlsx", "170,00", "EMPRESA TESTE", "Trabalhando", "Embalador a mão"), monthlyWorkbook("07-2026.xlsx", "170,00", "EMPRESA TESTE", "Demitido", "Embalador a mão")], "1.08", { ...eventFields, packerPercentage: "2.2655" }));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    const report = mocks.generatePdf.mock.calls[0][0];
    expect(report.grandTotalCents).toBe(4531n);
    expect(report.groups[0].employees[0].adjustmentsByCompetency.get("07-2026")).toBe(0n);
    const events = mocks.generatePdf.mock.calls[0][1];
    expect(events.grandTotalCents).toBe("2000");
    expect(events.employees[0].months[1].exclusionReason).toContain("Demitido");
  });

  it("rejects an invalid special percentage before parsing files", async () => {
    const response = await POST(request([xlsx()], "1.08", { packerPercentage: "2.26555" }));
    expect(response.status).toBe(400);
    expect(mocks.parseWorkbook).not.toHaveBeenCalled();
  });
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

  it("keeps disabled events compatible and ignores unused event settings", async () => {
    const response = await POST(request([xlsx()], "5", { includeEvents: "false", bonusOldValue: "invalid" }));
    expect(response.status).toBe(200);
    expect(mocks.generatePdf).toHaveBeenCalledWith(expect.objectContaining({ grandTotalCents: 5000n }), undefined);
  });

  it("rejects invalid or repeated enablement and missing new values", async () => {
    const invalid = await POST(request([xlsx()], "5", { includeEvents: "yes" }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("REAJUSTE_RULE_INVALID");
    const form = new FormData();
    form.append("files", xlsx());
    form.set("percentage", "5");
    form.append("includeEvents", "false");
    form.append("includeEvents", "false");
    expect((await POST(new Request("http://localhost/api/reajuste-salarial/gerar", { method: "POST", body: form, headers: { "content-length": "1024" } }))).status).toBe(400);
    const missing = await POST(request([xlsx()], "5", { ...eventFields, bonusNewValue: "", sundayNewValue: "" }));
    expect(missing.status).toBe(400);
    expect(mocks.prepareArchive).not.toHaveBeenCalled();
  });

  it("generates a real integrated PDF from the same monthly XLSX bytes", async () => {
    await useRealPipeline();
    const { default: PDFDocument } = await import("pdfkit");
    const text = vi.spyOn(PDFDocument.prototype, "text");
    try {
    const response = await POST(request([monthlyWorkbook(), monthlyWorkbook("07-2026.xlsx")], "5", eventFields));
    expect(response.status).toBe(200);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(mocks.prepareArchive).toHaveBeenCalledTimes(2);
    expect(mocks.parseWorkbook).toHaveBeenCalledTimes(2);
    const [advance, events] = mocks.generatePdf.mock.calls[0];
    expect(advance.grandTotalCents).toBe(20000n);
    expect(events).toMatchObject({ bonusTotalCents: "2000", sundayTotalCents: "2000", grandTotalCents: "4000", issueCount: 0 });
    expect(events.generatedAt).toBe(advance.generatedAt.toISOString());
    const { PDFDocument: LoadedPdf } = await import("pdf-lib");
    const loaded = await LoadedPdf.load(bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(4);
    expect(loaded.getTitle()).toContain("bônus e domingos");
    const values = text.mock.calls.map((call) => String(call[0])).join("\n");
    for (const expected of ["240,00", "ANA TESTE", "565", "901"]) expect(values).toContain(expected);
    } finally { text.mockRestore(); }
  });

  it("generates the real legacy PDF when events are disabled", async () => {
    await useRealPipeline();
    const response = await POST(request([monthlyWorkbook()], "5", { includeEvents: "false" }));
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect(mocks.generatePdf).toHaveBeenCalledWith(expect.objectContaining({ grandTotalCents: 10000n }), undefined);
  });

  it("blocks pending events and mixed companies before rendering", async () => {
    await useRealPipeline();
    const pending = await POST(request([monthlyWorkbook("06-2026.xlsx", "171,00")], "5", eventFields));
    expect(pending.status).toBe(409);
    expect((await pending.json()).error.code).toBe("REAJUSTE_EVENTS_PENDING");
    const mixed = await POST(request([monthlyWorkbook(), monthlyWorkbook("07-2026.xlsx", "170,00", "OUTRA EMPRESA")], "5", eventFields));
    expect(mixed.status).toBe(400);
    expect((await mixed.json()).error.code).toBe("REAJUSTE_STRUCTURE_INVALID");
    expect(mocks.generatePdf).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
  });

  it("supports a single configured event and rejects historic overrides outside uploaded months", async () => {
    await useRealPipeline();
    const response = await POST(request([monthlyWorkbook()], "5", { ...eventFields, bonusNewValue: "" }));
    expect(response.status).toBe(200);
    expect(mocks.generatePdf.mock.calls[0][1]).toMatchObject({ bonusTotalCents: "0", sundayTotalCents: "1000", grandTotalCents: "1000" });
    const unknownMonth = await POST(request([monthlyWorkbook()], "5", { ...eventFields, historicOverrides: JSON.stringify([{ competencyKey: "08-2026", bonusOldValue: "80,00", sundayOldValue: "85,00" }]) }));
    expect(unknownMonth.status).toBe(400);
    expect((await unknownMonth.json()).error.code).toBe("REAJUSTE_RULE_INVALID");
    expect(mocks.generatePdf).toHaveBeenCalledTimes(1);
  });

  it("sanitizes unexpected monitoring errors without personal payload", async () => {
    mocks.parseWorkbook.mockRejectedValueOnce(new Error("PRIVATE_EMPLOYEE_PAYLOAD"));
    const response = await POST(request([xlsx()]));
    expect(response.status).toBe(503);
    const [error, context] = mocks.captureException.mock.calls[0];
    expect(error.message).not.toContain("PRIVATE_EMPLOYEE_PAYLOAD");
    expect(JSON.stringify(context)).not.toContain("PRIVATE_EMPLOYEE_PAYLOAD");
    const body = await response.json();
    const correlationId = body.error.message.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
    expect(correlationId).toBeDefined();
    const scrubbed = beforeSendScrubber({ tags: context.tags, extra: context.extra });
    expect(scrubbed?.tags.correlationId).toBe(correlationId);
    expect(scrubbed?.extra).toBeUndefined();
  });
});
