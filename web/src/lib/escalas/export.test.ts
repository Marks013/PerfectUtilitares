import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import type { EscalaWorkspace } from "./types";

function fixture(): EscalaWorkspace {
  const person = { id: "p1", registration: "0001", name: "Áurea Silva", sector: "Reposição", role: "Repositor", weeklyHours: 42 as const,
    shiftIds: ["day", "unused"], activeFrom: "", offMode: "VARIABLE" as const, fixedOffDays: [], offPattern: "ANY" as const,
    maxConsecutiveSundays: 1 as const, sundayRestRule: "PROTECTIVE" as const, preferredOffDays: [], historyKnown: false, history: [] };
  const dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];
  return { id: "plan", revision: 3, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-10-27",
    input: { schemaVersion: 1, branchCode: "08", branchName: "Filial de teste", startDate: dates[0], endDate: dates[6], defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
      policy: { source: "Cenário técnico", validFrom: "2026-01-01", validUntil: "2026-12-31", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true,
        minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 6, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
      employees: [person, { ...person, id: "manager", registration: "0002", name: "Gerente de setor", role: "Gerente", scheduleMode: "UNTIMED", shiftIds: [] },
        { ...person, id: "excluded", registration: "0003", name: "=1+1 Nome integral preservado", planningEnabled: false }],
      shifts: [{ id: "day", name: "Horário utilizado", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] },
        { id: "unused", name: "Alternativa não selecionada", segments: [{ start: 420, end: 900, kind: "WORK" }] }],
      demands: [], assignments: dates.flatMap((date, index) => [
        { employeeId: "p1", date, kind: index < 5 ? "WORK" as const : "OFF" as const, ...(index < 5 ? { shiftId: "day" } : {}) },
        { employeeId: "manager", date, kind: index < 5 ? "DUTY" as const : "OFF" as const },
      ]),
    },
    validation: { valid: true, readyToPublish: false, minimumCoverageMargin: null,
      issues: [{ code: "POLICY_PENDING", severity: "PENDING", message: "Confirmar a norma aplicável." }],
      summaries: [{ employeeId: "p1", workedMinutes: 2520, workDays: 5, offDays: 2, maxStreak: 5, sundaysWorked: 0 },
        { employeeId: "manager", workedMinutes: 0, workDays: 5, offDays: 2, maxStreak: 5, sundaysWorked: 0 }],
    },
  };
}

describe("Escalas presentation and export contracts", () => {
  it("formats Excel for reading and printing without converting text or numeric values", () => {
    const workspace = fixture(), original = structuredClone(workspace);
    const archive = unzipSync(exportEscalaXlsx(workspace));
    const main = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    expect(main).toContain('width="42" customWidth="1"');
    expect(main).toContain('state="frozen"');
    expect(main).toContain('orientation="landscape" fitToWidth="1" fitToHeight="0"');
    expect(main).toContain('autoFilter ref="A1:N22"');
    expect(main).toContain('s="1" t="inlineStr"');
    expect(main).toContain("=1+1 Nome integral preservado");
    expect(main).not.toContain("<f>");
    expect(main.match(/<v>504<\/v>/g)).toHaveLength(5);
    expect(main).toContain("Não apurados");
    expect(main).toContain("Trabalho sem horário fixo");
    expect(strFromU8(archive["xl/styles.xml"])).toContain('wrapText="1"');
    expect(strFromU8(archive["xl/workbook.xml"])).toContain('name="_xlnm.Print_Titles"');
    expect(strFromU8(archive["xl/_rels/workbook.xml.rels"])).toContain('Target="styles.xml"');
    const review = strFromU8(archive["xl/worksheets/sheet2.xml"]);
    expect(review).toContain('width="110"');
    expect(review).toContain("POLICY_PENDING");
    expect(workspace).toEqual(original);
  });

  it("keeps the weekly grid, adds a readable summary and lists only shifts actually used", async () => {
    const workspace = fixture(), original = structuredClone(workspace);
    const bytes = await exportEscalaPdf(workspace);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPages().every((page) => page.getWidth() === 842 && page.getHeight() === 595)).toBe(true);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
    const document = await loading.promise;
    try {
      const pages: string[][] = [];
      for (let index = 1; index <= document.numPages; index++) {
        const content = await (await document.getPage(index)).getTextContent();
        const items = content.items.filter((item) => "str" in item);
        pages.push(items.map((item) => "str" in item ? item.str : ""));
        for (const item of items) if ("transform" in item) {
          expect(item.transform[4]).toBeGreaterThanOrEqual(25);
          expect(item.transform[4] + item.width).toBeLessThanOrEqual(817);
          expect(item.transform[5]).toBeGreaterThanOrEqual(16);
        }
      }
      expect(pages[0].join(" ")).toContain("02/11 Seg");
      expect(pages[0]).toContain("SH");
      const summary = pages[1].join(" ");
      expect(summary).toContain("Resumo de carga e turnos");
      expect(summary).toContain("Horas previstas");
      expect(summary).toContain("42:00");
      expect(summary).toContain("Não apuradas");
      expect(summary).toContain("Horário utilizado");
      expect(summary).not.toContain("Alternativa não selecionada");
      expect(summary).not.toContain("02/11 Seg");
      expect(pages.flat().filter((text) => text === "Matrícula / colaborador")).toHaveLength(2);
      expect(pages.flat().join(" ")).toContain("RASCUNHO");
    } finally { await loading.destroy(); }
    expect(workspace).toEqual(original);
  }, 15000);

  it("handles unsupported font characters and multipage groups without losing page geometry", async () => {
    const workspace = fixture();
    workspace.input.employees = Array.from({ length: 45 }, (_, index) => ({ ...workspace.input.employees[0], id: `p${index}`, registration: String(index), name: `Pessoa ${index} 😀` }));
    workspace.input.assignments = [];
    const bytes = await exportEscalaPdf(workspace);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(3);
    expect(document.getPages().every((page) => page.getWidth() === 842 && page.getHeight() === 595)).toBe(true);
  });
});
