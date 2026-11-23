import { renderAsAdministrator as renderToStaticMarkup } from "./access-test-support";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EmployeeEditor } from "./employees";
import { FixedRestFields } from "./fixed-rest-fields";
import { newEmployee, newInput } from "./workspace-model";
import { fixedRestSlots, withFixedRestSlots } from "@/lib/escalas/fixed-rest";
import { EscalaAccessProvider } from "./access-context";

describe("independent explicit fixed rests", () => {
  it("shows the same two selectors to the operator of the planning branch", () => {
    const input = newInput("11", "Teste", "2026-11", 42), employee = newEmployee(42);
    input.employees = [employee];
    const render = (code: string) => renderMarkup(<EscalaAccessProvider value={{ channel: "USERNAME", roleLabel: "Operador",
      administrator: false, allBranches: false, branches: [{ code, label: "Filial", capabilities: ["workspace.read", "workspace.save", "employee.manage"] }] }}>
      <EmployeeEditor input={input} employee={employee} onSave={vi.fn()} onCancel={vi.fn()} />
    </EscalaAccessProvider>);
    expect(render("11").match(/<select(?![^>]*disabled)[^>]*>/g)).toHaveLength(2);
    expect(render("12")).toBe("");
    input.generationMode = "HOURS_ONLY";
    const hoursOnly = render("11");
    expect(hoursOnly.match(/<select[^>]*disabled[^>]*>/g)).toHaveLength(2);
    expect(hoursOnly).toContain("mantém as folgas da grade");
  });
  it("offers one selection per rest with the rotation selected by default", () => {
    const input = newInput("11", "Teste", "2026-11", 42), employee = newEmployee(42);
    const html = renderToStaticMarkup(<EmployeeEditor input={input} employee={employee} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(employee.offMode).toBe("VARIABLE"); expect(employee.fixedOffDays).toEqual([]);
    const fixedRestFields = html.match(/<fieldset[^>]*><legend[^>]*>Folgas semanais deste colaborador<\/legend>[\s\S]*?<\/fieldset>/)?.[0] ?? "";
    expect(fixedRestFields).toContain("Primeira folga");
    expect(fixedRestFields).toContain("Segunda folga");
    expect(fixedRestFields.match(/<select(?![^>]*disabled)[^>]*>/g)).toHaveLength(2);
    expect(fixedRestFields.match(/<option value="" selected="">No rodízio<\/option>/g)).toHaveLength(2);
    expect(fixedRestFields).not.toContain('type="checkbox"');
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
    expect(html).toContain('value="2" selected');
    expect(html).toContain('value="variable" selected="">No rodízio · dia guardado (sexta-feira)');
    expect(html).toContain("Voltar ao rodízio e guardar quarta-feira");
    expect(employee.fixedRestSlots).toBeUndefined();
  });
  it("shows branch closure separately and leaves personal slots disabled", () => {
    const input = newInput("02", "Icaraíma", "2026-12", 42), employee = newEmployee(42);
    const html = renderToStaticMarkup(<FixedRestFields input={input} employee={employee} onChange={vi.fn()} />);
    expect(html).toContain("A filial 02 fecha aos domingos.");
    expect(html.match(/<option value="" selected="">No rodízio<\/option>/g)).toHaveLength(2);
  });
  it("reports duplicate, Saturday and three-rest conflicts without changing data", () => {
    const input = newInput("02", "Icaraíma", "2026-12", 42);
    const employee = withFixedRestSlots(newEmployee(42), [{ enabled: true, weekday: 2 }, { enabled: true, weekday: 5 }]);
    const html = renderToStaticMarkup(<FixedRestFields input={input} employee={employee} onChange={vi.fn()} />);
    expect(html).toContain("não permite folga comum no sábado"); expect(html).toContain("somam três descansos");
    expect(employee.fixedOffDays).toEqual([2, 5]);

    const duplicate = withFixedRestSlots(newEmployee(42), [{ enabled: true, weekday: 2 }, { enabled: false, weekday: 2 }]);
    const duplicateHtml = renderToStaticMarkup(<FixedRestFields input={input} employee={duplicate} onChange={vi.fn()} />);
    expect(duplicateHtml).toContain("Este dia já foi fixado na outra folga. Selecione um dia diferente.");
    expect(duplicateHtml).toMatch(/<option(?=[^>]*value="2")(?=[^>]*disabled="")[^>]*>/);
    expect(duplicate.fixedOffDays).toEqual([2]);
  });
});
