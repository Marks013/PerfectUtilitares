import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { addDays, dateRange, weekStart } from "./dates";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import type { EscalaWorkspace } from "./types";

function fixture(month = "2026-11"): EscalaWorkspace {
  const person = { id: "p1", registration: "0001", name: "Áurea Silva", sector: "Reposição", role: "Repositor", weeklyHours: 42 as const,
    shiftIds: ["day", "unused"], activeFrom: "", offMode: "VARIABLE" as const, fixedOffDays: [], offPattern: "ANY" as const,
    maxConsecutiveSundays: 1 as const, sundayRestRule: "PROTECTIVE" as const, preferredOffDays: [], historyKnown: false, history: [],
    sourceSchedule: { report: "FPRE136" as const, code: "011", description: "Original importado", weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00 / 00:00-00:00" } };
  const first = `${month}-01`, [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const start = weekStart(first), end = addDays(weekStart(last), 6), dates = dateRange(start, end);
  return { id: "plan", revision: 3, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-10-27",
    input: { schemaVersion: 1, visibleMonth: month, branchCode: "08", branchName: "Filial de teste", startDate: start, endDate: end, defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
      policy: { source: "Cenário técnico", validFrom: "2026-01-01", validUntil: "2029-12-31", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true,
        minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 6, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
      employees: [person, { ...person, id: "manager", registration: "0002", name: "Ana Gerente", role: "Gerente", scheduleMode: "UNTIMED", shiftIds: [] },
        { ...person, id: "excluded", registration: "0003", name: "=1+1 Nome integral preservado", planningEnabled: false, planningExclusionReason: "Conferir a referência noturna" }],
      shifts: [{ id: "unused", name: "Alternativa não selecionada", segments: [{ start: 420, end: 900, kind: "WORK" }] },
        { id: "day", name: "Horário utilizado", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
      demands: [], assignments: dates.flatMap((date, index) => [
        { employeeId: "p1", date, kind: index % 7 < 5 ? "WORK" as const : "OFF" as const, ...(index % 7 < 5 ? { shiftId: "day" } : {}) },
        { employeeId: "manager", date, kind: index % 7 < 5 ? "DUTY" as const : "OFF" as const },
      ]),
    },
    validation: { valid: true, readyToPublish: false, minimumCoverageMargin: null,
      issues: [{ code: "POLICY_PENDING", severity: "PENDING", message: "Confirmar a norma aplicável." }], summaries: [],
    },
  };
}

async function pdfContent(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
  const document = await loading.promise;
  try {
    const pages = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index), content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const items = content.items.filter((item) => "str" in item);
      for (const item of items) if ("transform" in item) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(25);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(viewport.width - 25);
        expect(item.transform[5]).toBeGreaterThanOrEqual(16);
      }
      pages.push(items);
    }
    return pages;
  } finally { await loading.destroy(); }
}

describe("Escalas shared monthly presentation and real exports", () => {
  it("writes an actual monthly XLSX grid with frozen headers, safe text and secondary details", async () => {
    const workspace = fixture(), original = structuredClone(workspace), bytes = exportEscalaXlsx(workspace);
    const archive = unzipSync(bytes), main = strFromU8(archive["xl/worksheets/sheet1.xml"]);
    const rows = await readSheet(Buffer.from(bytes), "Escala");
    expect(rows[3]).toHaveLength(34);
    expect(rows[3].slice(0, 4)).toEqual(["Setor", "Matrícula", "Colaborador", "Cargo"]);
    expect(rows[3][4]).toBe("01/11 Dom");
    expect(rows[3].at(-1)).toBe("30/11 Seg");
    expect(rows.slice(4).map((row) => row[2])).toEqual(["=1+1 Nome integral preservado", "Ana Gerente", "Áurea Silva"]);
    expect(rows[4].slice(4).every((value) => value === "EX")).toBe(true);
    expect(rows[5]).toContain("SF");
    expect(rows[6]).toContain("T02");
    expect(main).toContain('xSplit="4" ySplit="4"');
    expect(main).toContain('orientation="landscape" fitToWidth="1" fitToHeight="0"');
    expect(main).not.toContain("<f>");
    expect(strFromU8(archive["xl/styles.xml"])).toContain('wrapText="1"');
    expect(strFromU8(archive["xl/workbook.xml"])).toContain("$1:$4");
    expect(strFromU8(archive["xl/worksheets/sheet2.xml"])).not.toContain("POLICY_PENDING");
    const shifts = await readSheet(Buffer.from(bytes), "Turnos");
    expect(shifts.flat()).toContain("T02");
    expect(shifts.flat().join(" ")).toContain("08:00-12:00 / 13:00-17:00");
    expect(shifts.flat().join(" ")).toContain("17:24");
    expect(shifts.flat().join(" ")).not.toContain("Alternativa não selecionada");
    expect(workspace).toEqual(original);
  });

  it.each([["2026-02", 28], ["2028-02", 29], ["2026-11", 30], ["2026-12", 31]] as const)("keeps PDF/XLSX dates, people and each assignment identical for %s", async (month, days) => {
    const workspace = fixture(month), before = structuredClone(workspace);
    const xlsx = exportEscalaXlsx(workspace), rows = await readSheet(Buffer.from(xlsx), "Escala");
    const pdf = await exportEscalaPdf(workspace), pages = await pdfContent(pdf), all = pages.flat();
    const text = all.map((item) => item.str).join(" ");
    expect(rows[3]).toHaveLength(days + 4);
    expect(text).not.toContain("Resumo de carga e turnos");
    expect(text).not.toContain("Horas previstas");
    expect(text).not.toContain("POLICY_PENDING");
    expect(text).toContain("RASCUNHO");
    expect(text).toContain("Turnos utilizados");
    expect(text).toContain("Original importado");
    expect(text).not.toContain("Alternativa não selecionada");
    expect(text).toContain(`${month}-01 a ${month}-${days}`);
    const gridPage = pages.find((items) => items.some((item) => item.str === "0001 - Áurea Silva"));
    expect(gridPage).toBeDefined();
    for (const row of rows.slice(4)) {
      const identity = gridPage?.find((item) => item.str === `${row[1]} - ${row[2]}`);
      expect(identity).toBeDefined();
      const cells = gridPage?.filter((item) => item.str.trim().length > 0 && "transform" in item && "transform" in (identity ?? {}) && Math.abs(item.transform[5] - (identity as { transform: number[] }).transform[5]) < 0.1 && item.transform[4] > 300).map((item) => item.str);
      expect(cells).toEqual(row.slice(4));
    }
    expect(workspace).toEqual(before);
  }, 20000);

  it("wraps complete long names and roles, repeats headers and stays compact across pages", async () => {
    const workspace = fixture();
    const longName = "Pessoa com nome completo muito extenso para comprovar que nenhuma parte do nome foi descartada na impressão profissional";
    workspace.input.employees = Array.from({ length: 65 }, (_, index) => ({ ...workspace.input.employees[0], id: `p${index}`, registration: String(index).padStart(4, "0"), name: index ? `Pessoa ${index}` : longName }));
    workspace.input.assignments = [];
    const bytes = await exportEscalaPdf(workspace), document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeLessThanOrEqual(4);
    const pages = await pdfContent(bytes), text = pages.flat().map((item) => item.str).join(" ");
    expect(text.replace(/\s+/g, " ")).toContain(longName);
    expect(pages.filter((items) => items.some((item) => item.str === "Matrícula / colaborador")).length).toBeGreaterThan(1);
    expect(text).not.toContain("...");
  }, 20000);

  it("groups repeated issues without exposing internal codes or losing their count", async () => {
    const workspace = fixture();
    workspace.validation.issues = Array.from({ length: 120 }, (_, index) => ({ code: "COVERAGE_DEFICIT", severity: "ERROR", date: `2026-11-${String(index % 30 + 1).padStart(2, "0")}`, message: "Reposição: 1 presente, mínimo 2, a partir de 08:00. Confira a cobertura.", }));
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Conferencia");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain(120);
    expect(rows.flat().join(" ")).not.toContain("COVERAGE_DEFICIT");
    const text = (await pdfContent(await exportEscalaPdf(workspace))).flat().map((item) => item.str).join(" ");
    expect(text).toContain("120 ocorrências");
    expect(text).not.toContain("COVERAGE_DEFICIT");
  }, 20000);

  it("preserves extensive grouped review messages without exceeding Excel's cell limit", async () => {
    const workspace = fixture();
    const messages = ["A".repeat(18000), "B".repeat(18000), "C".repeat(35000)];
    workspace.validation.issues = messages.map((message) => ({ code: "TEST_REVIEW", severity: "ERROR", message }));
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Conferencia");
    const parts = rows.slice(1).map((row) => String(row[4]));
    expect(parts.every((part) => part.length <= 30000)).toBe(true);
    expect(parts.join("")).toBe(messages.join(""));
    expect(rows.slice(1).reduce((sum, row) => sum + Number(row[2]), 0)).toBe(3);
  });

  it("keeps legacy weekly drafts readable and handles unsafe XML and unsupported font characters", async () => {
    const workspace = fixture();
    delete workspace.input.visibleMonth;
    workspace.input.endDate = addDays(workspace.input.startDate, 6);
    workspace.status = "PUBLISHED";
    workspace.input.employees = [{ ...workspace.input.employees[0], name: '=Texto <integral> & "seguro" 😀\u0001\uffff' }];
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Escala");
    expect(rows[3]).toHaveLength(11);
    expect(rows[4][2]).toBe('=Texto <integral> & "seguro" 😀');
    const bytes = await exportEscalaPdf(workspace), document = await PDFDocument.load(bytes);
    expect(document.getPages().every((page) => page.getWidth() === 842 && page.getHeight() === 595)).toBe(true);
    const text = (await pdfContent(bytes)).flat().map((item) => item.str).join(" ");
    expect(text).toContain("PUBLICADA");
    expect(text).toContain('=Texto <integral> & "seguro"');
  }, 20000);

  it("exports an empty draft without fake collaborators or hours", async () => {
    const workspace = fixture();
    workspace.input.employees = []; workspace.input.assignments = []; workspace.input.shifts = [];
    workspace.validation.issues = [];
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace)), "Escala");
    expect(rows).toHaveLength(4);
    const text = (await pdfContent(await exportEscalaPdf(workspace))).flat().map((item) => item.str).join(" ");
    expect(text).toContain("Nenhum colaborador");
    expect(text).toContain("Sem ocorrências");
    expect(text).not.toContain("Horas previstas");
  }, 20000);
});
