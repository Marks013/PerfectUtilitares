import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { visibleDates } from "@/lib/escalas/dates";
import { buildEscalaDiagnostics } from "@/lib/escalas/diagnostics";
import type { EscalaValidation } from "@/lib/escalas/types";
import { Employees, EmployeeEditor } from "./employees";
import { Shifts, Rules } from "./configuration";
import { ShiftSummary } from "./shift-summary";
import { ValidationResults } from "./results";
import { groupValidationIssues } from "./validation-guidance";
import { newEmployee, newInput } from "./workspace-model";

function sample() {
  const input = newInput("2", "Centro", "2026-11", 42);
  input.employees = [
    { ...newEmployee(42, "first"), id: "a", registration: "101", name: "Pessoa incluída", sector: "Reposição", role: "Repositor", activeFrom: "2020-01-01" },
    { ...newEmployee(42, "second"), id: "b", registration: "102", name: "Outra pessoa", sector: "Caixas", role: "Operador", activeFrom: "2020-01-01" },
    { ...newEmployee(42, "first"), id: "x", registration: "103", name: "Pessoa excluída", sector: "Reposição", role: "Repositor", activeFrom: "2020-01-01", planningEnabled: false, planningExclusionReason: "Exclusão manual: não participa desta proposta de teste." },
  ];
  input.shifts = [
    { id: "first", name: "Referência importada", segments: [{start: 576, end: 840, kind: "WORK"}, {start: 840, end: 960, kind: "BREAK"}, {start: 960, end: 1200, kind: "WORK"}] },
    { id: "second", name: "Referência importada", segments: [{start: 580, end: 810, kind: "WORK"}, {start: 810, end: 930, kind: "BREAK"}, {start: 930, end: 1204, kind: "WORK"}] },
  ];
  const date = visibleDates(input)[0];
  input.assignments = [{employeeId: "a", date, kind: "WORK", shiftId: "first"}, {employeeId: "b", date, kind: "WORK", shiftId: "second"}, {employeeId: "x", date, kind: "WORK", shiftId: "first"}];
  return { input, date };
}

