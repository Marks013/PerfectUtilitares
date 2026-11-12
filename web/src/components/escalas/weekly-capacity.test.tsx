import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { visibleDates } from "@/lib/escalas/dates";
import { ValidationResults } from "./results";
import { newEmployee, newInput } from "./workspace-model";
import { weeklyCapacityCaveat, weeklySectorCapacity } from "@/lib/escalas/weekly-capacity";
import { WeeklyCapacity } from "./weekly-capacity";

function fixture() {
  const input = newInput("08", "Loja", "2026-11", 42);
  input.employees = Array.from({ length: 10 }, (_, index) => ({ ...newEmployee(42, input.shifts[0].id),
    id: String(index), registration: String(index), sector: "Frente de caixa", role: "Operador", scheduleMode: "TIMED" as const, weeklyHoursMode: "BRANCH" as const }));
  return input;
}

describe("weekly capacity in the actual shortage review", () => {
  it("shows 440, 420, 400 and 10.48 people equivalents even when no hourly gap is detected", () => {
    const html = renderToStaticMarkup(<ValidationResults input={fixture()} validation={{ valid: true, readyToPublish: false,
      issues: [], summaries: [], minimumCoverageMargin: null }} section="coverage" />);
    for (const text of ["Referência 44h: 440h/semana", "42h: 420h", "40h: 400h", "20h a menos", "10,48 pessoas (+0,48 equivalente)", weeklyCapacityCaveat]) expect(html).toContain(text);
    expect([...html.matchAll(/<h4[^>]*>([^<]+)<\/h4>/g)].map(match => match[1])).toEqual(["Frente de caixa"]);
    expect(html).toContain("Detalhes de cobertura indisponíveis para este setor.");
    expect(html).not.toContain("Nenhum desfalque detectado nas faixas com referência disponível.");
    expect(html).not.toContain("Ajustar este setor");
  });
  it("reports no shortage only when the known roster covers an informed need", () => {
    const input = fixture();
    input.shifts = [{ id: "day", name: "Teste", segments: [{ kind: "WORK", start: 480, end: 600 }] }];
    input.employees = input.employees.map(person => ({ ...person, shiftIds: ["day"] }));
    input.assignments = input.employees.flatMap(person => visibleDates(input).map(date => date === "2026-11-02"
      ? { employeeId: person.id, date, kind: "WORK" as const, shiftId: "day" }
      : { employeeId: person.id, date, kind: "OFF" as const }));
    input.demands = [{ id: "confirmed", sector: "Frente de caixa", date: "2026-11-02", start: 480, end: 540, minimum: 1 }];
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={{ valid: true, readyToPublish: false,
      issues: [], summaries: [], minimumCoverageMargin: null }} section="coverage" />);
    expect(html).toContain("Nenhum desfalque detectado nas faixas com referência disponível.");
    expect(html).toContain("Necessidade informada: 0 h de horas de pessoas faltantes no período");
    expect(html).toContain("29 dia(s) sem presença com horário");
    input.demands.push({ id: "estimate", sector: "Frente de caixa", date: "2026-11-02", start: 480, end: 540, minimum: 2, estimated: true });
    const withoutEstimateBasis = renderToStaticMarkup(<ValidationResults input={input} validation={{ valid: true, readyToPublish: false,
      issues: [], summaries: [], minimumCoverageMargin: null }} section="coverage" />);
    expect(withoutEstimateBasis).toContain("Referência de cobertura indisponível ou desatualizada");
    expect(withoutEstimateBasis).toContain("Necessidade informada: 0 h de horas de pessoas faltantes no período");
    expect(withoutEstimateBasis).not.toContain("Nenhum desfalque detectado nas faixas com referência disponível.");
  });
  it("does not invent timed capacity for a sector made only of people without a clock reference", () => {
    const input = fixture(); input.employees = [{ ...input.employees[0], scheduleMode: "UNTIMED", shiftIds: [] }];
    const html = renderToStaticMarkup(<WeeklyCapacity capacity={weeklySectorCapacity(input)[0]} />);
    expect(html).toContain("Capacidade semanal não apurada");
    expect(html).toContain("1 sem horário apurado");
    expect(html).not.toMatch(/NaN|Infinity|44h: 44h/);
    expect(renderToStaticMarkup(<WeeklyCapacity capacity={undefined} />)).toBe("");
  });
});
