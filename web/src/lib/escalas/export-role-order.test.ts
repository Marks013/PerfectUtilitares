import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { strFromU8, unzipSync } from "fflate";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import type { EscalaWorkspace } from "./types";

function fixture(): EscalaWorkspace {
  const input = newInput("08", "Ordenação sintética", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-03"; input.visibleMonth = undefined;
  input.policy.closedDates = []; input.policy.holidayDates = [];
  const clock = (id: string, start: number, pause: number, resume: number, end: number) => ({ id, name: id, segments: [
    { start, end: pause, kind: "WORK" as const }, { start: pause, end: resume, kind: "BREAK" as const }, { start: resume, end, kind: "WORK" as const },
  ] });
  input.shifts = [clock("five", 300, 540, 600, 840), clock("manual", 360, 600, 660, 900),
    clock("geometry", 420, 630, 750, 960), clock("early", 420, 660, 720, 960),
    clock("eight", 480, 720, 780, 1020), clock("nine", 540, 780, 840, 1080), clock("ten", 600, 840, 900, 1140)];
  const definitions = [
    ["01", "Zélia Outro Setor", "Açougue", "Repositor", "nine"],
    ["02", "Zélia Ajudante", "Padaria", "Ajudante", "nine"],
    ["03", "Zélia Manual", "Padaria", "Auxiliar", "manual"],
    ["04", "Zélia Geometria", "Padaria", "Auxiliar", "geometry"],
    ["05", "Álvaro Mesmo Horário", "Padaria", "Auxiliar", "early"],
    ["06", "Bia Mesmo Horário", "Padaria", "Auxiliar", "early"],
    ["07", "Caio Variantes", "Padaria", "Auxiliar", "eight"],
    ["08", "Ana Horário Posterior", "Padaria", "Auxiliar", "nine"],
    ["09", "Aline Sem Horário", "Padaria", "Auxiliar", "early"],
    ["10", "Ana Outro Cargo", "Padaria", "Padeiro", "five"],
  ];
  input.employees = definitions.map(([id, name, sector, role, shift]) => ({ ...newEmployee(42, shift), id, registration: id, name, sector, role,
    activeFrom: "", planningEnabled: true, scheduleMode: id === "09" ? "UNTIMED" as const : "TIMED" as const,
    shiftIds: id === "07" ? ["eight", "ten"] : [shift],
    ...(id === "03" ? { manualShiftOverrides: [{ catalogCode: 1500, shiftId: "manual", markings: ["06:00", "10:00", "11:00", "15:00"] as [string, string, string, string], effectiveFrom: "2026-11-02", effectiveUntil: "2026-11-03" }] } : {}),
  })).reverse();
  input.assignments = definitions.flatMap(([id, , , , shift]) => ["2026-11-02", "2026-11-03"].map(date => ({
    employeeId: id, date, ...(id === "09" ? { kind: "DUTY" as const } : { kind: "WORK" as const, shiftId: id === "07" && date === "2026-11-03" ? "ten" : shift }),
  })));
  input.demands = [{ id: "confirmed", date: "2026-11-02", sector: "Padaria", start: 480, end: 540, minimum: 2, estimated: false }];
  return { id: "role-order", revision: 4, status: "DRAFT", canEdit: true, canPublish: false, updatedAt: "2026-11-02", input,
    validation: { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null } };
}

const restOrder = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"];
const hoursOrder = ["01", "02", "03", "04", "05", "06", "07", "08", "07", "09", "10"];

describe("role order in real operational exports", () => {
  it.each(["rest", "hours", "both"] as const)("orders the %s XLSX by sector, role, complete clock and name", async mode => {
    const workspace = fixture(), before = structuredClone(workspace), bytes = Buffer.from(exportEscalaXlsx(workspace, mode));
    const archive = unzipSync(bytes), workbook = strFromU8(archive["xl/workbook.xml"]);
    expect([...workbook.matchAll(/<sheet name="([^"]+)"/g)].map(match => match[1]))
      .toEqual(mode === "rest" ? ["Escala"] : mode === "hours" ? ["Horarios"] : ["Escala", "Horarios"]);
    expect(workbook).not.toMatch(/Capacidade|Desfalques|Print_Titles/);
    for (const [path, data] of Object.entries(archive)) if (/worksheets\/sheet\d+\.xml$/.test(path)) {
      expect(strFromU8(data)).not.toMatch(/<pane\b|state="frozen"|[xy]Split=/);
    }
    if (mode !== "hours") {
      const rows = (await readSheet(bytes, "Escala")).slice(4);
      expect(rows.map(row => row[1])).toEqual(restOrder);
      expect(rows.find(row => row[1] === "07")?.[4]).toContain("Varia no mês:");
      expect(rows.find(row => row[1] === "09")?.slice(5)).toEqual(["ENC", "ENC"]);
    }
    if (mode !== "rest") {
      const rows = (await readSheet(bytes, "Horarios")).slice(4);
      expect(rows.map(row => row[1])).toEqual(hoursOrder);
      expect(rows.filter(row => row[1] === "07").map(row => row[5])).toEqual(["08:00-12:00 / 13:00-17:00", "10:00-14:00 / 15:00-19:00"]);
      const manual = rows.find(row => row[1] === "03");
      expect(manual?.[5]).toBe("06:00-10:00 / 11:00-15:00 — Aplicado: 02/11/2026 a 03/11/2026 (escolha manual)");
      expect(manual?.[5]).not.toContain("Referência manual");
      const enc = rows.find(row => row[1] === "09");
      expect(enc?.[5]).toBe("ENC — Sem horário fixo"); expect(enc?.[7]).toBe("Não apurada");
      expect(enc?.slice(4).join(" ")).not.toContain("00:00");
    }
    expect(workspace).toEqual(before);
  });

  it.each((["rest", "hours", "both"] as const).flatMap(mode => [true, false].map(separateSectors => ({ mode, separateSectors }))))
    ("preserves the $mode PDF order and page bounds with separateSectors=$separateSectors", async ({ mode, separateSectors }) => {
      const workspace = fixture(), before = structuredClone(workspace);
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const task = pdfjs.getDocument(pdfJsServerDocumentOptions(await exportEscalaPdf(workspace, mode, { separateSectors })));
      const document = await task.promise;
      try {
        const pages: string[] = [];
        for (let index = 1; index <= document.numPages; index++) {
          const page = await document.getPage(index), content = await page.getTextContent(), viewport = page.getViewport({ scale: 1 });
          for (const item of content.items) if ("str" in item) {
            expect(item.transform[4]).toBeGreaterThanOrEqual(25);
            expect(item.transform[4] + item.width).toBeLessThanOrEqual(viewport.width - 25);
            expect(item.transform[5]).toBeGreaterThanOrEqual(16);
          }
          pages.push(content.items.filter(item => "str" in item).map(item => item.str).join(" "));
        }
        const text = pages.join(" ").replace(/\s+/g, " ");
        const identities = [...text.matchAll(/\b(0[1-9]|10) - (?:Zélia|Álvaro|Bia|Caio|Ana|Aline)\b/g)].map(match => match[1]);
        const expected = mode === "rest" ? restOrder : mode === "hours" ? hoursOrder : separateSectors
          ? ["01", "01", ...restOrder.slice(1), ...hoursOrder.slice(1)] : [...restOrder, ...hoursOrder];
        expect(identities).toEqual(expected);
        expect(text).not.toMatch(/(?:Cargo|Função):/);
        expect(text).toContain("ENC — Sem horário fixo");
        if (mode !== "rest") {
          expect(text).toContain("06:00-10:00 / 11:00-15:00 — Aplicado: 02/11/2026 a 03/11/2026 (escolha manual)");
          expect(text).not.toContain("Referência manual");
          expect(text).toContain("Nominal semanal:"); expect(text).toContain("Desfalques de cobertura");
          expect(text).toContain("10:00-14:00 / 15:00-19:00");
        }
        expect(workspace).toEqual(before);
      } finally { await task.destroy(); }
    }, 20000);

  it("keeps an unapplied manual reference distinct from applied attendance in XLSX and PDF", async () => {
    const workspace = fixture();
    workspace.input.assignments = workspace.input.assignments.filter(day => day.employeeId !== "03");
    const before = structuredClone(workspace);
    const bytes = Buffer.from(exportEscalaXlsx(workspace, "hours"));
    const rows = await readSheet(bytes, "Horarios"), manual = rows.find(row => row[1] === "03");
    expect(manual?.[5]).toBe("06:00-10:00 / 11:00-15:00 — Referência manual: 02/11/2026 a 03/11/2026");
    expect(manual?.[5]).not.toContain("Aplicado:");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = pdfjs.getDocument(pdfJsServerDocumentOptions(await exportEscalaPdf(workspace, "hours", { separateSectors: false })));
    const document = await task.promise;
    try {
      const pages: string[] = [];
      for (let index = 1; index <= document.numPages; index++) {
        const page = await document.getPage(index), content = await page.getTextContent();
        pages.push(content.items.filter(item => "str" in item).map(item => item.str).join(" "));
      }
      const text = pages.join(" ").replace(/\s+/g, " ");
      expect(text).toContain("06:00-10:00 / 11:00-15:00 — Referência manual: 02/11/2026 a 03/11/2026");
      expect(text).not.toContain("(escolha manual)");
      expect(workspace.input.assignments.some(day => day.employeeId === "03")).toBe(false);
      expect(workspace).toEqual(before);
    } finally { await task.destroy(); }
  }, 20000);
});
