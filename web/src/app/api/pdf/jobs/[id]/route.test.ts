import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  acquireJobLock: vi.fn(),
  deleteMany: vi.fn(),
  findFirst: vi.fn(),
  getOwner: vi.fn(),
  readJsonBody: vi.fn(),
  removeJobFiles: vi.fn(),
  safeParse: vi.fn(),
  serializeJob: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.captureException,
}));

vi.mock("@/lib/api/security", () => ({
  enforceSharedRateLimit: vi.fn().mockResolvedValue(null),
  jsonError: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  methodNotAllowed: vi.fn(),
  readJsonBody: mocks.readJsonBody,
  requireContentType: vi.fn(),
  requireMaxContentLength: vi.fn(),
  requireSameOrigin: vi.fn().mockReturnValue(null),
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

vi.mock("@/lib/pdf/schema", () => ({
  pdfJobUpdateSchema: { safeParse: mocks.safeParse },
}));

vi.mock("@/lib/pdf/serialization", () => ({
  serializePdfJob: mocks.serializeJob,
}));

vi.mock("@/lib/pdf/storage", () => ({
  removePdfJobFiles: mocks.removeJobFiles,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    pdfJob: {
      deleteMany: mocks.deleteMany,
      findFirst: mocks.findFirst,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/users/schema", () => ({
  zodIssueDetails: vi.fn(),
}));

import { DELETE, PATCH } from "@/app/api/pdf/jobs/[id]/route";

const context = { params: Promise.resolve({ id: "job-12345678" }) };

describe("DELETE /api/pdf/jobs/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwner.mockResolvedValue({ session: null });
    mocks.findFirst.mockResolvedValue({ id: "job-12345678", status: "DRAFT" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.removeJobFiles.mockResolvedValue(undefined);
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation((callback) =>
      callback({
        pdfJob: {
          findFirst: mocks.findFirst,
          update: mocks.update,
          updateMany: mocks.updateMany,
        },
      }),
    );
  });

  it("expires the job, removes files, and then deletes its metadata", async () => {
    const response = await DELETE(
      new Request("https://example.com/api/pdf/jobs/job-12345678", {
        method: "DELETE",
      }),
      context,
    );

    expect(response.status).toBe(204);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: "job-12345678",
        status: { not: "RUNNING" },
        ownerSessionHash: "owner-hash",
      },
      data: {
        completedAt: expect.any(Date),
        status: "EXPIRED",
      },
    });
    expect(mocks.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.removeJobFiles.mock.invocationCallOrder[0]!,
    );
    expect(mocks.removeJobFiles.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteMany.mock.invocationCallOrder[0]!,
    );
  });

  it("preserves expired metadata when filesystem cleanup fails", async () => {
    mocks.removeJobFiles.mockRejectedValueOnce(new Error("disk unavailable"));

    const response = await DELETE(
      new Request("https://example.com/api/pdf/jobs/job-12345678", {
        method: "DELETE",
      }),
      context,
    );

    expect(response.status).toBe(503);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledOnce();
  });

  it("does not remove files if the job starts running during deletion", async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await DELETE(
      new Request("https://example.com/api/pdf/jobs/job-12345678", {
        method: "DELETE",
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.removeJobFiles).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/pdf/jobs/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwner.mockResolvedValue({ session: null });
    mocks.readJsonBody.mockResolvedValue({ ok: true, data: {} });
    mocks.safeParse.mockReturnValue({
      success: true,
      data: {
        annotations: [],
        manifest: {
          pages: [
            {
              artifactId: "artifact-1",
              id: "page-1",
              rotation: 0,
              sourcePage: 1,
            },
          ],
          version: 1,
        },
      },
    });
    mocks.findFirst.mockResolvedValue({
      artifacts: [{ id: "artifact-1" }],
      id: "job-12345678",
      status: "DRAFT",
    });
    mocks.update.mockResolvedValue({ id: "job-12345678" });
    mocks.serializeJob.mockReturnValue({ id: "job-12345678" });
    mocks.transaction.mockImplementation((callback) =>
      callback({
        pdfJob: {
          findFirst: mocks.findFirst,
          update: mocks.update,
          updateMany: mocks.updateMany,
        },
      }),
    );
  });

  it("locks the job and updates a manifest only while it is DRAFT", async () => {
    const response = await PATCH(
      new Request("https://example.com/api/pdf/jobs/job-12345678", {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.acquireJobLock).toHaveBeenCalledWith(
      expect.any(Object),
      "job-12345678",
    );
    expect(mocks.update).toHaveBeenCalledOnce();
  });

  it("rejects a manifest when queueing won the job lock", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      artifacts: [{ id: "artifact-1" }],
      id: "job-12345678",
      status: "QUEUED",
    });

    const response = await PATCH(
      new Request("https://example.com/api/pdf/jobs/job-12345678", {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
