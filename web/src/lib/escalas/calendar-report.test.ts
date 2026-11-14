import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { applyLocalHolidayCalendar } from "./calendar";
import { dateRange } from "./dates";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import { assignmentPresentation, buildEscalaPresentation, escalaShiftCodes } from "./presentation";
import type { EscalaWorkspace } from "./types";
import { analyzeCoverage } from "./coverage-analysis";

function fixture(month = "2026-12", branch = "02"): EscalaWorkspace {
  const raw = newInput(branch, "Loja de teste", month, 42);
  raw.policy.calendarMode = "LOCAL";
  const input = applyLocalHolidayCalendar(raw);
  input.employees = [{ ...newEmployee(42, "day"), id: "p", registration: "01", name: "Ana", sector: "Caixa", role: "Operador" }];
  input.shifts = [{ id: "day", name: "Turno", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.assignments = dateRange(input.startDate, input.endDate).map(date => ({ employeeId: "p", date,
    kind: input.policy.paidHolidayDates?.includes(date) ? "HOLIDAY" : "OFF" }));
  return { id: "calendar-report", revision: 1, status: "DRAFT", canEdit: true, canPublish: false, updatedAt: "2026-11-11", input,
    validation: { valid: true, readyToPublish: false, summaries: [], issues: [], minimumCoverageMargin: null } };
}

async function readPdf(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"), task = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
  const document = await task.promise;
  try {
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), content = await page.getTextContent(), viewport = page.getViewport({ scale: 1 });
      for (const item of content.items) if ("str" in item) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(25);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(viewport.width - 25);
        expect(item.transform[5]).toBeGreaterThanOrEqual(16);
      }
      pages.push(content.items.filter(item => "str" in item).map(item => item.str).join(" "));
    }
    return pages;
  } finally { await task.destroy(); }
}

