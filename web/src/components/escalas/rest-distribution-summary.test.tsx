import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RestDistributionSummary } from "./rest-distribution-summary";
import { newEmployee, newInput } from "./workspace-model";

function fixture(pairs = 3) {
  const input = newInput("06", "Teste", "2026-11", 42);
  input.employees = [{ ...newEmployee(42), id: "one", registration: "001", name: "Pessoa incluída", sector: "Loja", activeFrom: "2020-01-01", scheduleMode: "UNTIMED" as const, shiftIds: [] }];
  input.assignments = [2, 9, 16].slice(0, pairs).flatMap(day => [day, day + 1].map(value => ({
    employeeId: "one", date: `2026-11-${String(value).padStart(2, "0")}`, kind: "OFF" as const,
  })));
  return input;
}

describe("plain-language rest distribution summary", () => {
  it("does not turn an unbuilt roster into a reassuring result", () => {
    expect(renderToStaticMarkup(<RestDistributionSummary input={newInput("06", "Teste", "2026-11", 42)} />)).toBe("");
  });
  it("shows the monthly target as a preference, not a quota, with optional details", () => {
    const html = renderToStaticMarkup(<RestDistributionSummary input={fixture()} />);
    expect(html).toContain('aria-label="Distribuição das folgas"');
    expect(html).toContain("até 2 pares por pessoa no mês");
    expect(html).toContain("não é uma quantidade a preencher");
    expect(html).toContain("Pessoa incluída");
    expect(html).toContain("3 pares");
    expect(html).toContain("Conferir quem passou da meta");
    expect(html).not.toContain("<details open");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("garantida");
  });
  it("compares actual counts without claiming that retained pairs are necessary", () => {
    const html = renderToStaticMarkup(<RestDistributionSummary input={fixture(1)} previousInput={fixture()} search={{ attempted: true, retainedReference: false }} />);
    expect(html).toContain("3 antes");
    expect(html).toContain("1 agora");
    expect(html).not.toContain("Pessoa incluída");
    expect(html).not.toContain("necessários");
    expect(html).not.toContain("Conferir quem passou da meta");
  });
  it("does not invent a reason or an earlier search when reopening a saved grade", () => {
    const html = renderToStaticMarkup(<RestDistributionSummary input={fixture(1)} />);
    expect(html).toContain("Contagem da grade exibida");
    expect(html).not.toContain("no prazo");
    expect(html).not.toContain("busca não");
    expect(html).not.toContain("necessários");
  });
  it("separates an unattempted search from a retained reference", () => {
    const unattempted = renderToStaticMarkup(<RestDistributionSummary input={fixture()} search={{ attempted: false, retainedReference: false }} />);
    expect(unattempted).toContain("A etapa de redistribuição não foi executada no prazo disponível");
    expect(unattempted).not.toContain("não existe alternativa");
    const retained = renderToStaticMarkup(<RestDistributionSummary input={fixture()} search={{ attempted: true, retainedReference: true }} />);
    expect(retained).toContain("A grade de referência foi preservada");
    expect(retained).not.toContain("conflito comprovado");
  });
  it("omits excluded employees and keeps imposed choices separate from editable days", () => {
    const input = fixture();
    input.employees[0].offMode = "FIXED";
    input.employees.push({ ...input.employees[0], id: "disabled", name: "Pessoa excluída", planningEnabled: false });
    input.assignments.push(...input.assignments.map(record => ({ ...record, employeeId: "disabled" })));
    const html = renderToStaticMarkup(<RestDistributionSummary input={input} />);
    expect(html).toContain("por bloqueios ou escolhas");
    expect(html).not.toContain("Pessoa excluída");
    expect(html).not.toContain("Conferir quem passou da meta");
  });
});
