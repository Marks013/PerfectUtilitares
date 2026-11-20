import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { EscalaInput } from "@/lib/escalas/types";
import { AbsenceImport, AbsenceImportReview } from "./absence-import";
import { ImportEmployees } from "./coverage-import";
import { Field } from "./controls";
import { newEmployee, newInput } from "./workspace-model";

// Exercise the real component handlers with stateful hooks; browser coverage remains in E2E.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], deps: [] as (readonly unknown[] | undefined)[],
  cursor: 0, changed: false, effects: [] as (() => void)[], cleanup: [] as ((() => void) | undefined)[] }));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual,
    useState<T>(initial: T | (() => T)) {
      const slot = hooks.cursor++;
      if (!(slot in hooks.slots)) hooks.slots[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
      return [hooks.slots[slot] as T, (next: T | ((previous: T) => T)) => {
        hooks.slots[slot] = typeof next === "function" ? (next as (value: T) => T)(hooks.slots[slot] as T) : next;
        hooks.changed = true;
      }];
    },
    useRef<T>(initial: T) { const slot = hooks.cursor++; if (!(slot in hooks.slots)) hooks.slots[slot] = { current: initial }; return hooks.slots[slot]; },
    useId() { return `synthetic-${hooks.cursor++}`; },
    useEffect(effect: () => unknown, deps?: readonly unknown[]) {
      const slot = hooks.cursor++;
      if (!deps || !hooks.deps[slot] || deps.length !== hooks.deps[slot]?.length || deps.some((value, i) => !Object.is(value, hooks.deps[slot]?.[i]))) {
        hooks.deps[slot] = deps;
        hooks.effects.push(() => { hooks.cleanup[slot]?.(); const cleanup = effect(); hooks.cleanup[slot] = typeof cleanup === "function" ? cleanup as () => void : undefined; });
      }
    },
  };
});

type Props = { input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void };
type NodeProps = { children?: ReactNode | ((id: string) => ReactNode); type?: string; disabled?: boolean;
  onClick?: () => void; onChange?: (event: { target: { files: File[] } }) => void; onApply?: () => void; role?: string };
