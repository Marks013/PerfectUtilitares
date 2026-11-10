import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { storeClosingMinutes } from "@/lib/escalas/store-hours";
import { StoreClosingOption } from "./store-closing-option";
import { changeStoreClosingMinutes, coverageDefinitionChanged, newEmployee, newInput, scenarioDefinitionChanged } from "./workspace-model";

function fixture() {
  const input = newInput("08", "Loja", "2026-11", 42);
  input.employees = [{ ...newEmployee(42, "turno-inicial"), id: "person", sourceSchedule: {
    report: "FPRE136", code: "ref", description: "Original", weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00",
  } }];
  input.assignments = [
    { employeeId: "person", date: "2026-11-02", kind: "WORK", shiftId: "turno-inicial", locked: true },
    { employeeId: "person", date: "2026-11-03", kind: "ABSENCE", locked: true },
    { employeeId: "person", date: "2026-11-04", kind: "OFF" },
  ];
  input.demands = [
    { id: "estimated", date: "2026-11-02", sector: "Loja", start: 480, end: 720, minimum: 1, estimated: true },
    { id: "manual", date: "2026-11-02", sector: "Loja", start: 480, end: 720, minimum: 1 },
  ];
  return input;
}

describe("configurable store closing", () => {
  it.each([["02", "20:00"], ["08", "20:00"], ["018", "22:00"]])("shows the default for branch %s without changing the draft", (branch, closing) => {
    const input = newInput(branch, "Loja", "2026-11", 42);
    const before = structuredClone(input), onChange = vi.fn();
    const html = renderToStaticMarkup(<StoreClosingOption input={input} disabled={false} onChange={onChange} />);
    expect(html).toContain("Fechamento da loja");
    expect(html).toMatch(new RegExp(`<input(?=[^>]*type="time")(?=[^>]*value="${closing}")[^>]*>`));
    expect(html).toMatch(/<label[^>]*for="[^"]+"[^>]*>Fechamento da loja<\/label>/);
    expect(html).toContain('aria-describedby=');
    expect(html).toContain("Usar padrão da filial");
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toEqual(before);
  });

  it("renders a saved override and disables both controls during processing or read-only access", () => {
    const input = { ...fixture(), storeClosingMinutes: 1260 };
    const html = renderToStaticMarkup(<StoreClosingOption input={input} disabled onChange={vi.fn()} />);
    expect(html).toMatch(/<input(?=[^>]*value="21:00")(?=[^>]*disabled="")[^>]*>/);
    expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>Usar padrão da filial<\/button>/);
  });

  it("marks previous results stale without changing references, locks, absences or manual demand", () => {
    const input = fixture(), before = structuredClone(input);
    const next = changeStoreClosingMinutes(input, 1260);
    expect(next.storeClosingMinutes).toBe(1260);
    expect(next.needsRegeneration).toBe(true);
    expect(next.assignments).toBe(input.assignments);
    expect(next.shifts).toBe(input.shifts);
    expect(next.employees).toBe(input.employees);
    expect(next.policy).toBe(input.policy);
    expect(next.demands).toEqual([input.demands[1]]);
    expect(scenarioDefinitionChanged(input, { ...input, storeClosingMinutes: 1260 })).toBe(true);
    expect(coverageDefinitionChanged(input, { ...input, storeClosingMinutes: 1260 })).toBe(true);
    expect(input).toEqual(before);
    expect(changeStoreClosingMinutes(next, 1260)).toBe(next);
  });

  it("restores the branch default and leaves an empty plan current", () => {
    const input = newInput("18", "Loja", "2026-11", 42);
    const overridden = changeStoreClosingMinutes(input, 1200);
    expect(overridden.needsRegeneration).toBe(false);
    const restored = changeStoreClosingMinutes(overridden, undefined);
    expect(restored.storeClosingMinutes).toBeUndefined();
    expect(storeClosingMinutes(restored)).toBe(1320);
    expect(restored.needsRegeneration).toBe(false);
  });

  it("does not invalidate equivalent defaults and retains explicit choices across branches", () => {
    const input = fixture();
    const explicit = changeStoreClosingMinutes(input, 1200);
    expect(explicit.storeClosingMinutes).toBe(1200);
    expect(explicit.needsRegeneration).toBe(input.needsRegeneration);
    expect(explicit.demands).toBe(input.demands);
    expect(scenarioDefinitionChanged(input, explicit)).toBe(false);
    expect(coverageDefinitionChanged(input, explicit)).toBe(false);
    const reset = changeStoreClosingMinutes(explicit, undefined);
    expect(reset.storeClosingMinutes).toBeUndefined();
    expect(reset.demands).toBe(input.demands);
    expect(storeClosingMinutes({ ...reset, branchCode: "18" })).toBe(1320);
    expect(scenarioDefinitionChanged(reset, { ...reset, branchCode: "18" })).toBe(true);
    expect(coverageDefinitionChanged(reset, { ...reset, branchCode: "18" })).toBe(true);
    expect(storeClosingMinutes({ ...explicit, branchCode: "18" })).toBe(1200);
  });

  it("shows midnight as 00:00 and rejects invalid minute values before changing a draft", () => {
    const input = fixture();
    const midnight = changeStoreClosingMinutes(input, 1440);
    expect(renderToStaticMarkup(<StoreClosingOption input={midnight} disabled={false} onChange={vi.fn()} />)).toContain('value="00:00"');
    for (const value of [0, -1, 1441, 1200.5, Number.NaN]) {
      expect(() => changeStoreClosingMinutes(input, value)).toThrow("Informe um horário de fechamento válido.");
    }
    expect(input.storeClosingMinutes).toBeUndefined();
  });
});
