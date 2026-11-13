import { describe, expect, it } from "vitest";
import { readSheet } from "read-excel-file/node";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { coverageBasis } from "./automatic-coverage";
import { analyzeCoverage } from "./coverage-analysis";
import { exportEscalaPdf, exportEscalaXlsx } from "./export";
import { exportedDateISO, exportedDurationMinutes } from "./export-test-utils";
import type { EscalaWorkspace } from "./types";

function fixture(): EscalaWorkspace {
  const input = newInput("06", "Loja sintética", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-03"; input.visibleMonth = undefined;
  input.policy.closedDates = []; input.policy.holidayDates = [];
  input.shifts = [
    { id: "day", name: "Diurno", segments: [{ start: 540, end: 780, kind: "WORK" }, { start: 780, end: 840, kind: "BREAK" }, { start: 840, end: 1080, kind: "WORK" }] },
    { id: "early", name: "Cedo", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }] },
  ];
  input.employees = ["a", "b"].map((id, index) => ({ ...newEmployee(42, "day"), id, registration: "000" + (index + 1),
    name: "Pessoa sintética " + id, sector: "Setor A", role: index ? "Outra função" : "Repositor", weeklyHoursMode: "BRANCH", shiftIds: ["day", "early"],
    sourceSchedule: { report: "FPRE136", code: "original", description: "Referência sintética", weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00 / 00:00-00:00" } }));
  input.assignments = input.employees.flatMap(person => [
    { employeeId: person.id, date: "2026-11-02", kind: "WORK" as const, shiftId: "day" },
    { employeeId: person.id, date: "2026-11-03", kind: "WORK" as const, shiftId: person.id === "a" ? "early" : "day" },
  ]);
  input.assignments.push({ ...input.assignments[0] });
  input.demands = [
    { id: "role-a", date: "2026-11-02", sector: "Setor A", role: "Repositor", start: 540, end: 600, minimum: 2, estimated: false },
    { id: "role-b", date: "2026-11-02", sector: "Setor A", role: "Padeiro", start: 540, end: 600, minimum: 1, estimated: false },
    { id: "estimate", date: "2026-11-02", sector: "Setor A", start: 720, end: 780, minimum: 10, estimated: true },
  ];
  input.coverageBasis = coverageBasis(input);
  return { id: "synthetic-core-export", revision: 1, status: "DRAFT", canEdit: true, canPublish: false, updatedAt: "2026-11-02", input,
    validation: { valid: true, readyToPublish: false, summaries: [], issues: [], minimumCoverageMargin: null } };
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes)), document = await loading.promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index), content = await page.getTextContent();
      pages.push(content.items.filter(item => "str" in item).map(item => item.str).join(" "));
    }
    return pages.join(" ");
  } finally { await loading.destroy(); }
}

