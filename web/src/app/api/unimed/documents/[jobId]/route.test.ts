import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUnimedDocumentPdf: vi.fn(),
  requireUnimedAccess: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/security", () => ({
  enforcePersistentRateLimit: vi.fn().mockResolvedValue(null),
  jsonError: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  methodNotAllowed: (allowed: string[]) =>
    new Response(null, {
      status: 405,
      headers: { Allow: allowed.join(", ") },
    }),
}));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/unimed/document-pdf", () => ({
  getUnimedDocumentPdf: mocks.getUnimedDocumentPdf,
}));

import { DELETE, GET, POST } from "@/app/api/unimed/documents/[jobId]/route";

let requestSequence = 1;

function request() {
  return new Request("http://localhost/api/unimed/documents/pdf-job-test-123", {
    headers: { "x-forwarded-for": `127.5.0.${requestSequence++}` },
  });
}

function context(jobId = "pdf-job-test-123") {
  return { params: Promise.resolve({ jobId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUnimedAccess.mockResolvedValue({
    ok: true,
    tenantId: "tenant-test-123",
    moduleSessionId: "module-session-test-123",
    accessLevel: "OPERATOR",
  });
  mocks.getUnimedDocumentPdf.mockResolvedValue({
    state: "PENDING",
    job: { id: "pdf-job-test-123", progress: 25, status: "RUNNING" },
  });
});

describe("Unimed generated PDF API", () => {
  it("accepts only GET", () => {
    expect(POST().status).toBe(405);
    expect(DELETE().status).toBe(405);
    expect(POST().headers.get("allow")).toBe("GET");
  });

  it("requires document permission before reading a job", async () => {
    mocks.requireUnimedAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: "UNIMED_FORBIDDEN" } },
        { status: 403 },
      ),
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).toHaveBeenCalledWith("GENERATE_DOCUMENT");
    expect(mocks.getUnimedDocumentPdf).not.toHaveBeenCalled();
  });

  it("rejects invalid identifiers", async () => {
    const response = await GET(request(), context("short"));

    expect(response.status).toBe(400);
    expect(mocks.getUnimedDocumentPdf).not.toHaveBeenCalled();
  });

  it("returns a non-cacheable pending status with polling guidance", async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("retry-after")).toBe("1");
    expect(mocks.getUnimedDocumentPdf).toHaveBeenCalledWith(
      "tenant-test-123",
      "module-session-test-123",
      "pdf-job-test-123",
    );
    await expect(response.json()).resolves.toEqual({
      job: { id: "pdf-job-test-123", progress: 25, status: "RUNNING" },
    });
  });

  it("does not reveal jobs outside the authorized tenant", async () => {
    mocks.getUnimedDocumentPdf.mockResolvedValue({ state: "NOT_FOUND" });

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNIMED_DOCUMENT_JOB_NOT_FOUND" },
    });
  });

  it("maps failed and expired conversions to safe errors", async () => {
    mocks.getUnimedDocumentPdf.mockResolvedValueOnce({ state: "FAILED" });
    const failed = await GET(request(), context());
    mocks.getUnimedDocumentPdf.mockResolvedValueOnce({ state: "GONE" });
    const gone = await GET(request(), context());

    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: "UNIMED_DOCUMENT_PDF_FAILED" },
    });
    expect(gone.status).toBe(410);
    await expect(gone.json()).resolves.toMatchObject({
      error: { code: "UNIMED_DOCUMENT_PDF_EXPIRED" },
    });
  });

  it("downloads only the consumed PDF with safe headers", async () => {
    const bytes = new TextEncoder().encode("%PDF-synthetic");
    mocks.getUnimedDocumentPdf.mockResolvedValue({
      state: "READY",
      bytes,
      cleanupDeferred: false,
      contentType: "application/pdf",
      fileName: "unimed-rn561.pdf",
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="unimed-rn561.pdf"',
    );
    expect(response.headers.get("content-length")).toBe(String(bytes.length));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-unimed-cleanup")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
