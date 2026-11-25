import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import { ESCALA_OPERATOR_CAPABILITIES } from "@/lib/escalas/permissions";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { canDisplayEscalaAction, EscalaAccessProvider, useEscalaClientAccess } from "./access-context";
import { EscalaAccessBoundary } from "./operational-access";
import { EscalasWorkspace } from "./escalas-workspace";
import { Publication } from "./publication";
import { CellEditor } from "./roster-editor";
import { EmployeeEditor } from "./employees";
import { Proposals, ValidationResults } from "./results";
import { newEmployee, newInput } from "./workspace-model";

const mocked = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("./use-escalas-workspace", () => ({ useEscalasWorkspace: mocked.model }));

const operator: EscalaClientAccess = { channel: "USERNAME", roleLabel: "Equipe da filial", administrator: false, allBranches: false,
  branches: [{ code: "07", label: "Filial 07", capabilities: ESCALA_OPERATOR_CAPABILITIES }] };
const administrator: EscalaClientAccess = { channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] };
function plan(): EscalaWorkspace {
  const input = newInput("07", "Centro", "2026-12", 42);
  input.employees = [{ ...newEmployee(42, "shift"), id: "person", name: "Pessoa teste", registration: "001", sector: "Caixa", role: "Operador" }];
  input.shifts = [{ id: "shift", name: "Manhã", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 840, kind: "BREAK" }, { start: 840, end: 1104, kind: "WORK" }] }];
  input.assignments = [{ employeeId: "person", date: "2026-12-01", kind: "WORK", shiftId: "shift" }];
  return { id: "workspace", revision: 2, input, canEdit: true, canPublish: true, status: "DRAFT", updatedAt: "2026-12-01",
    validation: { valid: true, readyToPublish: true, issues: [], summaries: [], minimumCoverageMargin: null } };
}
function contextMarkup(context: EscalaClientAccess | null, child: React.ReactNode) {
  return renderToStaticMarkup(<EscalaAccessProvider value={context}>{child}</EscalaAccessProvider>);
}

