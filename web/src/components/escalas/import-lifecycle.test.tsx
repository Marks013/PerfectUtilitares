import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ImportSyncCommand, ImportSyncPreview, ImportSyncPurpose } from "@/lib/escalas/import-sync-contracts";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { AbsenceImport } from "./absence-import";
import { ImportEmployees } from "./coverage-import";
import { Field } from "./controls";
import { ImportReplacement, type ImportReplacementProps } from "./import-replacement";
import { requestImportReplacement, type ImportReplacementResult, type ReplaceImport } from "./import-replacement-client";
import { newEmployee, newInput } from "./workspace-model";

// Exercise the real component handlers with stateful hooks; browser coverage remains in E2E.
const createHooks = vi.hoisted(() => () => ({ slots: [] as unknown[], deps: [] as (readonly unknown[] | undefined)[],
  cursor: 0, layout: [] as (() => void)[], effects: [] as (() => void)[], cleanup: [] as ((() => void) | undefined)[] }));
let hooks = createHooks();
let changed = false;
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  function queueEffect(queue: 'effects' | 'layout', effect: () => unknown, deps?: readonly unknown[]) {
    const current = hooks;
    const slot = current.cursor++;
    if (deps && current.deps[slot]?.length === deps.length && deps.every((value, i) => Object.is(value, current.deps[slot]?.[i]))) return;
    current.deps[slot] = deps;
    current[queue].push(() => {
      current.cleanup[slot]?.();
      const cleanup = effect();
      current.cleanup[slot] = typeof cleanup === "function" ? cleanup as () => void : undefined;
    });
  }
  return { ...actual,
    useState<T>(initial: T | (() => T)) {
      const slot = hooks.cursor++;
      if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
      const current = hooks;
      return [current.slots[slot] as T, (next: T | ((previous: T) => T)) => {
        const previous = current.slots[slot] as T;
        const value = typeof next === "function" ? (next as (value: T) => T)(previous) : next;
        if (!Object.is(previous, value)) { current.slots[slot] = value; changed = true; }
      }];
    },
    useRef<T>(initial: T) { const slot = hooks.cursor++; if (!(slot in hooks.slots)) hooks.slots[slot] = { current: initial }; return hooks.slots[slot]; },
    useId() { return `synthetic-${hooks.cursor++}`; },
    useCallback<T>(callback: T, deps: readonly unknown[]) {
      const slot = hooks.cursor++;
      if (!hooks.deps[slot] || deps.some((value, i) => !Object.is(value, hooks.deps[slot]?.[i]))) {
        hooks.slots[slot] = callback; hooks.deps[slot] = deps;
      }
      return hooks.slots[slot];
    },
    useEffect(effect: () => unknown, deps?: readonly unknown[]) { queueEffect("effects", effect, deps); },
    useLayoutEffect(effect: () => unknown, deps?: readonly unknown[]) { queueEffect("layout", effect, deps); },
  };
});


const access = vi.hoisted(() => ({ channel: "ACCOUNT", administrator: true, allBranches: true }));
vi.mock("./access-context", () => ({ useEscalaClientAccess: () => access }));

type ControlProps = {
  children?: ReactNode | ((id: string) => ReactNode);
  type?: string;
  disabled?: boolean;
  onClick?: () => void;
  onChange?: (event: { target: { files?: File[]; checked?: boolean; value?: string } }) => void;
};
let props: ImportReplacementProps, component: typeof ImportEmployees | typeof AbsenceImport, tree: ReactNode;
let parent: ReturnType<typeof createHooks>, child: ReturnType<typeof createHooks> | undefined, childKey: ReactElement["key"];

