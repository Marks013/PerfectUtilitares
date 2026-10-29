import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AbsenceImportPreview } from "@/lib/escalas/fphi105";
import type { EscalaAssignment } from "@/lib/escalas/types";
import { AbsenceImport, AbsenceImportReview, absencePeriods, absenceScenarioKey } from "./absence-import";
import { newInput } from "./workspace-model";

function fixture() {
  const input = newInput("02", "Loja", "2026-11", 42);
  input.employees = [{ id: "p", registration: "001", name: "Pessoa de teste", sector: "Loja", role: "Repositor", weeklyHours: 42, shiftIds: [], activeFrom: "2020-01-01", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }];
  return input;
}

function preview(): AbsenceImportPreview {
  return {
    assignments: [1, 2, 3].map((day) => ({ employeeId: "p", date: `2026-11-0${day}`, kind: "ABSENCE" })),
    counts: { totalRows: 3, matchedRows: 1, unmatchedRows: 1, ambiguousRows: 0, outsidePeriodRows: 1, invalidRows: 0, openEndedRows: 0, employees: 1, days: 3 },
    issues: [], reportPeriod: { startDate: "2026-11-01", endDate: "2026-11-30" },
  };
}

describe("optional absence import", () => {
  it("starts optional, labelled and idle without invented progress", () => {
    const html = renderToStaticMarkup(<AbsenceImport input={fixture()} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("Importar afastamentos e férias (opcional)");
    expect(html).toContain("Arquivo de afastamentos CSV");
    expect(html).toContain("Dados médicos não são importados");
    expect(html).toContain('accept=".csv"');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('role="progressbar"');
    expect(html).not.toContain("<details open");
    expect(html).not.toContain('required=""');
    expect(html).not.toContain("100%");
  });

  it("does not expose an import before the team exists", () => {
    const input = fixture(); input.employees = [];
    expect(renderToStaticMarkup(<AbsenceImport input={input} disabled={false} onChange={vi.fn()} />)).toBe("");
  });

  it("keeps readonly controls disabled", () => {
    const html = renderToStaticMarkup(<AbsenceImport input={fixture()} disabled onChange={vi.fn()} />);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it("invalidates a preview for branch, dates, workload and team identity changes", () => {
    const input = fixture(), key = absenceScenarioKey(input);
    for (const next of [
      { ...input, branchCode: "03" }, { ...input, startDate: "2026-11-02" },
      { ...input, endDate: "2026-11-29" }, { ...input, visibleMonth: "2026-12" },
      { ...input, defaultWeeklyHours: 44 as const },
      { ...input, employees: input.employees.map((person) => ({ ...person, registration: "002" })) },
      { ...input, employees: input.employees.map((person) => ({ ...person, activeUntil: "2026-11-15" })) },
    ]) expect(absenceScenarioKey(next)).not.toBe(key);
    expect(absenceScenarioKey({ ...input, assignments: [{ employeeId: "p", date: "2026-11-01", kind: "OFF", locked: true }] })).toBe(key);
  });

  it("groups only adjacent absence dates without mutating or counting duplicates", () => {
    const items: EscalaAssignment[] = [
      { employeeId: "p", date: "2026-11-03", kind: "ABSENCE" },
      { employeeId: "q", date: "2026-11-01", kind: "ABSENCE" },
      { employeeId: "p", date: "2026-11-01", kind: "ABSENCE" },
      { employeeId: "p", date: "2026-11-02", kind: "ABSENCE" },
      { employeeId: "p", date: "2026-11-02", kind: "ABSENCE" },
      { employeeId: "p", date: "2026-11-04", kind: "WORK", shiftId: "s" },
      { employeeId: "p", date: "2026-11-05", kind: "ABSENCE" },
    ];
    const original = structuredClone(items);
    expect(absencePeriods(items)).toEqual([
      { employeeId: "p", startDate: "2026-11-01", endDate: "2026-11-03" },
      { employeeId: "p", startDate: "2026-11-05", endDate: "2026-11-05" },
      { employeeId: "q", startDate: "2026-11-01", endDate: "2026-11-01" },
    ]);
    expect(items).toEqual(original);
  });

  it("shows an explicit preview with local team identities and inclusive dates", () => {
    const html = renderToStaticMarkup(<AbsenceImportReview preview={preview()} input={fixture()} disabled={false} onApply={vi.fn()} />);
    expect(html).toContain("1 colaboradores · 3 dias de afastamento");
    expect(html).toContain("Pessoa de teste · matrícula 001");
    expect(html).toContain("01/11/2026 a 03/11/2026");
    expect(html).toContain("Nada foi alterado ainda");
    expect(html).toContain("Aplicar afastamentos à proposta");
    expect(html).toContain("gere a proposta e salve a revisão");
  });

  it("explains locked conflicts before applying and never asks to remove all restrictions", () => {
    const input = fixture();
    input.assignments = [{ employeeId: "p", date: "2026-11-01", kind: "OFF", locked: true }];
    const html = renderToStaticMarkup(<AbsenceImportReview preview={preview()} input={input} disabled={false} onApply={vi.fn()} />);
    expect(html).toContain("1 dias bloqueados serão preservados");
    expect(html).toContain("confira os bloqueios na escala e importe novamente");
    expect(input.assignments[0]).toEqual({ employeeId: "p", date: "2026-11-01", kind: "OFF", locked: true });
  });

  it("makes unmatched or empty results actionable rather than an import success", () => {
    const data = preview(); data.assignments = []; data.counts.employees = 0; data.counts.days = 0;
    const html = renderToStaticMarkup(<AbsenceImportReview preview={data} input={fixture()} disabled={false} onApply={vi.fn()} />);
    expect(html).toContain("Nenhum afastamento aplicável");
    expect(html).toContain("Confira se a equipe e o mês correspondem ao relatório");
    expect(html).toContain('disabled=""');
  });

  it("presents file warnings in an optional disclosure", () => {
    const data = preview(); data.issues = [{ line: 4, code: "DATE", message: "Confira a data de término." }];
    const html = renderToStaticMarkup(<AbsenceImportReview preview={data} input={fixture()} disabled={false} onApply={vi.fn()} />);
    expect(html).toContain("Conferir avisos do arquivo (1)");
    expect(html).toContain("Linha 4: Confira a data de término");
    expect(html).not.toContain("<details open");
  });
});
