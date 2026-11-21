import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EscalaInput, EscalaWorkspace } from "@/lib/escalas/types";
import type { EscalaCandidateReceipt } from "@/lib/escalas/candidate-reference";
import type { GeneratedProposal } from "./mass-generation";
import { newEmployee, newInput } from "./workspace-model";
import { useEscalasWorkspace } from "./use-escalas-workspace";
import { EscalaAccessProvider } from "./access-context";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";

// Run the real hook, queue, requests and generation helper with stateful hook primitives.
// This exercises async lifecycles without installing a DOM/browser test dependency.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], deps: [] as (readonly unknown[] | undefined)[], cursor: 0, changed: false,
  effects: [] as (() => void)[], cleanup: [] as ((() => void) | undefined)[],
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  const changed = (slot: number, deps?: readonly unknown[]) => !deps || !hooks.deps[slot] || deps.length !== hooks.deps[slot]?.length || deps.some((value, index) => !Object.is(value, hooks.deps[slot]?.[index]));
  return { ...actual,
    useState<T>(initial: T | (() => T)) {
      const slot = hooks.cursor++;
      if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.slots[slot] as T, (next: T | ((previous: T) => T)) => {
        hooks.slots[slot] = typeof next === "function" ? (next as (previous: T) => T)(hooks.slots[slot] as T) : next;
        hooks.changed = true;
      }];
    },
    useRef<T>(initial: T) {
      const slot = hooks.cursor++;
      if (!(slot in hooks.slots)) hooks.slots[slot] = { current: initial };
      return hooks.slots[slot];
    },
    useCallback<T>(callback: T, deps: readonly unknown[]) {
      const slot = hooks.cursor++;
      if (changed(slot, deps)) { hooks.slots[slot] = callback; hooks.deps[slot] = deps; }
      return hooks.slots[slot];
    },
    useEffect(effect: () => unknown, deps?: readonly unknown[]) {
      const slot = hooks.cursor++;
      if (changed(slot, deps)) {
        hooks.deps[slot] = deps;
        hooks.effects.push(() => {
          hooks.cleanup[slot]?.();
          const cleanup = effect();
          hooks.cleanup[slot] = typeof cleanup === "function" ? cleanup as () => void : undefined;
        });
      }
    },
  };
});

