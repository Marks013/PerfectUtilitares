import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { visibleDates } from "@/lib/escalas/dates";
import type { EscalaValidation } from "@/lib/escalas/types";
import { ValidationResults } from "./results";
import { newEmployee, newInput } from "./workspace-model";

function fixture() {
  const input = newInput("02", "Centro", "2026-11", 42);
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "person", sector: "Reposição", role: "Repositor", activeFrom: "2020-01-01" }];
  const validation: EscalaValidation = { valid: true, readyToPublish: false, minimumCoverageMargin: null, issues: [], summaries: [{ employeeId: "person", workedMinutes: 0, workDays: 2, offDays: 1, maxStreak: 1, sundaysWorked: 99 }] };
  return { input, validation };
}
describe("operational review insights", () => {
  it.each(["DAYS_AND_HOURS", "REST_ONLY", "HOURS_ONLY"] as const)("shows period work and distinct shortage measures in %s", mode => {
    const { input, validation } = fixture();
    input.generationMode = mode;
    input.shifts = [{ id: "shift", name: "Teste", segments: [{ kind: "WORK", start: 480, end: 600 }] }];
    input.employees[0].shiftIds = ["shift"];
    input.assignments = visibleDates(input).map(date => date === "2026-11-02"
      ? { employeeId: "person", date, kind: "WORK" as const, shiftId: "shift" }
      : { employeeId: "person", date, kind: "OFF" as const });
    input.demands = [{ id: "confirmed", sector: "Reposição", date: "2026-11-02", start: 480, end: 540, minimum: 2 }];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="coverage" />);
    expect(html).toContain("Horas de trabalho com horário no período: 2 h");
    expect(html).toContain("Necessidade informada: 1 h de horas de pessoas faltantes no período");
    expect(html).toContain("pico simultâneo considerando funções: 1 pessoa(s)");
    expect(html).toContain("capacidade nominal semanal");
  });
  it("does not show presence or shortages for hourly references without a roster", () => {
    const { input, validation } = fixture();
    input.generationMode = "HOURS_ONLY";
    input.assignments = [{ employeeId: "person", date: "2026-11-02", kind: "ABSENCE" }];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="coverage" />);
    expect(html).not.toContain("Horas de trabalho com horário no período");
    expect(html).not.toContain("pico simultâneo considerando funções");
  });
  it("does not present missing estimates as zero when their basis is absent", () => {
    const { input, validation } = fixture();
    input.assignments = [{ employeeId: "person", date: "2026-11-02", kind: "WORK", shiftId: input.shifts[0].id }];
    input.demands = [{ id: "estimate", sector: "Reposição", date: "2026-11-02", start: 480, end: 540, minimum: 2, estimated: true }];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="coverage" />);
    expect(html).toContain("Referência de cobertura indisponível ou desatualizada");
    expect(html).not.toContain("Referência estimada, não confirmada: 0 h");
  });
  it("does not present old numeric peaks for a work day with no shift", () => {
    const { input, validation } = fixture();
    input.assignments = visibleDates(input).map(date => date === "2026-11-02"
      ? { employeeId: "person", date, kind: "WORK" as const, shiftId: "missing" }
      : { employeeId: "person", date, kind: "OFF" as const });
    input.demands = [{ id: "confirmed", sector: "Reposição", date: "2026-11-02", start: 480, end: 540, minimum: 2 }];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="coverage" />);
    expect(html).toContain("Horas de trabalho com horário no período: indisponível");
    expect(html).toContain("pico simultâneo considerando funções: indisponível");
    expect(html).not.toContain("pico de 2 pessoa(s)");
    expect(html).not.toContain("até 2 pessoa(s) abaixo da referência");
  });
  it("preserves confirmed metrics while an estimated basis is unavailable", () => {
    const { input, validation } = fixture();
    input.shifts = [{ id: "shift", name: "Teste", segments: [{ kind: "WORK", start: 480, end: 600 }] }];
    input.employees[0].shiftIds = ["shift"];
    input.assignments = visibleDates(input).map(date => date === "2026-11-02"
      ? { employeeId: "person", date, kind: "WORK" as const, shiftId: "shift" }
      : { employeeId: "person", date, kind: "OFF" as const });
    input.demands = [
      { id: "confirmed", sector: "Reposição", date: "2026-11-02", start: 480, end: 540, minimum: 2 },
      { id: "estimated", sector: "Reposição", date: "2026-11-02", start: 480, end: 540, minimum: 3, estimated: true },
    ];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="coverage" />);
    expect(html).toContain("Referência de cobertura indisponível ou desatualizada");
    expect(html).toContain("Necessidade informada: 1 h de horas de pessoas faltantes no período");
    expect(html).not.toContain("Referência estimada, não confirmada: 0 h");
  });
  it("shows days without timed presence even when estimated demand is zero", () => {
    const { input, validation } = fixture();
    input.assignments = visibleDates(input).map(date => date === "2026-11-02"
      ? { employeeId: "person", date, kind: "WORK" as const, shiftId: input.shifts[0].id }
      : { employeeId: "person", date, kind: "OFF" as const });
    input.demands = [{ id: "estimate", sector: "Reposição", date: "2026-11-03", start: 480, end: 1080, minimum: 0, estimated: true }];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="coverage" />);
    expect(html).toContain("Dias sem ninguém com horário no setor");
    expect(html).toContain("Uma estimativa zero não confirma fechamento nem atendimento");
    expect(html).toContain("Consultar datas de Reposição");
    expect(html).toContain("03/11");
    expect(html).not.toContain("Desfalques (0)");
  });
  it("shows monthly Sunday rest against known availability, not technical-horizon totals", () => {
    const { input, validation } = fixture();
    input.assignments = [
      { employeeId: "person", date: "2026-11-01", kind: "WORK", shiftId: input.shifts[0].id },
      { employeeId: "person", date: "2026-11-08", kind: "OFF" },
      { employeeId: "person", date: "2026-11-15", kind: "ABSENCE" },
      { employeeId: "person", date: "2026-11-22", kind: "WORK", shiftId: input.shifts[0].id },
      { employeeId: "person", date: "2026-12-06", kind: "OFF" },
    ];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="information" />);
    expect(html).toContain("Domingos no mês");
    expect(html).toContain("1 folga(s) / 3 disponíveis");
    expect(html).toContain("2 trabalhado(s) · 1 afastado(s) · 1 sem definição");
    expect(html).not.toContain(">99<");
  });
});
