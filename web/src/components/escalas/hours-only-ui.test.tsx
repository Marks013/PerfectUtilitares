import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { GenerationModeOption, hasHourReferences } from "./generation-mode-option";
import { HoursProposal } from "./hours-proposal";
import { HoursReferencePreview } from "./hours-reference-preview";
import { EmployeeEditor } from "./employees";
import { Publication } from "./publication";
import { Roster } from "./roster";
import { changeGenerationMode, newEmployee, newInput } from "./workspace-model";
import { Mixed42Option } from "./mixed-42-option";

const validation = { valid: true, readyToPublish: true, summaries: [], issues: [], minimumCoverageMargin: null };
function fixture(hours: 40 | 42 | 44 = 42) {
  const input = newInput("11", "Loja", "2026-11", hours);
  input.generationMode = "HOURS_ONLY";
  input.shifts = [{ id: "day", name: "Referência", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 780 + hours * 12 - 240, kind: "WORK" }] }];
  input.employees = [{ ...newEmployee(hours, "day"), id: "one", registration: "1", name: "Ana", sector: "Loja", activeFrom: "2020-01-01" }];
  return input;
}

describe("hours-only scope and relevant controls", () => {
  it.each(([40, 42, 44] as const).flatMap(hours => (["DAYS_AND_HOURS", "REST_ONLY", "HOURS_ONLY"] as const).map(mode => ({ hours, mode }))))("keeps the $hours h × $mode selection and activates mixed controls only at 42h", ({ hours, mode }) => {
    const input = fixture(hours); input.generationMode = mode;
    const original = structuredClone(input);
    const html = renderToStaticMarkup(<GenerationModeOption input={input} disabled={false} onChange={vi.fn()} />);
    expect(html).toMatch(new RegExp(`<input(?=[^>]*value="${mode}")(?=[^>]*checked="")[^>]*>`));
    const mixed = renderToStaticMarkup(<Mixed42Option input={input} disabled={false} onChange={vi.fn()} />);
    if (hours === 42) expect(mixed).toContain("Jornada mista de 42h");
    else expect(mixed).toBe("");
    expect(input).toEqual(original);
  });

  it.each([40, 42, 44] as const)("offers three explicit modes at %ih without changing the input", hours => {
    const input = fixture(hours), before = structuredClone(input);
    const html = renderToStaticMarkup(<GenerationModeOption input={input} disabled={false} onChange={vi.fn()} />);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/<input(?=[^>]*value="HOURS_ONLY")(?=[^>]*checked="")[^>]*>/);
    expect(html).toContain("sem criar presenças ou folgas");
    expect(input).toEqual(before);
  });
  it("changing scope keeps assignments, restrictions, clocks and manual workload", () => {
    const input = fixture(40); input.generationMode = "REST_ONLY";
    input.assignments = [{ employeeId: "one", date: "2026-11-02", kind: "OFF", locked: true }, { employeeId: "one", date: "2026-11-03", kind: "ABSENCE" }];
    const next = changeGenerationMode(input, "HOURS_ONLY");
    expect(next.assignments).toBe(input.assignments); expect(next.employees).toBe(input.employees);
    expect(next.shifts).toBe(input.shifts); expect(next.policy).toBe(input.policy); expect(next.needsRegeneration).toBe(true);
  });
  it("requires preparation on entry to hours-only even before importing the team", () => {
    const input = newInput("11", "Loja", "2026-11", 42);
    const next = changeGenerationMode(input, "HOURS_ONLY");
    expect(next.needsRegeneration).toBe(true);
    expect(next.assignments).toBe(input.assignments);
    expect(input.needsRegeneration).not.toBe(true);
  });
  it("can export valid references with no attendance while blocking rest outputs and publication", () => {
    const input = fixture();
    const workspace: EscalaWorkspace = { id: "plan", revision: 1, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-11-12", input, validation };
    const html = renderToStaticMarkup(<Publication workspace={workspace} validation={validation} dirty={false} busy={false} mode="both" onPublish={vi.fn()} />);
    expect(html).toContain('<option value="hours" selected="">Referências de horários</option>');
    expect(html).not.toContain('value="rest"'); expect(html).not.toContain('value="both"');
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Gerar PDF<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
    expect(html).toContain("Não representa presença diária nem cobertura garantida");
  });
  it("does not call zero clocks an exportable hourly reference", () => {
    const input = fixture(); input.employees[0].scheduleMode = "UNTIMED";
    expect(hasHourReferences(input)).toBe(false);
    input.assignments = [{ employeeId: "one", date: "2026-11-02", kind: "ABSENCE" }];
    const workspace: EscalaWorkspace = { id: "plan", revision: 1, status: "DRAFT", canEdit: true, canPublish: false, updatedAt: "2026-11-12", input, validation };
    const files = renderToStaticMarkup(<Publication workspace={workspace} validation={validation} dirty={false} busy={false} onPublish={vi.fn()} />);
    expect(files).toMatch(/<button[^>]*disabled=""[^>]*>Gerar PDF<\/button>/);
    const html = renderToStaticMarkup(<HoursReferencePreview input={input} />);
    expect(html).toContain("nenhum horário foi atribuído"); expect(html).not.toContain("folgas planejadas");
  });
  it("hides rest editing in hours-only and keeps reference output separate from a calendar", () => {
    const input = fixture();
    const editor = renderToStaticMarkup(<EmployeeEditor input={input} employee={input.employees[0]} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(editor).not.toContain("Organização das folgas"); expect(editor).not.toContain("Preferências de folga");
    expect(editor).toContain("os dias já registrados são preservados");
    const roster = renderToStaticMarkup(<Roster input={input} validation={validation} disabled={false} canUnlock={false} mode="both" onChange={vi.fn()} />);
    expect(roster).not.toContain('value="rest"'); expect(roster).not.toContain('value="both"');
    const references = renderToStaticMarkup(<HoursReferencePreview input={input} />);
    expect(references).toContain("Referências de horários"); expect(references).not.toContain("Revisar dia");
    expect(references).toContain("Nenhum dia de trabalho ou folga foi criado");
  });
  it("defaults manual adaptation to comparing both clock anchors without applying on render", () => {
    const input = fixture(), onChange = vi.fn();
    const html = renderToStaticMarkup(<HoursProposal input={input} disabled={false} onChange={onChange} />);
    expect(html).toContain('<option value="both" selected="">Automático');
    expect(html).toContain("Manual · Manter entrada"); expect(onChange).not.toHaveBeenCalled();
  });
});
