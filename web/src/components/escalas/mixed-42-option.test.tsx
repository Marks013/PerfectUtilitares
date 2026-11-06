import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HoursProposal } from "./hours-proposal";
import { Mixed42Option } from "./mixed-42-option";
import { changeBranchWeeklyHours, changeMixed42Sectors, coverageDefinitionChanged, mixed42EligibleSectors, newEmployee, newInput, pruneMixed42Sectors, scenarioDefinitionChanged } from "./workspace-model";

function fixture() {
  const input = newInput("02", "Loja", "2026-11", 42);
  input.employees = [
    { ...newEmployee(42, "turno-inicial"), id: "caixa", sector: "FRENTE DE CAIXA", activeFrom: "2020-01-01" },
    { ...newEmployee(42, "turno-inicial"), id: "mercearia", sector: "Mercearia", activeFrom: "2020-01-01" },
    { ...newEmployee(40, "turno-inicial"), id: "balcao", sector: "Balcão" },
    { ...newEmployee(42), id: "acougue", sector: "Açougue", scheduleMode: "MISSING" },
  ];
  return input;
}

describe("mixed 42-hour sector choice", () => {
  it("shows eligible sectors only and suggests real names without selecting any", () => {
    const input = fixture();
    const html = renderToStaticMarkup(<Mixed42Option input={input} disabled={false} onChange={vi.fn()} />);
    expect(mixed42EligibleSectors(input)).toEqual(["FRENTE DE CAIXA", "Mercearia"]);
    expect(html).toContain("Jornada mista de 42h (opcional)");
    expect(html).toContain("3 dias de 8h e 2 dias de 9h");
    expect(html).toContain("intervalo fixo não trabalhado é de 3h");
    expect(html).toContain("Sugestões da sua equipe: FRENTE DE CAIXA");
    expect(html).toContain("8h24 por dia");
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain("Balcão");
    expect(html).not.toContain("Açougue");
  });

  it("marks a prior roster stale and removes only estimated demands", () => {
    const input = fixture();
    input.assignments = [{ employeeId: "caixa", date: "2026-11-04", kind: "OFF", locked: true }, { employeeId: "mercearia", date: "2026-11-04", kind: "ABSENCE" }];
    input.demands = [{ id: "a", sector: "FRENTE DE CAIXA", date: "2026-11-04", start: 480, end: 720, minimum: 1, estimated: true }, { id: "b", sector: "Mercearia", date: "2026-11-04", start: 480, end: 720, minimum: 1 }];
    const next = changeMixed42Sectors(input, ["FRENTE DE CAIXA", "FRENTE DE CAIXA", "Açougue"]);
    expect(next.mixed42Sectors).toEqual(["FRENTE DE CAIXA"]);
    expect(next.simulation).toBe(true);
    expect(next.policy).toBe(input.policy);
    expect(next.needsRegeneration).toBe(true);
    expect(next.assignments).toBe(input.assignments);
    expect(next.demands.map((item) => item.id)).toEqual(["b"]);
    expect(scenarioDefinitionChanged(input, next)).toBe(true);
    expect(coverageDefinitionChanged(input, next)).toBe(true);
    expect(changeMixed42Sectors(next, ["FRENTE DE CAIXA"])).toBe(next);
    expect(scenarioDefinitionChanged(next, changeMixed42Sectors(next, []))).toBe(true);
  });

  it("clears selection when changing hours or removing the matching sector", () => {
    const input = changeMixed42Sectors(fixture(), ["FRENTE DE CAIXA"]);
    expect(changeBranchWeeklyHours(input, 40).mixed42Sectors).toBeUndefined();
    const updated = { ...input, employees: input.employees.filter((person) => person.id !== "caixa") };
    expect(pruneMixed42Sectors(updated).mixed42Sectors).toBeUndefined();
    expect(renderToStaticMarkup(<Mixed42Option input={changeBranchWeeklyHours(input, 40)} disabled={false} onChange={vi.fn()} />)).toBe("");
  });

  it("does not offer selectors in a period capped at 40h", () => {
    const input = { ...fixture(), startDate: "2028-01-03", endDate: "2028-01-30" };
    const html = renderToStaticMarkup(<Mixed42Option input={input} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("O período não tem semanas de 42h");
    expect(html).not.toContain('type="checkbox"');
  });

  it("keeps the uniform manual action available only when the mixed option is inactive", () => {
    const input = fixture();
    const render = (current: typeof input) => renderToStaticMarkup(<HoursProposal input={current} disabled={false} onChange={vi.fn()} />);
    expect(render(input)).toContain("Ajustar horários no rascunho");
    const mixed = render(changeMixed42Sectors(input, ["FRENTE DE CAIXA"]));
    expect(mixed).toContain("use Gerar escala e horários");
    expect(mixed).toContain("Horários atuais do rascunho");
    expect(mixed).not.toContain("Ajustar horários no rascunho");
  });
});