function nodes(node: ReactNode): ReactElement<ControlProps>[] {
  if (Array.isArray(node)) return node.flatMap(value => nodes(value));
  if (!isValidElement<ControlProps>(node)) return [];
  const children = node.type === Field && typeof node.props.children === "function" ? node.props.children("synthetic-file") : node.props.children;
  return [node, ...nodes(typeof children === "function" ? null : children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function button(prefix: string) {
  return nodes(tree).find(node => node.type === "button" && text(node).startsWith(prefix))?.props;
}
const checkPreview = () => button("Conferir substituição");
const apply = () => button("Confirmar e salvar substituição");

function unmountChild() {
  for (const cleanup of child?.cleanup ?? []) cleanup?.();
  child = undefined;
}
function render() {
  changed = false;
  const entry = component(props);
  if (!isValidElement<Parameters<typeof ImportReplacement>[0]>(entry) || entry.type !== ImportReplacement) throw new Error("Import entry absent");
  hooks = parent;
  parent.cursor = 0;
  const boundary = ImportReplacement(entry.props);
  tree = null;
  if (!boundary) unmountChild();
  else {
    if (boundary.type !== Fragment) throw new Error("Replacement session boundary absent");
    const session: unknown = boundary.props.children;
    if (!isValidElement<Parameters<typeof ImportReplacement>[0]>(session) || typeof session.type !== "function") throw new Error("Replacement session absent");
    if (!child || childKey !== boundary.key) {
      unmountChild();
      child = createHooks();
      childKey = boundary.key;
    }
    hooks = child;
    child.cursor = 0;
    tree = (session.type as (sessionProps: Parameters<typeof ImportReplacement>[0]) => ReactNode)(session.props);
    for (const effect of child.layout.splice(0)) effect();
    for (const effect of child.effects.splice(0)) effect();
  }
  for (const effect of parent.effects.splice(0)) effect();
}
async function settle() {
  for (let i = 0; i < 30; i++) {
    if (changed) render();
    await Promise.resolve();
  }
  if (changed) render();
}
function control(type: string, index = 0) {
  const found = nodes(tree).filter(node => node.type === "input" && node.props.type === type)[index]?.props;
  if (!found?.onChange || found.disabled) throw new Error("Import control unavailable");
  return found.onChange;
}
async function select(file = new File(["synthetic"], "team.csv", { type: "text/csv" })) {
  control("file")({ target: { files: [file] } });
  await settle();
  control("checkbox")({ target: { checked: true } });
  await settle();
}
async function click(action: ControlProps | undefined) {
  if (!action?.onClick || action.disabled) throw new Error("Import action unavailable");
  action.onClick();
  await settle();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function preview(workspace: EscalaWorkspace, command: ImportSyncCommand, blockers: ImportSyncPreview["blockers"] = [], fileHash = "0".repeat(64)): ImportSyncPreview {
  const { purpose, startDate, endDate, completeScopeConfirmed } = command;
  const { branchCode, startDate: workspaceStartDate, endDate: workspaceEndDate, visibleMonth } = workspace.input;
  const added = purpose === "EMPLOYEES" ? [{ id: "new-person", registration: "0002", name: "Synthetic imported", fields: [] }] : [];
  const absences = purpose === "ABSENCES" && !blockers.length ? [{ employeeId: "existing", date: startDate, registration: "0001" }] : [];
  return {
    contractVersion: 1, purpose, layout: purpose === "ABSENCES" ? "FPHI105" : "ESCALA_TEMPLATE",
    context: { workspaceId: workspace.id, revision: workspace.revision, branchCode, workspaceStartDate, workspaceEndDate, visibleMonth: visibleMonth ?? null, status: workspace.status },
    scope: { startDate, endDate },
    coverage: { completeScopeConfirmed, sourcePeriod: null, basis: "ADMIN_DECLARATION" },
    fileHash, expectedImpactHash: "1".repeat(64), canApply: completeScopeConfirmed && !blockers.length,
    impact: { people: { added, updated: [], removed: [], unchanged: [] }, absences: { added: absences, removed: [], unchanged: [] }, assignments: [], references: [] },
    blockers, warnings: [],
    counts: { addedPeople: added.length, updatedPeople: 0, removedPeople: 0, unchangedPeople: 0, addedAbsenceDays: absences.length, removedAbsenceDays: 0, unchangedAbsenceDays: 0, assignmentChanges: 0, blockers: blockers.length },
    effect: { nextStatus: "DRAFT", needsRegeneration: true, approvalInvalidated: false, approvedPolicyVersionIdBefore: null, approvedPolicyVersionIdAfter: null },
  };
}
function replaceWith(replacement: ReplaceImport = async (_file, command) => {
  const summary = preview(props.workspace, command);
  if (command.action === "PREVIEW_REPLACE") return { preview: summary };
  return { summary, workspace: { ...props.workspace, revision: command.expectedRevision + 1 } };
}) {
  const replaceImport = vi.fn(replacement);
  props = { ...props, replaceImport };
  render();
  return replaceImport;
}
function useHttp(fetcher: (...args: [string, RequestInit]) => Promise<Response>) {
  vi.stubGlobal("fetch", fetcher);
  return replaceWith((file, command, signal) => requestImportReplacement(file, command, props.workspace, signal));
}
function setWorkspace(workspace: EscalaWorkspace) {
  props = { ...props, workspace };
  render();
  return settle();
}

beforeEach(async () => {
  parent = createHooks();
  child = undefined;
  childKey = null;
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  vi.stubGlobal("crypto", { randomUUID, subtle: { digest: async () => new ArrayBuffer(32) } });
  const input = newInput("06", "Synthetic", "2026-12", 42);
  input.employees = [{ ...newEmployee(42), id: "existing", registration: "0001", name: "Synthetic existing", sector: "Store", role: "Clerk", scheduleMode: "MISSING" }];
  props = {
    disabled: false, replaceImport: vi.fn<ReplaceImport>(),
    workspace: { id: "plan-06", revision: 4, status: "DRAFT", input, canEdit: true, canPublish: true,
      updatedAt: "2026-11-21T00:00:00Z", validation: { valid: true, issues: [], summaries: [], readyToPublish: true, minimumCoverageMargin: 0 } },
  };
  component = ImportEmployees;
  render();
  await settle();
});
afterEach(() => {
  unmountChild();
  for (const cleanup of parent.cleanup) cleanup?.();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each([
  { purpose: "EMPLOYEES" as ImportSyncPurpose, entry: ImportEmployees },
  { purpose: "ABSENCES" as ImportSyncPurpose, entry: AbsenceImport },
])("replacement lifecycle ($purpose)", ({ purpose, entry }) => {
  beforeEach(async () => { component = entry; render(); await settle(); });

  it("aborts work on a different planning context and applies only the newer revision", async () => {
    const previous = deferred<ImportReplacementResult>(), recent = deferred<ImportReplacementResult>();
    const replace = replaceWith().mockReturnValueOnce(previous.promise).mockReturnValueOnce(recent.promise);
    const original = props.workspace;
    await select();
    await click(checkPreview());
    const oldCommand = replace.mock.calls[0][1];
    await setWorkspace({ ...original, id: "plan-07", input: { ...original.input, branchCode: "07" } });
    expect(replace.mock.calls[0][2].aborted).toBe(true);
    await setWorkspace({ ...original, revision: 5 });
    await select();
    await click(checkPreview());
    previous.resolve({ preview: preview(original, oldCommand) });
    await settle();
    expect(apply()).toBeUndefined();
    expect(checkPreview()?.disabled).toBe(true);
    const command = replace.mock.calls[1][1];
    const reviewed = preview(props.workspace, command);
    recent.resolve({ preview: reviewed });
    await settle();
    expect(text(tree)).toContain("filial 06 · revisão 5");
    expect(apply()?.disabled).toBe(true);
    control("checkbox", 1)({ target: { checked: true } });
    await settle();
    await click(apply());
    expect(replace.mock.calls.map(([, command]) => command.action)).toEqual(["PREVIEW_REPLACE", "PREVIEW_REPLACE", "APPLY_REPLACE"]);
    expect(replace.mock.calls[2][1]).toMatchObject({ purpose, workspaceId: original.id, expectedRevision: 5, expectedImpactHash: reviewed.expectedImpactHash });
    expect(text(tree)).toContain("Substituição salva na revisão 6");
  });

  it("clears the preview on file replacement and after locking and unlocking", async () => {
    const replace = replaceWith();
    await select();
    await click(checkPreview());
    expect(apply()?.disabled).toBe(true);
    await select(new File(["different synthetic source"], "other.csv"));
    expect(apply()).toBeUndefined();
    await click(checkPreview());
    expect(apply()?.disabled).toBe(true);
    window.dispatchEvent(new Event("escalas:unlock-required"));
    await settle();
    expect(tree).toBeNull();
    window.dispatchEvent(new Event("escalas:unlocked"));
    await settle();
    expect(apply()).toBeUndefined();
    expect(checkPreview()?.disabled).toBe(true);
    expect(replace.mock.calls.every(([, command]) => command.action === "PREVIEW_REPLACE")).toBe(true);
  });

  it("handles the import API's unauthorized response and requests unlock once", async () => {
    const unlock = vi.fn();
    window.addEventListener("escalas:unlock-required", unlock);
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: { message: "Acesso encerrado" } }, { status: 401 }));
    const replace = useHttp(fetcher);
    await select();
    await click(checkPreview());
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(tree).toBeNull();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh review after an updated saved revision and displays protected-day blockers", async () => {
    const replace = replaceWith();
    await select();
    await click(checkPreview());
    control("checkbox", 1)({ target: { checked: true } });
    await settle();
    expect(apply()?.disabled).toBe(false);
    const { workspace } = props;
    const date = workspace.input.startDate;
    await setWorkspace({ ...workspace, revision: 5, input: { ...workspace.input, assignments: [{ employeeId: "existing", date, kind: "OFF", locked: true }] } });
    expect(apply()).toBeUndefined();
    expect(replace).toHaveBeenCalledTimes(1);
    replace.mockImplementationOnce(async (_file, command) => ({
      preview: preview(props.workspace, command, [{ code: "PROTECTED_ASSIGNMENT", date, message: "O dia bloqueado foi preservado." }]),
    }));
    await click(checkPreview());
    expect(replace.mock.calls[1][1]).toMatchObject({ expectedRevision: 5, action: "PREVIEW_REPLACE" });
    expect(renderToStaticMarkup(tree)).toContain("O dia bloqueado foi preservado.");
    expect(apply()?.disabled).toBe(true);
    expect(props.workspace.input.assignments[0]).toMatchObject({ date, kind: "OFF", locked: true });
  });
});

describe("replacement request feedback", () => {
  it("asks for missing registration and sends only the reviewed text on confirmation", async () => {
    const missing = { line: 3, name: "Pessoa nova", sector: "Loja", role: "Atendente" };
    const replace = replaceWith(async (_file, command) => {
      const corrected = Boolean(command.registrationCorrections?.length);
      const result = preview(props.workspace, command, corrected ? [] : [{ code: "SOURCE_IDENTITY", line: 3, message: "Informe a matrícula." }]);
      result.layout = "FPRE136";
      result.missingRegistrations = [{ ...missing, resolved: corrected }];
      result.expectedImpactHash = (corrected ? command.registrationCorrections?.[0]?.registration === "0007" ? "7" : "8" : "0").repeat(64);
      return command.action === "PREVIEW_REPLACE" ? { preview: result } : { summary: result, workspace: { ...props.workspace, revision: command.expectedRevision + 1 } };
    });
    await select();
    await click(checkPreview());
    expect(renderToStaticMarkup(tree)).toContain("Matrícula — Pessoa nova (linha 3)");
    expect(renderToStaticMarkup(tree)).toContain("mantenha o mesmo número, mesmo que tenha mudado de filial");
    expect(renderToStaticMarkup(tree)).toContain("Nenhuma matrícula será deduzida pelo nome.");
    expect(apply()?.disabled).toBe(true);
    expect(replace.mock.calls[0][1]).not.toHaveProperty("registrationCorrections");
    control("text")({ target: { value: "0007" } });
    await settle();
    expect(apply()).toBeUndefined();
    await click(checkPreview());
    expect(replace.mock.calls[1][1]).toMatchObject({ action: "PREVIEW_REPLACE", registrationCorrections: [{ line: 3, registration: "0007" }] });
    control("checkbox", 1)({ target: { checked: true } });
    await settle();
    expect(apply()?.disabled).toBe(false);

    control("text")({ target: { value: "0008" } });
    await settle();
    expect(apply()).toBeUndefined();
    await click(checkPreview());
    expect(apply()?.disabled).toBe(true);
    control("checkbox", 1)({ target: { checked: true } });
    await settle();
    await click(apply());
    expect(replace.mock.calls[3][1]).toMatchObject({ action: "APPLY_REPLACE", expectedImpactHash: "8".repeat(64), registrationCorrections: [{ line: 3, registration: "0008" }] });
  });

  it("does not carry a registration correction across a file or saved revision change", async () => {
    const replace = replaceWith(async (_file, command) => {
      const result = preview(props.workspace, command, [{ code: "SOURCE_IDENTITY", line: 3, message: "Informe a matrícula." }]);
      result.missingRegistrations = [{ line: 3, name: "Pessoa nova", sector: "Loja", role: "Atendente", resolved: false }];
      return { preview: result };
    });
    await select();
    await click(checkPreview());
    control("text")({ target: { value: "0007" } });
    await settle();
    await select(new File(["changed source"], "other.csv", { type: "text/csv" }));
    expect(text(tree)).not.toContain("Matrículas ausentes no arquivo");
    await click(checkPreview());
    expect(replace.mock.calls[1][1]).not.toHaveProperty("registrationCorrections");
    control("text")({ target: { value: "0008" } });
    await settle();
    await setWorkspace({ ...props.workspace, revision: 5 });
    expect(text(tree)).not.toContain("Matrículas ausentes no arquivo");
    await click(checkPreview());
    expect(replace.mock.calls[2][1]).not.toHaveProperty("registrationCorrections");
  });

  it("reports identical team without offering to save a revision", async () => {
    const replace = replaceWith(async (_file, command) => {
      const result = preview(props.workspace, command);
      result.canApply = false; result.effect.noChanges = true;
      result.impact.people.added = []; result.counts.addedPeople = 0;
      result.impact.people.unchanged = [{ id: "existing", registration: "0001", name: "Pessoa existente", fields: [] }]; result.counts.unchangedPeople = 1;
      return { preview: result };
    });
    await select();
    await click(checkPreview());
    expect(text(tree)).toContain("Nenhuma alteração na equipe. O planejamento e a revisão atual foram mantidos.");
    expect(text(tree)).not.toContain("Será salva uma nova revisão");
    expect(apply()).toBeUndefined();
    expect(replace).toHaveBeenCalledOnce();
  });

  it("disables apply for a rejected source and reports why", async () => {
    const replace = replaceWith(async (_file, command) => ({
      preview: preview(props.workspace, command, [{ code: "SOURCE_INVALID", message: "Formato de arquivo inválido." }]),
    }));
    await select(new File(["invalid"], "invalid.csv"));
    await click(checkPreview());
    expect(renderToStaticMarkup(tree)).toContain("Formato de arquivo inválido.");
    expect(apply()?.disabled).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("separates distinct FPHI105 blockers and warnings while preserving their locations", async () => {
    component = AbsenceImport;
    const lock = { code: "PROTECTED_ASSIGNMENT", message: "Afastamento em atribuição protegida.", employeeId: "existing", date: "2026-12-03" } as const;
    replaceWith(async (_file, command) => {
      const result = preview(props.workspace, command, [lock, lock, { ...lock, date: "2026-12-04" }]);
      const admission = { code: "UNKNOWN_BINDING", message: "Admissão desconhecida.", employeeId: "existing" } as const;
      const source = { code: "SOURCE_WARNING", message: "Confira o dado na origem.", line: 14 } as const;
      result.warnings.push(admission, admission, source, { ...source, line: 17 });
      return { preview: result };
    });
    await select();
    await click(checkPreview());
    const html = renderToStaticMarkup(tree);
    expect(html.match(/Afastamento em atribuição protegida\./g)).toHaveLength(1);
    expect(html).toContain("1 motivo bloqueante");
    expect(html).toContain("03/12/2026 a 04/12/2026");
    expect(html).toContain("Avisos que não bloqueiam");
    expect(html).toContain("2 tipos de aviso");
    expect(html.match(/Admissão desconhecida\./g)).toHaveLength(1);
    expect(html.match(/Confira o dado na origem\./g)).toHaveLength(1);
    expect(html).toContain("Linha 14");
    expect(html).toContain("Linha 17");
    expect(html).toContain("2 ocorrências");
    expect(apply()?.disabled).toBe(true);
  });

  it("shows FPRE136 departures openly and applies them only after explicit confirmation", async () => {
    const removed = { id: "existing", registration: "0001", name: "Pessoa sintética", fields: [] };
    const replace = replaceWith(async (_file, command) => {
      const result = preview(props.workspace, command);
      result.layout = "FPRE136";
      result.impact.people.removed = [removed];
      result.counts.removedPeople = 1;
      result.warnings = [{ code: "UNKNOWN_BINDING", message: "Admissão desconhecida.", employeeId: "new-person" }];
      return command.action === "PREVIEW_REPLACE" ? { preview: result } : { summary: result, workspace: { ...props.workspace, revision: command.expectedRevision + 1 } };
    });
    await select();
    await click(checkPreview());
    const html = renderToStaticMarkup(tree);
    expect(html).toMatch(/<details[^>]*open=""[^>]*><summary[^>]*>Pessoas retiradas \(1\)/);
    expect(html).toContain("Estas pessoas não constam no arquivo.");
    expect(html).toContain("Isso não registra uma demissão nem define uma data de desligamento.");
    expect(html).toContain("Pessoa sintética");
    expect(html).not.toContain('role="alert"');
    expect(apply()?.disabled).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    control("checkbox", 1)({ target: { checked: true } });
    await settle();
    await click(apply());
    expect(replace.mock.calls[1][1]).toMatchObject({ action: "APPLY_REPLACE", confirm: true, expectedImpactHash: "1".repeat(64) });
  });

  it("clears a ready review on save gating and changes to the period", async () => {
    replaceWith();
    await select();
    await click(checkPreview());
    expect(apply()?.disabled).toBe(true);
    props = { ...props, pendingSave: true };
    render();
    await settle();
    expect(apply()).toBeUndefined();
    expect(checkPreview()?.disabled).toBe(true);
    props = { ...props, pendingSave: false };
    render();
    await settle();
    await click(checkPreview());
    const { workspace } = props;
    await setWorkspace({ ...workspace, input: { ...workspace.input, endDate: workspace.input.startDate } });
    expect(apply()).toBeUndefined();
  });

  it("aborts the request and clears its timeout on unmount", async () => {
    const response = deferred<Response>();
    const fetcher = vi.fn((_url: string, _options: RequestInit) => response.promise);
    const replace = useHttp(fetcher);
    await select();
    await click(checkPreview());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    unmountChild();
    await settle();
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    response.resolve(Response.json({ preview: {} }));
    await settle();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("offers another review after timeout, with no replacement attempted", async () => {
    const pending = deferred<Response>();
    const fetcher = vi.fn((_url: string, _options: RequestInit) => pending.promise);
    const replace = useHttp(fetcher);
    await select();
    await click(checkPreview());
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(text(tree)).toContain("A espera excedeu o prazo.");
    expect(checkPreview()?.disabled).toBe(false);
    expect(apply()).toBeUndefined();
    replace.mockImplementationOnce(async (_file, command) => ({ preview: preview(props.workspace, command) }));
    await click(checkPreview());
    expect(apply()?.disabled).toBe(true);
    expect(replace.mock.calls.map(([, command]) => command.action)).toEqual(["PREVIEW_REPLACE", "PREVIEW_REPLACE"]);
  });

  it("ignores an unauthorized reply from a previous planning context", async () => {
    const response = deferred<Response>(), unlock = vi.fn();
    window.addEventListener("escalas:unlock-required", unlock);
    const fetcher = vi.fn((_url: string, _options: RequestInit) => response.promise);
    useHttp(fetcher);
    await select();
    await click(checkPreview());
    expect(fetcher).toHaveBeenCalledTimes(1);
    const { workspace } = props;
    await setWorkspace({ ...workspace, id: "plan-07", input: { ...workspace.input, branchCode: "07" } });
    response.resolve(Response.json({}, { status: 401 }));
    await settle();
    expect(unlock).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Filial 07");
  });

  it("does not expose an invalid success response for application", async () => {
    const replace = useHttp(vi.fn().mockResolvedValue(Response.json({ preview: {} })));
    await select();
    await click(checkPreview());
    expect(apply()).toBeUndefined();
    expect(text(tree)).toContain("A resposta não corresponde à conferência desta filial.");
    expect(text(tree)).toContain("Nenhuma substituição foi solicitada.");
    expect(replace.mock.calls.map(([, command]) => command.action)).toEqual(["PREVIEW_REPLACE"]);
  });
});
