import { renderAsAdministrator as renderToStaticMarkup } from "./access-test-support";
import { describe, expect, it, vi } from "vitest";
import { EmployeeEditor } from "./employees";
import { FixedRestFields } from "./fixed-rest-fields";
import { newEmployee, newInput } from "./workspace-model";
import { fixedRestSlots, withFixedRestSlots } from "@/lib/escalas/fixed-rest";

describe("independent explicit fixed rests", () => {
  it("offers two disabled controls without inferring fixed days", () => {
    const input = newInput("11", "Teste", "2026-11", 42), employee = newEmployee(42);
    const html = renderToStaticMarkup(<EmployeeEditor input={input} employee={employee} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(employee.offMode).toBe("VARIABLE"); expect(employee.fixedOffDays).toEqual([]);
    expect(html).toContain("Habilitar folga fixa 1");
    expect(html).toContain("Habilitar folga fixa 2");
    const fixedRestFields = html.match(/<fieldset[^>]*><legend[^>]*>Folgas fixas individuais \(opcional\)<\/legend>[\s\S]*?<\/fieldset>/)?.[0] ?? "";
    expect(fixedRestFields.match(/<input(?=[^>]*type="checkbox")(?=[^>]*disabled="")[^>]*>/g)).toHaveLength(2);
    expect(html).toContain("O Solver não habilita estes controles automaticamente.");
    expect(html).toMatch(/<option(?=[^>]*value="ANY")(?=[^>]*selected="")[^>]*>Priorizar folgas separadas \(padrão\)<\/option>/);
    expect(html).not.toContain("Quantas folgas fixas?");
    expect(html).not.toContain("Dias fixos aprovados");
  });
  it("retains legacy choices and independently remembers a disabled slot", () => {
    const input = newInput("11", "Teste", "2026-11", 42);
    const employee = { ...newEmployee(42), offMode: "MIXED" as const, fixedOffDays: [2] };
    const slots = fixedRestSlots(employee); slots[1] = { enabled: false, weekday: 4 };
    const edited = withFixedRestSlots(employee, slots);
    const html = renderToStaticMarkup(<FixedRestFields input={input} employee={edited} onChange={vi.fn()} />);
    expect(edited.fixedOffDays).toEqual([2]); expect(edited.fixedRestSlots?.[1]).toEqual({ enabled: false, weekday: 4 });
    expect(html).toContain('value="2" selected'); expect(html).toContain('value="4" selected');
    expect(html).toContain("Desabilitada: o dia está guardado");
    expect(employee.fixedRestSlots).toBeUndefined();
  });
  it("shows branch closure separately and leaves personal slots disabled", () => {
    const input = newInput("02", "Icaraíma", "2026-12", 42), employee = newEmployee(42);
    const html = renderToStaticMarkup(<FixedRestFields input={input} employee={employee} onChange={vi.fn()} />);
    expect(html).toContain("Filial 02: domingo fechado"); expect(html).not.toContain('checked=""');
  });
  it("reports duplicate, Saturday and three-rest conflicts without changing data", () => {
    const input = newInput("02", "Icaraíma", "2026-12", 42);
    const employee = withFixedRestSlots(newEmployee(42), [{ enabled: true, weekday: 2 }, { enabled: true, weekday: 5 }]);
    const html = renderToStaticMarkup(<FixedRestFields input={input} employee={employee} onChange={vi.fn()} />);
    expect(html).toContain("não permite folga comum no sábado"); expect(html).toContain("somam três descansos");
    expect(employee.fixedOffDays).toEqual([2, 5]);

    const duplicate = withFixedRestSlots(newEmployee(42), [{ enabled: true, weekday: 2 }, { enabled: false, weekday: 2 }]);
    const duplicateHtml = renderToStaticMarkup(<FixedRestFields input={input} employee={duplicate} onChange={vi.fn()} />);
    expect(duplicateHtml).toContain("O outro controle já fixa este dia. Escolha outro para habilitar.");
    expect(duplicate.fixedOffDays).toEqual([2]);
  });
});
