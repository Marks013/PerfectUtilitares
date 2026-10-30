import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ValidationResults } from "./results";
import { Coverage } from "./coverage-import";
import { CoverageTimeline } from "./coverage-timeline";
import { newInput } from "./workspace-model";

function fixture() {
  const input = newInput("08", "Ordenação", "2026-11", 42);
  const sectors = ["Zeladoria", "Loja 10", "Équipe", "Açougue", "Loja 2"];
  input.employees = sectors.map((sector, index) => ({ id: String(index), registration: String(index), name: sector, sector, role: "Operador", weeklyHours: 42, shiftIds: [], activeFrom: "", offMode: "VARIABLE" as const, fixedOffDays: [], offPattern: "ANY" as const, maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] }));
  input.demands = sectors.map((sector, index) => ({ id: String(index), date: "2026-11-02", sector, start: 480, end: 720, minimum: 1, estimated: sector !== "Zeladoria" }));
  return input;
}

describe("canonical Portuguese sector order in shortage views", () => {
  const expected = ["Açougue", "Équipe", "Loja 2", "Loja 10", "Zeladoria"];
  it("orders the actual shortage groups alphabetically without severity changing their order", () => {
    const html = renderToStaticMarkup(<ValidationResults input={fixture()} validation={{ valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null }} section="coverage" />);
    const names = [...html.matchAll(/<h4[^>]*>([^<]+)<\/h4>/g)].map(match => match[1]);
    expect(names).toEqual(expected);
    expect(html).toContain("mínimo informado para a operação");
  });
  it("uses numeric and accented order in the coverage sector filters", () => {
    const html = renderToStaticMarkup(<Coverage input={fixture()} disabled={false} onChange={vi.fn()} />);
    const select = html.match(/<select[^>]*>[\s\S]*?<\/select>/)?.[0] ?? "";
    const names = [...select.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map(match => match[1]);
    expect(names).toEqual(["Todos os setores", ...expected]);
  });
  it("orders the hourly graph sectors without mutating imported employees", () => {
    const input = fixture();
    const original = input.employees.map(person => person.sector);
    const html = renderToStaticMarkup(<CoverageTimeline input={input} />);
    const selects = html.match(/<select[^>]*>[\s\S]*?<\/select>/g) ?? [];
    const names = [...(selects[1] ?? "").matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map(match => match[1]);
    expect(names).toEqual(expected);
    expect(input.employees.map(person => person.sector)).toEqual(original);
  });
});
