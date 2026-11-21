import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaAccessProvider } from "./access-context";
import { EscalasWorkspace } from "./escalas-workspace";
import { useEscalasWorkspace } from "./use-escalas-workspace";
import { newEmployee, newInput } from "./workspace-model";

vi.mock("./use-escalas-workspace", () => ({ useEscalasWorkspace: vi.fn() }));

// Capture real screen callbacks and keep its hook primitives between static renders.
// Effects, DOM focus and browser navigation are deliberately outside this harness.
const ui = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  buttons: new Map<string, { disabled?: boolean; onClick?: () => void }>(),
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual,
    useState<T>(initial?: T | (() => T)) {
      const slot = ui.cursor++;
      if (!(slot in ui.slots)) ui.slots[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [ui.slots[slot] as T, (next: T | ((previous: T) => T)) => {
        ui.slots[slot] = typeof next === "function" ? (next as (previous: T) => T)(ui.slots[slot] as T) : next;
      }];
    },
    useRef<T>(initial: T) {
      const slot = ui.cursor++;
      if (!(slot in ui.slots)) ui.slots[slot] = { current: initial };
      return ui.slots[slot];
    },
    useEffect: () => undefined,
  };
});
vi.mock("react/jsx-runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("react/jsx-runtime")>();
  const capture = (factory: typeof actual.jsx) => (...args: Parameters<typeof actual.jsx>) => {
    const [type, raw] = args;
    if (type === "button" && raw && typeof raw === "object") {
      const props = raw as { children?: unknown; "aria-controls"?: string; disabled?: boolean; onClick?: () => void };
      const label = typeof props.children === "string" ? props.children : props["aria-controls"] ? "#" + props["aria-controls"] : null;
      if (label) ui.buttons.set(label, props);
    }
    return factory(...args);
  };
  return { ...actual, jsx: capture(actual.jsx), jsxs: capture(actual.jsxs) };
});

const previewAccess: EscalaClientAccess = {
  channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
  branches: [{ code: "08", label: "Filial sintética", capabilities: ["workspace.read", "schedule.generate", "shift.manage"] }],
};

function model(): ReturnType<typeof useEscalasWorkspace> {
  const input = newInput("08", "Filial sintética", "2026-11", 42);
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "synthetic-person", registration: "0001", name: "Pessoa sintética" }];
  const workspace: EscalaWorkspace = {
    id: "synthetic-plan", revision: 2, status: "DRAFT", input,
    validation: { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null },
    canEdit: false, canPublish: false, updatedAt: "2026-11-20T10:00:00Z",
  };
  const action = vi.fn();
  return {
    saveState: "saved", conflict: null, compareLatest: action, useServerRevision: action,
    rebaseDraft: action, closeConflict: action, localBackup: true, saveAndOpen: action,
    isCurrentRevision: () => true, recovery: null, recoverDraft: action, ignoreRecovery: action,
    flushDraft: vi.fn(async () => workspace), workspaces: [workspace], canCreate: false,
    workspace, input, validation: workspace.validation, dirty: false, outdated: false,
    busy: "", error: "", problem: null, notice: "", generated: null, pendingOpen: null,
    setPendingOpen: action, update: action, open: action, create: action, createApproved: action,
    addEmployee: vi.fn(async () => false), replaceImport: vi.fn(async () => null),
    rebaseApproved: action, upgradeCalendar: action, save: action, validate: action,
    generate: vi.fn(), canGenerate: true, applyGenerated: action, undoRoster: vi.fn(async () => false),
    publish: action, discard: action, deleteWorkspace: action, resetKey: 0, cancellable: false,
    cancelLabel: "Cancelar análise", cancelAnalysis: action, dismissProposals: action, canEdit: false,
  };
}

function markup(state: ReturnType<typeof useEscalasWorkspace>, access: EscalaClientAccess = previewAccess) {
  ui.cursor = 0; ui.buttons.clear();
  vi.mocked(useEscalasWorkspace).mockReturnValue(state);
  return renderToStaticMarkup(<EscalaAccessProvider value={access}><EscalasWorkspace /></EscalaAccessProvider>);
}

function click(label: string) {
  const button = ui.buttons.get(label);
  if (!button?.onClick || button.disabled) throw new Error("Screen action unavailable: " + label);
  button.onClick();
}

function generationButton(html: string) {
  const match = html.match(/<button\b[^>]*>Gerar escala e horários<\/button>/);
  if (!match) throw new Error("The real screen did not render its generation action");
  return match[0];
}

