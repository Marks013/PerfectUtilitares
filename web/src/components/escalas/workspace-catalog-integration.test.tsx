import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaAccessProvider } from "./access-context";
import { EscalasWorkspace } from "./escalas-workspace";
import { newEmployee, newInput } from "./workspace-model";

const mocked = vi.hoisted(() => ({ model: vi.fn() }));
vi.mock("./use-escalas-workspace", () => ({ useEscalasWorkspace: mocked.model }));

const administrator: EscalaClientAccess = { channel: "ACCOUNT", administrator: true, allBranches: true, roleLabel: "Administrador", branches: [] };
const branch: EscalaClientAccess = { channel: "USERNAME", administrator: false, allBranches: false, roleLabel: "Filial", branches: [{ code: "07", label: "Centro", capabilities: ["workspace.read", "workspace.save", "employee.manage", "shift.manage", "export.schedule.pdf", "export.schedule.xlsx"] }] };
function plan(): EscalaWorkspace {
  const input = newInput("07", "Centro", "2026-12", 42);
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "person", name: "Pessoa sintética", registration: "0007", sector: "Atendimento", role: "Operador" }];
  return { id: "saved-plan", revision: 3, status: "DRAFT", input, canEdit: true, canPublish: true, updatedAt: "2026-11-14", validation: { valid: true, readyToPublish: true, issues: [], summaries: [], minimumCoverageMargin: null } };
}
function state(workspace: EscalaWorkspace | null = null, plans: EscalaWorkspace[] = workspace ? [workspace] : []) {
  return { workspace, input: workspace?.input ?? null, workspaces: plans, canCreate: true, canEdit: Boolean(workspace), validation: workspace?.validation ?? null,
    dirty: false, saveState: "saved", busy: "", notice: "", error: "", problem: null, localBackup: true, recovery: null, generated: null, conflict: null, outdated: false };
}
const markup = (access: EscalaClientAccess | null) => renderToStaticMarkup(<EscalaAccessProvider value={access}><EscalasWorkspace /></EscalaAccessProvider>);
const catalogCount = (html: string) => (html.match(/>Turnos e arquivos de integração<\/summary>/g) ?? []).length;

beforeEach(() => mocked.model.mockReturnValue(state()));
describe("workspace catalog entry", () => {
  it("mounts one usable administrative catalog without any saved plans or an open workspace", () => {
    const html = markup(administrator);
    expect(catalogCount(html)).toBe(1);
    expect(html).toContain("Turnos cadastrados");
    expect(html).toMatch(/<button[^>]*>Consultar itens<\/button>/);
    expect(html.match(/<button[^>]*>Consultar itens<\/button>/)?.[0]).not.toContain("disabled");
    expect(html).toContain("Escolher ou criar planejamento para editar definições");
  });
  it("passes saved sources to the same entry while no workspace is open", () => {
    mocked.model.mockReturnValue(state(null, [plan()]));
    const html = markup(administrator);
    expect(catalogCount(html)).toBe(1);
    expect(html).toContain('value="2026-12"');
    expect(html).not.toContain("Abrir definições deste planejamento");
  });
  it("does not let a detached save status block a catalog with no open workspace", () => {
    mocked.model.mockReturnValue({ ...state(), canCreate: false, saveState: "pending" });
    const html = markup(administrator);
    expect(catalogCount(html)).toBe(1);
    expect(html.match(/<button[^>]*>Consultar itens<\/button>/)?.[0]).not.toContain("disabled");
    expect(html).toContain("Escolher planejamento para editar definições");
  });
  it("offers the existing definition editor for an authorized open workspace without duplicating the catalog", () => {
    mocked.model.mockReturnValue(state(plan()));
    const html = markup(administrator);
    expect(catalogCount(html)).toBe(1);
    expect(html).toContain("Abrir definições deste planejamento");
    expect(html).toContain("O cadastro no catálogo exige confirmação explícita");
  });
  it("keeps catalog and definition management out of the branch workspace while preserving assignment entry", () => {
    mocked.model.mockReturnValue(state(plan()));
    const html = markup(branch);
    expect(catalogCount(html)).toBe(0);
    expect(html).not.toContain("Criar ou alterar definições de turnos");
    expect(html).toContain("Pessoa sintética");
    expect(html).toContain("Trocar horário");
  });
  it("fails closed for missing context and an account that has only scoped grants", () => {
    mocked.model.mockReturnValue(state(plan()));
    expect(catalogCount(markup(null))).toBe(0);
    const scoped: EscalaClientAccess = { ...branch, channel: "ACCOUNT", branches: [{ ...branch.branches[0], capabilities: ["workspace.read", "settings.manage", "export.integration"] }] };
    expect(catalogCount(markup(scoped))).toBe(0);
  });
  it("disables integration while an open workspace has edits awaiting confirmation", () => {
    mocked.model.mockReturnValue({ ...state(plan()), dirty: true, saveState: "pending" });
    const html = markup(administrator);
    expect(catalogCount(html)).toBe(1);
    expect(html.match(/<button[^>]*>Consultar itens<\/button>/)?.[0]).toContain("disabled");
  });
});