describe("Escalas readable operational review", () => {
  it("keeps distinct exact clocks, included users and original reference separate", () => {
    const {input} = sample();
    input.employees[0].sourceSchedule = {report:"FPRE136",code:"135",description:"Original cadastrado",weekday:"09:36 14:00 16:00 20:00",saturday:"09:36 14:00"};
    const original = JSON.stringify(input);
    const html = renderToStaticMarkup(<ShiftSummary input={input} usedOnly />);
    expect(html).toContain("T01"); expect(html).toContain("T02");
    expect(html).toContain("09:36–14:00 / 16:00–20:00");
    expect(html).toContain("09:40–13:30 / 15:30–20:04");
    expect(html).toContain("14:00–16:00"); expect(html).toContain("08:24");
    expect((html.match(/1 na grade/g) ?? []).length).toBe(2);
    expect(html).not.toContain("2 na grade");
    expect(html).toContain("Comparar com o horário original importado");
    expect(html).toContain("Original 135");
    expect(html).toContain("Reposição"); expect(html).toContain("Caixas");
    expect(JSON.stringify(input)).toBe(original);
  });

  it("does not present old technical-day or missing-clock assignments as users of a visible timed shift", () => {
    const {input} = sample();
    input.employees[0].scheduleMode = "MISSING";
    input.assignments[1].date = input.startDate;
    const html = renderToStaticMarkup(<ShiftSummary input={input} usedOnly />);
    expect(html).toContain("Nenhum turno com horário foi aplicado");
  });

  it("preserves excluded records in a separate actionable relation and exposes the recorded reason", () => {
    const {input} = sample();
    const html = renderToStaticMarkup(<Employees input={input} disabled={false} onChange={vi.fn()} />);
    const mainStart = html.indexOf('aria-label="Colaboradores incluídos"');
    const excludedStart = html.indexOf("Não incluídos no planejamento (1)");
    expect(mainStart).toBeGreaterThan(-1); expect(excludedStart).toBeGreaterThan(mainStart);
    expect(html.slice(mainStart, excludedStart)).not.toContain("Pessoa excluída");
    const relation = html.slice(excludedStart);
    expect(relation).toContain("103 · Pessoa excluída");
    expect(relation).toContain("Reposição / Repositor");
    expect(relation).toContain("Exclusão manual: não participa desta proposta de teste.");
    expect(relation).toContain("Revisar cadastro");
    expect(input.employees).toHaveLength(3);
  });

  it("offers an explicit reason for manual exclusion and five-day model constraints", () => {
    const {input} = sample();
    const editor = renderToStaticMarkup(<EmployeeEditor employee={input.employees[2]} input={input} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(editor).toContain("Motivo da não inclusão");
    input.policy.maxConsecutiveWorkDays = 6;
    const rules = renderToStaticMarkup(<Rules input={input} disabled={false} onChange={vi.fn()} />);
    expect(rules).toContain("limite antigo de 6 dias");
    expect(rules).toMatch(/max="5"/);
    const shifts = renderToStaticMarkup(<Shifts input={input} disabled={false} onChange={vi.fn()} />);
    expect(shifts).toContain("Turnos disponíveis para a proposta");
    expect(shifts).not.toContain("não continua após");
  });

  it("separates blocking, review and informational cases, showing affected people and dates", () => {
    const {input, date} = sample();
    const validation: EscalaValidation = {valid:false,readyToPublish:false,summaries:[],minimumCoverageMargin:0,issues:[
      {code:"WORK_STREAK",severity:"ERROR",employeeId:"a",date,message:"Sequência de seis dias precisa de folga."},
      {code:"FIVE_BY_TWO_POLICY_OUTDATED",severity:"PENDING",date,message:"A revisão antiga precisa de recálculo."},
      {code:"ABSENCE_AVAILABILITY",severity:"WARNING",employeeId:"b",date,message:"Afastamento registrado nesta semana reduz a disponibilidade."},
    ]};
    const html = renderToStaticMarkup(<ValidationResults input={input} validation={validation} onResolve={vi.fn()} />);
    expect(html).toContain("Exige correção (1)");
    expect(html).toContain("Avisos (1)");
    expect(html).toContain("Informações (1)");
    expect(html).toContain("101 · Pessoa incluída"); expect(html).not.toContain("102 · Outra pessoa");
    const informational = renderToStaticMarkup(<ValidationResults input={input} validation={{ ...validation, issues: validation.issues.filter(issue => issue.severity === "WARNING") }} onResolve={vi.fn()} />);
    expect(informational).toContain("Informações e limites de conferência (1)");
    expect(informational).toContain("102 · Outra pessoa");
    expect(html).toContain("Período afetado");
    expect(informational).toContain("Nenhuma correção é necessária por esse tratamento");
    expect(html).toContain("Conferir sequência na escala");
    expect(html).not.toContain("Atenção");
    expect(html).not.toContain("exige regra específica");
  });

  it("shows exact sector deficits separately from an estimated reference, without role substitution", () => {
    const {input,date} = sample();
    input.demands = [{id:"estimate",date,sector:"Reposição",role:"Repositor",start:836,end:845,minimum:1,estimated:true}, {id:"minimum",date,sector:"Caixas",role:"Operador",start:810,end:815,minimum:1,estimated:false}];
    const validation: EscalaValidation={valid:false,readyToPublish:false,issues:[],summaries:[],minimumCoverageMargin:-1};
    const diagnostics = buildEscalaDiagnostics(input, []);
    expect(diagnostics.coverageGroups.some((row) => row.start === 840)).toBe(true);
    const html=renderToStaticMarkup(<ValidationResults input={input} validation={validation} onResolve={vi.fn()} />);
    expect(html).toContain("14:00–14:05");
    expect(html).toContain("estimativa automática, não mínimo obrigatório");
    expect(html).toContain("mínimo informado para a operação");
    expect(html).toContain("Efetivamente trabalhando");
    expect(html).toContain("Funções nesta faixa");
    expect(html).toContain("Conferir este setor e horário");
  });

  it("maps recovery to concrete model, availability and short-meal causes", () => {
    const groups=groupValidationIssues([{code:"SIMULATION_SHORT_MEAL_FLEX",severity:"PENDING",employeeId:"a",message:"Flexibilizado."}, {code:"EMPLOYMENT_AVAILABILITY",severity:"WARNING",employeeId:"a",message:"Vínculo parcial."}]);
    expect(groups[0].guidance.instruction).toContain("15 minutos");
    expect(groups[0].guidance.instruction).toContain("não dispensa intervalos de jornadas maiores");
    expect(groups[1].guidance.instruction).toContain("não a jornada contratual");
    expect(groups[0].guidance.target).toBe("intervals");
    expect(groups[1].guidance.target).toBe("team");
  });
});