describe("concise holiday identification in real reports", () => {
  it("distinguishes a closed holiday from rest, absence and timed work without credited hours", () => {
    const workspace = fixture(), employee = workspace.input.employees[0], date = "2026-12-25", codes = escalaShiftCodes(workspace.input);
    const holiday = { employeeId: employee.id, date, kind: "HOLIDAY" as const };
    expect(assignmentPresentation(employee, date, holiday, codes)).toEqual({ code: "FE", description: "Feriado — loja fechada" });
    expect(assignmentPresentation(employee, date, { ...holiday, kind: "OFF" }, codes).code).toBe("F");
    expect(assignmentPresentation(employee, date, { ...holiday, kind: "ABSENCE" }, codes).code).toBe("AF");
    const model = buildEscalaPresentation(workspace), cell = model.people[0].cells.find(day => day.date === date);
    expect(cell).toMatchObject({ code: "FE", interval: "Não se aplica", daily: "Não apurada" });
    expect(cell?.shiftId).toBeUndefined();
    expect(model.calendarLabel).toBe("Calendário: Icaraíma-PR");
    expect(model.holidayNotes).toContain("25/12 Natal (fechado)");
    expect(model.legend).toContain("FE = Feriado, loja fechada");
  });

  it("marks Christmas once in the date header and names it in a compact XLSX and single-page PDF", async () => {
    const workspace = fixture(), before = structuredClone(workspace);
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace, "rest")), "Escala");
    expect(rows[2][0]).toContain("Calendário: Icaraíma-PR");
    expect(rows[2][0]).toContain("25/12 Natal (fechado)");
    const christmas = rows[3].indexOf("25*\nSex");
    expect(christmas).toBeGreaterThan(4);
    expect(rows[3].filter(value => value === "25*\nSex")).toHaveLength(1);
    expect(rows[4][christmas]).toBe("FE");
    const pages = await readPdf(await exportEscalaPdf(workspace, "rest"));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Calendário: Icaraíma-PR");
    expect(pages[0]).toContain("25/12 Natal (fechado)");
    expect(pages[0]).toContain("25*");
    expect(pages[0]).toContain("FE");
    expect(workspace).toEqual(before);
  }, 20000);

  it("keeps an open Sunday holiday as work or rest, never mislabelling it a closure", async () => {
    const workspace = fixture("2026-11", "11"), date = "2026-11-15";
    const day = workspace.input.assignments.find(entry => entry.date === date);
    if (!day) throw new Error("Sunday missing from fixture");
    day.kind = "WORK"; day.shiftId = "day";
    const model = buildEscalaPresentation(workspace);
    expect(model.people[0].cells.find(entry => entry.date === date)?.code).toBe("T01");
    expect(model.holidayNotes).toContain("15/11 Proclamação da República");
    expect(model.holidayNotes).not.toContain("15/11 Proclamação da República (fechado)");
    expect(model.calendarLabel).toBe("Calendário: Umuarama-PR");
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace, "rest")), "Escala");
    const holiday = rows[3].indexOf("15*\nDom");
    expect(holiday).toBeGreaterThan(4);
    expect(rows[3].filter(value => value === "15*\nDom")).toHaveLength(1);
    expect(rows[4][holiday]).toBe("T01");
  });

  it("identifies manual dates without claiming an automatic municipal profile", () => {
    const workspace = fixture();
    workspace.input.policy.calendarMode = "MANUAL";
    workspace.input.policy.holidayDates = ["2026-12-10"];
    const model = buildEscalaPresentation(workspace);
    expect(model.calendarLabel).toBe("Calendário: manual");
    expect(model.holidayNotes).toEqual(["10/12 Feriado cadastrado"]);
  });
  it.each([42, 40] as const)("keeps source-backed nominal capacity separate and matches the central comparison at %ih", async hours => {
    const workspace = fixture();
    workspace.input.defaultWeeklyHours = hours;
    workspace.input.employees = Array.from({ length: 10 }, (_, index) => ({ ...workspace.input.employees[0], id: `p${index}`, registration: String(index), name: `Pessoa ${index}`, weeklyHours: hours, weeklyHoursMode: "BRANCH" as const,
      sourceSchedule: { report: "FPRE136" as const, code: "original", description: "Original de 44 horas", weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00 / 00:00-00:00" } }));
    workspace.input.assignments = [];
    const [capacity] = analyzeCoverage(workspace.input, workspace.input, { referenceOrigin: "PERSISTED" }).sectors;
    if (!capacity) throw new Error("Nominal sector missing from the central comparison");
    const nominal = capacity.nominal, selected = nominal.scenarios.find(scenario => scenario.weeklyHours === hours);
    if (!selected) throw new Error("Chosen nominal scenario missing");
    const bytes = exportEscalaXlsx(workspace, "hours");
    const { unzipSync, strFromU8 } = await import("fflate");
    const workbook = strFromU8(unzipSync(bytes)["xl/workbook.xml"]);
    expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map(match => match[1])).toEqual(["Horarios"]);
    expect(workbook).not.toMatch(/Capacidade|Desfalques/);
    const rows = await readSheet(Buffer.from(bytes), "Horarios");
    expect(rows.slice(4).map(row => row[0])).toEqual(Array(10).fill("Caixa"));
    expect(new Set(rows.slice(4).map(row => row[1])).size).toBe(10);
    expect(nominal.referencePeople).toBe(10); expect(nominal.withoutReferencePeople).toBe(0);
    expect(nominal.referenceCapacityHours).toBe(440);
    expect(nominal.scenarios.map(scenario => scenario.capacityHours)).toEqual([420, 400]);
    expect(selected.capacityHours).toBe(hours === 42 ? 420 : 400);
    expect(selected.lostHours).toBe(hours === 42 ? 20 : 40);
    const { candidateWeeklyHoursMin: minimum, candidateWeeklyHoursMax: maximum } = nominal;
    if (minimum === null || maximum === null) throw new Error("Known nominal candidates must have weekly bounds");
    const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
    expect(minimum).toBe(hours * 10); expect(maximum).toBe(hours * 10);
    expect(selected.equivalentPeople).toBeCloseTo(hours === 42 ? 440 / 42 : 11, 12);
    expect(selected.additionalEquivalentPeople).toBeCloseTo(hours === 42 ? 20 / 42 : 1, 12);
    expect(capacity.knownWorkPersonMinutes).toBe(0);
    const pdf = (await readPdf(await exportEscalaPdf(workspace, "hours"))).join(" ").replace(/\s+/g, " ");
    expect(pdf).toContain("Nominal semanal: 440h; 10 com origem.");
    expect(pdf).toContain("FPRE136: 44h (10)");
    expect(pdf).toContain("42h: 420h; 40h: 400h");
    const current = minimum === maximum ? minimum.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : number(minimum) + "–" + number(maximum);
    expect(pdf).toContain("Atual: " + current + " h/sem.");
    expect(pdf).toContain("Diferença nominal: " + selected.lostHours + " h/sem.");
    expect(pdf).toContain("WORK conhecido no período: 00:00");
    const restPdf = (await readPdf(await exportEscalaPdf(workspace, "rest"))).join(" ");
    expect(restPdf).not.toContain("Nominal semanal:");
    const rest = exportEscalaXlsx(workspace, "rest");
    expect(strFromU8(unzipSync(rest)["xl/workbook.xml"])).not.toContain('name="Capacidade"');
  }, 20000);
});