describe("branch-scoped display permissions", () => {
  it("does not render another access's conflict, recovery or warnings outside the current branch", () => {
    const workspace = plan();
    const other: EscalaClientAccess = { ...operator, branches: [{ ...operator.branches[0], code: "08" }] };
    mocked.model.mockReturnValue({ input: workspace.input, workspace, conflict: workspace, workspaces: [workspace], canCreate: false, canEdit: true,
      dirty: true, recovery: { baseRevision: 1, input: workspace.input }, busy: "", notice: "Prior access notice", error: "Prior access failure", localBackup: false, saveState: "conflict" });
    const html = contextMarkup(other, <EscalasWorkspace />);
    for (const text of ["Pessoa teste", "Comparar conflito de revisão", "Rascunho recuperável", "Prior access notice", "Prior access failure"]) expect(html).not.toContain(text);
  });
  it("never exposes capacity analysis inside shared proposal and review descendants to a branch operator", () => {
    const workspace = plan();
    const review = contextMarkup(operator, <ValidationResults input={workspace.input} validation={workspace.validation} section="coverage" />);
    expect(review).not.toContain(">Desfalques (");
    expect(review).not.toContain("capacidade");
    if (!workspace.validation) throw new Error("Fixture requires validation");
    const proposal = { proposalInput: workspace.input, validation: workspace.validation, result: { status: "FEASIBLE", message: "Proposta" } };
    const html = contextMarkup(operator, <Proposals input={workspace.input} generated={proposal} disabled={false} onGenerated={vi.fn()} onDismiss={vi.fn()} />);
    expect(html).toContain("Aplicar proposta à grade");
    expect(html).not.toContain("Conferir capacidade e desfalques");
  });
  it("fails closed without context, for another branch and ambiguous duplicate grants", () => {
    expect(canDisplayEscalaAction(null, "settings.manage", "07")).toBe(false);
    expect(canDisplayEscalaAction(operator, "schedule.generate", "08")).toBe(false);
    expect(canDisplayEscalaAction(operator, "schedule.generate", "7")).toBe(true);
    expect(canDisplayEscalaAction({ ...operator, branches: [...operator.branches, { ...operator.branches[0], code: "7" }] }, "schedule.generate", "07")).toBe(false);
  });
  it("never promotes username entry into administrative controls", () => {
    const malformed: EscalaClientAccess = { ...operator, administrator: true, allBranches: true,
      branches: [{ ...operator.branches[0], capabilities: [...ESCALA_OPERATOR_CAPABILITIES, "settings.manage", "import.manage", "report.analytics"] }] };
    for (const action of ["settings.manage", "import.manage", "report.analytics"] as const) expect(canDisplayEscalaAction(malformed, action, "07")).toBe(false);
    expect(canDisplayEscalaAction(administrator, "settings.manage", "08")).toBe(true);
  });
  it("propagates the server context through the real access boundary", () => {
    function Reader() { return <p>{useEscalaClientAccess()?.roleLabel ?? "No context"}</p>; }
    expect(renderToStaticMarkup(<EscalaAccessBoundary initialAccess="ACCOUNT" initialContext={administrator}><Reader /></EscalaAccessBoundary>)).toContain("Administrador");
    const missing = renderToStaticMarkup(<EscalaAccessBoundary initialAccess="ACCOUNT"><Reader /></EscalaAccessBoundary>);
    expect(missing).not.toContain("No context");
    expect(missing).not.toContain("Nome cadastrado");
    expect(missing).toContain("Confira o acesso da sua conta");
  });
  it("offers basic files to a branch operator without publication or sector separation", () => {
    const workspace = plan(), before = JSON.stringify(workspace), onPublish = vi.fn();
    const html = contextMarkup(operator, <Publication workspace={workspace} validation={workspace.validation} dirty={false} busy={false} onPublish={onPublish} />);
    expect(html).toContain("Gerar PDF"); expect(html).toContain("Gerar XLSX");
    expect(html).not.toContain(">Publicar proposta<"); expect(html).not.toContain("Separar setores");
    expect(html).not.toContain("Conferi esta revisão da filial");
    expect(onPublish).not.toHaveBeenCalled(); expect(JSON.stringify(workspace)).toBe(before);
    const other = contextMarkup({ ...operator, branches: [] }, <Publication workspace={workspace} validation={workspace.validation} dirty={false} busy={false} onPublish={onPublish} />);
    expect(other).not.toContain("Gerar PDF"); expect(other).not.toContain("Gerar XLSX");
  });
  it("keeps files independently granted and restores publication for an authorized administrator", () => {
    const workspace = plan();
    const pdfOnly: EscalaClientAccess = { ...operator, branches: [{ ...operator.branches[0], capabilities: ["workspace.read", "export.schedule.pdf"] }] };
    const files = contextMarkup(pdfOnly, <Publication workspace={workspace} validation={workspace.validation} dirty={false} busy={false} onPublish={vi.fn()} />);
    expect(files).toContain("Gerar PDF"); expect(files).not.toContain("Gerar XLSX");
    const adminFiles = contextMarkup(administrator, <Publication workspace={workspace} validation={workspace.validation} dirty={false} busy={false} onPublish={vi.fn()} />);
    expect(adminFiles).toContain("Gerar PDF");
    expect(adminFiles).toMatch(/<button[^>]*disabled=""[^>]*>Publicar proposta<\/button>/);
  });
  it("shows task navigation and operational guidance without imports or administrative options", () => {
    const workspace = plan();
    mocked.model.mockReturnValue({ input: workspace.input, workspace, workspaces: [workspace], canCreate: true, canEdit: true,
      busy: "", notice: "", error: "", dirty: false, localBackup: true, saveState: "saved", validation: workspace.validation });
    const html = contextMarkup(operator, <EscalasWorkspace />);
    expect(html).toContain("Montar escala"); expect(html).toContain("Horários, folgas e arquivos");
    expect(html).toContain("regras desta filial foram definidas pelo administrador");
    expect(html).not.toContain("Importar ou atualizar arquivos"); expect(html).not.toContain("Relatórios e gráficos PDF");
    expect(html).not.toContain("Regras de jornada e intervalos"); expect(html).not.toContain("Configurações da filial</button>");
    expect(html).toContain("Criar planejamento");
    expect(html).toContain("Criar ou abrir rascunho");
    expect(html).not.toContain("Código da filial</label>");
    expect(html).toContain("Adicionar colaborador por modelo aprovado");
  });
  it("gives an operator a focused employee editor and preserves protected day information", () => {
    const workspace = plan(), input = workspace.input, employee = input.employees[0], onSave = vi.fn();
    const editor = contextMarkup(operator, <EmployeeEditor input={input} employee={employee} onSave={onSave} onCancel={vi.fn()} />);
    expect(editor).toContain("Dias de folga preferidos (não obrigatórios)");
    expect(editor).toContain("Nome completo");
    expect(editor).toContain("Primeira folga");
    expect(editor).toContain("Segunda folga");
    for (const administrativeField of ["Horário de trabalho", "Turnos autorizados", "Histórico anterior e continuidade"]) expect(editor).not.toContain(administrativeField);
    expect(onSave).not.toHaveBeenCalled();
    const day = contextMarkup(operator, <CellEditor input={input} employee={employee} date="2026-12-01" assignment={{ employeeId: employee.id, date: "2026-12-01", kind: "ABSENCE", locked: true }} canUnlock={false} onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(day).toContain("Afastamentos e feriados registrados são preservados");
    expect(day).not.toContain("Manter este dia nas próximas gerações");
  });
});
