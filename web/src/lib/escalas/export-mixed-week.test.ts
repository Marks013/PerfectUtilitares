import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import type { EscalaWorkspace } from "./types";

function scenario(): EscalaWorkspace {
  const input = newInput("08", "Loja sintética", "2026-11", 42);
  input.simulation = true; input.mixed42Sectors = ["Caixa"];
  input.shifts = [
    { id: "eight", name: "Oito", segments: [{ start: 600, end: 840, kind: "WORK" }, { start: 840, end: 900, kind: "BREAK" }, { start: 900, end: 1140, kind: "WORK" }] },
    { id: "nine", name: "Nove", segments: [{ start: 480, end: 750, kind: "WORK" }, { start: 750, end: 930, kind: "BREAK" }, { start: 930, end: 1200, kind: "WORK" }] },
  ];
  input.employees = [{ ...newEmployee(42, "eight"), id: "p", registration: "01", name: "Pessoa Sintética", sector: "Caixa", role: "Operador", shiftIds: ["eight", "nine"] }];
  input.assignments = [
    ...[2, 4, 5, 9, 11].map(day => ({ employeeId: "p", date: `2026-11-${String(day).padStart(2, "0")}`, kind: "WORK" as const, shiftId: "eight" })),
    ...[3, 6, 10, 13].map(day => ({ employeeId: "p", date: `2026-11-${String(day).padStart(2, "0")}`, kind: "WORK" as const, shiftId: "nine" })),
    { employeeId: "p", date: "2026-11-12", kind: "ABSENCE" },
  ];
  input.demands = [];
  return { id: "mixed-proof", revision: 1, status: "DRAFT", canEdit: true, canPublish: false, updatedAt: "2026-11-10", input,
    validation: { valid: true, readyToPublish: false, summaries: [], issues: [], minimumCoverageMargin: null } };
}

async function text(bytes: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
  const document = await task.promise;
  try {
    const result: string[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      expect(viewport.width).toBe(842); expect(viewport.height).toBe(595);
      for (const item of content.items) if ("str" in item) {
        expect(item.transform[4]).toBeGreaterThanOrEqual(25);
        expect(item.transform[4] + item.width).toBeLessThanOrEqual(viewport.width - 25);
        expect(item.transform[5]).toBeGreaterThanOrEqual(16);
        result.push(item.str);
      }
    }
    return result.join(" ");
  } finally { await task.destroy(); }
}

describe("actual mixed weekly journeys in operational reports", () => {
  it("reopens Excel with the real weekly days for each 8h and 9h shift, including an absence week", async () => {
    const source = scenario(), before = structuredClone(source);
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(source, "hours")), "Horarios");
    expect(rows[2][0]).toContain("Fechamento da loja: 20:00");
    expect(rows[3]).toContain("Aplicação nas semanas");
    const short = rows.find(row => row[7] === "08:00"), long = rows.find(row => row[7] === "09:00");
    expect(short?.[8]).toContain("02/11–08/11: 3 dias · Seg 02, Qua 04, Qui 05");
    expect(short?.[8]).toContain("09/11–15/11: 2 dias · Seg 09, Qua 11");
    expect(long?.[8]).toContain("02/11–08/11: 2 dias · Ter 03, Sex 06");
    expect(long?.[8]).toContain("09/11–15/11: 2 dias · Ter 10, Sex 13");
    expect(long?.[6]).toBe("12:30-15:30 (03:00)");
    expect(short?.[8]).not.toContain("Qui 12");
    expect(source).toEqual(before);
  });
  it("shows only actual dates inside the visible month in a partial boundary week", async () => {
    const source = scenario();
    source.input.assignments = [
      { employeeId: "p", date: "2026-10-31", kind: "WORK", shiftId: "nine" },
      { employeeId: "p", date: "2026-11-01", kind: "WORK", shiftId: "eight" },
    ];
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(source, "hours")), "Horarios");
    const actual = rows.find(row => row[7] === "08:00");
    expect(actual?.[8]).toBe("26/10–01/11: 1 dia · Dom 01");
    expect(rows.some(row => row[7] === "09:00")).toBe(false);
    expect(rows.flat().join(" ")).not.toContain("Sáb 31");
  });
  it("does not claim a mixed 42h distribution after the transition to 40h", async () => {
    const source = scenario();
    const period = newInput("08", "Loja sintética", "2028-01", 42);
    Object.assign(source.input, { startDate: period.startDate, endDate: period.endDate, visibleMonth: period.visibleMonth });
    source.input.assignments = [{ employeeId: "p", date: "2028-01-03", kind: "WORK", shiftId: "eight" }];
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(source, "hours")), "Horarios");
    expect(rows[3]).not.toContain("Aplicação nas semanas");
    expect(rows[2][0]).not.toContain("NEGOCIAÇÃO");
    expect(await text(await exportEscalaPdf(source, "hours"))).not.toContain("NEGOCIAÇÃO");
  });
  it("retains the real 8h dates on both sides of a transition month without inventing 9h days", async () => {
    const source = scenario(), period = newInput("08", "Loja sintética", "2027-12", 42);
    Object.assign(source.input, { startDate: period.startDate, endDate: period.endDate, visibleMonth: period.visibleMonth });
    source.input.assignments = [
      { employeeId: "p", date: "2027-12-06", kind: "WORK", shiftId: "eight" },
      { employeeId: "p", date: "2027-12-20", kind: "WORK", shiftId: "eight" },
    ];
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(source, "hours")), "Horarios");
    const actual = rows.find(row => row[7] === "08:00");
    expect(actual?.[8]).toContain("06/12–12/12: 1 dia · Seg 06");
    expect(actual?.[8]).toContain("20/12–26/12: 1 dia · Seg 20");
    expect(rows.some(row => row[7] === "09:00")).toBe(false);
  });
  it("prints the same weekly dates and 3h meal in bounded A4 PDF cells", async () => {
    const source = scenario(); source.input.storeClosingMinutes = 1260;
    const result = await text(await exportEscalaPdf(source, "hours"));
    expect(result).toContain("Fechamento da loja: 21:00");
    expect(result).toContain("Aplicação nas semanas");
    expect(result).toContain("02/11–08/11: 3 dias");
    expect(result).toContain("09/11–15/11: 2 dias");
    expect(result).toContain("12:30-15:30 (03:00)");
    expect(result).not.toContain("Qui 12");
  });
});
