import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import { EscalaAccessProvider } from "./access-context";
import { PlanSelector, planPeriod, planSelection } from "./plan-selector";
import type { WorkspaceSummary } from "./use-escalas-workspace";
import { newInput } from "./workspace-model";

function plan(id: string, branch: string, month: string, revision = 1): WorkspaceSummary {
  return { id, revision, status: "DRAFT", updatedAt: "2026-11-11T12:00:00Z", input: newInput(branch, `Loja ${branch}`, month, 42) };
}
const plans = () => [plan("08-dec", "08", "2026-12"), plan("11-nov", "11", "2026-11"), plan("08-next", "8", "2027-01"),
  plan("02-nov", "02", "2026-11"), plan("08-nov", "08", "2026-11"), plan("08-jan", "08", "2026-01"), plan("02-dec", "02", "2026-12")];

const adminAccess: EscalaClientAccess = {
  channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [],
};

function branchGrant(code: string, label: string): EscalaClientAccess["branches"][number] {
  return { code, label, capabilities: ["workspace.read"] };
}

const operatorAccess: EscalaClientAccess = {
  channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
  branches: [branchGrant("08", "Centro")],
};

function renderSelector(props: ComponentProps<typeof PlanSelector>, access = adminAccess) {
  return renderToStaticMarkup(<EscalaAccessProvider value={access}><PlanSelector {...props} /></EscalaAccessProvider>);
}

