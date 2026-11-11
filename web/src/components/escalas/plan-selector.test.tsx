import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlanSelector, planPeriod, planSelection, selectPlan } from "./plan-selector";
import type { WorkspaceSummary } from "./use-escalas-workspace";
import { newInput } from "./workspace-model";

function plan(id: string, branch: string, month: string, revision = 1): WorkspaceSummary {
  return { id, revision, status: "DRAFT", updatedAt: "2026-11-11T12:00:00Z", input: newInput(branch, `Loja ${branch}`, month, 42) };
}
const plans = () => [plan("08-dec", "08", "2026-12"), plan("11-nov", "11", "2026-11"), plan("08-next", "8", "2027-01"),
  plan("02-nov", "02", "2026-11"), plan("08-nov", "08", "2026-11"), plan("08-jan", "08", "2026-01"), plan("02-dec", "02", "2026-12")];

describe("hierarchical planning selection", () => {
  it("groups canonical stores, years descending and only existing months in calendar order", () => {
    const input = plans(), before = structuredClone(input), selection = planSelection(input, "08-nov");
    expect(selection.branches.map(branch => branch.branchCode)).toEqual(["02", "08", "11"]);
    expect(selection.years).toEqual(["2027", "2026"]);
    expect(selection.months).toEqual(["01", "11", "12"]);
    expect(input).toEqual(before);
  });

  it("keeps the open month and year when switching stores, otherwise opens the latest real period", () => {
    expect(selectPlan(plans(), "08-nov", "branch", "02")).toBe("02-nov");
    expect(selectPlan(plans(), "02-dec", "branch", "08")).toBe("08-dec");
    expect(selectPlan(plans(), "02-dec", "branch", "11")).toBe("11-nov");
    expect(selectPlan(plans(), "11-nov", "branch", "missing")).toBeUndefined();
  });

  it("keeps the month in a new year when available, otherwise chooses that year's newest month", () => {
    const input = [...plans(), plan("08-nov-next", "08", "2027-11")];
    expect(selectPlan(input, "08-nov", "year", "2027")).toBe("08-nov-next");
    expect(selectPlan(plans(), "08-dec", "year", "2027")).toBe("08-next");
    expect(selectPlan(plans(), "08-next", "year", "2026")).toBe("08-jan");
    expect(selectPlan(plans(), "08-nov", "year", "2025")).toBeUndefined();
  });

  it("never changes store or year when a month is selected and never invents a missing plan", () => {
    expect(selectPlan(plans(), "08-nov", "month", "12")).toBe("08-dec");
    expect(selectPlan(plans(), "08-nov", "month", "11")).toBe("08-nov");
    expect(selectPlan(plans(), "08-next", "month", "12")).toBeUndefined();
    expect(selectPlan(plans(), undefined, "month", "11")).toBeUndefined();
    expect(selectPlan(plans(), undefined, "branch", "08")).toBe("08-next");
  });

  it("renders three native controls with associated visible labels and the actual open context", () => {
    const onSelect = vi.fn(), html = renderToStaticMarkup(<PlanSelector plans={plans()} selectedId="08-nov" disabled={false} onSelect={onSelect} />);
    expect(html.match(/<select\b/g)).toHaveLength(3);
    for (const label of ["Filial", "Ano", "Mês"]) expect(html).toMatch(new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${label}</label>`));
    expect(html).toContain('value="08" selected=""');
    expect(html).toContain('value="2026" selected=""');
    expect(html).toContain('value="11" selected=""');
    expect(html).toContain("Novembro de 2026");
    expect(html).toContain("Planejamento aberto:");
    expect(html).toContain("Rascunho");
    expect(html).not.toContain("Fevereiro");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps controls on the current workspace until opening is confirmed, and disables them while busy", () => {
    const requested = selectPlan(plans(), "08-nov", "branch", "02");
    expect(requested).toBe("02-nov");
    const html = renderToStaticMarkup(<PlanSelector plans={plans()} selectedId="08-nov" disabled onSelect={vi.fn()} />);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toContain('value="08" selected=""');
    expect(planSelection(plans(), "02-nov").period?.branch).toBe("02");
  });

  it("requires a store before enabling year and month without silently opening the first plan", () => {
    const onSelect = vi.fn(), html = renderToStaticMarkup(<PlanSelector plans={plans()} disabled={false} onSelect={onSelect} />);
    expect(html.match(/<select[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).not.toContain("Planejamento aberto:");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("retains duplicate same-period workspaces with explicit choices and the current ID", () => {
    const input = [...plans(), { ...plan("08-nov-copy", "08", "2026-11", 3), status: "PUBLISHED" as const }];
    expect(planSelection(input, "08-nov").matching.map(entry => entry.id).sort()).toEqual(["08-nov", "08-nov-copy"]);
    expect(selectPlan(input, "08-nov", "month", "11")).toBe("08-nov");
    const html = renderToStaticMarkup(<PlanSelector plans={input} selectedId="08-nov" disabled={false} onSelect={vi.fn()} />);
    expect(html.match(/<select\b/g)).toHaveLength(4);
    expect(html).toContain(">Planejamento</label>");
    expect(html).toContain('value="08-nov" selected=""');
    expect(html).toContain('value="08-nov-copy"');
    expect(html).toContain("Publicada");
    expect(html).toContain("revisão 3");
  });

  it("infers old complete-month horizons like the roster, but exposes custom legacy intervals", () => {
    const monthly = plan("old-month", "08", "2026-11");
    delete monthly.input.visibleMonth;
    expect(planPeriod(monthly)).toMatchObject({ key: "2026-11", label: "Novembro de 2026" });
    const weekly = { ...monthly, id: "old-week", input: { ...monthly.input, startDate: "2026-11-02", endDate: "2026-11-08" } };
    expect(planPeriod(weekly)).toMatchObject({ key: "2026-11", label: "02/11/2026 a 08/11/2026" });
    const html = renderToStaticMarkup(<PlanSelector plans={[monthly, weekly]} selectedId="old-week" disabled={false} onSelect={vi.fn()} />);
    expect(html).toContain("02/11/2026 a 08/11/2026");
    expect(html).toContain('value="old-month"');
    expect(html).toContain('value="old-week" selected=""');
  });
});