const validation = { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null };
function workspace(id = "plan-08", branch = "08"): EscalaWorkspace {
  const input = newInput(branch, "Filial sintética", "2026-12", 42);
  input.employees = [{ ...newEmployee(42, "day"), id: "person", registration: "1", name: "Pessoa sintética", sector: "Caixa", role: "Operador", activeFrom: "2020-01-01" }];
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 840, kind: "BREAK" }, { start: 840, end: 1104, kind: "WORK" }] }];
  input.assignments = [{ employeeId: "person", date: "2026-12-01", kind: "OFF" }];
  return { id, revision: 2, status: "DRAFT", input, validation, canEdit: true, canPublish: true, updatedAt: "2026-11-14T00:00:00Z" };
}
function candidate(source: EscalaWorkspace, sequence: number): GeneratedProposal {
  const proposalInput = structuredClone(source.input);
  if (proposalInput.generationMode !== "HOURS_ONLY") proposalInput.assignments = [{ employeeId: "person", date: "2026-12-01", kind: "WORK", shiftId: "day" }];
  const candidateReceipt: EscalaCandidateReceipt = { version: 1, workspaceId: source.id, revision: source.revision,
    issuedAt: Date.now(), expiresAt: Date.now() + 60_000, baseHash: "base", contextHash: "context", inputHash: "candidate-" + sequence, signature: "opaque-private-" + sequence };
  return { result: { status: "FEASIBLE", assignments: proposalInput.assignments, message: "Proposta", wallTimeSeconds: 1 }, proposalInput, validation, candidateReceipt, proposalProof: `opaque-application-proof-${sequence}` };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  let reject: (cause: unknown) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
type Reply = { status: number; body: unknown };
let current: ReturnType<typeof useEscalasWorkspace>;
let sources: Map<string, EscalaWorkspace>;
let calls: Record<string, unknown>[];
let generation: (body: Record<string, unknown>, sequence: number) => Promise<Reply>;
let count: number;
let pendingSave: Promise<Reply> | null;
let access: EscalaClientAccess | null;

function Harness() {
  current = useEscalasWorkspace();
  return null;
}
function render() {
  hooks.cursor = 0; hooks.changed = false;
  renderToStaticMarkup(<EscalaAccessProvider value={access}><Harness /></EscalaAccessProvider>);
  const effects = hooks.effects.splice(0);
  for (const effect of effects) effect();
}
async function settle() {
  for (let index = 0; index < 50; index++) { if (hooks.changed) render(); await Promise.resolve(); }
  if (hooks.changed) render();
}
async function open(id = "plan-08") { current.open(id); await settle(); }
async function generate() { current.generate(); await settle(); }
async function remountAccessScope() {
  for (const cleanup of hooks.cleanup) cleanup?.();
  hooks.slots = []; hooks.deps = []; hooks.cleanup = []; hooks.effects = []; hooks.cursor = 0; hooks.changed = false;
  render(); await settle();
}
function generations() { return calls.filter(body => body.action === "GENERATE"); }

beforeEach(async () => {
  hooks.slots = []; hooks.deps = []; hooks.cleanup = []; hooks.effects = []; hooks.cursor = 0; hooks.changed = false;
  access = { channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] };
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-14T10:00:00Z"));
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("sessionStorage", { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("localStorage", { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() });
  sources = new Map([["plan-08", workspace()], ["plan-07", workspace("plan-07", "07")]]);
  calls = []; count = 0; pendingSave = null;
  generation = async (body, sequence) => {
    const source = sources.get(String(body.id));
    if (!source) throw new Error("Unknown synthetic workspace");
    return { status: 200, body: candidate(source, sequence) };
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    let reply: Reply;
    if (!init?.method) {
      const id = new URL(url, "https://synthetic.invalid").searchParams.get("id");
      reply = { status: 200, body: url.includes("/export") ? { downloaded: true } : id ? sources.get(id) : { workspaces: [...sources.values()], canCreate: true } };
    } else {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push(body);
      if (body.action === "GENERATE" || body.action === "UPGRADE_CALENDAR") reply = await generation(body, ++count);
      else if (body.action === "SAVE") {
        const previous = sources.get(String(body.id));
        if (!previous) throw new Error("Unknown synthetic workspace");
        if (pendingSave) reply = await pendingSave;
        else {
          const saved = { ...previous, revision: previous.revision + 1, input: structuredClone(body.input as EscalaInput) };
          sources.set(saved.id, saved); reply = { status: 200, body: saved };
        }
      } else if (body.action === "APPLY_PROPOSAL") {
        const previous = sources.get(String(body.id)); if (!previous) throw new Error("Unknown synthetic workspace");
        const saved = { ...previous, revision: previous.revision + 1, input: structuredClone(body.input as EscalaInput) };
        sources.set(saved.id, saved); reply = { status: 200, body: saved };
      } else reply = { status: 200, body: { operationId: "a3dfb1bc-a1d3-4fe8-aab9-3d527490a62c", state: body.action === "CANCEL_GENERATION" ? "CANCELLED" : "CREATED", expiresAt: "2026-11-15T10:00:00Z" } };
    }
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => structuredClone(reply.body) };
  }));
  render(); await settle(); await open();
});
afterEach(() => {
  for (const cleanup of hooks.cleanup) cleanup?.();
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("scoped preview and independent application authority", () => {
  const previewAccess = (): EscalaClientAccess => ({ channel: "USERNAME", administrator: false, allBranches: false, roleLabel: "Filial",
    branches: [{ code: "08", label: "Filial 08", capabilities: ["workspace.read", "schedule.generate"] }] });

  it("generates twice from a clean saved revision without SAVE and sends its candidate receipt, without granting edit or apply", async () => {
    const source = sources.get("plan-08"); if (!source) throw new Error("Workspace not found");
    source.canEdit = false; source.canPublish = false; access = previewAccess(); await open();
    const original = structuredClone(source);
    expect(current.canEdit).toBe(false); expect(current.canGenerate).toBe(true);
    await generate(); const first = current.generated; await generate();
    expect(generations()).toHaveLength(2);
    expect(generations()[1].comparisonReference).toEqual({ input: first?.proposalInput, receipt: first?.candidateReceipt });
    current.applyGenerated(); current.save();
    const attemptedEdit = structuredClone(source.input); attemptedEdit.employees[0].name = "Edição sem permissão";
    current.update(attemptedEdit); await settle();
    expect(current.dirty).toBe(false); expect(current.input).toEqual(original.input);
    expect(sources.get("plan-08")).toEqual(original);
    expect(calls.some(body => ["SAVE", "APPLY_PROPOSAL", "PUBLISH"].includes(String(body.action)))).toBe(false);
  });

  it("does not send a dirty draft after SAVE permission is removed", async () => {
    const draft = structuredClone(current.input); if (!draft) throw new Error("Workspace not open");
    draft.employees[0].name = "Rascunho autorizado antes da mudança"; current.update(draft); await settle();
    access = previewAccess(); render(); await settle();
    expect(current.dirty).toBe(true); expect(current.canGenerate).toBe(false);
    current.generate(); current.save(); await settle();
    await expect(current.flushDraft()).rejects.toMatchObject({ status: 403, code: "ESCALA_PROTECTED_INPUT" });
    await vi.advanceTimersByTimeAsync(1100); await settle();
    expect(calls.some(body => body.action === "SAVE" || body.action === "START_GENERATION")).toBe(false);
  });

  const noticeCases: { label: string; warnings: boolean; comparison?: GeneratedProposal["comparison"]; expected?: string }[] = [
    { label: "simple", warnings: false },
    { label: "simple with warnings", warnings: true },
    { label: "retained", warnings: false, comparison: { admission: "ADMITTED", selection: "REFERENCE_RETAINED" }, expected: "mantida para preservar a cobertura" },
    { label: "retained with warnings", warnings: true, comparison: { admission: "ADMITTED", selection: "REFERENCE_RETAINED" }, expected: "mantida para preservar a cobertura" },
    { label: "expired", warnings: false, comparison: { admission: "EXPIRED", selection: "NOT_USED" }, expected: "comparação anterior expirou" },
    { label: "expired with warnings", warnings: true, comparison: { admission: "EXPIRED", selection: "NOT_USED" }, expected: "comparação anterior expirou" },
    { label: "changed", warnings: true, comparison: { admission: "SCENARIO_CHANGED", selection: "NOT_USED" }, expected: "não pôde ser usada neste cenário" },
    { label: "incompatible", warnings: true, comparison: { admission: "INCOMPATIBLE", selection: "NOT_USED" }, expected: "não pôde ser usada neste cenário" },
  ];
  it.each((["preview", "apply"] as const).flatMap(authority => noticeCases.map(testCase => ({ ...testCase, authority }))))(
    "gives $authority an available next action for $label", async ({ authority, warnings, comparison, expected }) => {
      const source = sources.get("plan-08"); if (!source) throw new Error("Workspace not found");
      if (authority === "preview") { source.canEdit = false; source.canPublish = false; access = previewAccess(); await open(); }
      generation = async (_body, sequence) => {
        const proposal = candidate(source, sequence);
        if (warnings) proposal.validation = { ...proposal.validation, issues: [{ code: "SYNTHETIC_WARNING", message: "Aviso sintético", severity: "WARNING" }] };
        if (comparison) proposal.comparison = comparison;
        return { status: 200, body: proposal };
      };
      await generate();
      expect(current.generated).not.toBeNull();
      if (expected) expect(current.notice).toContain(expected);
      if (warnings) expect(current.notice).toContain("concluída com avisos");
      else expect(current.notice).not.toContain("concluída com avisos");
      if (authority === "preview") {
        expect(current.notice).toContain("Confira a proposta.");
        expect(current.notice).toContain("pessoa autorizada nesta filial");
        expect(current.notice).not.toMatch(/Confira e aplique|antes de aplicar/);
      } else expect(current.notice).toMatch(/Confira e aplique|antes de aplicar/);
      expect(current.notice).not.toMatch(/ótim|aprovad|opaque-private/i);
      expect(calls.some(body => ["SAVE", "APPLY_PROPOSAL", "PUBLISH"].includes(String(body.action)))).toBe(false);
    },
  );

  it.each(["workspace.save", "schedule.apply"] as const)("does not suggest application when %s is missing", async missing => {
    access = { ...previewAccess(), branches: [{ code: "08", label: "Filial 08", capabilities: ["workspace.read", "schedule.generate", ...(missing === "workspace.save" ? ["schedule.apply" as const] : ["workspace.save" as const])] }] };
    render(); await settle(); await generate();
    expect(current.workspace?.canEdit).toBe(true);
    expect(current.notice).toContain("Confira a proposta.");
    expect(current.notice).not.toMatch(/Confira e aplique|antes de aplicar/);
  });

  it("uses current permissions for the notice when access changes while awaiting generation", async () => {
    const pending = deferred<Reply>(); generation = () => pending.promise;
    current.generate(); await settle();
    access = previewAccess(); render(); await settle();
    pending.resolve({ status: 200, body: candidate(workspace(), 1) }); await settle();
    expect(current.generated).not.toBeNull(); expect(current.notice).toContain("Confira a proposta.");
    expect(current.notice).not.toMatch(/Confira e aplique|antes de aplicar/);
  });

  it("discards a dirty draft after SAVE is removed by reading the saved revision, with only one plan and no write", async () => {
    sources.delete("plan-07"); await remountAccessScope(); await open();
    expect(current.workspaces).toHaveLength(1);
    const draft = structuredClone(current.input); if (!draft) throw new Error("Workspace not open");
    draft.employees[0].name = "Edição local ainda não salva"; current.update(draft); await settle();
    access = previewAccess(); render(); await settle();
    expect(current.dirty).toBe(true); expect(current.canGenerate).toBe(false);
    const source = sources.get("plan-08"); if (!source) throw new Error("Workspace not found");
    const saved = { ...source, revision: 3, canEdit: false, canPublish: false, input: structuredClone(source.input) };
    saved.input.branchName = "Revisão salva no servidor"; sources.set(saved.id, saved);
    calls = []; const before = vi.mocked(fetch).mock.calls.length;
    current.discard(); await settle(); await vi.advanceTimersByTimeAsync(1100); await settle();
    expect(current.workspace?.revision).toBe(3); expect(current.input).toEqual(saved.input);
    expect(current.dirty).toBe(false); expect(current.generated).toBeNull(); expect(current.canGenerate).toBe(true);
    expect(current.workspaces).toHaveLength(1); expect(calls).toEqual([]);
    const requests = vi.mocked(fetch).mock.calls.slice(before);
    expect(requests).toHaveLength(1); expect(requests[0][0]).toBe("/api/escalas?id=plan-08");
    expect(requests[0][1]?.method).toBeUndefined();
    expect(sources.get("plan-08")).toEqual(saved);
  });

  it("keeps the local draft when discard cannot read the saved revision, without writing", async () => {
    const draft = structuredClone(current.input); if (!draft) throw new Error("Workspace not open");
    draft.employees[0].name = "Edição local preservada"; current.update(draft); await settle();
    access = previewAccess(); render(); await settle(); calls = [];
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: { code: "UNAVAILABLE", message: "Tente novamente." } }) } as Response);
    current.discard(); await settle(); await vi.advanceTimersByTimeAsync(1100); await settle();
    expect(current.dirty).toBe(true); expect(current.input).toEqual(draft); expect(current.workspace?.revision).toBe(2);
    expect(current.error).not.toBe(""); expect(calls).toEqual([]);
  });

  it.each([{ status: 409, code: "ESCALA_CONFIG_REVOKED" }, { status: 409, code: "ESCALA_CONFIG_APPROVAL_REQUIRED" },
    { status: 403, code: "ESCALA_ACCESS_REQUIRED" }, { status: 400, code: "ESCALA_COMPARISON_REFERENCE_INVALID" }])(
    "never restores a prior applicable preview after $code with the same workspace revision", async ({ status, code }) => {
      await generate(); expect(current.generated?.proposalProof).toBeTruthy();
      generation = async () => ({ status, body: { error: { code, message: "Acesso ou configuração alterados." } } });
      await generate(); expect(current.workspace?.revision).toBe(2); expect(current.generated).toBeNull();
      current.applyGenerated(); await settle();
      expect(calls.some(body => body.action === "APPLY_PROPOSAL" || body.action === "SAVE")).toBe(false);
    });

  it("clears both artifacts on lock and does not carry them into the boundary's fresh hook instance", async () => {
    await generate(); expect(current.generated?.candidateReceipt).toBeTruthy();
    window.dispatchEvent(new Event("escalas:unlock-required")); await settle();
    expect(current.generated).toBeNull(); expect(current.canGenerate).toBe(false);
    for (const cleanup of hooks.cleanup) cleanup?.();
    hooks.slots = []; hooks.deps = []; hooks.cleanup = []; hooks.effects = []; hooks.cursor = 0; hooks.changed = false;
    render(); await settle(); await open(); await generate();
    expect(generations().at(-1)).not.toHaveProperty("comparisonReference");
  });

  it("applies the exact final input and r2 proof while never using the comparison receipt as application authority", async () => {
    await generate(); const selected = structuredClone(current.generated); if (!selected) throw new Error("Candidate missing");
    current.applyGenerated(); await settle();
    expect(calls.find(body => body.action === "APPLY_PROPOSAL")).toEqual({ action: "APPLY_PROPOSAL", id: "plan-08", expectedRevision: 2,
      input: selected.proposalInput, proposalProof: selected.proposalProof });
    expect(current.workspace?.revision).toBe(3); expect(current.generated).toBeNull();
    expect(calls.some(body => body.action === "SAVE")).toBe(false);
  });
});