describe("hierarchical planning selection", () => {
  it("distinguishes a Sunday copy from its legacy original in the same month", () => {
    const sunday = plan("sunday", "06", "2026-12"), legacy = plan("legacy", "06", "2026-12");
    delete legacy.input.planningWeekStartsOn;
    legacy.input.startDate = "2026-11-30"; legacy.input.endDate = "2027-01-03";
    const before = structuredClone([sunday, legacy]);
    const html = renderSelector({ plans: [sunday, legacy], selectedId: "sunday", disabled: false, onSelect: vi.fn() });
    expect(html).toContain('value="sunday" selected=""');
    expect(html).toContain("domingo a sábado");
    expect(html).toContain("segunda a domingo");
    expect([sunday, legacy]).toEqual(before);
  });

  it("groups canonical stores, years descending and only existing months in calendar order", () => {
    const input = plans(), before = structuredClone(input), selection = planSelection(input, "08-nov");
    expect(selection.branches.map(branch => branch.branchCode)).toEqual(["02", "08", "11"]);
    expect(selection.years).toEqual(["2027", "2026"]);
    expect(selection.months).toEqual(["01", "11", "12"]);
    expect(input).toEqual(before);
  });

  it("stages a different branch without automatically choosing a period or changing the active plan", () => {
    expect(planSelection(plans(), "08-nov", undefined, { branch: "02" })).toMatchObject({
      active: { id: "08-nov" }, branch: "02", year: undefined, month: undefined, chosen: undefined,
    });
    expect(planSelection(plans(), "08-nov", undefined, { branch: "missing" }).chosen).toBeUndefined();
  });

  it("filters months by year while keeping the opened workspace until a month is chosen", () => {
    const input = [...plans(), plan("08-nov-next", "08", "2027-11")];
    expect(planSelection(input, "08-nov", undefined, { year: "2027" })).toMatchObject({
      active: { id: "08-nov" }, year: "2027", month: undefined, months: ["01", "11"], matching: [],
    });
    expect(planSelection(input, "08-nov", undefined, { year: "2027", month: "11" }).chosen?.id).toBe("08-nov-next");
    expect(planSelection(input, "08-nov", undefined, { year: "2027", month: "12" }).chosen).toBeUndefined();
    expect(planSelection(input, "08-nov", undefined, { year: "2025" }).year).toBeUndefined();
  });

  it("never changes store or year when a month is selected and never invents a missing plan", () => {
    expect(planSelection(plans(), "08-nov", undefined, { month: "12" }).chosen?.id).toBe("08-dec");
    expect(planSelection(plans(), "08-nov", undefined, { month: "11" }).chosen?.id).toBe("08-nov");
    expect(planSelection(plans(), "08-next", undefined, { month: "12" }).chosen).toBeUndefined();
    expect(planSelection(plans(), undefined, undefined, { month: "11" }).chosen).toBeUndefined();
  });

  it("renders three native controls with associated visible labels and the actual open context", () => {
    const onSelect = vi.fn(), html = renderSelector({ plans: plans(), selectedId: "08-nov", disabled: false, onSelect });
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
    const html = renderSelector({ plans: plans(), selectedId: "08-nov", disabled: true, onSelect: vi.fn() });
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Abrir planejamento<\/button>/);
    expect(html).toContain('value="08" selected=""');
    expect(planSelection(plans(), "02-nov").period?.branch).toBe("02");
  });

  it("requires a store before enabling year and month without silently opening the first plan", () => {
    const onSelect = vi.fn(), html = renderSelector({ plans: plans(), disabled: false, onSelect });
    expect(html.match(/<select[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).not.toContain("Planejamento aberto:");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("retains duplicate same-period workspaces with explicit choices and the current ID", () => {
    const input = [...plans(), { ...plan("08-nov-copy", "08", "2026-11", 3), status: "PUBLISHED" as const }];
    expect(planSelection(input, "08-nov").matching.map(entry => entry.id).sort()).toEqual(["08-nov", "08-nov-copy"]);
    expect(planSelection(input, "08-nov").chosen?.id).toBe("08-nov");
    const filters = { branch: "08", year: "2026", month: "11" };
    expect(planSelection(input, undefined, undefined, filters).chosen).toBeUndefined();
    expect(planSelection(input, undefined, undefined, { ...filters, planId: "02-nov" }).chosen).toBeUndefined();
    expect(planSelection(input, undefined, undefined, { ...filters, planId: "08-nov-copy" }).chosen?.id).toBe("08-nov-copy");
    const html = renderSelector({ plans: input, selectedId: "08-nov", disabled: false, onSelect: vi.fn() });
    expect(html.match(/<select\b/g)).toHaveLength(4);
    expect(html).toContain(">Planejamento</label>");
    expect(html).toContain('value="08-nov" selected=""');
    expect(html).toContain('value="08-nov-copy"');
    expect(html).toContain("Publicada");
    expect(html).toContain("revisão 3");
  });

  it("uses the single grant even with a stale selection and lets the operator start by year", () => {
    const onSelect = vi.fn();
    const html = renderSelector({ plans: plans(), selectedId: "11-nov", disabled: false, onSelect }, operatorAccess);
    expect(html).toContain("Filial 08 · Centro");
    expect(html.match(/<select\b/g)).toHaveLength(2);
    expect(html.match(/<select[^>]*disabled=""/g)).toHaveLength(1);
    expect(html).toContain('value="2027"');
    expect(html).toContain("Selecione o ano primeiro");
    expect(html).not.toContain("Planejamento aberto:");
    expect(html).not.toContain("Loja 11");
    expect(planSelection(plans(), undefined, "08", { year: "2027" })).toMatchObject({
      active: undefined, year: "2027", month: undefined, months: ["01"],
    });
    expect(planSelection(plans(), undefined, "08", { branch: "02", year: "2027", month: "01" }).chosen?.id).toBe("08-next");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows the fixed branch when there is no planning", () => {
    const html = renderSelector({ plans: [], disabled: false, onSelect: vi.fn() }, operatorAccess);
    expect(html).toContain("Filial 08 · Centro");
    expect(html).toContain("Nenhum planejamento disponível nesta filial.");
    expect(html).not.toContain("<select");
  });

  it("keeps branch choice for multiple grants and for an administrator with only one plan", () => {
    const access = { ...operatorAccess, branches: [...operatorAccess.branches, branchGrant("02", "Norte")] };
    const scoped = renderSelector({ plans: plans(), selectedId: "08-nov", disabled: false, onSelect: vi.fn() }, access);
    expect(scoped).toContain('value="02"');
    expect(scoped).toContain('value="08" selected=""');
    expect(scoped).not.toContain('value="11">Filial');
    const admin = renderSelector({ plans: [plan("one-plan", "08", "2026-11")], selectedId: "one-plan", disabled: false, onSelect: vi.fn() });
    expect(admin).toContain(">Filial</label>");
    expect(admin.match(/<select\b/g)).toHaveLength(3);
  });

  it("does not expose plans or select another branch without the access provider", () => {
    const onSelect = vi.fn();
    const html = renderToStaticMarkup(<PlanSelector plans={plans()} selectedId="08-nov" disabled={false} onSelect={onSelect} />);
    expect(html).toContain("Não foi possível confirmar o acesso às filiais.");
    expect(html).not.toContain("Planejamento aberto:");
    expect(html).not.toContain("Loja 08");
    expect(html).not.toContain("<select");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("infers old complete-month horizons like the roster, but exposes custom legacy intervals", () => {
    const monthly = plan("old-month", "08", "2026-11");
    delete monthly.input.visibleMonth;
    expect(planPeriod(monthly)).toMatchObject({ key: "2026-11", label: "Novembro de 2026" });
    const weekly = { ...monthly, id: "old-week", input: { ...monthly.input, startDate: "2026-11-02", endDate: "2026-11-08" } };
    expect(planPeriod(weekly)).toMatchObject({ key: "2026-11", label: "02/11/2026 a 08/11/2026" });
    const html = renderSelector({ plans: [monthly, weekly], selectedId: "old-week", disabled: false, onSelect: vi.fn() });
    expect(html).toContain("02/11/2026 a 08/11/2026");
    expect(html).toContain('value="old-month"');
    expect(html).toContain('value="old-week" selected=""');
  });
});
