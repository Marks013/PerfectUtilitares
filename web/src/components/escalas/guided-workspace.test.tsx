import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { renderAsAdministrator as renderToStaticMarkup } from "./access-test-support";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaWorkspaceAccessMetadata } from "@/lib/escalas/access-contracts";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaAccessProvider } from "./access-context";
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
    pendingOpen: null, setPendingOpen: action, update: action, open: action, create: action, createApproved: action, createMonth: action,
    addEmployee: vi.fn(async () => false), removeEmployee: vi.fn(async () => false), changeAbsence: vi.fn(async () => false), replaceImport: vi.fn(async () => null), rebaseApproved: action,
    upgradeCalendar: action, save: action,
    validate: action, generate: action, canGenerate: Boolean(workspace?.canEdit), readOnlyDraft: false, applyGenerated: action,
    undoRoster: vi.fn(async () => false), publish: action,
    discard: action, deleteWorkspace: action, resetKey: 0, cancellable: false, cancelLabel: "Cancelar análise",
    cancelAnalysis: action, dismissProposals: action, canEdit: Boolean(workspace?.canEdit),
  } satisfies ReturnType<typeof useEscalasWorkspace>;
}

function plan(): EscalaWorkspace {
  return {
    id: "guided", revision: 1, status: "DRAFT", input: newInput("07", "Hiper", "2026-11", 42),
    validation: { valid: true, readyToPublish: false, minimumCoverageMargin: 0, summaries: [], issues: [] }, canEdit: true, canPublish: true, updatedAt: "2026-10-30T00:00:00Z",
  } satisfies EscalaWorkspace;
}

