import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ImportChanges } from "./import-changes";
import { newEmployee, newInput } from "./workspace-model";

function fixture() {
  const input = newInput("08", "Filial sintética", "2026-11", 42);
  const saved = { ...newEmployee(42, input.shifts[0].id), id: "saved", registration: "005",
    name: "Nome salvo", sector: "Caixas", role: "Operador" };
  input.employees = [saved];
  return { input, saved };
}

describe("employee import preview conflicts", () => {
  it("shows both rows and an accessible block when duplicate imported IDs and registrations occur", () => {
    const { input, saved } = fixture();
    const before = structuredClone(input);
    const employees = [
      { ...saved, id: "duplicate-id", name: "Primeira ocorrência" },
      { ...saved, id: "duplicate-id", name: "Segunda ocorrência" },
    ];
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<ImportChanges input={input} employees={employees}
      shifts={input.shifts} choices={{ updateRegistrations: [] }} disabled={false} onChange={onChange} />);
    expect(html).toContain("2 para conferir");
    expect(html).toContain("Importação bloqueada");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Primeira ocorrência");
    expect(html).toContain("Segunda ocorrência");
    expect(html).not.toContain("Atualizar nome, setor e cargo da matrícula 005");
    expect(html).not.toContain('type="checkbox"');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toEqual(before);
  });

  it("keeps a unique changed registration independently selectable without a false conflict", () => {
    const { input, saved } = fixture();
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<ImportChanges input={input}
      employees={[{ ...saved, id: "imported", name: "Nome atualizado" }]}
      shifts={input.shifts} choices={{ updateRegistrations: [] }} disabled={false} onChange={onChange} />);
    expect(html).toContain("1 com mudanças");
    expect(html).toContain("Atualizar nome, setor e cargo da matrícula 005");
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("Importação bloqueada");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("explains an ambiguous saved registration without offering an unsafe update", () => {
    const { input, saved } = fixture();
    input.employees.push({ ...saved, id: "another-saved-id" });
    const html = renderToStaticMarkup(<ImportChanges input={input}
      employees={[{ ...saved, id: "imported", name: "Revisão no arquivo" }]}
      shifts={input.shifts} choices={{ updateRegistrations: ["005"] }} disabled={false} onChange={vi.fn()} />);
    expect(html).toContain("1 para conferir");
    expect(html).toContain("Importação bloqueada");
    expect(html).not.toContain("Atualizar nome, setor e cargo da matrícula 005");
  });
});
