import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventAdjustmentReport } from "@/lib/reajuste-salarial/event-adjustment-types";
import { filterEventEmployees, initialEventSettings, validateEventInputs } from "./event-adjustment-workspace-model";

const runtime = vi.hoisted(() => {
  const slots: unknown[] = []; let cursor = 0;
  return {
    begin() { cursor = 0; }, reset() { slots.length = 0; cursor = 0; },
    useState<T>(initial: T) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index] as T, (value: T | ((current: T) => T)) => { slots[index] = typeof value === "function" ? (value as (current: T) => T)(slots[index] as T) : value; }] as const; },
    useRef<T>(initial: T) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] as { current: T }; },
    useEffect() {},
  };
});
vi.mock("react", () => runtime);
vi.mock("./download", () => ({ downloadBlob: vi.fn() }));
import { useEventAdjustmentWorkspaceController } from "./event-adjustment-workspace";
import { downloadBlob } from "./download";
const fetchMock = vi.fn<typeof fetch>();
const file = new File(["spreadsheet"], "06-2026.xlsx");
const report = { issueCount: 0, employees: [] } as unknown as EventAdjustmentReport;
function EventWorkspace() { runtime.begin(); return useEventAdjustmentWorkspaceController(true); }
const render = EventWorkspace;
beforeEach(() => { runtime.reset(); vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("event adjustment configuration and cancellation", () => {
  it("permits analysis with blank new values and validates historical values", () => {
    expect(validateEventInputs([file], initialEventSettings, [])).toEqual([]);
    expect(validateEventInputs([file], { ...initialEventSettings, sundayOldValue: "0" }, [])).toHaveLength(1);
    expect(validateEventInputs([file], initialEventSettings, [{ competencyKey: "06-2026", bonusOldValue: "", sundayOldValue: "85.50" }])).toHaveLength(1);
  });
  it("invalidates pending analysis when a configured value changes", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render().mergeIncoming([file]);
    const pending = render().analyze();
    const signal = fetchMock.mock.calls[0][1]?.signal;
    render().updateSetting("bonusNewValue", "90,00");
    resolve(Response.json({ report })); await pending;
    expect(signal?.aborted).toBe(true);
    expect(render()).toMatchObject({ report: null, status: "idle", settings: { bonusNewValue: "90,00" } });
  });
  it("reset clears values, files and exceptions and rejects a late PDF", async () => {
    render().mergeIncoming([file]); render().updateSetting("bonusNewValue", "90,00");
    render().updateOverride("06-2026", "sundayOldValue", "85,00");
    fetchMock.mockResolvedValueOnce(Response.json({ report })); await render().analyze();
    expect(render().canGenerate).toBe(true);
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = render().generate(); const signal = fetchMock.mock.calls[1][1]?.signal;
    render().reset(); resolve(new Response("PDF", { headers: { "content-type": "application/pdf" } })); await pending;
    expect(signal?.aborted).toBe(true); expect(downloadBlob).not.toHaveBeenCalled();
    expect(render()).toMatchObject({ files: [], overrides: [], settings: initialEventSettings, report: null, status: "idle", canGenerate: false });
  });
  it("sends historical overrides with the unchanged general value as fallback", async () => {
    render().mergeIncoming([file]); render().updateOverride("06-2026", "sundayOldValue", "75,00");
    fetchMock.mockResolvedValueOnce(Response.json({ report })); await render().analyze();
    const data = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(JSON.parse(data.get("historicOverrides") as string)).toEqual([{ competencyKey: "06-2026", bonusOldValue: "80,00", sundayOldValue: "75,00" }]);
    expect(render().canGenerate).toBe(false);
  });
  it("ignores an error body that finishes after the files changed", async () => {
    let resolve!: (body: unknown) => void;
    const response = new Response("error", { status: 422 });
    vi.spyOn(response, "json").mockReturnValue(new Promise(done => { resolve = done; }));
    fetchMock.mockResolvedValueOnce(response);
    render().mergeIncoming([file]); const pending = render().analyze();
    await Promise.resolve();
    render().removeFile(`${file.name}:${file.size}:${file.lastModified}`);
    resolve({ error: { message: "Erro de uma base removida" } }); await pending;
    expect(render()).toMatchObject({ files: [], report: null, messages: [], status: "idle" });
  });
  it("does not treat missing payroll membership as a missing event", () => {
    const result = { received: false, issue: null };
    const base = { registration: "1", employeeName: "Ana", branchAlias: "Filial A", months: [{ competency: { key: "06-2026" }, inPayroll: false, bonus565: result, indemnity901: result }] };
    const filteredReport = { employees: [base, { ...base, registration: "2", months: [{ ...base.months[0], inPayroll: true }] }] } as unknown as EventAdjustmentReport;
    expect(filterEventEmployees(filteredReport, { search: "filial a", competency: "06-2026", event: "bonus-missing" }).map(item => item.registration)).toEqual(["2"]);
  });
});
