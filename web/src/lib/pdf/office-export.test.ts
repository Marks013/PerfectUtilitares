import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), mkdir: vi.fn(), rm: vi.fn(), stat: vi.fn(), readFile: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({ mkdir: mocks.mkdir, rm: mocks.rm, stat: mocks.stat, readFile: mocks.readFile }));
vi.mock("@/lib/pdf/storage", () => ({ resolvePdfStorageKey: (key: string) => `/storage/${key}` }));
import { convertPdfToOffice } from "./office-export";

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    pid: 98765,
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    kill: vi.fn(),
  });
  return child;
}
const input = { jobId: "job-1", storageKey: "job-1/input/source.pdf", extension: "docx" as const };

describe("PDF-to-Office subprocess boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.stat.mockResolvedValue({ size: 4 });
    mocks.readFile.mockResolvedValue(Buffer.from("PKok"));
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("runs the configured isolated runtime, parses fragmented progress and removes scratch output", async () => {
    vi.stubEnv("PDF_OFFICE_PYTHON", "/runtime/python3");
    vi.stubEnv("PDF_OFFICE_SCRIPT", "/runtime/export.py");
    const child = childProcess();
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.emit("data", 'ignored PDF content\n{"progress":');
        child.stdout.emit("data", '35}\n{"progress":999}\n');
        child.emit("close", 0);
      });
      return child;
    });
    const progress = vi.fn().mockResolvedValue(undefined);
    expect(await convertPdfToOffice({ ...input, onProgress: progress })).toEqual(new Uint8Array(Buffer.from("PKok")));
    expect(progress.mock.calls).toEqual([[35], [95]]);
    expect(mocks.spawn).toHaveBeenCalledWith("/runtime/python3", ["/runtime/export.py", "/storage/job-1/input/source.pdf", expect.stringMatching(/converted\.docx$/), "docx"], expect.objectContaining({
      shell: false, stdio: ["ignore", "pipe", "ignore"],
      env: expect.objectContaining({ OMP_THREAD_LIMIT: "1", PYTHONDONTWRITEBYTECODE: "1", TMPDIR: expect.stringContaining("/storage/job-1/work/"), XDG_CACHE_HOME: expect.stringMatching(/\/work\/[^/]+\/cache$/) }),
    }));
    expect(mocks.rm).toHaveBeenCalledOnce();
    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining("/storage/job-1/work/"), { recursive: true, force: true });
  });

  it("reports unreadable OCR text with a safe actionable error", async () => {
    const child = childProcess();
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"error":"PDF_OFFICE_OCR_NO_TEXT","detail":"confidential document text"}\n');
        child.emit("close", 1);
      });
      return child;
    });
    await expect(convertPdfToOffice(input)).rejects.toMatchObject({ code: "PDF_OFFICE_OCR_NO_TEXT", message: expect.stringContaining("nitidez") });
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it("does not expose unknown protocol errors or raw document output", async () => {
    const child = childProcess();
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.emit("data", '{"error":"secret personal content"}\n');
        child.emit("close", 2);
      });
      return child;
    });
    await expect(convertPdfToOffice(input)).rejects.toMatchObject({ code: "PDF_OFFICE_CONVERSION_FAILED", message: expect.not.stringContaining("secret") });
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it("maps spawn failure and removes its isolated work directory", async () => {
    const child = childProcess();
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit("error", new Error("ENOENT /private/path")));
      return child;
    });
    await expect(convertPdfToOffice(input)).rejects.toMatchObject({ code: "OFFICE_TOOL_UNAVAILABLE", message: expect.not.stringContaining("/private/") });
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it("kills the complete OCR process group and waits for close before cleanup", async () => {
    vi.useFakeTimers();
    const child = childProcess();
    mocks.spawn.mockReturnValue(child);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const pending = convertPdfToOffice({ ...input, timeoutMs: 20 });
    const rejected = expect(pending).rejects.toMatchObject({ code: "OFFICE_CONVERSION_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(25);
    if (process.platform === "win32") expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    else expect(kill).toHaveBeenCalledWith(-98765, "SIGKILL");
    expect(mocks.rm).not.toHaveBeenCalled();
    child.emit("close", null);
    await rejected;
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it.each([0, 100 * 1024 * 1024 + 1])("rejects an invalid output size of %s bytes", async (size) => {
    mocks.stat.mockResolvedValue({ size });
    const child = childProcess();
    mocks.spawn.mockImplementation(() => { queueMicrotask(() => child.emit("close", 0)); return child; });
    await expect(convertPdfToOffice(input)).rejects.toMatchObject({ code: "PDF_OFFICE_OUTPUT_TOO_LARGE" });
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it("terminates OCR descendants after an internal failure before cleaning scratch files", async () => {
    const child = childProcess();
    mocks.spawn.mockReturnValue(child);
    const kill = vi.spyOn(process, "kill").mockReturnValue(true);
    const pending = convertPdfToOffice(input);
    const rejected = expect(pending).rejects.toMatchObject({ code: "PDF_OFFICE_OCR_FAILED" });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    child.stdout.emit("data", '{"error":"PDF_OFFICE_OCR_FAILED"}\n');
    child.emit("exit", 1);
    if (process.platform === "win32") expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    else expect(kill).toHaveBeenCalledWith(-98765, "SIGKILL");
    expect(mocks.rm).not.toHaveBeenCalled();
    child.emit("close", 1);
    await rejected;
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it("does not fail a valid document because a progress notification failed", async () => {
    const child = childProcess();
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => { child.stdout.emit("data", '{"progress":50}\n'); child.emit("close", 0); });
      return child;
    });
    await expect(convertPdfToOffice({ ...input, onProgress: vi.fn().mockRejectedValue(new Error("progress unavailable")) })).resolves.toEqual(new Uint8Array(Buffer.from("PKok")));
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it("maps missing output without exposing internal filesystem paths", async () => {
    mocks.stat.mockRejectedValueOnce(new Error("ENOENT /private/work/converted.docx"));
    const child = childProcess();
    mocks.spawn.mockImplementation(() => { queueMicrotask(() => child.emit("close", 0)); return child; });
    await expect(convertPdfToOffice(input)).rejects.toMatchObject({ code: "OFFICE_OUTPUT_MISSING", message: expect.not.stringContaining("/private/") });
    expect(mocks.rm).toHaveBeenCalledOnce();
  });
});
