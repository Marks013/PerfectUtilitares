import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EmployeeEditor } from "./employees";
import { newEmployee, newInput } from "./workspace-model";

describe("variable rests by default, fixed days by explicit choice", () => {
  it("offers an unchecked fixed-days option and separated rests for a new employee", () => {
    const input = newInput("11", "Teste", "2026-11", 42), employee = newEmployee(42);
    const html = renderToStaticMarkup(<EmployeeEditor input={input} employee={employee} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(employee.offMode).toBe("VARIABLE"); expect(employee.fixedOffDays).toEqual([]);
    expect(html).toContain("Fixar dias de folga (opcional)");
    expect(html).not.toContain("Quantas folgas fixas?");
    expect(html).not.toContain("Dias fixos aprovados");
    expect(html).toContain('value="ANY" selected');
    expect(html).toContain("Priorizar folgas separadas (padrão)");
  });
  it("preserves and shows an explicitly configured fixed rest arrangement", () => {
    const input = newInput("11", "Teste", "2026-11", 42);
    const employee = { ...newEmployee(42), offMode: "MIXED" as const, fixedOffDays: [2] };
    const html = renderToStaticMarkup(<EmployeeEditor input={input} employee={employee} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain("Quantas folgas fixas?"); expect(html).toContain("Dias fixos aprovados");
    expect(html).toContain('value="MIXED" selected');
  });
});