describe("saved-revision preview in the real scheduling screen", () => {
  beforeEach(() => { vi.clearAllMocks(); ui.slots = []; ui.cursor = 0; ui.buttons.clear(); });

  it("identifies the only granted branch when there is no saved planning", () => {
    const state = { ...model(), workspaces: [], workspace: null, input: null, validation: null, canGenerate: false };
    const html = markup(state);
    expect(html).toContain("Filial 08 · Filial sintética");
    expect(html).toContain("Nenhum planejamento disponível nesta filial.");
    expect(html).not.toContain("Carregando planejamentos…");
    expect(html).not.toContain("Não foi possível carregar os planejamentos");
    expect(html).not.toContain("Gerar escala e horários");
    expect(state.open).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("keeps loading and failed retrieval distinct for the branch without saved planning", () => {
    const state = { ...model(), workspaces: [], workspace: null, input: null, validation: null, canGenerate: false };
    const loading = markup({ ...state, busy: "Carregando planejamentos…" });
    expect(loading).toContain("Filial 08 · Filial sintética");
    expect(loading).toContain("Carregando planejamentos…");
    expect(loading).not.toContain("Nenhum planejamento disponível nesta filial.");
    const failed = markup({ ...state, error: "Falha sintética de listagem." });
    expect(failed).toContain("Não foi possível carregar os planejamentos.");
    expect(failed).not.toContain("Nenhum planejamento disponível nesta filial.");
    expect(state.open).not.toHaveBeenCalled();
  });

  it("enables preview without SAVE while keeping editing and administrative configuration unavailable", () => {
    const state = model();
    const html = markup(state);
    expect(generationButton(html)).not.toContain('disabled=""');
    expect(html).toMatch(/<fieldset[^>]*disabled=""[^>]*>[\s\S]*?<legend[^>]*>O que gerar\?<\/legend>/);
    expect(html).toContain("Você pode gerar uma proposta para conferir");
    expect(html).not.toContain("Alternar dias de 8h e 9h");
    expect(html).not.toContain("Turnos específicos");
    expect(html).not.toContain("Salvar agora");
    expect(state.update).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.applyGenerated).not.toHaveBeenCalled();
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("requires generation permission in the selected branch even when the model is ready", () => {
    const access: EscalaClientAccess = { ...previewAccess, branches: [{ ...previewAccess.branches[0], capabilities: ["workspace.read"] }] };
    expect(generationButton(markup(model(), access))).toContain('disabled=""');
    const otherBranch: EscalaClientAccess = { ...previewAccess, branches: [{ ...previewAccess.branches[0], code: "07" }] };
    expect(markup(model(), otherBranch)).not.toContain("Gerar escala e horários");
  });

  it("keeps the real action disabled when the hook reports an unavailable preview", () => {
    const state = model();
    state.canGenerate = false;
    expect(generationButton(markup(state))).toContain('disabled=""');
    expect(state.generate).not.toHaveBeenCalled();
  });

  it("retains 8h/9h configuration and administrative navigation for the administrator", () => {
    const state = model();
    state.canEdit = true;
    if (!state.workspace) throw new Error("Synthetic workspace missing");
    state.workspace.canEdit = true;
    const admin: EscalaClientAccess = { channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] };
    const html = markup(state, admin);
    expect(html).toContain("Alternar dias de 8h e 9h");
    expect(html).toContain("4h30");
    expect(html).toContain("Simular jornada de mais de 4h até 6h sem pausa de 15 min");
    expect(html).toContain('aria-controls="escala-area-adjustments"');
  });

  it("offers confirmed discard in the current plan after SAVE is lost, with only one plan", () => {
    const state = model(); state.dirty = true; state.canGenerate = false;
    if (!state.workspace) throw new Error("Workspace missing");
    state.workspace.canEdit = true; state.canEdit = true;
    let html = markup(state);
    expect(state.workspaces).toHaveLength(1);
    click("#escala-area-generate"); html = markup(state);
    expect(html).toMatch(/<section id="escala-area-generate"/);
    expect(html).toContain("A prévia está bloqueada porque há alterações locais");
    expect(html).not.toContain("Você pode gerar uma proposta para conferir");
    expect(generationButton(html)).toContain('disabled=""');
    expect(html).toContain("Descartar alterações locais");
    expect(html).not.toContain("Confirmar descarte e carregar revisão salva");
    click("Descartar alterações locais"); html = markup(state);
    expect(state.discard).not.toHaveBeenCalled();
    expect(html).toContain('role="group" aria-label="Confirmar descarte das alterações locais"');
    expect(html).toContain("O descarte não salva o rascunho");
    click("Manter alterações locais"); html = markup(state);
    expect(state.discard).not.toHaveBeenCalled();
    expect(html).not.toContain("Confirmar descarte e carregar revisão salva");
    click("Descartar alterações locais"); markup(state);
    click("Confirmar descarte e carregar revisão salva");
    expect(state.discard).toHaveBeenCalledTimes(1);
    expect(state.save).not.toHaveBeenCalled(); expect(state.saveAndOpen).not.toHaveBeenCalled();
    expect(state.update).not.toHaveBeenCalled(); expect(state.generate).not.toHaveBeenCalled();
    expect(state.applyGenerated).not.toHaveBeenCalled(); expect(state.publish).not.toHaveBeenCalled();
  });

  it.each((["preview", "apply"] as const).flatMap(authority => [
    { label: "simple", detail: "" },
    { label: "retained", detail: "A proposta anterior foi mantida para preservar a cobertura." },
    { label: "expired", detail: "A comparação anterior expirou. Uma nova proposta foi calculada." },
  ].map(item => ({ ...item, authority }))))("shows the $authority completion notice with warnings and $label context", ({ authority, detail }) => {
    const state = model();
    const instruction = authority === "preview"
      ? "Confira a proposta. Para aplicar ou salvar alterações, peça ajuda a uma pessoa autorizada nesta filial."
      : detail ? "Confira antes de aplicar." : "Confira e aplique à escala.";
    state.notice = ["Proposta concluída com avisos.", detail, instruction].filter(Boolean).join(" ");
    const access: EscalaClientAccess = authority === "preview" ? previewAccess
      : { channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] };
    if (authority === "apply") {
      state.canEdit = true;
      if (!state.workspace) throw new Error("Workspace missing");
      state.workspace.canEdit = true;
    }
    const html = markup(state, access);
    expect(html).toContain("Proposta concluída com avisos.");
    if (detail) expect(html).toContain(detail);
    expect(html).toContain(instruction);
    if (authority === "preview") expect(html).not.toMatch(/Confira e aplique|antes de aplicar/);
    expect(state.applyGenerated).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
  });

  it("does not reuse discard confirmation after the selected saved revision changes", () => {
    const state = model(); state.dirty = true; state.canGenerate = false;
    markup(state); click("Descartar alterações locais"); markup(state);
    const previousConfirmation = ui.buttons.get("Confirmar descarte e carregar revisão salva")?.onClick;
    if (!state.workspace || !previousConfirmation) throw new Error("Confirmation missing");
    state.workspace = { ...state.workspace, revision: state.workspace.revision + 1 };
    const html = markup(state); previousConfirmation();
    expect(html).not.toContain("Confirmar descarte e carregar revisão salva");
    expect(state.discard).not.toHaveBeenCalled();
  });

  it("does not offer Save and open without effective SAVE permission", () => {
    const state = model(); state.dirty = true; state.canGenerate = false; state.pendingOpen = "synthetic-other-plan";
    if (!state.workspace) throw new Error("Workspace missing");
    state.workspace.canEdit = true; state.canEdit = true;
    const html = markup(state);
    expect(html).not.toContain("Salvar e abrir");
    expect(html).toContain("Descartar alterações e abrir");
    expect(state.saveAndOpen).not.toHaveBeenCalled();
  });

  it("keeps Save and open for an authorized editable plan", () => {
    const state = model(); state.dirty = true; state.canEdit = true; state.pendingOpen = "synthetic-other-plan";
    if (!state.workspace) throw new Error("Workspace missing");
    state.workspace.canEdit = true;
    const admin: EscalaClientAccess = { channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] };
    const html = markup(state, admin);
    expect(html).toContain("Salvar e abrir"); click("Salvar e abrir");
    expect(state.saveAndOpen).toHaveBeenCalledWith("synthetic-other-plan");
    expect(html).not.toContain("A prévia está bloqueada porque há alterações locais");
  });

  it("keeps the short-pause simulation shortcut administrative and distinct from the block limit", () => {
    const html = markup(model());
    expect(html).not.toContain("Simular jornada de mais de 4h até 6h sem pausa de 15 min");
    expect(ui.buttons.has("Simular jornada de mais de 4h até 6h sem pausa de 15 min")).toBe(false);
  });
});