describe("guided scheduling workspace", () => {
  beforeEach(() => vi.mocked(useEscalasWorkspace).mockReturnValue(state()));

  it("explains the active convention and offers an explicit copy only for editable legacy plans", () => {
    const workspace = plan();
    vi.mocked(useEscalasWorkspace).mockReturnValue(state(workspace));
    let html = renderToStaticMarkup(<EscalasWorkspace />);
    expect(html).toContain("domingo a sábado. O domingo inicia uma nova semana.");
    expect(html).not.toContain("Usar semana de domingo a sábado");
    workspace.input.planningWeekStartsOn = "MONDAY";
    workspace.input.startDate = "2026-10-26"; workspace.input.endDate = "2026-12-06";
    vi.mocked(useEscalasWorkspace).mockReturnValue(state(workspace));
    html = renderToStaticMarkup(<EscalasWorkspace />);
    expect(html).toContain("segunda a domingo (planejamento anterior).");
    expect(html).toContain("Usar semana de domingo a sábado");
    expect(html).toContain("crie um novo rascunho a partir deste");
    workspace.canEdit = false;
    vi.mocked(useEscalasWorkspace).mockReturnValue(state(workspace));
    expect(renderToStaticMarkup(<EscalasWorkspace />)).not.toContain("Usar semana de domingo a sábado");
  });

  it("directs an operator to approved employee registration and hides administrative actions", () => {
    const workspace = { ...plan(), approvedPolicyVersionId: "approved" } satisfies EscalaWorkspace & Partial<EscalaWorkspaceAccessMetadata>;
    workspace.input.planningWeekStartsOn = "MONDAY";
    vi.mocked(useEscalasWorkspace).mockReturnValue(state(workspace));
    const access: EscalaClientAccess = {
      channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
      branches: [{ code: "07", label: "Hiper", capabilities: ["workspace.read", "workspace.save", "workspace.create", "employee.manage"] }],
    };
    const html = renderMarkup(<EscalaAccessProvider value={access}><EscalasWorkspace /></EscalaAccessProvider>);
    expect(html).toContain("Cadastre os colaboradores usando um modelo aprovado.");
    expect(html).not.toContain("Importar equipe");
    expect(html).not.toContain("Usar semana de domingo a sábado");
  });

  it("offers shift assignment independently of employee editing, for eligible people only", () => {
    const workspace = plan();
    const timed = newEmployee(42, workspace.input.shifts[0].id);
    workspace.input.employees = [
      { ...timed, id: "timed", name: "Pessoa com turno" },
      { ...timed, id: "untimed", name: "Pessoa sem turno", scheduleMode: "UNTIMED", shiftIds: [] },
    ];
    vi.mocked(useEscalasWorkspace).mockReturnValue(state(workspace));
    const access: EscalaClientAccess = {
      channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
      branches: [{ code: "07", label: "Hiper", capabilities: ["workspace.read", "workspace.save", "shift.manage"] }],
    };
    const html = renderMarkup(<EscalaAccessProvider value={access}><EscalasWorkspace /></EscalaAccessProvider>);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Trocar turno<span[^>]*> de Pessoa com turno/);
    expect(html.match(/>Trocar turno</g)).toHaveLength(1);
  });

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
    expect(navigation).toContain("Equipe");
    expect(navigation).toContain("Montar escala");
    expect(navigation).toContain("Horários, folgas e arquivos");
    expect(navigation).toContain('aria-current="step"');
    expect(html).toMatch(/<section hidden="" inert="" id="escala-area-generate"/);
    expect(html).toContain("Conferir equipe");
    expect(html).toMatch(/<nav aria-label="Relatórios opcionais"[^>]*><button[^>]*aria-controls="escala-area-reports"[^>]*>Relatórios e gráficos PDF<\/button><\/nav>/);
    expect(html).not.toContain("Relatórios operacionais (opcional)");
    expect(html).toContain("Conferências e configurações");
    expect(html).not.toContain("Conteúdo do PDF e XLSX");
    expect(html).toContain("Arquivo de equipe CSV ou XLSX");
    expect(html).toMatch(/<input(?=[^>]*type="file")(?=[^>]*accept="\.csv,\.xlsx")[^>]*>/);
  });

  it("offers the next guided action for an imported team without requiring manual rules", () => {
    const workspace = plan();
    workspace.input.employees = [{ ...newEmployee(42, workspace.input.shifts[0].id), id: "person", registration: "001", name: "Pessoa" }];
    const model = state(workspace);
    vi.mocked(useEscalasWorkspace).mockReturnValue(model);
    const html = renderToStaticMarkup(<EscalasWorkspace />);
    expect(html).not.toContain("Selecione a filial e o mês para planejar.");
    expect(html).toContain("1 colaborador incluído");
    expect(html).toContain("Continuar para montar escala");
    expect(html).toContain("Confira os colaboradores e os afastamentos registrados");
    expect(html).toContain("08:24");
    expect(html).toContain("Fechamento da loja");
    expect(html).toMatch(/<input(?=[^>]*type="time")(?=[^>]*value="20:00")[^>]*>/);
    expect(html).toContain("Equilibrar os dois períodos de trabalho em até 4h30 cada");
    expect(html).toContain("Simular jornada de mais de 4h até 6h sem pausa de 15 min");
    expect(model.generate).not.toHaveBeenCalled();
    expect(model.update).not.toHaveBeenCalled();
  });
  it("guides the branch operator to generate without offering imports or administrative rules", () => {
    const workspace = plan();
    workspace.input.employees = [{ ...newEmployee(42, workspace.input.shifts[0].id), id: "branch-person", registration: "002", name: "Pessoa da filial" }];
    const model = state(workspace);
    vi.mocked(useEscalasWorkspace).mockReturnValue(model);
    const access: EscalaClientAccess = {
      channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
      branches: [{ code: "07", label: "Hiper", capabilities: ["workspace.read", "workspace.save", "schedule.generate", "schedule.apply", "employee.manage"] }],
    };

    const html = renderMarkup(<EscalaAccessProvider value={access}><EscalasWorkspace /></EscalaAccessProvider>);

    expect(html).toContain("Continuar para montar escala");
    expect(html).toMatch(/<button(?![^>]*\sdisabled(?:=|\s|>))[^>]*>Gerar escala e horários<\/button>/);
    expect(html).toContain("A jornada e as regras desta filial foram definidas pelo administrador");
    expect(html).not.toContain("Importar ou atualizar arquivos da equipe");
    expect(html).not.toContain("Equilibrar os dois períodos de trabalho em até 4h30 cada");
    expect(html).not.toContain("Simular jornada de mais de 4h até 6h sem pausa de 15 min");
    expect(html).not.toContain("Relatórios e gráficos PDF");
    expect(model.generate).not.toHaveBeenCalled();
  });
  it("places the active branch and daily tasks before global administration in DOM order", () => {
    vi.mocked(useEscalasWorkspace).mockReturnValue(state(plan()));
    const html = renderToStaticMarkup(<EscalasWorkspace />);
    const context = html.indexOf('aria-labelledby="escala-scenario-title"');
    const navigation = html.indexOf('aria-label="Etapas do planejamento"');
    const team = html.indexOf('id="escala-area-team"');
    expect(context).toBeGreaterThan(-1);
    expect(navigation).toBeGreaterThan(context);
    expect(team).toBeGreaterThan(navigation);
    for (const label of ["Base global de equipes e afastamentos", "Administrar operadores e filiais", 'aria-label="Catálogo administrativo de turnos"']) {
      expect(html.indexOf(label)).toBeGreaterThan(team);
    }
  });

  it("keeps global administration available before a plan is selected", () => {
    const html = renderToStaticMarkup(<EscalasWorkspace />);
    expect(html).toContain("Base global de equipes e afastamentos");
    expect(html).toContain("Administrar operadores e filiais");
    expect(html).toContain('aria-label="Catálogo administrativo de turnos"');
    expect(html).not.toContain('aria-labelledby="escala-scenario-title"');
  });

});
