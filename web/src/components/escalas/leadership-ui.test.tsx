import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImportChanges } from "./import-changes";
import { LeadershipFields } from "./leadership-fields";
import { LeadershipSummary } from "./leadership-summary";
import { MovementPriorities } from "./movement-priorities";
import { newEmployee, newInput } from "./workspace-model";

describe("optional operational controls", () => {
  it("keeps movement optional, labelled and free of presumed weekend peaks", () => {
    const html = renderToStaticMarkup(<MovementPriorities input={newInput("02", "Filial", "2026-11", 42)} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("Movimento da loja (opcional)");
    expect(html).toContain("não presume movimento maior no fim de semana");
    expect(html).not.toContain("<details open");
    expect(html).toContain("Repetir em dias da semana");
    expect(html).not.toContain("Quais dias desse período?");
    expect(html).not.toContain('checked=""');
    expect(html).toContain('value="2026-11-01"');
    expect(html).toContain("<label");
  });
  it("offers responsibility correction without calling a manager a sector substitute", () => {
    const input = newInput("02", "Filial", "2026-11", 42);
    const employee = { ...newEmployee(42), id: "one", registration: "001", name: "Pessoa", role: "GERENTE", sector: "Administrativo" };
    const html = renderToStaticMarkup(<LeadershipFields employee={employee} input={input} onChange={vi.fn()} />);
    expect(html).toContain('value="BRANCH" selected');
    expect(html).toContain("não substitui automaticamente um encarregado");
  });
  it("refreshes an inferred responsibility after editing the role instead of retaining an old sector", () => {
    const input = newInput("02", "Filial", "2026-11", 42);
    const employee = { ...newEmployee(42), id: "one", registration: "001", name: "Pessoa", role: "GERENTE", sector: "Administrativo",
      leadership: { role: "SECTOR" as const, source: "INFERRED" as const, sectors: ["Caixa"] } };
    const html = renderToStaticMarkup(<LeadershipFields employee={employee} input={input} onChange={vi.fn()} />);
    expect(html).toContain('value="BRANCH" selected');
    expect(html).not.toContain('checked=""');
    const manual = { ...employee, leadership: { ...employee.leadership, source: "MANUAL" as const } };
    expect(renderToStaticMarkup(<LeadershipFields employee={manual} input={input} onChange={vi.fn()} />)).toContain('value="SECTOR" selected');
  });
  it("shows import differences and requires explicit confirmation to change a known employee", () => {
    const input = newInput("02", "Filial", "2026-11", 42);
    const employee = { ...newEmployee(42), id: "one", registration: "001", name: "Pessoa", role: "Operador", sector: "Caixa" };
    input.employees = [employee];
    const html = renderToStaticMarkup(<ImportChanges input={input} employees={[{ ...employee, role: "Encarregado" }]} shifts={[]} choices={{ updateRegistrations: [] }} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("1 com mudanças");
    expect(html).toContain("só mudam com sua confirmação");
    expect(html).not.toContain('checked=""');
  });
  it("does not show empty leadership statistics and separates attendance from hourly coverage", () => {
    expect(renderToStaticMarkup(<LeadershipSummary counts={undefined} />)).toBe("");
    const html = renderToStaticMarkup(<LeadershipSummary counts={{ prioritizedSectorDays: 10, prioritizedSectorDaysWithoutLeader: 2, criticalSectorDays: 4, criticalSectorDaysWithoutLeader: 1, timedCoverageIncluded: false }} />);
    expect(html).toContain("8 de 10 presenças planejadas");
    expect(html).toContain("1 setor(es)/dia");
    expect(html).toContain("não acrescenta colaboradores nem cobertura por horário");
  });
});
