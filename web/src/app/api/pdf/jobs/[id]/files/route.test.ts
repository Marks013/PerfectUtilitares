import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquireJobLock: vi.fn(),
  findFirst: vi.fn(),
  getOwner: vi.fn(),
  removeStorageKey: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  writeUpload: vi.fn(),
}));

vi.mock("@/lib/api/security", () => ({
  enforceSharedRateLimit: vi.fn().mockResolvedValue(null),
  jsonError: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  methodNotAllowed: vi.fn(),
  requireContentType: vi.fn().mockReturnValue(null),
  requireMaxContentLength: vi.fn().mockReturnValue(null),
  requireSameOrigin: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/api/resource-capacity", () => ({
  requireResourceCapacity: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/pdf/access", () => ({
  getPdfOwnerContext: mocks.getOwner,
  pdfJobAccessWhere: vi
    .fn()
    .mockReturnValue({ ownerSessionHash: "owner-hash" }),
}));

vi.mock("@/lib/pdf/capacity", () => ({
  acquirePdfJobLock: mocks.acquireJobLock,
}));

vi.mock("@/lib/pdf/serialization", () => ({
  serializePdfJob: (job: unknown) => job,
}));

vi.mock("@/lib/pdf/storage", async () => {
  const { PdfStorageError, sanitizePdfFileName } = await import(
    "@/lib/pdf/storage-core"
  );
  return {
    PdfStorageError,
    removePdfStorageKey: mocks.removeStorageKey,
    sanitizePdfFileName,
    writePdfUpload: mocks.writeUpload,
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    pdfJob: { findFirst: mocks.findFirst },
  },
}));

vi.mock("@/lib/system/resource-capacity", () => ({
  getRequestContentLength: vi.fn().mockReturnValue(10),
}));

import { POST } from "@/app/api/pdf/jobs/[id]/files/route";

const context = { params: Promise.resolve({ id: "job-12345678" }) };
const request = (fileName = encodeURIComponent("input.pdf")) =>
  new Request("https://example.com/api/pdf/jobs/job-12345678/files", {
    body: new Uint8Array([1]),
    headers: {
      "Content-Type": "application/pdf",
      Origin: "https://example.com",
      "X-File-Name": fileName,
    },
    method: "POST",
  });

describe("POST /api/pdf/jobs/:id/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwner.mockResolvedValue({ session: null });
    mocks.removeStorageKey.mockResolvedValue(undefined);
    mocks.findFirst.mockResolvedValue({
      _count: { artifacts: 0 },
      id: "job-12345678",
      inputBytes: 5n,
      operation: "COMPRESS",
      status: "DRAFT",
    });
    mocks.writeUpload.mockResolvedValue({
      artifactId: "artifact-1",
      sha256: "digest",
      sizeBytes: 10n,
      storageKey: "job-12345678/input/artifact-1.pdf",
    });
    mocks.update.mockResolvedValue({ id: "job-12345678", artifacts: [] });
    mocks.transaction.mockImplementation((callback) =>
      callback({
        pdfJob: { findFirst: mocks.findFirst, update: mocks.update },
      }),
    );
  });

  it("serializes upload and commits bytes while the job remains DRAFT", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(201);
    expect(mocks.acquireJobLock).toHaveBeenCalledWith(
      expect.any(Object),
      "job-12345678",
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ inputBytes: 15n }),
      }),
    );
  });

  it("accepts a long filename and persists the shortened PDF name", async () => {
    const response = await POST(
      request(encodeURIComponent(`${"Débitos ".repeat(30)}.pdf`)),
      context,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ artifactId: "artifact-1" });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          artifacts: {
            create: expect.objectContaining({
              originalName: `${"Débitos ".repeat(30).slice(0, 176)}.pdf`,
            }),
          },
        }),
      }),
    );
  });

  it.each([
    ["", "O nome do arquivo enviado está vazio. Renomeie o PDF e tente novamente."],
    ["%ZZ.pdf", "O nome do arquivo enviado é inválido."],
  ])("returns a useful validation error for filename %s", async (fileName, message) => {
    const response = await POST(request(fileName), context);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_FILE_NAME", message },
    });
    expect(mocks.writeUpload).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("removes the staged upload when queueing wins the commit lock", async () => {
    mocks.findFirst
      .mockResolvedValueOnce({
        _count: { artifacts: 0 },
        id: "job-12345678",
        inputBytes: 5n,
        operation: "COMPRESS",
        status: "DRAFT",
      })
      .mockResolvedValueOnce({
        _count: { artifacts: 0 },
        id: "job-12345678",
        inputBytes: 5n,
        operation: "COMPRESS",
        status: "QUEUED",
      });

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    expect(mocks.writeUpload).toHaveBeenCalledOnce();
    expect(mocks.removeStorageKey).toHaveBeenCalledWith(
      "job-12345678/input/artifact-1.pdf",
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