let props: Props, component: (props: Props) => ReactNode, tree: ReactNode;
function nodes(node = tree): ReactElement<NodeProps>[] {
  if (Array.isArray(node)) return node.flatMap(value => nodes(value));
  if (!isValidElement<NodeProps>(node)) return [];
  const children = node.type === Field && typeof node.props.children === "function" ? node.props.children("synthetic-file") : node.props.children;
  return [node, ...nodes(typeof children === "function" ? null : children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}
function button(label: string) { const found = nodes().find(node => node.type === "button" && text(node) === label); if (!found) throw new Error(`Button absent: ${label}`); return found.props; }
function render() { hooks.cursor = 0; hooks.changed = false; tree = component(props); for (const effect of hooks.effects.splice(0)) effect(); }
async function settle() { for (let i = 0; i < 30; i++) { if (hooks.changed) render(); await Promise.resolve(); } if (hooks.changed) render(); }
async function select(file = new File(["synthetic"], "team.csv", { type: "text/csv" })) {
  const input = nodes().find(node => node.type === "input" && node.props.type === "file");
  if (!input?.props.onChange) throw new Error("File input absent");
  input.props.onChange({ target: { files: [file] } }); await settle();
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function teamReply() { return Response.json({ preview: { employees: [{ ...newEmployee(42), id: "new-person", registration: "0002", name: "Synthetic imported", sector: "Store", role: "Clerk", scheduleMode: "MISSING" }], shifts: [], issues: [], totalRows: 1 } }); }
function absenceReply() { return Response.json({ preview: { assignments: [{ employeeId: "existing", date: "2026-12-01", kind: "ABSENCE" }], issues: [], counts: { employees: 1, days: 1, matchedRows: 1, unmatchedRows: 0, outsidePeriodRows: 0 } } }); }
function apply() { return nodes().find(node => node.type === AbsenceImportReview)?.props.onApply; }

beforeEach(() => {
  hooks.slots = []; hooks.deps = []; hooks.cursor = 0; hooks.changed = false; hooks.effects = []; hooks.cleanup = [];
  vi.useFakeTimers(); vi.stubGlobal("window", new EventTarget());
  const input = newInput("06", "Synthetic", "2026-12", 42);
  input.employees = [{ ...newEmployee(42), id: "existing", registration: "0001", name: "Synthetic existing", sector: "Store", role: "Clerk", scheduleMode: "MISSING" }];
  props = { input, disabled: false, onChange: vi.fn() }; component = ImportEmployees; render();
});
afterEach(() => { for (const cleanup of hooks.cleanup) cleanup?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("employee import lifecycle", () => {
  it("[regression] aborts an old scenario and never revives it after switching away and back", async () => {
    const old = deferred<Response>(), recent = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(recent.promise); vi.stubGlobal("fetch", fetcher);
    await select(); button("Conferir arquivo").onClick?.(); await settle();
    const original = props.input;
    props = { ...props, input: { ...original, branchCode: "07" } }; render(); await settle();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    props = { ...props, input: original }; render(); await settle();
    button("Conferir arquivo").onClick?.(); await settle();
    old.resolve(teamReply()); await settle();
    expect(text(tree)).not.toContain("Prévia: 1");
    expect(button("Conferindo arquivo…").disabled).toBe(true);
    recent.resolve(teamReply()); await settle();
    button("Aplicar registros aceitos à proposta").onClick?.(); await settle();
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onChange).mock.calls[0][0].branchCode).toBe("06");
  });
  it("[regression] handles an empty unauthorized response before parsing JSON", async () => {
    const unlock = vi.fn(); window.addEventListener("escalas:unlock-required", unlock);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await select(); button("Conferir arquivo").onClick?.(); await settle();
    expect(unlock).toHaveBeenCalledTimes(1); expect(text(tree)).not.toContain("Prévia:"); expect(props.onChange).not.toHaveBeenCalled();
  });
  it("[regression] rejects invalid files locally without a network request", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    for (const file of [new File([], "empty.csv"), new File(["x"], "file.exe"), new File([new Uint8Array(512 * 1024 + 1)], "large.xlsx")]) {
      await select(file); button("Conferir arquivo").onClick?.(); await settle();
      expect(text(tree)).toContain("até 512 KB");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("[regression] prevents a stale apply callback from changing a locked or different context", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => teamReply()));
    await select(); button("Conferir arquivo").onClick?.(); await settle();
    const oldApply = button("Aplicar registros aceitos à proposta").onClick;
    props = { ...props, disabled: true }; render(); await settle(); oldApply?.(); await settle();
    expect(props.onChange).not.toHaveBeenCalled();
    props = { ...props, disabled: false }; render(); await settle(); oldApply?.(); await settle();
    expect(props.onChange).not.toHaveBeenCalled(); expect(text(tree)).not.toContain("Prévia:");
  });
  it("[regression] invalidates a ready preview when team or end date changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => teamReply()));
    await select(); button("Conferir arquivo").onClick?.(); await settle();
    props = { ...props, input: { ...props.input, endDate: "2027-01-09" } }; render(); await settle();
    expect(text(tree)).not.toContain("Prévia:");
    button("Conferir arquivo").onClick?.(); await settle();
    props = { ...props, input: { ...props.input, employees: props.input.employees.map(person => ({ ...person, name: "Updated independently" })) } }; render(); await settle();
    expect(text(tree)).not.toContain("Prévia:");
  });
  it("[regression] aborts pending work and clears its timer on unmount", async () => {
    const response = deferred<Response>(); const fetcher = vi.fn().mockReturnValue(response.promise); vi.stubGlobal("fetch", fetcher);
    await select(); button("Conferir arquivo").onClick?.(); await settle();
    for (const cleanup of hooks.cleanup) cleanup?.(); hooks.cleanup = [];
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    response.resolve(teamReply()); await settle(); expect(props.onChange).not.toHaveBeenCalled();
  });
  it("[regression] applies against latest protected assignments rather than an old input snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => teamReply()));
    await select(); button("Conferir arquivo").onClick?.(); await settle();
    const oldApply = button("Aplicar registros aceitos à proposta").onClick;
    props = { ...props, input: { ...props.input, assignments: [{ employeeId: "existing", date: "2026-12-01", kind: "OFF", locked: true }] } }; render(); await settle();
    oldApply?.(); await settle();
    expect(props.onChange).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onChange).mock.calls[0][0].assignments).toEqual(props.input.assignments);
  });
  it("allows a retry after a timeout and does not apply the failed request", async () => {
    const fetcher = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })); vi.stubGlobal("fetch", fetcher);
    await select(); button("Conferir arquivo").onClick?.(); await settle(); await vi.advanceTimersByTimeAsync(60_000); await settle();
    expect(text(tree)).toContain("demorou além do esperado"); expect(button("Conferir arquivo").disabled).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => teamReply())); button("Conferir arquivo").onClick?.(); await settle();
    expect(text(tree)).toContain("Prévia: 1"); expect(props.onChange).not.toHaveBeenCalled();
  });
  it("ignores a stale unauthorized reply instead of locking a newer request", async () => {
    const response = deferred<Response>(), unlock = vi.fn(); window.addEventListener("escalas:unlock-required", unlock);
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(response.promise)); await select(); button("Conferir arquivo").onClick?.(); await settle();
    props = { ...props, input: { ...props.input, branchCode: "07" } }; render(); await settle();
    response.resolve(new Response(null, { status: 401 })); await settle(); expect(unlock).not.toHaveBeenCalled();
  });
  it("does not expose a malformed successful response for application", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ preview: {} })));
    await select(); button("Conferir arquivo").onClick?.(); await settle();
    expect(text(tree)).not.toContain("Prévia:"); expect(text(tree)).toContain("prévia de equipe válida"); expect(props.onChange).not.toHaveBeenCalled();
  });
});

describe("absence import recovery", () => {
  beforeEach(() => { hooks.slots = []; hooks.deps = []; hooks.effects = []; hooks.cleanup = []; component = AbsenceImport; render(); });
  it("[regression] handles an empty unauthorized response without parsing it first", async () => {
    const unlock = vi.fn(); window.addEventListener("escalas:unlock-required", unlock);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await select(); button("Conferir afastamentos").onClick?.(); await settle(); expect(unlock).toHaveBeenCalledTimes(1);
  });
  it("[regression] clears a completed preview on lock, and cannot revive it on unlock", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => absenceReply()));
    await select(); button("Conferir afastamentos").onClick?.(); await settle(); expect(apply()).toBeDefined();
    props = { ...props, disabled: true }; render(); await settle();
    props = { ...props, disabled: false }; render(); await settle();
    expect(apply()).toBeUndefined(); expect(props.onChange).not.toHaveBeenCalled();
  });
  it("preserves a newly locked date when applying a compatible preview", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => absenceReply()));
    await select(); button("Conferir afastamentos").onClick?.(); await settle();
    props = { ...props, input: { ...props.input, assignments: [{ employeeId: "existing", date: "2026-12-01", kind: "OFF", locked: true }] } }; render(); await settle();
    apply()?.(); await settle(); expect(props.onChange).not.toHaveBeenCalled(); expect(text(tree)).toContain("dias bloqueados foram preservados");
  });
});