describe("trusted candidate lifecycle in the real workspace hook", () => {
  describe("explicit weekly calendar upgrade", () => {
    async function legacy() {
      const source = workspace();
      delete source.input.planningWeekStartsOn;
      source.input.startDate = "2026-11-30"; source.input.endDate = "2027-01-03";
      sources.set(source.id, source); await open(source.id);
      return source;
    }
    it("uses the saved revision, prevents duplicate clicks and selects only the returned new draft", async () => {
      const source = await legacy(), previous = structuredClone(source);
      const pending = deferred<Reply>();
      generation = async () => pending.promise;
      current.upgradeCalendar(); current.upgradeCalendar(); await settle();
      const requests = calls.filter(body => body.action === "UPGRADE_CALENDAR");
      expect(requests).toEqual([{ action: "UPGRADE_CALENDAR", id: source.id, expectedRevision: 2 }]);
      expect(current.busy).toContain("domingo a sábado");
      const upgraded = workspace("sunday-copy");
      upgraded.input.planningCalendarSource = { workspaceId: source.id, revision: 2 };
      pending.resolve({ status: 200, body: upgraded }); await settle();
      expect(current.workspace?.id).toBe("sunday-copy");
      expect(current.input?.planningWeekStartsOn).toBe("SUNDAY");
      expect(current.notice).toContain("O planejamento original foi preservado");
      expect(current.generated).toBeNull();
      expect(generations()).toEqual([]);
      expect(calls.some(body => ["SAVE", "PUBLISH"].includes(String(body.action)))).toBe(false);
      expect(sources.get(source.id)).toEqual(previous);
    });
    it("preserves the selected plan and provides the server error when an upgrade fails", async () => {
      const source = await legacy(), before = structuredClone(current.input), original = structuredClone(source);
      generation = async () => ({ status: 409, body: { code: "ESCALA_STALE_REVISION", error: "O planejamento mudou. Recarregue a revisão atual." } });
      current.upgradeCalendar(); await settle();
      expect(current.workspace?.id).toBe(source.id);
      expect(current.input).toEqual(before);
      expect(sources.get(source.id)).toEqual(original);
      expect(current.error).not.toBe("");
      expect(current.notice).toBe("");
      expect(current.busy).toBe("");
      expect(generations()).toEqual([]);
    });
    it("flushes local edits before requesting the explicit upgrade", async () => {
      await legacy();
      const draft = structuredClone(current.input);
      if (!draft) throw new Error("Legacy plan missing");
      draft.branchName = "Edição preservada";
      current.update(draft); await settle();
      generation = async () => ({ status: 200, body: workspace("new-copy") });
      current.upgradeCalendar(); await settle();
      expect(calls.map(body => body.action)).toEqual(["SAVE", "UPGRADE_CALENDAR"]);
      expect(calls[1].expectedRevision).toBe(3);
      expect(sources.get("plan-08")?.input.branchName).toBe("Edição preservada");
    });
  });

  describe("generation intent epoch", () => {
    async function pendingDraftWithConflict() {
      await generate();
      const selected = workspace(); selected.revision = 7; selected.input.defaultWeeklyHours = 40;
      sources.set(selected.id, selected);
      current.compareLatest(); await settle();
      expect(current.conflict?.revision).toBe(7);
      const edited = structuredClone(current.input);
      if (!edited) throw new Error("Workspace not open");
      edited.employees[0].name = "Edição antes da geração";
      current.update(edited); await settle();
      const pending = deferred<Reply>(); pendingSave = pending.promise;
      current.generate(); await settle();
      expect(calls.filter(body => body.action === "SAVE")).toHaveLength(1);
      expect(generations()).toHaveLength(1);
      return { pending, edited, selected };
    }

    it("does not redirect generation after a successful old SAVE when the server revision was selected during the flush", async () => {
      const { pending, edited } = await pendingDraftWithConflict();
      current.useServerRevision(); await settle();
      pending.resolve({ status: 200, body: { ...workspace(), revision: 3, input: edited } }); await settle();
      expect(current.workspace?.revision).toBe(7); expect(current.input?.defaultWeeklyHours).toBe(40);
      expect(current.generated).toBeNull(); expect(current.error).toBe(""); expect(current.busy).toBe("");
      expect(calls.filter(body => body.action === "START_GENERATION")).toHaveLength(1);
      expect(generations()).toHaveLength(1);
    });

    it("ignores a rejected old SAVE without showing its error or restoring a proposal in the newly selected context", async () => {
      const { pending } = await pendingDraftWithConflict();
      current.useServerRevision(); await settle();
      const notice = current.notice;
      pending.reject(new TypeError("Falha do SAVE antigo")); await settle();
      expect(current.workspace?.revision).toBe(7); expect(current.input?.defaultWeeklyHours).toBe(40);
      expect(current.generated).toBeNull(); expect(current.error).toBe(""); expect(current.problem).toBeNull();
      expect(current.notice).toBe(notice); expect(current.busy).toBe("");
      expect(calls.filter(body => body.action === "START_GENERATION")).toHaveLength(1);
      expect(generations()).toHaveLength(1);
    });

    it("allows the new revision returned by this generation's own SAVE to proceed to solving", async () => {
      const edited = structuredClone(current.input);
      if (!edited) throw new Error("Workspace not open");
      edited.employees[0].name = "Edição salva pelo próprio fluxo";
      current.update(edited); await settle();
      const pending = deferred<Reply>(); pendingSave = pending.promise;
      current.generate(); await settle();
      expect(generations()).toHaveLength(0);
      const saved = { ...workspace(), revision: 3, input: edited }; sources.set(saved.id, saved);
      pending.resolve({ status: 200, body: saved }); await settle();
      expect(current.workspace?.revision).toBe(3); expect(current.generated?.candidateReceipt?.revision).toBe(3);
      expect(calls.find(body => body.action === "START_GENERATION")).toMatchObject({ id: saved.id, expectedRevision: 3 });
      expect(generations()).toHaveLength(1); expect(generations()[0]).toMatchObject({ id: saved.id, expectedRevision: 3 });
      expect(generations()[0]).not.toHaveProperty("comparisonReference");
      expect(current.error).toBe(""); expect(current.busy).toBe("");
    });
  });

  it("captures the previous candidate before clearing the preview and sends only its full input and matching receipt", async () => {
    await generate();
    const previous = structuredClone(current.generated);
    expect(previous?.proposalInput.assignments[0].kind).toBe("WORK");
    expect(current.input?.assignments[0].kind).toBe("OFF");
    await generate();
    expect(generations()[0]).not.toHaveProperty("comparisonReference");
    expect(generations()[1].comparisonReference).toEqual({ input: previous?.proposalInput, receipt: previous?.candidateReceipt });
    expect(generations()[1].comparisonReference).not.toHaveProperty("validation");
    expect(current.input?.assignments[0].kind).toBe("OFF");
    expect(sessionStorage.setItem).not.toHaveBeenCalled(); expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it.each(["edit", "period", "mode", "hours", "save", "branch"])("invalidates the previous comparison after %s", async action => {
    await generate();
    if (action === "save") { current.save(); await settle(); }
    else if (action === "branch") await open("plan-07");
    else {
      const input = structuredClone(current.input);
      if (!input) throw new Error("Workspace not open");
      if (action === "period") {
        const period = newInput(input.branchCode, input.branchName, "2027-01", 42);
        input.visibleMonth = period.visibleMonth; input.startDate = period.startDate; input.endDate = period.endDate;
        input.policy = period.policy; input.assignments = [];
      }
      else if (action === "mode") input.generationMode = "REST_ONLY";
      else if (action === "hours") input.defaultWeeklyHours = 40;
      else input.employees[0].name = "Pessoa editada";
      current.update(input); await settle();
    }
    expect(current.generated).toBeNull();
    await generate();
    expect(generations()[1]).not.toHaveProperty("comparisonReference");
    if (action === "branch") expect(generations()[1].id).toBe("plan-07");
  });

  it("restores a usable previous proposal on a transport failure and blocks duplicate clicks while waiting", async () => {
    await generate(); const previous = current.generated;
    const pending = deferred<Reply>(); generation = () => pending.promise;
    current.generate(); current.generate(); await settle();
    expect(generations()).toHaveLength(2); expect(current.generated).toBeNull();
    pending.resolve({ status: 503, body: { error: { code: "UNAVAILABLE", message: "Tente novamente em instantes." } } }); await settle();
    expect(current.generated).toBe(previous); expect(current.error).not.toBe("");
    expect(calls.filter(body => body.action === "CANCEL_GENERATION")).toHaveLength(1);
  });

  it("keeps the existing payload error handling and restores the previous proposal on HTTP 413", async () => {
    await generate(); const previous = current.generated;
    generation = async () => ({ status: 413, body: { error: { code: "BODY_TOO_LARGE", message: "O conteúdo enviado excede o limite permitido." } } });
    await generate();
    expect(current.generated).toBe(previous);
    expect(current.problem?.message).toBe("Este planejamento ficou grande demais para o cálculo.");
    expect(current.problem?.explanation).toContain("não apague colaboradores, ausências ou históricos");
    expect(current.error).not.toContain("opaque-private");
  });

  it("also restores the usable previous proposal when fetch rejects before an HTTP response", async () => {
    await generate(); const previous = current.generated;
    generation = async () => { throw new Error("Conexão interrompida."); };
    await generate();
    expect(current.generated).toBe(previous); expect(current.error).not.toBe("");
  });

  it("does not use or restore a candidate whose validation was not usable", async () => {
    generation = async (body, sequence) => ({ status: 200, body: { ...candidate(sources.get(String(body.id)) ?? workspace(), sequence), validation: { ...validation, valid: false } } });
    await generate();
    generation = async () => ({ status: 503, body: { error: { code: "UNAVAILABLE", message: "Tente novamente." } } });
    await generate();
    expect(generations()[1]).not.toHaveProperty("comparisonReference"); expect(current.generated).toBeNull();
  });

  it("ignores a successful reply from the previous revision after the user chooses the server context", async () => {
    await generate();
    const server = workspace(); server.revision = 3; server.input.defaultWeeklyHours = 40; sources.set(server.id, server);
    current.compareLatest(); await settle(); expect(current.conflict?.revision).toBe(3);
    const pending = deferred<Reply>(); generation = () => pending.promise;
    current.generate(); await settle();
    current.useServerRevision(); await settle();
    pending.resolve({ status: 200, body: candidate(workspace(), 2) }); await settle();
    expect(current.workspace?.revision).toBe(3); expect(current.input?.defaultWeeklyHours).toBe(40); expect(current.generated).toBeNull();
  });

  it("does not restore a failed old candidate into another selected context", async () => {
    await generate();
    const server = workspace("plan-07", "07");
    sources.set("plan-08", { ...server, id: "plan-08", revision: 3 });
    current.compareLatest(); await settle();
    const pending = deferred<Reply>(); generation = () => pending.promise;
    current.generate(); await settle(); current.useServerRevision(); await settle();
    pending.resolve({ status: 503, body: { error: { code: "UNAVAILABLE", message: "Tente novamente." } } }); await settle();
    expect(current.input?.branchCode).toBe("07"); expect(current.generated).toBeNull();
    expect(current.error).toBe("");
  });

  it.each(["EXPIRED", "SCENARIO_CHANGED", "INCOMPATIBLE"] as const)("continues generating with plain feedback when comparison is %s", async admission => {
    await generate();
    generation = async (body, sequence) => ({ status: 200, body: { ...candidate(sources.get(String(body.id)) ?? workspace(), sequence), comparison: { admission, selection: "NOT_USED", reason: "opaque-private-internal-reason" } } });
    await generate();
    expect(current.generated).not.toBeNull(); expect(current.notice).toContain("comparação anterior");
    expect(current.notice).not.toContain(admission); expect(current.notice).not.toContain("opaque-private");
  });

  it("explains retained coverage without presenting the previous candidate as optimal or approved", async () => {
    await generate();
    generation = async (body, sequence) => ({ status: 200, body: { ...candidate(sources.get(String(body.id)) ?? workspace(), sequence), comparison: { admission: "ADMITTED", selection: "REFERENCE_RETAINED" } } });
    await generate();
    expect(current.notice).toBe("A proposta anterior foi mantida para preservar a cobertura. Confira antes de aplicar.");
    expect(current.notice).not.toMatch(/ótim|conform|aprovad/i);
  });

  it("keeps repeated downloads independent of receipt expiration without renewing or mutating the candidate", async () => {
    await generate(); const previous = current.generated, snapshot = structuredClone(previous);
    const outdated = current.outdated;
    vi.setSystemTime(new Date("2026-11-14T10:02:00Z"));
    const saved = await current.flushDraft(); await settle();
    if (!saved) throw new Error("Workspace not open");
    expect(current.isCurrentRevision(saved)).toBe(true);
    await fetch("/api/escalas/export?id=plan-08&revision=2&format=xlsx"); await settle();
    await fetch("/api/escalas/export?id=plan-08&revision=2&format=xlsx"); await settle();
    expect(current.generated).toBe(previous); expect(current.generated).toEqual(snapshot);
    expect(current.outdated).toBe(outdated);
    expect(generations()).toHaveLength(1); expect(calls.some(body => body.action === "SAVE")).toBe(false);
    await generate(); expect(generations()[1].comparisonReference).toEqual({ input: snapshot?.proposalInput, receipt: snapshot?.candidateReceipt });
  });

  it("keeps HOURS_ONLY free of comparison references and never applies or creates rest assignments", async () => {
    const source = sources.get("plan-08"); if (!source) throw new Error("Workspace not found");
    source.input.generationMode = "HOURS_ONLY"; source.input.assignments = []; await open();
    await generate(); await generate();
    expect(generations().every(body => !("comparisonReference" in body))).toBe(true);
    expect(current.input?.assignments).toEqual([]); expect(current.generated?.proposalInput.assignments).toEqual([]);
    expect(calls.some(body => body.action === "SAVE" || body.action === "PUBLISH")).toBe(false);
  });
});


describe("workspace access recovery", () => {
  it("reloads the initial list after unlocking without a previously selected workspace", async () => {
    for (const cleanup of hooks.cleanup) cleanup?.();
    hooks.slots = []; hooks.deps = []; hooks.cleanup = []; hooks.effects = []; hooks.cursor = 0; hooks.changed = false;
    const fetcher = vi.mocked(fetch);
    fetcher.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: { code: "ESCALA_ACCESS_REQUIRED", message: "Acesso expirado" } }) } as Response);
    render(); await settle();
    expect(current.workspace).toBeNull(); expect(current.workspaces).toEqual([]); expect(current.canCreate).toBe(false);
    window.dispatchEvent(new Event("escalas:unlocked")); await remountAccessScope();
    expect(current.workspace).toBeNull();
    expect(current.workspaces.map(item => item.id)).toEqual(["plan-08", "plan-07"]);
    expect(current.canCreate).toBe(true); expect(current.busy).toBe(""); expect(current.error).toBe("");
    expect(calls.filter(item => ["SAVE", "CREATE", "PUBLISH"].includes(String(item.action)))).toEqual([]);
  });
  it("blocks a stale editing callback immediately after locking and restores only after reloading", async () => {
    const previous = structuredClone(current.input), staleUpdate = current.update;
    if (!previous) throw new Error("Workspace not loaded");
    window.dispatchEvent(new Event("escalas:unlock-required"));
    staleUpdate({ ...previous, branchName: "Rejected while locked" }); await settle();
    expect(current.canEdit).toBe(false); expect(current.dirty).toBe(false); expect(current.input).toEqual(previous);
    window.dispatchEvent(new Event("escalas:unlocked")); await remountAccessScope(); await open();
    expect(current.canEdit).toBe(true); expect(current.input).toEqual(previous);
  });
  it("does not queue a write for a read-only workspace even if a stale control invokes update", async () => {
    const source = sources.get("plan-08");
    if (!source) throw new Error("Workspace not found");
    sources.set("plan-08", { ...source, canEdit: false, canPublish: false });
    await open(); const previous = structuredClone(current.input);
    if (!previous) throw new Error("Workspace not loaded");
    current.update({ ...previous, branchName: "Not permitted" }); await settle();
    expect(current.canEdit).toBe(false); expect(current.dirty).toBe(false); expect(current.input).toEqual(previous);
    await vi.advanceTimersByTimeAsync(1000); await settle();
    expect(calls.filter(item => item.action === "SAVE")).toEqual([]);
  });
  it("requests unlock on a non-JSON 401 instead of leaving the editing controls enabled", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401, json: async () => { throw new SyntaxError("synthetic expired response"); } } as unknown as Response);
    await open();
    expect(current.canEdit).toBe(false); expect(current.workspace?.id).toBe("plan-08"); expect(current.error).not.toBe("");
  });
});


describe("locked proposal protection", () => {
  it("does not apply a prepared proposal through a stale callback while the session is locked", async () => {
    await generate(); const previous = structuredClone(current.input), apply = current.applyGenerated;
    expect(current.generated).not.toBeNull();
    window.dispatchEvent(new Event("escalas:unlock-required")); apply(); await settle();
    expect(current.input).toEqual(previous); expect(current.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(1000); await settle();
    expect(calls.filter(item => item.action === "SAVE")).toEqual([]);
  });
});