describe("central coverage analysis in real operational files", () => {
  it("carries a reference-only manual clock and validity to real PDF and XLSX", async () => {
    const workspace = fixture(); workspace.input.generationMode = "HOURS_ONLY"; workspace.input.assignments = [];
    workspace.input.employees = [workspace.input.employees[0]];
    workspace.input.employees[0].shiftIds = ["day"];
    workspace.input.employees[0].manualShiftOverrides = [{ catalogCode: 1500, shiftId: "early", markings: ["08:00", "12:00", "13:00", "17:00"], effectiveFrom: "2026-11-02", effectiveUntil: "2026-11-03" }];
    const before = structuredClone(workspace);
    const rows = await readSheet(Buffer.from(exportEscalaXlsx(workspace, "hours")), "Horarios");
    const text = rows.flat().join(" | ");
    expect(text).toContain("Referência manual"); expect(text).toContain("08:00-12:00"); expect(text).toContain("02/11/2026"); expect(text).toContain("03/11/2026");
    const rendered = await pdfText(await exportEscalaPdf(workspace, "hours", { separateSectors: false }));
    expect(rendered).toContain("Referência manual"); expect(rendered).toContain("08:00-12:00"); expect(rendered).toContain("02/11/2026");
    expect(workspace).toEqual(before); expect(workspace.input.assignments).toEqual([]);
  });
  it("exports independent numeric rulers with the real role-aware peak occurrence in XLSX and PDF", async () => {
    const workspace = fixture(), before = structuredClone(workspace);
    const central = analyzeCoverage(workspace.input, workspace.input, { details: true, referenceOrigin: "PERSISTED" }).sectors[0];
    const bytes = Buffer.from(exportEscalaXlsx(workspace, "hours"));
    const rows = (await readSheet(bytes, "Desfalques")).slice(4);
    expect(rows).toHaveLength(2);
    const confirmed = rows.find(row => row[1] === "Confirmada"), estimated = rows.find(row => row[1] === "Estimada");
    if (!confirmed || !estimated) throw new Error("Independent confirmed and estimated export rows are required");
    expect(rows.every(row => row.length === 12)).toBe(true);
    expect(confirmed.slice(2, 5)).toEqual([2, 3, 2]); expect(confirmed[6]).toBe("09:00-10:00");
    expect(estimated.slice(2, 5)).toEqual([2, 10, 8]); expect(estimated[6]).toBe("12:00-13:00");
    expect(exportedDateISO(confirmed[5])).toBe("2026-11-02");
    expect(exportedDateISO(estimated[5])).toBe("2026-11-02");
    expect(confirmed[4]).toBe(central.confirmed?.peakMissing);
    expect(central.confirmed?.peakSectorMissing).toBe(1);
    expect(exportedDurationMinutes(confirmed[7])).toBe(60);
    expect(confirmed[11]).toContain("Limite por função");
    expect(exportedDurationMinutes(confirmed[9])).toBe(central.confirmed?.deficitPersonMinutes);
    expect(exportedDurationMinutes(estimated[9])).toBe(central.estimated?.deficitPersonMinutes);
    expect(rows.some(row => row[1] === "Total")).toBe(false);
    const capacity = (await readSheet(bytes, "Capacidade"))[4];
    expect(capacity[1]).toBe(2);
    expect(capacity[3]).toBe(88); expect(capacity[4]).toBe(84); expect(capacity[5]).toBe(80);
    expect(capacity[9]).toBe(central.knownWorkPersonMinutes / 60);
    expect(capacity[9]).toBe(32);
    expect((await readSheet(bytes, "Horarios")).slice(4)).toHaveLength(3);
    const text = await pdfText(await exportEscalaPdf(workspace, "hours"));
    expect(text).toContain("Confirmada"); expect(text).toContain("Estimada");
    expect(text).toContain("Maior falta simultânea (pessoas)");
    expect(text).not.toMatch(/Pico geral|Geral:|Com funções:/);
    expect(text).toContain("09:00-10:00"); expect(text).toContain("12:00-13:00");
    expect(text).not.toContain("Reveja entradas, intervalos e folgas");
    expect(workspace).toEqual(before);
  });
  it("preserves unknown nominal origins and unknown WORK as unavailable instead of inventing 44h or zero shortage", async () => {
    const workspace = fixture();
    delete workspace.input.employees[1].sourceSchedule;
    workspace.input.employees[1].weeklyHoursMode = "BRANCH";
    const unknownDay = workspace.input.assignments.find(day => day.employeeId === "b" && day.date === "2026-11-02");
    if (!unknownDay) throw new Error("WORK assignment missing from the unknown-clock fixture");
    unknownDay.shiftId = "not-known";
    workspace.input.coverageBasis = coverageBasis(workspace.input);
    const bytes = Buffer.from(exportEscalaXlsx(workspace, "hours"));
    const capacity = (await readSheet(bytes, "Capacidade"))[4];
    expect(capacity[1]).toBe(1); expect(capacity[2]).toContain("Sem origem: 1");
    expect(capacity[3]).toBe(44);
    const rows = (await readSheet(bytes, "Desfalques")).slice(4);
    for (const row of rows) {
      expect(row[1]).toContain("parcial");
      expect(row.slice(2, 11)).toEqual(Array(9).fill("—"));
    }
  });
  it("does not turn an obsolete estimated ruler into a known zero while keeping the confirmed ruler available", async () => {
    const workspace = fixture(); delete workspace.input.coverageBasis;
    const rows = (await readSheet(Buffer.from(exportEscalaXlsx(workspace, "hours")), "Desfalques")).slice(4);
    expect(rows.find(row => row[1] === "Confirmada")?.[4]).toBe(2);
    expect(rows.find(row => row[1] === "Estimada · parcial")?.slice(2, 11)).toEqual(Array(9).fill("—"));
  });
});
