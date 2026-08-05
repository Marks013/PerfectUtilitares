import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  captureException: vi.fn(),
  enqueue: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  getOwner: vi.fn(),
  recordUsage: vi.fn(),
  reserve: vi.fn(),
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
  requireSameOrigin: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/api/resource-capacity", () => ({
  resourceCapacityErrorResponse: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/pdf/access", () => ({
  getPdfOwnerContext: mocks.getOwner,
  pdfJobAccessWhere: vi.fn().mockReturnValue({ userId: "user-1" }),
}));

vi.mock("@/lib/pdf/capacity", () => ({
  PdfPublicCapacityError: class PdfPublicCapacityError extends Error {},
  reservePdfJobForQueue: mocks.reserve,
}));

vi.mock("@/lib/pdf/queue", () => ({
  enqueuePdfJob: mocks.enqueue,
}));

vi.mock("@/lib/pdf/schema", () => ({
  jpgToPdfOptionsSchema: {
    safeParse: vi.fn().mockReturnValue({ success: true }),
  },
  pdfCompressionOptionsSchema: {
    safeParse: vi.fn().mockReturnValue({ success: true }),
  },
  pdfManifestSchema: { safeParse: vi.fn().mockReturnValue({ success: true }) },
}));

vi.mock("@/lib/pdf/serialization", () => ({
  serializePdfJob: (job: { inputBytes?: bigint }) => ({
    ...job,
    inputBytes: job.inputBytes?.toString(),
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: { create: mocks.auditCreate },
    pdfJob: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/usage/record", () => ({
  recordUserUsage: mocks.recordUsage,
}));

import { POST } from "@/app/api/pdf/jobs/[id]/queue/route";

const context = { params: Promise.resolve({ id: "job-12345678" }) };
const request = () =>
  new Request("https://example.com/api/pdf/jobs/job-12345678/queue", {
    method: "POST",
  });
const draftJob = {
  artifacts: [
    {
      id: "artifact-1",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
  ],
  id: "job-12345678",
  inputBytes: 100n,
  operation: "WORD_TO_PDF",
  options: null,
  principalKey: "principal-1",
  status: "DRAFT",
};

describe("POST /api/pdf/jobs/:id/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOwner.mockResolvedValue({
      session: { user: { id: "user-1" } },
    });
    mocks.findFirst.mockResolvedValue(draftJob);
    mocks.reserve.mockResolvedValue(true);
    mocks.enqueue.mockResolvedValue("queue-id");
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    mocks.recordUsage.mockResolvedValue(undefined);
    mocks.findUniqueOrThrow.mockResolvedValue({
      ...draftJob,
      status: "QUEUED",
    });
  });

  it("keeps queue admission successful when audit and usage fail", async () => {
    mocks.auditCreate.mockRejectedValueOnce(new Error("audit unavailable"));
    mocks.recordUsage.mockRejectedValueOnce(new Error("usage unavailable"));

    const response = await POST(request(), context);

    expect(response.status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.captureException).toHaveBeenCalledTimes(2);
  });

  it("returns the current job for an idempotent queued request", async () => {
    mocks.findFirst.mockResolvedValueOnce({ ...draftJob, status: "QUEUED" });
    mocks.findUnique.mockResolvedValueOnce({ ...draftJob, status: "QUEUED" });

    const response = await POST(request(), context);

    expect(response.status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("uses idempotent publication attempts when two queue requests race", async () => {
    mocks.reserve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.findUnique.mockResolvedValue({ ...draftJob, status: "QUEUED" });

    const [first, second] = await Promise.all([
      POST(request(), context),
      POST(request(), context),
    ]);

    expect([first.status, second.status]).toEqual([202, 202]);
    expect(mocks.reserve).toHaveBeenCalledTimes(2);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
  });

  it("keeps QUEUED recoverable when the winning publication rejects", async () => {
    let rejectFirstPublication: (reason: Error) => void = () => undefined;
    const firstPublication = new Promise<never>((_resolve, reject) => {
      rejectFirstPublication = reject;
    });
    mocks.reserve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.enqueue
      .mockImplementationOnce(() => firstPublication)
      .mockResolvedValueOnce(null);
    mocks.findUnique.mockResolvedValue({ ...draftJob, status: "QUEUED" });

    const firstResponsePromise = POST(request(), context);
    await vi.waitFor(() => expect(mocks.enqueue).toHaveBeenCalledOnce());

    const secondResponse = await POST(request(), context);
    rejectFirstPublication(new Error("queue connection lost"));
    const firstResponse = await firstResponsePromise;

    expect(firstResponse.status).toBe(503);
    expect(secondResponse.status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledTimes(2);
    expect(mocks.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT" }),
      }),
    );
  });
});
