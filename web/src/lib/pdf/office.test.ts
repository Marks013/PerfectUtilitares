import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  readFile: mocks.readFile,
  readdir: mocks.readdir,
  rm: mocks.rm,
}));
vi.mock("pdf-lib", () => ({
  PDFDocument: { load: mocks.load },
}));
vi.mock("@/lib/pdf/storage", () => ({
  resolvePdfStorageKey: (key: string) => `/storage/${key}`,
}));

import { convertOfficeToPdf, PdfOfficeError } from "./office";

function childProcess(event: "exit" | "error", value: unknown) {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stderr: EventEmitter;
  };
  child.kill = vi.fn();
  child.stderr = new EventEmitter();
  queueMicrotask(() => child.emit(event, value));
  return child;
}

describe("office-to-PDF conversion boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(Buffer.from("%PDF-test"));
    mocks.readdir.mockResolvedValue(["converted.pdf"]);
    mocks.load.mockResolvedValue({ getPageCount: () => 1 });
    mocks.spawn.mockImplementation(() => childProcess("exit", 0));
  });

  it("runs LibreOffice with an isolated profile and validates the PDF", async () => {
    const result = await convertOfficeToPdf({
      jobId: "job-1",
      storageKey: "job-1/input/document.docx",
    });

    expect(Buffer.from(result).toString()).toBe("%PDF-test");
    expect(mocks.spawn).toHaveBeenCalledWith(
      "soffice",
      expect.arrayContaining([
        "--headless",
        "--convert-to",
        "pdf",
        "/storage/job-1/input/document.docx",
      ]),
      expect.objectContaining({
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
      }),
    );
    expect(mocks.rm).toHaveBeenCalledWith(
      expect.stringContaining("/storage/job-1/work/"),
      { force: true, recursive: true },
    );
  });

  it("rejects a successful command that produced no PDF", async () => {
    mocks.readdir.mockResolvedValueOnce(["readme.txt"]);

    await expect(
      convertOfficeToPdf({
        jobId: "job-1",
        storageKey: "job-1/input/document.docx",
      }),
    ).rejects.toMatchObject({ code: "OFFICE_OUTPUT_MISSING" });
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it("rejects an invalid or empty converted PDF", async () => {
    mocks.load.mockRejectedValueOnce(new Error("invalid PDF"));

    await expect(
      convertOfficeToPdf({
        jobId: "job-1",
        storageKey: "job-1/input/document.docx",
      }),
    ).rejects.toMatchObject({
      code: "OFFICE_OUTPUT_INVALID",
      cause: expect.any(Error),
    });
  });

  it("maps missing LibreOffice and non-zero exits to stable errors", async () => {
    mocks.spawn.mockImplementationOnce(() =>
      childProcess("error", Object.assign(new Error("missing"), { code: "ENOENT" })),
    );
    await expect(
      convertOfficeToPdf({
        jobId: "job-1",
        storageKey: "job-1/input/document.docx",
      }),
    ).rejects.toMatchObject({ code: "OFFICE_TOOL_UNAVAILABLE" });

    mocks.spawn.mockImplementationOnce(() => {
      const child = childProcess("exit", 1);
      child.stderr.emit("data", Buffer.from("conversion failed"));
      return child;
    });
    await expect(
      convertOfficeToPdf({
        jobId: "job-2",
        storageKey: "job-2/input/document.docx",
      }),
    ).rejects.toBeInstanceOf(PdfOfficeError);
  });
});
