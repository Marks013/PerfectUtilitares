import { describe, expect, it, vi } from "vitest";
import { readSheet } from "read-excel-file/node";
import { PDFDocument, PDFPage } from "pdf-lib";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import { mixedWeeklyApplication } from "./mixed-week-report";
import { buildOperationalReport } from "./operational-report";
import { operationalReportOptionsSchema } from "./operational-report-contracts";
import { exportOperationalReportPdf } from "./operational-report-pdf";
import type { EscalaWorkspace } from "./types";

function fixture(): EscalaWorkspace {
  const input = newInput("06", "Loja sintética", "2026-12", 42);
  input.employees = [{ ...newEmployee(42, "day"), id: "person", registration: "0001", name: "Pessoa sintética", sector: "Caixa", role: "Operador" }];
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.assignments = [{ employeeId: "person", date: "2026-12-06", kind: "OFF" }, { employeeId: "person", date: "2026-12-07", kind: "WORK", shiftId: "day" }];
  return { id: "calendar-report", revision: 3, status: "DRAFT", input, canEdit: true, canPublish: false, updatedAt: "2026-11-18T00:00:00Z",
    validation: { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null } };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
  const document = await task.promise;
  try {
    const text: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      expect([viewport.width, viewport.height]).toEqual([842, 595]);
      for (const item of content.items) if ("str" in item) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(25);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(viewport.width - 25);
        expect(item.transform[5]).toBeGreaterThanOrEqual(16);
        text.push(item.str);
      }
    }
    return text.join(" ");
  } finally { await task.destroy(); }
}

describe("Sunday planning calendar in the generated files", () => {
  it("assigns Sunday to the new weekly application without changing weekday identifiers or legacy reports", () => {
    const source = fixture(); source.input.mixed42Sectors = ["Caixa"];
    const dates = ["2026-12-04", "2026-12-06"], person = source.input.employees[0];
    expect(mixedWeeklyApplication(source.input, person, dates)).toBe("29/11–05/12: 1 dia · Sex 04\n06/12–12/12: 1 dia · Dom 06");
    const legacy = { ...source.input, planningWeekStartsOn: undefined, startDate: "2026-11-30", endDate: "2027-01-03" };
    expect(mixedWeeklyApplication(legacy, person, dates)).toBe("30/11–06/12: 2 dias · Sex 04, Dom 06");
    expect(source.input.planningWeekStartsOn).toBe("SUNDAY");
  });

  it.each(["rest", "hours", "both"] as const)("exports actual %s files with explicit convention and the saved day assignments", async mode => {
    const source = fixture(), before = structuredClone(source);
    const bytes = exportEscalaXlsx(source, mode);
    const name = mode === "hours" ? "Horarios" : "Escala";
    const rows = await readSheet(Buffer.from(bytes), name);
    expect(rows[2][0]).toContain("Semana: domingo a sábado");
    if (mode !== "hours") {
      expect(rows[3][10]).toBe("06\nDom");
      expect(rows[3][11]).toBe("07\nSeg");
      const row = rows.find(row => row[1] === "0001");
      expect(row?.[10]).toBe("F");
      expect(row?.[11]).toMatch(/^T\d+$/);
    }
    const pdf = await exportEscalaPdf(source, mode);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(0);
    const text = await pdfText(pdf);
    expect(text).toContain("Semana: domingo a sábado");
    expect(text).toContain("Pessoa sintética");
    expect(source).toEqual(before);
  });

  it("identifies a legacy saved report without silently reclassifying its week", async () => {
    const source = fixture();
    delete source.input.planningWeekStartsOn;
    source.input.startDate = "2026-11-30"; source.input.endDate = "2027-01-03";
    const before = structuredClone(source);
    expect((await readSheet(Buffer.from(exportEscalaXlsx(source, "rest")), "Escala"))[2][0]).toContain("Semana: segunda a domingo");
    expect(await pdfText(await exportEscalaPdf(source, "rest"))).toContain("Semana: segunda a domingo");
    expect(source).toEqual(before);
  });

  it("uses the saved convention for operational PDF week blocks and keeps bounded content", async () => {
    const source = fixture();
    const options = operationalReportOptionsSchema.parse({ workspaceId: source.id, revision: source.revision, month: "2026-12", sections: ["calendar"] });
    const model = buildOperationalReport(source, options);
    expect(model.planningWeekStartsOn).toBe("SUNDAY");
    const drawn: string[] = [], original = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, value, drawOptions) {
      drawn.push(value); return original.call(this, value, drawOptions);
    });
    try {
      const bytes = await exportOperationalReportPdf(model);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
      expect(drawn.join(" ")).toContain("Semana: domingo a sábado");
      expect(drawn.filter(line => line.startsWith("Semanas civis:")).join(" ")).toContain("29/11, 06/12, 13/12, 20/12, 27/12");
      expect(await pdfText(bytes)).toContain("Pessoa sintética");
    } finally { spy.mockRestore(); }
  });
});
