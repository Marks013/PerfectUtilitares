import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HoursProposal, hoursArePrepared, hoursProposalGroups, prepareHoursProposal } from "./hours-proposal";
import { groupValidationIssues } from "./validation-guidance";
import { ValidationResults } from "./results";
import { changeBranchWeeklyHours, coverageDefinitionChanged, newEmployee, newInput } from "./workspace-model";

function reference() {
  const input = newInput("02", "Centro", "2026-11", 42);
  input.shifts = [{ id: "source", name: "44h em seis dias", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 980, kind: "WORK" }] }];
  input.employees = [{ ...newEmployee(44, "source"), weeklyHoursMode: "BRANCH", id: "a", registration: "1", name: "Ana", role: "Repositor", sector: "Loja", sourceSchedule: { report: "FPRE136", code: "1", description: "44h", weekday: "07:00-11:00 13:00-16:20", saturday: "07:00-11:00 13:00-16:20" } }];
  return input;
}

describe("explicit branch hours selection before mass days off", () => {
  it("proposes 42h in five days from the original 44h reference, preserves meal and applies only the selected arrival anchor", () => {
    const input = reference();
    expect(hoursArePrepared(input)).toBe(false);
    const proposal = prepareHoursProposal(input, "arrival");
    const shifts = proposal.employees[0].shiftIds.map((id) => proposal.shifts.find((shift) => shift.id === id));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.segments).toEqual([{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }]);
    expect(proposal.employees[0].weeklyHours).toBe(42);
    expect(hoursArePrepared(proposal)).toBe(true);
    expect(input.shifts[0].segments[2].end).toBe(980);
    expect(input.employees[0].weeklyHours).toBe(44);
    expect(proposal.policy.reviewed).toBe(false);
    expect(proposal.policy.compensationAuthorized).toBe(false);
  });

  it("allows departure-only and both strategies without inventing clocks for untimed managers", () => {
    const input = reference();
    input.employees.push({ ...newEmployee(42), id: "m", registration: "2", name: "Gerente", role: "Gerente", sector: "Loja", scheduleMode: "UNTIMED" });
    const departure = prepareHoursProposal(input, "departure");
    const shift = departure.shifts.find((item) => item.id === departure.employees[0].shiftIds[0]);
    expect(shift?.segments[0].start).toBe(356);
    expect(shift?.segments[2].end).toBe(980);
    expect(departure.employees[1].shiftIds).toEqual([]);
    expect(departure.employees[1].scheduleMode).toBe("UNTIMED");
    expect(prepareHoursProposal(input, "both").employees[0].shiftIds).toHaveLength(2);
  });

  it("preserves an explicitly individual 44-hour reference when the branch simulation selects 42 hours", () => {
    const input = reference();
    input.employees[0].weeklyHoursMode = "INDIVIDUAL";
    const proposal = prepareHoursProposal(input, "arrival");
    expect(proposal.employees[0].weeklyHours).toBe(44);
    const shift = proposal.shifts.find((item) => item.id === proposal.employees[0].shiftIds[0]);
    expect(shift?.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)).toBe(528);
    expect(input.employees[0].weeklyHours).toBe(44);
  });

  it("does not offer schedule adaptation for locked assignments", () => {
    const input = reference();
    input.assignments = [{ employeeId: "a", date: input.startDate, kind: "OFF", locked: true }];
    expect(() => prepareHoursProposal(input, "arrival")).toThrow("bloqueados");
  });

  it("renders an explicit preview selection without silently applying schedule changes", () => {
    const input = reference();
    const html = renderToStaticMarkup(<HoursProposal input={input} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("Ver proposta de horários para 42h");
    expect(html).toContain("Manter entrada e intervalo, ajustar a saída");
    expect(html).not.toContain("Escolher estes horários e continuar");
    expect(input.employees[0].shiftIds).toEqual(["source"]);
  });

  it("groups equivalent schedules for one branch review while preserving names in alphabetical order", () => {
    const input = reference();
    input.employees.push({ ...input.employees[0], id: "b", name: "Beatriz", registration: "2" });
    const groups = hoursProposalGroups(input, prepareHoursProposal(input, "both"));
    expect(groups).toHaveLength(1);
    expect(groups[0].people).toEqual(["Ana · 1", "Beatriz · 2"]);
    expect(groups[0].proposal).toHaveLength(2);
    expect(groups[0].proposal.every((value) => value.includes("08:24 trabalhadas"))).toBe(true);
    expect(groups[0].original).toBe("07:00-11:00 13:00-16:20");
  });

  it("keeps different sectors and unsafe schedule exclusions visible in separate groups", () => {
    const input = reference();
    input.employees.push({ ...input.employees[0], id: "b", name: "Bruno", registration: "2", sector: "Açougue" });
    const proposal = prepareHoursProposal(input, "both");
    proposal.employees[0] = { ...proposal.employees[0], planningEnabled: false, planningExclusionReason: "Horário exige conferência" };
    const groups = hoursProposalGroups(input, proposal);
    expect(groups).toHaveLength(2);
    expect(groups[0].sector).toBe("Açougue");
    expect(groups[1].proposal).toEqual(["Horário exige conferência"]);
  });

  it("requires fresh hour selection after a branch reference changes 42 to 40 and back, preserving individual contracts", () => {
    const input = reference();
    input.employees[0] = { ...input.employees[0], weeklyHours: 42, weeklyHoursMode: "BRANCH" };
    input.employees.push({ ...input.employees[0], id: "b", registration: "2", name: "Beatriz", weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL" });
    const prepared42 = prepareHoursProposal(input, "both");
    const selected40 = changeBranchWeeklyHours(prepared42, 40);
    expect(hoursArePrepared(selected40)).toBe(false);
    const prepared40 = prepareHoursProposal(selected40, "both");
    expect(hoursArePrepared(prepared40)).toBe(true);
    const selected42 = changeBranchWeeklyHours(prepared40, 42);
    expect(hoursArePrepared(selected42)).toBe(false);
    const restored42 = prepareHoursProposal(selected42, "both");
    expect(restored42.employees[0].weeklyHours).toBe(42);
    expect(restored42.employees[1].weeklyHours).toBe(40);
    expect(hoursArePrepared(restored42)).toBe(true);
  });

  it("resolves a legacy imported branch reference before changing the selected target", () => {
    const input = reference();
    input.employees[0] = { ...input.employees[0], weeklyHours: 42, weeklyHoursMode: undefined };
    const selected40 = changeBranchWeeklyHours(input, 40);
    expect(selected40.employees[0].weeklyHoursMode).toBe("BRANCH");
    const prepared40 = prepareHoursProposal(selected40, "both");
    const restored42 = prepareHoursProposal(changeBranchWeeklyHours(prepared40, 42), "both");
    expect(restored42.employees[0].weeklyHours).toBe(42);
  });
});

describe("actionable grouped validation", () => {
  it("collapses thousands of pending days into one actionable cause and keeps all occurrences available", () => {
    const issues = Array.from({ length: 4000 }, (_, i) => ({ code: "DAY_PENDING", severity: "PENDING" as const, date: "2026-11-02", employeeId: `e${i}`, message: "Dia sem definição." }));
    const groups = groupValidationIssues(issues);
    expect(groups).toHaveLength(1);
    expect(groups[0].issues).toHaveLength(4000);
    expect(groups[0].guidance.target).toBe("generate");
    const html = renderToStaticMarkup(<ValidationResults input={reference()} validation={{ valid: true, readyToPublish: false, issues, summaries: [], minimumCoverageMargin: null }} onResolve={vi.fn()} />);
    expect(html).toContain("Limites de conferência (1)");
    expect(html).toContain("Gerar proposta mensal");
    expect(html).toContain("Escala ainda não gerada");
    expect(html).not.toContain("Ver detalhes (4000)");
    expect(html.length).toBeLessThan(10000);
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it("distinguishes normative review from missing coverage and never treats either as a completed approval", () => {
    const groups = groupValidationIssues([
      { code: "POLICY_PENDING", severity: "PENDING", message: "Revisão pendente" },
      { code: "COVERAGE_PENDING", severity: "PENDING", message: "Setor sem demanda" },
      { code: "COVERAGE_REVIEW_PENDING", severity: "PENDING", message: "Estimar demanda" },
    ]);
    expect(groups.map((group) => group.guidance.target)).toEqual(["rules", "generate", "coverage"]);
    expect(groups[0].guidance.instruction).toContain("Antes de publicar");
    expect(groups[2].guidance.instruction).toContain("mínimo zero");
  });

  it("keeps estimated coverage gaps pending and shows them before applying the draft", () => {
    const input = reference();
    const issues = [{ code: "ESTIMATED_COVERAGE_GAP", severity: "PENDING" as const, date: input.startDate, message: "Loja: presente 1, estimativa 2, 08:00–12:00." }];
    const groups = groupValidationIssues(issues);
    expect(groups[0].guidance.target).toBe("coverage");
    expect(groups[0].guidance.instruction).toContain("não aprova");
  });

  it("allows explicit coverage confirmation to freeze estimates without immediately invalidating that confirmation", () => {
    const input = reference();
    input.demands = [{ id: "d", date: input.startDate, sector: "Loja", start: 480, end: 720, minimum: 1, estimated: true }];
    input.policy.coverageReview = "SUGGESTED";
    const confirmed = { ...input, demands: input.demands.map((demand) => ({ ...demand, estimated: false })), policy: { ...input.policy, coverageReview: "CONFIRMED" as const } };
    expect(coverageDefinitionChanged(input, confirmed)).toBe(false);
    expect(confirmed.demands[0].estimated).toBe(false);
    expect(coverageDefinitionChanged(confirmed, { ...confirmed, demands: confirmed.demands.map((demand) => ({ ...demand, minimum: 2 })) })).toBe(true);
    expect(coverageDefinitionChanged(confirmed, { ...confirmed, employees: [...confirmed.employees] })).toBe(true);
    expect(coverageDefinitionChanged(confirmed, { ...confirmed, assignments: [] })).toBe(false);
  });
});
