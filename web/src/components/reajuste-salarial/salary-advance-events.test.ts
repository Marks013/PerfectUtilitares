import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventAdjustmentReport } from "@/lib/reajuste-salarial/event-adjustment-types";

const runtime = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  let effects: Array<() => void> = [];
  return {
    begin() { cursor = 0; },
    reset() { slots.length = 0; cursor = 0; effects = []; },
    flush() { const pending = effects; effects = []; for (const effect of pending) effect(); },
    useState<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index] as T, (value: T | ((current: T) => T)) => { slots[index] = typeof value === "function" ? (value as (current: T) => T)(slots[index] as T) : value; }] as const;
    },
    useRef<T>(initial: T) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index] as { current: T }; },
    useMemo<T>(calculate: () => T) { return calculate(); },
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
vi.mock("./reajuste-salarial-workspace-view", () => ({ ReajusteSalarialWorkspaceView: vi.fn() }));
vi.mock("./download", () => ({ downloadBlob: vi.fn() }));
import { useSalaryAdvanceWorkspaceController } from "./reajuste-salarial-workspace";
import { downloadBlob } from "./download";

class FakeRequest extends EventTarget {
  static latest: FakeRequest;
  upload = new EventTarget();
  status = 200;
  response = new Blob(["PDF"]);
  responseType = "";
  data = new FormData();
  abort = vi.fn(() => this.dispatchEvent(new Event("abort")));
  constructor() { super(); FakeRequest.latest = this; }
  open() {}
  send(data: FormData) { this.data = data; }
  getResponseHeader(name: string) { return name === "content-type" ? "application/pdf" : null; }
}
const fetchMock = vi.fn<typeof fetch>();
const file = new File(["spreadsheet"], "06-2026.xlsx");
const report = { issueCount: 0, employees: [] } as unknown as EventAdjustmentReport;
function AdvanceWorkspace(active = true) {
  runtime.begin(); useSalaryAdvanceWorkspaceController(active); runtime.flush();
  runtime.begin(); return useSalaryAdvanceWorkspaceController(active);
}
const render = AdvanceWorkspace;
beforeEach(() => { runtime.reset(); vi.clearAllMocks(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("XMLHttpRequest", FakeRequest); });
afterEach(() => vi.unstubAllGlobals());
function configure() {
  render().mergeIncoming([file]); render().setPercentage("5"); render().setIncludeEvents(true);
  render().eventModel.updateSetting("bonusNewValue", "90,00");
}
async function analyze() { fetchMock.mockResolvedValueOnce(Response.json({ report })); await render().eventModel.analyze(); }

describe("optional salary advance events", () => {
  it("disables PDF generation for an invalid role percentage while retaining a valid event preview", async () => {
    configure(); await analyze();
    expect(render().canGenerate).toBe(true);
    render().setPackerPercentage("2.26555");
    expect(render().canGenerate).toBe(false);
    expect(render().eventModel.report).toEqual(report);
    render().setPackerPercentage("3,1234");
    expect(render().canGenerate).toBe(true);
  });
  it("sends the role percentage while optional events are off", () => {
    render().mergeIncoming([file]); render().setPercentage("5");
    expect(render().includeEvents).toBe(false);
    render().generate();
    expect([...FakeRequest.latest.data.keys()]).toEqual(["files", "percentage", "packerPercentage"]);
    expect(FakeRequest.latest.data.get("packerPercentage")).toBe("2.2655");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requires a current event preview and sends settings with the same files once", async () => {
    configure();
    expect(render().canGenerate).toBe(false);
    render().generate(); expect(render().state.status).toBe("error");
    render().eventModel.updateOverride("06-2026", "sundayOldValue", "75,00");
    await analyze();
    expect(render().canGenerate).toBe(true);
    render().generate();
    const data = FakeRequest.latest.data;
    expect(data.get("includeEvents")).toBe("true");
    expect(data.getAll("files")).toHaveLength(1);
    expect(data.get("bonusNewValue")).toBe("90,00");
    expect(data.get("packerPercentage")).toBe("2.2655");
    expect(JSON.parse(data.get("historicOverrides") as string)).toEqual([{ competencyKey: "06-2026", bonusOldValue: "80,00", sundayOldValue: "75,00" }]);
  });
  it("aborts pending event analysis when external bases change and ignores its late result", async () => {
    configure(); let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = render().eventModel.analyze(); const signal = fetchMock.mock.calls[0][1]?.signal;
    render().removeFile(`${file.name}:${file.size}:${file.lastModified}`); render();
    resolve(Response.json({ report })); await pending;
    expect(signal?.aborted).toBe(true); expect(render().eventModel.report).toBeNull(); expect(render().canGenerate).toBe(false);
  });
  it("aborts the combined PDF when the option is turned off or the tab changes", async () => {
    configure(); await analyze(); render().generate(); const first = FakeRequest.latest;
    render().setIncludeEvents(false); render(); first.dispatchEvent(new Event("load"));
    expect(first.abort).toHaveBeenCalledOnce(); expect(downloadBlob).not.toHaveBeenCalled();
    render().generate(); const second = FakeRequest.latest; render(false); second.dispatchEvent(new Event("load"));
    expect(second.abort).toHaveBeenCalledOnce(); expect(downloadBlob).not.toHaveBeenCalled();
  });
  it("preserves the entire previous selection when more than four files are requested", () => {
    const files = ["06", "07", "08", "09"].map(month => new File(["x"], `${month}-2026.xlsx`));
    render().mergeIncoming(files); render().mergeIncoming([new File(["x"], "10-2026.xlsx")]);
    expect(render().files).toEqual(files); expect(render().fileSelectionError).toContain("limite é de 4 bases");
  });
  it("keeps the shared files and pending analysis when an excessive selection is rejected", async () => {
    const files = ["06", "07", "08", "09"].map(month => new File(["x"], `${month}-2026.xlsx`));
    render().mergeIncoming(files); render().setIncludeEvents(true);
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const pending = render().eventModel.analyze();
    const signal = fetchMock.mock.calls[0][1]?.signal;
    render().mergeIncoming([new File(["x"], "10-2026.xlsx")]);
    expect(render().files).toEqual(files);
    expect(render().eventModel.busy).toBe(true);
    expect(signal?.aborted).toBe(false);
    resolve(Response.json({ report })); await pending;
    expect(render().eventModel.report).toEqual(report);
  });
  it("aborts a pending PDF when the role percentage changes and rejects its late download", () => {
    render().mergeIncoming([file]); render().setPercentage("1,08"); render().generate();
    const request = FakeRequest.latest;
    render().setPackerPercentage("3,1234"); render(); request.dispatchEvent(new Event("load"));
    expect(request.abort).toHaveBeenCalledOnce(); expect(downloadBlob).not.toHaveBeenCalled();
    render().generate(); expect(FakeRequest.latest.data.get("packerPercentage")).toBe("3,1234");
  });
  it("requires a valid role percentage even when optional events are off", () => {
    render().mergeIncoming([file]); render().setPercentage("1,08"); render().setPackerPercentage("2,26555");
    expect(render().canGenerate).toBe(false);
    render().generate();
    expect(render().state).toMatchObject({ status: "error", messages: ["Informe o percentual para Embalador a mão entre 0,0001 e 100, com até quatro casas."] });
  });
  it("clears the optional configuration and rejects late downloads after reset", async () => {
    configure(); await analyze(); render().generate(); const request = FakeRequest.latest;
    render().reset(); render(); request.dispatchEvent(new Event("load"));
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(render()).toMatchObject({ files: [], percentage: "", packerPercentage: "2.2655", includeEvents: false, state: { status: "idle" }, eventModel: { report: null, overrides: [], settings: { bonusNewValue: "" } } });
  });
  it("releases shared files and invalidates the preview after a successful combined PDF", async () => {
    configure(); await analyze(); render().generate(); FakeRequest.latest.dispatchEvent(new Event("load"));
    expect(downloadBlob).toHaveBeenCalledOnce();
    expect(render().files).toEqual([]); expect(render().eventModel.report).toBeNull();
  });
});
