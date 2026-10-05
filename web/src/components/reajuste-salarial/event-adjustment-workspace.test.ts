import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventAdjustmentReport } from "@/lib/reajuste-salarial/event-adjustment-types";
import { displayedEventDifference, filterEventEmployees, initialEventSettings, validateEventInputs } from "./event-adjustment-workspace-model";

const runtime = vi.hoisted(() => {
  const slots: unknown[] = []; let cursor = 0; let effects: Array<() => void> = [];
  return {
    begin() { cursor = 0; }, reset() { slots.length = 0; cursor = 0; effects = []; },
    flush() { const pending = effects; effects = []; for (const effect of pending) effect(); },
    useState<T>(initial: T) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index] as T, (value: T | ((current: T) => T)) => { slots[index] = typeof value === "function" ? (value as (current: T) => T)(slots[index] as T) : value; }] as const; },
    useRef<T>(initial: T) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] as { current: T }; },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index] as { deps: unknown[]; cleanup?: () => void } | undefined;
      if (previous && deps.length === previous.deps.length && deps.every((value, position) => Object.is(value, previous.deps[position]))) return;
      slots[index] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
    },
  };
});
vi.mock("react", () => runtime);
import { useEventAdjustmentWorkspaceController } from "./event-adjustment-workspace";
const fetchMock = vi.fn<typeof fetch>();
const file = new File(["spreadsheet"], "06-2026.xlsx");
const report = { issueCount: 0, employees: [] } as unknown as EventAdjustmentReport;
let files: File[] = [file];
function EventWorkspace(active = true) {
  runtime.begin(); useEventAdjustmentWorkspaceController(active, files); runtime.flush();
  runtime.begin(); return useEventAdjustmentWorkspaceController(active, files);
}
const render = EventWorkspace;
beforeEach(() => { runtime.reset(); files = [file]; vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("event adjustment configuration and cancellation", () => {
  it("uses the parent files and removes historical exceptions for removed months", () => {
    render().updateOverride("06-2026", "sundayOldValue", "75,00");
    files = [new File(["spreadsheet"], "07-2026.xlsx")];
    expect(render()).toMatchObject({ files, overrides: [], report: null, status: "idle" });
  });
  it("does not analyze when the optional section is inactive", async () => {
    await render(false).analyze();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects invalid historical values before submitting the shared files", async () => {
    render().updateSetting("sundayOldValue", "0");
    await render().analyze();
    expect(render().status).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sums only the displayed competency while retaining the complete report total", () => {
    const employee = {
      totalDifferenceCents: "4500",
      months: [
        { competency: { key: "06-2026" }, bonus565: { differenceCents: "1000" }, indemnity901: { differenceCents: "500" } },
        { competency: { key: "07-2026" }, bonus565: { differenceCents: "1000" }, indemnity901: { differenceCents: "2000" } },
      ],
    } as unknown as EventAdjustmentReport["employees"][number];
    expect(displayedEventDifference(employee, "06-2026")).toBe("1500");
    expect(displayedEventDifference(employee, "07-2026")).toBe("3000");
    expect(displayedEventDifference(employee, "")).toBe("4500");
    expect(displayedEventDifference(employee, "08-2026")).toBe("0");
    expect(employee.totalDifferenceCents).toBe("4500");
  });
  it("permits analysis with blank new values and validates historical values", () => {
    expect(validateEventInputs([file], initialEventSettings, [])).toEqual([]);
    expect(validateEventInputs([file], { ...initialEventSettings, sundayOldValue: "0" }, [])).toHaveLength(1);
    expect(validateEventInputs([file], initialEventSettings, [{ competencyKey: "06-2026", bonusOldValue: "", sundayOldValue: "85.50" }])).toHaveLength(1);
  });
  it("invalidates pending analysis when a configured value changes", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = render().analyze();
    const signal = fetchMock.mock.calls[0][1]?.signal;
    render().updateSetting("bonusNewValue", "90,00");
    resolve(Response.json({ report })); await pending;
    expect(signal?.aborted).toBe(true);
    expect(render()).toMatchObject({ report: null, status: "idle", settings: { bonusNewValue: "90,00" } });
  });
  it("reset clears values and exceptions and rejects a late analysis", async () => {
    render().updateSetting("bonusNewValue", "90,00");
    render().updateOverride("06-2026", "sundayOldValue", "85,00");
    fetchMock.mockResolvedValueOnce(Response.json({ report })); await render().analyze();
    expect(render().canGenerate).toBe(true);
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = render().analyze(); const signal = fetchMock.mock.calls[1][1]?.signal;
    render().reset(); resolve(Response.json({ report })); await pending;
    expect(signal?.aborted).toBe(true);
    expect(render()).toMatchObject({ files: [file], overrides: [], settings: initialEventSettings, report: null, status: "idle", canGenerate: false });
  });
  it("sends historical overrides with the unchanged general value as fallback", async () => {
    render().updateOverride("06-2026", "sundayOldValue", "75,00");
    fetchMock.mockResolvedValueOnce(Response.json({ report })); await render().analyze();
    const data = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(data.get("excludeAbsentLatest")).toBe("false");
    expect(JSON.parse(data.get("historicOverrides") as string)).toEqual([{ competencyKey: "06-2026", bonusOldValue: "80,00", sundayOldValue: "75,00" }]);
    expect(render().canGenerate).toBe(false);
  });
  it("ignores an error body that finishes after the files changed", async () => {
    let resolve!: (body: unknown) => void;
    const response = new Response("error", { status: 422 });
    vi.spyOn(response, "json").mockReturnValue(new Promise(done => { resolve = done; }));
    fetchMock.mockResolvedValueOnce(response);
    const pending = render().analyze();
    await Promise.resolve();
    files = []; render();
    resolve({ error: { message: "Erro de uma base removida" } }); await pending;
    expect(render()).toMatchObject({ files: [], report: null, messages: [], status: "idle" });
  });
  it("shows structured API errors and connection failures without a valid preview", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: "Base inválida", details: [{ message: "Competência duplicada" }] } }, { status: 422 }));
    await render().analyze();
    expect(render()).toMatchObject({ report: null, status: "error", messages: ["Base inválida", "Competência duplicada"], canGenerate: false });
    fetchMock.mockRejectedValueOnce(new Error("network"));
    await render().analyze();
    expect(render().messages).toEqual(["Falha de conexão. Tente novamente."]);
  });
  it("does not treat missing payroll membership as a missing event", () => {
    const result = { received: false, issue: null };
    const base = { registration: "1", employeeName: "Ana", branchAlias: "Filial A", months: [{ competency: { key: "06-2026" }, inPayroll: false, bonus565: result, indemnity901: result }] };
    const filteredReport = { employees: [base, { ...base, registration: "2", months: [{ ...base.months[0], inPayroll: true }] }] } as unknown as EventAdjustmentReport;
    expect(filterEventEmployees(filteredReport, { search: "filial a", competency: "06-2026", event: "bonus-missing" }).map(item => item.registration)).toEqual(["2"]);
  });
});
