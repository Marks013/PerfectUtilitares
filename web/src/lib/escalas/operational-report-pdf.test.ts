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
describe("optional operational PDF", () => {

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
      expect(text).toContain("Previsto na grade"); expect(text).toContain("08:00-12:00"); expect(text).toContain("12:00-15:00");
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
