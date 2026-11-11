import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { applyLocalHolidayCalendar } from "@/lib/escalas/calendar";
import { Rules } from "./configuration";
import { Roster } from "./roster";
import { newEmployee, newInput } from "./workspace-model";

function fixture() {
  const raw = newInput("02", "Loja", "2026-12", 42);
  raw.policy.calendarMode = "LOCAL";
  const input = applyLocalHolidayCalendar(raw);
  input.employees = [{ ...newEmployee(42, "day"), id: "p", name: "Ana", registration: "01", role: "Operador", sector: "Caixa" }];
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 984, kind: "WORK" }] }];
  input.assignments = [{ employeeId: "p", date: "2026-12-25", kind: "HOLIDAY" }];
  return input;
}
describe("holiday calendar controls and closed-day visibility", () => {
  it("shows one simple calendar choice, locality and three standard closure dates without hiding manual dates", () => {
    const input = fixture(), before = structuredClone(input), onChange = vi.fn();
    const html = renderToStaticMarkup(<Rules input={input} disabled={false} onChange={onChange} />);
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Calendário de feriados<\/label>/);
    expect(html).toContain('value="LOCAL" selected=""');
    expect(html).toContain("Local automático · Icaraíma-PR");
    expect(html).toContain("01/01, 01/05 e 25/12");
    expect(html).toContain("folgas de domingo continuam no rodízio");
    expect(html).toContain("Datas de fechamento obrigatório");
    expect(html).toContain("Feriados do período");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toEqual(before);
  });
  it("preserves manual legacy mode and disables controls for a read-only plan", () => {
    const input = fixture();
    delete input.policy.calendarMode;
    const html = renderToStaticMarkup(<Rules input={input} disabled onChange={vi.fn()} />);
    expect(html).toContain('value="MANUAL" selected=""');
    expect(html).toContain("sem acrescentar o calendário local");
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).not.toContain("Referência local:");
  });
  it("names Christmas accessibly and does not offer a workday editor for FE", () => {
    const html = renderToStaticMarkup(<Roster input={fixture()} validation={null} disabled={false} canUnlock={false} onChange={vi.fn()} mode="rest" />);
    expect(html).toContain("Calendário: Icaraíma-PR");
    expect(html).toContain("25/12 Natal (fechado)");
    expect(html).toContain('<span class="sr-only">Natal, loja fechada</span>');
    expect(html).toContain("FE = Feriado, loja fechada");
    expect(html).toContain('<span aria-hidden="true">FE</span><span class="sr-only">Ana, 25/12/2026: Feriado — loja fechada</span>');
    expect(html).not.toMatch(/<button[^>]*aria-label="Ana, 25\/12\/2026:[^"]*Editar/);
  });
  it("does not offer a dead review action for a closed holiday in the hourly view", () => {
    const input = fixture();
    input.startDate = "2026-12-25"; input.endDate = "2026-12-25"; delete input.visibleMonth;
    const html = renderToStaticMarkup(<Roster input={input} validation={null} disabled={false} canUnlock={false} onChange={vi.fn()} mode="hours" />);
    expect(html).toContain("Feriado — loja fechada");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Revisar dia<\/button>/);
  });
});
