import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalasWorkspace } from "./escalas-workspace";
import { useEscalasWorkspace } from "./use-escalas-workspace";
import { newEmployee, newInput } from "./workspace-model";

vi.mock("./use-escalas-workspace", () => ({ useEscalasWorkspace: vi.fn() }));

function state(workspace: EscalaWorkspace | null = null) {
  const action = vi.fn();
  return {
    saveState: "saved" as const, conflict: null, compareLatest: action, useServerRevision: action,
    rebaseDraft: action, closeConflict: action, localBackup: true, saveAndOpen: action,
    isCurrentRevision: () => true, recovery: null, recoverDraft: action, ignoreRecovery: action,
    flushDraft: vi.fn(async () => workspace), workspaces: workspace ? [workspace] : [],
    canCreate: true, workspace, input: workspace?.input ?? null, validation: workspace?.validation ?? null,
    dirty: false, outdated: false, busy: "", error: "", problem: null, notice: "", generated: null,
    pendingOpen: null, setPendingOpen: action, update: action, open: action, create: action, save: action,
    validate: action, generate: action, applyGenerated: action, undoRoster: action, publish: action,
    discard: action, deleteWorkspace: action, resetKey: 0, cancellable: false, cancelLabel: "Cancelar análise",
    cancelAnalysis: action, dismissProposals: action, canEdit: Boolean(workspace?.canEdit),
  } satisfies ReturnType<typeof useEscalasWorkspace>;
}

function plan() {
  return {
    id: "guided", revision: 1, status: "DRAFT", input: newInput("07", "Hiper", "2026-11", 42),
    validation: { valid: true, readyToPublish: false, minimumCoverageMargin: 0, summaries: [], issues: [] }, canEdit: true, canPublish: true, updatedAt: "2026-10-30T00:00:00Z",
  } satisfies EscalaWorkspace;
}

describe("guided scheduling workspace", () => {
  beforeEach(() => vi.mocked(useEscalasWorkspace).mockReturnValue(state()));

  it("starts with an open creation form and does not ask for advanced rules", () => {
    const html = renderToStaticMarkup(<EscalasWorkspace />);
    expect(html).toMatch(/<details[^>]*open=""[^>]*><summary[^>]*>Criar planejamento/);
    expect(html).toContain("Código da filial");
    expect(html).toContain("Mês de referência");
    expect(html).not.toContain("Premissas da simulação");
    expect(html).not.toContain("Conteúdo do PDF e XLSX");
  });

  it("guides import first, keeps generation in its own step and leaves exports out of an empty plan", () => {
    vi.mocked(useEscalasWorkspace).mockReturnValue(state(plan()));
    const html = renderToStaticMarkup(<EscalasWorkspace />);
    const navigation = html.slice(html.indexOf('aria-label="Etapas do planejamento"'), html.indexOf("</nav>"));
    expect((navigation.match(/<button/g) ?? []).length).toBe(3);
    expect(navigation).toContain("Importar equipe");
    expect(navigation).toContain("Escolher jornada e gerar");
    expect(navigation).toContain("Revisar e exportar");
    expect(navigation).toContain('aria-current="step"');
    expect(html).toMatch(/<section hidden="" inert="" id="escala-area-generate"/);
    expect(html).toContain("Voltar para importar equipe");
    expect(html).toContain("Ferramentas e ajustes opcionais");
    expect(html).not.toContain("Conteúdo do PDF e XLSX");
    expect(html).toContain("FPRE136 em CSV (recomendado) ou XLSX");
  });

  it("offers the next guided action for an imported team without requiring manual rules", () => {
    const workspace = plan();
    workspace.input.employees = [{ ...newEmployee(42, "day"), id: "person", registration: "001", name: "Pessoa" }];
    const model = state(workspace);
    vi.mocked(useEscalasWorkspace).mockReturnValue(model);
    const html = renderToStaticMarkup(<EscalasWorkspace />);
    expect(html).not.toContain("Selecione a filial e o mês para planejar.");
    expect(html).toContain("1 colaboradores incluídos");
    expect(html).toContain("Continuar para jornada e geração");
    expect(html).toContain("Férias e afastamentos são opcionais");
    expect(html).toContain("08:24");
    expect(html).toContain("Ajustar pausas de jornadas curtas (opcional)");
    expect(model.generate).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });
});
