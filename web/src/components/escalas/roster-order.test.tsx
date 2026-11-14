import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Roster } from "./roster";
import { newEmployee, newInput } from "./workspace-model";
import type { EscalaInput } from "@/lib/escalas/types";

// Exercise the existing filter/page render states without adding a browser or DOM runtime.
const state = vi.hoisted(() => ({ filter: "", sector: "", page: 0, textState: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, useState: (initial: unknown) => {
    const textIndex = initial === "" ? state.textState++ : -1;
    const value = textIndex === 1 ? state.filter : textIndex === 2 ? state.sector : initial === 0 ? state.page : initial;
    return actual.useState(value);
  } };
});

function fixture() {
  const input = newInput("06", "Loja sintética", "2026-12", 42);
  input.shifts = [
    { id: "early", name: "Primeiro intervalo", segments: [{ start: 480, end: 690, kind: "WORK" }, { start: 690, end: 810, kind: "BREAK" }, { start: 810, end: 1104, kind: "WORK" }] },
    { id: "later-break", name: "Outro intervalo", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 840, kind: "BREAK" }, { start: 840, end: 1104, kind: "WORK" }] },
    { id: "late", name: "Tarde", segments: [{ start: 576, end: 746, kind: "WORK" }, { start: 746, end: 866, kind: "BREAK" }, { start: 866, end: 1200, kind: "WORK" }] },
  ];
  const person = (id: string, name: string, role: string, shift: string, sector = "Açougue") => ({
    ...newEmployee(42, shift), id, registration: id, name, role, sector,
  });
  input.employees = [
    person("7", "Ana Tarde", "Operador", "late"),
    person("6", "Aline Outro Intervalo", "Operador", "later-break"),
    person("5", "Zélia Manhã", "Operador", "early"),
    person("4", "Bia Manhã", "Operador", "early"),
    { ...person("3", "Zoe Encarregada", "ENC. SETOR", "early"), scheduleMode: "UNTIMED" as const },
    person("2", "Zoe Auxiliar", "Auxiliar", "late"),
    person("8", "Aline Outro Setor", "Auxiliar", "early", "Padaria"),
    { ...person("1", "Aprendiz Excluído", "Auxiliar", "early"), planningEnabled: false, planningExclusionReason: "Fora da população mensal" },
  ];
  input.assignments = input.employees.flatMap(person => [
    { employeeId: person.id, date: "2026-12-01", kind: person.scheduleMode === "UNTIMED" ? "DUTY" as const : "WORK" as const, ...(person.scheduleMode === "UNTIMED" ? {} : { shiftId: person.shiftIds[0] }) },
    { employeeId: person.id, date: "2026-12-02", kind: "OFF" as const, locked: true },
    { employeeId: person.id, date: "2026-12-25", kind: "HOLIDAY" as const },
  ]);
  return input;
}

function render(input: EscalaInput, mode: "rest" | "both" = "rest") {
  state.textState = 0;
  const html = renderToStaticMarkup(<Roster input={input} validation={null} disabled={false} canUnlock onChange={vi.fn()} mode={mode} />);
  const monthly = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
  const names = [...monthly.matchAll(/<th scope="row"[^>]*><span[^>]*>([^<]+)<\/span>/g)].map(match => match[1]);
  return { html, monthly, names };
}

beforeEach(() => { state.filter = ""; state.sector = ""; state.page = 0; state.textState = 0; });

describe("monthly roster presentation order", () => {
  it("orders sectors, roles and the full proposed clock before names without changing the monthly population or days", () => {
    const input = fixture(), before = structuredClone(input);
    const { html, monthly, names } = render(input, "both");
    expect(names).toEqual(["Zoe Auxiliar", "Zoe Encarregada", "Bia Manhã", "Zélia Manhã", "Aline Outro Intervalo", "Ana Tarde", "Aline Outro Setor"]);
    expect(monthly).not.toContain("Aprendiz Excluído");
    expect(monthly).toContain('data-kind="DUTY" data-code="ENC"');
    expect(monthly).toContain('data-kind="OFF" data-code="F" data-locked="true"');
    expect(monthly).toContain('<span aria-hidden="true">FE</span>');
    expect(html).toContain("Setores de A–Z. Nas folgas e nos horários: cargo, horário completo crescente e nome.");
    expect(html.match(/Colaboradores por setor, cargo, horário completo crescente e nome\./g)).toHaveLength(2);
    expect(input).toEqual(before);
  });

  it("keeps combined sector and case-insensitive name/role/registration filtering on the same eligible population", () => {
    const input = fixture(), before = structuredClone(input);
    state.sector = "Açougue"; state.filter = "OPERADOR";
    expect(render(input).names).toEqual(["Bia Manhã", "Zélia Manhã", "Aline Outro Intervalo", "Ana Tarde"]);
    state.filter = "manhã";
    expect(render(input).names).toEqual(["Bia Manhã", "Zélia Manhã"]);
    state.filter = "7";
    expect(render(input).names).toEqual(["Ana Tarde"]);
    state.filter = "Aprendiz";
    expect(render(input).names).toEqual([]);
    expect(input).toEqual(before);
  });

  it("retains the twenty-person page boundary after applying the display order", () => {
    const input = fixture();
    input.employees = Array.from({ length: 21 }, (_, index) => ({ ...newEmployee(42, "early"), id: `p${index}`, registration: String(index + 1), name: `Pessoa ${String(21 - index).padStart(2, "0")}`, sector: "Loja", role: "Operador" }));
    input.assignments = input.employees.map(person => ({ employeeId: person.id, date: "2026-12-01", kind: "WORK", shiftId: "early" }));
    const before = structuredClone(input);
    expect(render(input).names).toEqual(Array.from({ length: 20 }, (_, index) => `Pessoa ${String(index + 1).padStart(2, "0")}`));
    state.page = 1;
    expect(render(input).names).toEqual(["Pessoa 21"]);
    expect(input).toEqual(before);
  });
});
