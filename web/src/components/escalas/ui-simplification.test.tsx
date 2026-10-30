import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShortMealSimulation } from "./labor-policy-fields";
import { ValidationResults } from "./results";
import { groupValidationIssues } from "./validation-guidance";
import { newEmployee, newInput } from "./workspace-model";
import { Roster } from "./roster";
import { visibleDates } from "@/lib/escalas/dates";

describe("guided draft defaults", () => {
  it("renders sector names alphabetically and groups hours before role or employee name", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    input.shifts = [
      { id: "early", name: "Manhã", segments: [{start:450,end:690,kind:"WORK"},{start:690,end:810,kind:"BREAK"},{start:810,end:1074,kind:"WORK"}] },
      { id: "late", name: "Tarde", segments: [{start:480,end:720,kind:"WORK"},{start:720,end:840,kind:"BREAK"},{start:840,end:1104,kind:"WORK"}] },
    ];
    input.employees = [
      { ...newEmployee(42,"late"), id:"late", name:"Ana da Tarde", registration:"3", sector:"Açougue", role:"Atendente" },
      { ...newEmployee(42,"early"), id:"early-b", name:"Bia da Manhã", registration:"2", sector:"Açougue", role:"Repositor" },
      { ...newEmployee(42,"early"), id:"early-a", name:"Alice da Manhã", registration:"1", sector:"Açougue", role:"Repositor" },
      { ...newEmployee(42,"early"), id:"bakery", name:"Zélia da Padaria", registration:"4", sector:"Padaria", role:"Atendente" },
      { ...newEmployee(42,"early"), id:"apprentice", name:"Aprendiz da Loja", registration:"5", sector:"Loja", role:"AUX. DE SERVIÇOS EM SUPER" },
    ];
    const date=visibleDates(input)[0];
    input.assignments=input.employees.map(person=>({employeeId:person.id,date,kind:"WORK",shiftId:person.shiftIds[0]}));
    const before=JSON.stringify(input);
    const hours=renderToStaticMarkup(<Roster mode="hours" input={input} validation={null} disabled={false} canUnlock onChange={vi.fn()} />);
    expect(hours.indexOf("Alice da Manhã")).toBeLessThan(hours.indexOf("Bia da Manhã"));
    expect(hours.indexOf("Bia da Manhã")).toBeLessThan(hours.indexOf("Ana da Tarde"));
    expect(hours.indexOf("Ana da Tarde")).toBeLessThan(hours.indexOf("Zélia da Padaria"));
    const rest=renderToStaticMarkup(<Roster mode="rest" input={input} validation={null} disabled={false} canUnlock onChange={vi.fn()} />);
    const body=rest.slice(rest.indexOf("<tbody>"),rest.indexOf("</tbody>"));
    expect(body).not.toContain("Aprendiz da Loja");
    expect(hours).toContain("Aprendiz da Loja");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("always offers the optional short-meal simulation without requiring a pre-existing short shift", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    const html = renderToStaticMarkup(<ShortMealSimulation input={input} onChange={vi.fn()} />);
    expect(html).toContain("Simular jornadas de 4 a 6 horas sem pausa");
    expect(html).toContain("escala-short-meal");
    expect(html).toContain("Não autoriza dispensar pausas no trabalho real");
    expect(html).not.toContain('checked=""');
  });

  it("keeps publication paperwork available as information, not a draft error or an empty correction button", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    const validation = { valid:true, readyToPublish:false, minimumCoverageMargin:0, summaries:[], issues:[
      {code:"POLICY_PENDING",severity:"PENDING" as const,message:"Regras da filial: norma e responsável pela conferência ainda não informados."},
      {code:"MISSING_SCHEDULE",severity:"PENDING" as const,message:"Horários não apurados."},
      {code:"SHORT_REFERENCE_PRESERVED",severity:"WARNING" as const,message:"A carga contratual individual não foi presumida."},
    ] };
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} section="information" onResolve={vi.fn()} />);
    expect(html).toContain("Avisos (0)");
    expect(html).toContain("Informações (3)");
    expect(html).toContain("Horário reduzido mantido");
    expect(html).toContain("Folgas planejadas, sem horário fixo");
    expect(html).not.toContain(">Conferir regras da filial<");
    expect(html).toContain("Detalhes da conferência");
  });

  it("routes an insufficient short pause to its actual option rather than an unrelated employee form", () => {
    const group = groupValidationIssues([{code:"MEAL_INTERVAL",severity:"ERROR",message:"Intervalo insuficiente."}])[0];
    expect(group.guidance.target).toBe("team");
    const flex = groupValidationIssues([{code:"SIMULATION_SHORT_MEAL_FLEX",severity:"PENDING",message:"Flexibilizado."}])[0];
    expect(flex.guidance.target).toBe("intervals");
  });
});
