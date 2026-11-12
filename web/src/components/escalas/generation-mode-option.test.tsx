import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { GenerationModeOption } from "./generation-mode-option";
import { Publication } from "./publication";
import { Roster } from "./roster";
import { changeGenerationMode, coverageDefinitionChanged, newEmployee, newInput, scenarioDefinitionChanged } from "./workspace-model";

function fixture() {
  const input = newInput("11", "Loja", "2026-11", 42);
  input.employees = [{ ...newEmployee(42, "turno-inicial"), id: "person", sector: "Açougue" }];
  input.assignments = [
    { employeeId: "person", date: "2026-11-02", kind: "OFF", locked: true },
    { employeeId: "person", date: "2026-11-03", kind: "ABSENCE" },
    { employeeId: "person", date: "2026-11-04", kind: "WORK", shiftId: "turno-inicial", locked: true },
  ];
  input.demands = [
    { id: "estimated", sector: "Açougue", date: "2026-11-02", start: 480, end: 720, minimum: 1, estimated: true },
    { id: "informed", sector: "Açougue", date: "2026-11-02", start: 480, end: 720, minimum: 1 },
  ];
  return input;
}

describe("calculation scope choice", () => {
  it("defaults to days and hours with three explicitly labelled radio choices", () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<GenerationModeOption input={fixture()} disabled={false} onChange={onChange} />);
    expect(html).toContain("O que gerar?");
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/<input(?=[^>]*value="DAYS_AND_HOURS")(?=[^>]*checked="")[^>]*>/);
    expect(html).not.toMatch(/<input(?=[^>]*value="REST_ONLY")(?=[^>]*checked="")[^>]*>/);
    expect(html).toContain("Folgas e horários");
    expect(html).toContain("Só folgas");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("explains the reference clocks and mixed daily durations without claiming times will be optimized", () => {
    const input = changeGenerationMode(fixture(), "REST_ONLY");
    const html = renderToStaticMarkup(<GenerationModeOption input={input} disabled onChange={vi.fn()} />);
    expect(html).toContain('disabled=""');
    expect(html).toMatch(/<input(?=[^>]*value="REST_ONLY")(?=[^>]*checked="")[^>]*>/);
    expect(html).toContain("sem otimizar entradas e saídas");
    expect(html).toContain("dias de 8h e 9h");
    expect(html).toContain("Horários bloqueados são preservados");
  });
  it("marks a saved roster stale while keeping locks, absences, clocks, people and informed minima", () => {
    const input = fixture(), before = structuredClone(input);
    const next = changeGenerationMode(input, "REST_ONLY");
    expect(next.generationMode).toBe("REST_ONLY");
    expect(next.needsRegeneration).toBe(true);
    expect(next.assignments).toBe(input.assignments);
    expect(next.employees).toBe(input.employees);
    expect(next.shifts).toBe(input.shifts);
    expect(next.policy).toBe(input.policy);
    expect(next.demands).toEqual([input.demands[1]]);
    expect(scenarioDefinitionChanged(input, next)).toBe(true);
    expect(coverageDefinitionChanged(input, { ...input, generationMode: "REST_ONLY" })).toBe(true);
    expect(input).toEqual(before);
    expect(changeGenerationMode(next, "REST_ONLY")).toBe(next);
  });
  it("treats absent mode as the existing default and does not mark an empty plan stale", () => {
    const input = newInput("11", "Loja", "2026-11", 42);
    expect(changeGenerationMode(input, "DAYS_AND_HOURS")).toBe(input);
    expect(scenarioDefinitionChanged(input, { ...input, generationMode: "DAYS_AND_HOURS" })).toBe(false);
    expect(coverageDefinitionChanged(input, { ...input, generationMode: "DAYS_AND_HOURS" })).toBe(false);
    expect(changeGenerationMode(input, "REST_ONLY").needsRegeneration).toBe(false);
  });
  it("prefers rest-only files and preview while retaining explicit hourly and combined views", () => {
    const input = changeGenerationMode(fixture(), "REST_ONLY");
    const validation = { valid: true, readyToPublish: false, summaries: [], issues: [], minimumCoverageMargin: null };
    const workspace: EscalaWorkspace = { id: "plan", revision: 1, status: "DRAFT", canEdit: true, canPublish: false, updatedAt: "2026-11-06", input, validation };
    const files = renderToStaticMarkup(<Publication workspace={workspace} validation={validation} dirty={false} busy={false} onPublish={vi.fn()} />);
    const rest = renderToStaticMarkup(<Roster input={input} validation={validation} disabled={false} canUnlock={false} onChange={vi.fn()} />);
    expect(files).toContain('<option value="rest" selected="">');
    expect(rest).toContain('<option value="rest" selected="">');
    for (const html of [files, rest]) { expect(html).toContain('value="hours"'); expect(html).toContain('value="both"'); }
    const explicit = renderToStaticMarkup(<Publication workspace={workspace} mode="hours" validation={validation} dirty={false} busy={false} onPublish={vi.fn()} />);
    expect(explicit).toContain('<option value="hours" selected="">');
  });
});
