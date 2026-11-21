import { describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { OPERATIONAL_REPORT_SECTION_LABELS, operationalReportOptionsSchema } from "./operational-report-contracts";
import { buildOperationalReport } from "./operational-report";
import { exportOperationalReportPdf } from "./operational-report-pdf";
import type { EscalaWorkspace } from "./types";

function fixture(): EscalaWorkspace {
  const input = newInput("06", "Loja sintética", "2026-12", 42); input.visibleMonth = "2026-12";
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 900, kind: "BREAK" }, { start: 900, end: 1200, kind: "WORK" }] }];
  input.employees = Array.from({ length: 40 }, (_, i) => ({ ...newEmployee(42, "day"), id: String(i), registration: String(i), name: "Pessoa sintética com identificação completa " + i, sector: "Setor A", role: "Atendente" }));
  input.assignments = input.employees.map(person => ({ employeeId: person.id, date: "2026-12-01", kind: "WORK" as const, shiftId: "day" }));
  return { id: "synthetic", revision: 19, status: "DRAFT", input, canEdit: true, canPublish: false, updatedAt: "2026-12-01", validation: { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null } };
}

async function extractPages(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  const document = await loading.promise;
  try {
    const pages = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), content = await page.getTextContent();
      const items = content.items.filter((item): item is import("pdfjs-dist/types/src/display/api").TextItem => "str" in item);
      pages.push({ text: items.map(item => item.str).join(" ").replace(/\s+/g, " "), items, view: page.view });
    }
    return pages;
  } finally { await loading.destroy(); }
}
describe("optional operational PDF", () => {
  it("uses Brazilian Portuguese without exposing programming labels or internal identifiers", async () => {
    const workspace = fixture();
    workspace.input.employees = workspace.input.employees.slice(0, 2);
    workspace.input.assignments = workspace.input.assignments.slice(0, 2);
    workspace.updatedAt = "2026-12-01T13:30:00Z";
    const options = operationalReportOptionsSchema.parse({ workspaceId: workspace.id, revision: workspace.revision, month: "2026-12",
      sections: ["summary", "calendar", "journeys", "variants", "presence", "coverage"], date: "2026-12-01" });
    const pages = await extractPages(await exportOperationalReportPdf(buildOperationalReport(workspace, options)));
    const text = pages.map(page => page.text).join(" ");
    expect(text).toContain("dezembro de 2026");
    expect(text).toContain("01/12/2026 às 10:30");
    expect(text).toContain("01/12/2026 a 31/12/2026");
    expect(text).toContain("Colaboradores trabalhando");
    expect(text).not.toContain(workspace.id);
    expect(text).not.toMatch(/\b(?:WORK|DUTY|OFF|HOLIDAY|ABSENCE|UNTIMED|PAID_BREAK|BREAK)\b/);
    expect(text).not.toMatch(/OpenAI|ChatGPT|Codex|inteligência artificial|\bAPI\b|\bJSON\b|\d{4}-\d{2}-\d{2}T/i);
  });
  it.each([["2026-02", 28], ["2028-02", 29], ["2026-11", 30], ["2026-12", 31]] as const)("extracts one coherent monthly grid with real weeks and totals in %s", async (month, days) => {
    const workspace = fixture(), previous = workspace.input;
    workspace.input = { ...newInput("06", "Loja sintética", month, 42), visibleMonth: month,
      shifts: previous.shifts, employees: previous.employees.slice(0, 2), assignments: [] };
    workspace.input.employees[0].name = "AlphaCalendar";
    workspace.input.employees[1].name = "BetaCalendar"; workspace.input.employees[1].sector = "Setor B";
    workspace.input.assignments = workspace.input.employees.map(person => ({ employeeId: person.id, date: month + "-01", kind: "WORK", shiftId: "day" }));
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month, sections: ["calendar"] });
    const model = buildOperationalReport(workspace, options), before = structuredClone(model);
    const pages = await extractPages(await exportOperationalReportPdf(model));
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toContain("AlphaCalendar"); expect(pages[0].text).toContain("BetaCalendar");
    expect(pages[0].text).toContain("Setor A"); expect(pages[0].text).toContain("Setor B");
    expect(pages[0].text).toContain("Mínimo e saldo diários não apurados");
    expect(pages[0].text.match(/Mínimo e saldo diários/g)).toHaveLength(1);
    expect(pages[0].text).toContain("folga fixa configurada"); expect(pages[0].text).toContain("férias ou outro motivo não informado");
    // PDF.js may merge neighboring cells into one text item; restrict to the calendar columns.
    expect(pages[0].items.some(item => item.transform[4] > 240 && item.str.includes("T01"))).toBe(true);
    for (const weekday of ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]) expect(pages[0].items.some(item => item.transform[4] > 240 && item.str.includes(weekday))).toBe(true);
    expect(model.calendar.weeks.flatMap(week => week.dates)).toHaveLength(days);
    for (const page of pages) for (const item of page.items) {
      expect(item.transform[4]).toBeGreaterThanOrEqual(24);
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(822);
      expect(item.transform[5]).toBeGreaterThanOrEqual(16);
      expect(item.transform[5]).toBeLessThan(580);
    }
    expect(model).toEqual(before);
  });
  it("repeats civil-week headers and retains a very long identification across real PDF pages", async () => {
    const workspace = fixture();
    workspace.input.employees = workspace.input.employees.slice(0, 1);
    workspace.input.employees[0].name = "Identificação " + "completa ".repeat(140) + "FimIdentificacao";
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["calendar"] });
    const pages = await extractPages(await exportOperationalReportPdf(buildOperationalReport(workspace, options)));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every(page => page.text.includes("Calendário mensal") && page.text.includes("Semana 1") && page.text.includes("Mínimo e saldo diários"))).toBe(true);
    expect(pages.map(page => page.text).join(" ")).toContain("FimIdentificacao");
    expect(pages.flatMap(page => page.items).every(item => item.transform[5] >= 16)).toBe(true);
  });
  it("extracts exact daily markings and explicit duty without crediting pauses as presence", async () => {
    const workspace = fixture(); workspace.input.employees = workspace.input.employees.slice(0, 2);
    workspace.input.employees[0].name = "AlphaPresence"; workspace.input.employees[1].name = "BetaDuty";
    workspace.input.assignments = [{ employeeId: "0", date: "2026-12-01", kind: "WORK", shiftId: "day" },
      { employeeId: "1", date: "2026-12-01", kind: "DUTY" }];
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["presence"], date: "2026-12-01" });
    const pages = await extractPages(await exportOperationalReportPdf(buildOperationalReport(workspace, options)));
    const text = pages.map(page => page.text).join(" ");
    expect(text).toContain("AlphaPresence"); expect(text).toContain("BetaDuty");
    expect(text).toContain("08:00-12:00"); expect(text).toContain("12:00-15:00"); expect(text).toContain("15:00-20:00");
    expect(text).toContain("Plantão sem horário definido");
    expect(text).toContain("09:00 de equipe"); expect(text).toContain("Nenhuma pausa conta como presença");
    expect(pages.flatMap(page => page.items).every(item => item.transform[5] >= 16)).toBe(true);
  });

  it("keeps calendar membership unchanged when excluded timed references are selected with journeys", async () => {
    const workspace = fixture();
    workspace.input.employees = workspace.input.employees.slice(0, 3);
    workspace.input.employees[0].name = "AlphaIncluded";
    workspace.input.employees[1].name = "BetaIncluded";
    const excluded = workspace.input.employees[2];
    excluded.name = "ExcludedTimed"; excluded.planningEnabled = false;
    workspace.input.assignments = workspace.input.assignments.filter(row => row.employeeId !== excluded.id && workspace.input.employees.some(person => person.id === row.employeeId));
    const before = structuredClone(workspace);
    const options = (sections: ("calendar" | "journeys")[]) => operationalReportOptionsSchema.parse({ workspaceId: workspace.id, revision: workspace.revision, month: "2026-12", sections });
    const calendar = buildOperationalReport(workspace, options(["calendar"]));
    const combined = buildOperationalReport(workspace, options(["calendar", "journeys"]));
    expect(combined.operations).toEqual(calendar.operations);
    expect(combined.people.find(person => person.employee.id === excluded.id)?.proposedVariants.length).toBeGreaterThan(0);
    const drawn: { page: PDFPage; text: string }[] = [], original = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, value, drawOptions) {
      drawn.push({ page: this, text: value }); return original.call(this, value, drawOptions);
    });
    const calendarNames = () => {
      const pages = new Set(drawn.filter(row => row.text.includes(OPERATIONAL_REPORT_SECTION_LABELS.calendar)).map(row => row.page));
      const text = drawn.filter(row => pages.has(row.page)).map(row => row.text).join(" ");
      return ["AlphaIncluded", "BetaIncluded", "ExcludedTimed"].filter(name => text.includes(name));
    };
    try {
      await exportOperationalReportPdf(calendar);
      const baseline = calendarNames(); expect(baseline).toEqual(["AlphaIncluded", "BetaIncluded"]);
      drawn.length = 0;
      await exportOperationalReportPdf(combined);
      expect(calendarNames()).toEqual(baseline);
      expect(drawn.map(row => row.text).join(" ")).toContain("ExcludedTimed");
      expect(workspace).toEqual(before);
      expect(workspace.input.assignments.some(row => row.employeeId === excluded.id && row.kind === "WORK")).toBe(false);
    } finally { spy.mockRestore(); }
  });
  it("writes real paginated PDF with vectors, complete names, exact clocks and no clipped rows", async () => {
    const workspace = fixture(), drawn: { text: string; y: number }[] = [];
    const original = PDFPage.prototype.drawText;
    const spy = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) { drawn.push({ text, y: options?.y ?? 0 }); return original.call(this, text, options); });
    try {
      const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["summary", "calendar", "journeys", "variants", "presence", "coverage"], date: "2026-12-01" });
      const pdf = await exportOperationalReportPdf(buildOperationalReport(workspace, options));
      const document = await PDFDocument.load(pdf);
      expect(document.getPageCount()).toBeGreaterThan(1);
      expect(document.getPages().every(page => page.getWidth() === 842 && page.getHeight() === 595)).toBe(true);
      expect(drawn.filter(item => item.y < 16)).toEqual([]);
      const text = drawn.map(item => item.text).join(" ").replace(/\s+/g, " ");
      expect(text).toContain("Planejamento da equipe"); expect(text).toContain("08:00-12:00"); expect(text).toContain("12:00-15:00");
      for (let i = 0; i < 40; i++) expect(text).toContain("completa " + i);
    } finally { spy.mockRestore(); }
  });
  it("does not draw a calendar or presence for references-only input", async () => {
    const workspace = fixture(); workspace.input.generationMode = "HOURS_ONLY"; workspace.input.assignments = [];
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["journeys"] });
    const model = buildOperationalReport(workspace, options);
    expect(model.referencesOnly).toBe(true); expect(model.dates).toEqual([]);
    expect((await PDFDocument.load(await exportOperationalReportPdf(model))).getPageCount()).toBeGreaterThan(0);
  });
  it("groups shared variants once instead of repeating forty individual journeys", async () => {
    const workspace = fixture(); workspace.input.generationMode = "HOURS_ONLY"; workspace.input.assignments = [];
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["variants"] });
    const model = buildOperationalReport(workspace, options);
    expect(model.referencesOnly).toBe(true); expect(model.dates).toEqual([]);
    expect((await PDFDocument.load(await exportOperationalReportPdf(model))).getPageCount()).toBe(1);
  });
  it.each(["name", "registration", "role", "sector"] as const)("rejects unsupported %s without saving or replacing identification", async field => {
    const workspace = fixture(); workspace.input.employees[0][field] = "Identificação 漢";
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["journeys"] });
    const model = buildOperationalReport(workspace, options), before = structuredClone(model);
    const save = vi.spyOn(PDFDocument.prototype, "save");
    try {
      await expect(exportOperationalReportPdf(model)).rejects.toMatchObject({ status: 422, code: "ESCALA_OPERATIONAL_FONT_UNSUPPORTED" });
      expect(save).not.toHaveBeenCalled(); expect(model).toEqual(before);
    } finally { save.mockRestore(); }
  });
  it("preserves a supported non-WinAnsi identifier with the existing Unicode fonts", async () => {
    const workspace = fixture(); workspace.input.generationMode = "HOURS_ONLY"; workspace.input.assignments = [];
    workspace.input.employees[0].name = "Жanna sintética";
    const options = operationalReportOptionsSchema.parse({ workspaceId: "synthetic", revision: 19, month: "2026-12", sections: ["journeys"] });
    const model = buildOperationalReport(workspace, options);
    expect((await PDFDocument.load(await exportOperationalReportPdf(model))).getPageCount()).toBeGreaterThan(0);
    expect(model.people.some(person => person.employee.name === "Жanna sintética")).toBe(true);
  });
});
