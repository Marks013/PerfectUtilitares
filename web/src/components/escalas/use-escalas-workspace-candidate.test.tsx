import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { EscalaInput, EscalaWorkspace } from "@/lib/escalas/types";
import type { EscalaCandidateReceipt } from "@/lib/escalas/candidate-reference";
import type { GeneratedProposal } from "./mass-generation";
import { newEmployee, newInput } from "./workspace-model";
import { useEscalasWorkspace } from "./use-escalas-workspace";

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
  return { result: { status: "FEASIBLE", assignments: proposalInput.assignments, message: "Proposta", wallTimeSeconds: 1 }, proposalInput, validation, candidateReceipt };
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

function Harness() {
  current = useEscalasWorkspace();
  return null;
}
function render() {
  hooks.cursor = 0; hooks.changed = false;
  renderToStaticMarkup(<Harness />);
  const effects = hooks.effects.splice(0);
  for (const effect of effects) effect();
}
async function settle() {
  for (let index = 0; index < 50; index++) { if (hooks.changed) render(); await Promise.resolve(); }
  if (hooks.changed) render();
}
async function open(id = "plan-08") { current.open(id); await settle(); }
async function generate() { current.generate(); await settle(); }
function generations() { return calls.filter(body => body.action === "GENERATE"); }

beforeEach(async () => {
  hooks.slots = []; hooks.deps = []; hooks.cleanup = []; hooks.effects = []; hooks.cursor = 0; hooks.changed = false;
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
      if (body.action === "GENERATE") reply = await generation(body, ++count);
      else if (body.action === "SAVE") {
        const previous = sources.get(String(body.id));
        if (!previous) throw new Error("Unknown synthetic workspace");
        if (pendingSave) reply = await pendingSave;
        else {
          const saved = { ...previous, revision: previous.revision + 1, input: structuredClone(body.input as EscalaInput) };
          sources.set(saved.id, saved); reply = { status: 200, body: saved };
        }
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

describe("trusted candidate lifecycle in the real workspace hook", () => {
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
