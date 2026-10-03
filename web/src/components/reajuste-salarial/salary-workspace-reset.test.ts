import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const slots: unknown[] = [];
  let cursor = 0;
  return {
    begin() { cursor = 0; },
    reset() { slots.length = 0; cursor = 0; },
    useState<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index] as T, (value: T | ((current: T) => T)) => {
        slots[index] = typeof value === "function" ? (value as (current: T) => T)(slots[index] as T) : value;
      }] as const;
    },
    useRef<T>(initial: T) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index] as { current: T };
    },
    useMemo<T>(calculate: () => T) { return calculate(); },
    useEffect() {},
  };
});
vi.mock("react", () => runtime);
vi.mock("./reajuste-salarial-workspace-view", () => ({ ReajusteSalarialWorkspaceView: vi.fn() }));
vi.mock("./download", () => ({ downloadBlob: vi.fn() }));
import { downloadBlob } from "./download";
import { useSalaryAdvanceWorkspaceController } from "./reajuste-salarial-workspace";
import { useSalaryRevisionWorkspaceController } from "./salary-revision-workspace";

class FakeRequest extends EventTarget {
  static latest: FakeRequest;
  upload = new EventTarget();
  status = 200;
  response = new Blob(["PDF"]);
  responseType = "";
  contentType = "application/pdf";
  abort = vi.fn(() => this.dispatchEvent(new Event("abort")));
  constructor() { super(); FakeRequest.latest = this; }
  open() {}
  send() {}
  getResponseHeader(name: string) { return name === "content-type" ? this.contentType : null; }
}
const fetchMock = vi.fn<typeof fetch>();
const file = new File(["spreadsheet"], "06-2026.xlsx");
const analysis = {
  fileHash: "a".repeat(64), sourceFile: file.name, employeeCount: 1,
  branchCount: 1, distinctSalaryCount: 1, minimumSalaryCents: "100000",
  maximumSalaryCents: "100000", salaries: [], employees: [],
};
function AdvanceWorkspace() { runtime.begin(); return useSalaryAdvanceWorkspaceController(); }
function RevisionWorkspace() { runtime.begin(); return useSalaryRevisionWorkspaceController(); }
const renderAdvance = AdvanceWorkspace;
const renderRevision = RevisionWorkspace;
beforeEach(() => {
  runtime.reset(); vi.clearAllMocks(); fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
});
afterEach(() => vi.unstubAllGlobals());

describe("salary workspace reset", () => {
  it("aborts analysis, clears all choices and ignores a late successful response", async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderRevision().setFile(file);
    renderRevision().setPercentage("5");
    renderRevision().setSearch("employee");
    renderRevision().setAdjustmentScope("rules_only");
    renderRevision().addRule();
    const pending = renderRevision().analyze();
    const signal = fetchMock.mock.calls[0][1]?.signal;
    renderRevision().reset();
    resolve(Response.json({ analysis }));
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(renderRevision()).toMatchObject({
      file: null, analysis: null, percentage: "", search: "",
      adjustmentScope: "all", rules: [], busy: false, state: { status: "idle" },
    });
    renderRevision().setFile(file);
    expect(renderRevision().file).toBe(file);
  });

  it.each(["advance", "revision"] as const)("resets %s during PDF generation and ignores late events", async (mode) => {
    if (mode === "advance") {
      renderAdvance().mergeIncoming([file]);
      renderAdvance().setPercentage("5"); renderAdvance().setPackerPercentage("2,26550");
    } else {
      fetchMock.mockResolvedValueOnce(Response.json({ analysis }));
      renderRevision().setFile(file);
      await renderRevision().analyze();
      renderRevision().setPercentage("5");
    }
    const render = mode === "advance" ? renderAdvance : renderRevision;
    render().generate();
    const request = FakeRequest.latest;
    expect(render().busy).toBe(true);
    render().reset();
    expect(request.abort).toHaveBeenCalledOnce();
    request.upload.dispatchEvent(new Event("load"));
    request.dispatchEvent(new Event("load"));
    request.dispatchEvent(new Event("error"));
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(render()).toMatchObject({ percentage: "", busy: false, state: { status: "idle" } });
    if (mode === "advance") expect(renderAdvance().files).toEqual([]);
    else expect(renderRevision().file).toBeNull();
  });

  it("does not restore an error when reset happens while its body is being read", async () => {
    renderAdvance().mergeIncoming([file]);
    renderAdvance().setPercentage("5"); renderAdvance().setPackerPercentage("2,26550");
    renderAdvance().generate();
    const request = FakeRequest.latest;
    request.status = 500;
    request.contentType = "application/json";
    let resolve!: (body: string) => void;
    vi.spyOn(request.response, "text").mockReturnValue(new Promise((done) => { resolve = done; }));
    request.dispatchEvent(new Event("load"));
    renderAdvance().reset();
    resolve(JSON.stringify({ error: { message: "Old response" } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(renderAdvance().state).toEqual({ status: "idle", progress: 0 });
  });
});
