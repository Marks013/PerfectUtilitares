import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  requireUnimedAccess: vi.fn(),
  queueUnimedDocumentPdf: vi.fn(),
  findReason: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unimedExclusionReason: { findFirst: mocks.findReason },
  },
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/unimed/document-pdf", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/unimed/document-pdf")>();
  return {
    ...actual,
    queueUnimedDocumentPdf: mocks.queueUnimedDocumentPdf,
  };
});

import { GET, POST } from "@/app/api/unimed/documents/route";
import { UnimedDocumentError } from "@/lib/unimed/documents";
import { UnimedDocumentPdfError } from "@/lib/unimed/document-pdf";

let requestSequence = 1;

function documentRequest(
  body: unknown,
  options: {
    contentLength?: string;
    contentType?: string;
    origin?: string;
  } = {},
) {
  const payload = JSON.stringify(body);
  const headers = new Headers({
    "content-type": options.contentType ?? "application/json",
    origin: options.origin ?? "http://localhost",
    "x-forwarded-for": `127.4.0.${requestSequence++}`,
  });
  if (options.contentLength) {
    headers.set("content-length", options.contentLength);
  }

  return new Request("http://localhost/api/unimed/documents", {
    method: "POST",
    headers,
    body: payload,
  });
}

const validInput = {
  beneficiaryId: "beneficiary-test-123",
  dependentIds: ["dependent-test-123"],
  reasonCode: 2,
  confirmed: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findReason.mockResolvedValue({ documentKind: "RN561" });
  mocks.requireUnimedAccess.mockResolvedValue({
    ok: true,
    session: {
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id: "user-test-123",
        tenantId: "tenant-test-123",
        role: "OPERATOR",
        status: "ACTIVE",
      },
    },
    tenantId: "tenant-test-123",
    accessLevel: "OPERATOR",
  });
  mocks.queueUnimedDocumentPdf.mockResolvedValue({
    id: "pdf-job-test-123",
    progress: 0,
    status: "QUEUED",
  });
});

describe("Unimed documents API", () => {
  it("accepts only POST", () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("checks same-origin before document permission", async () => {
    const response = await POST(
      documentRequest(validInput, { origin: "https://attacker.test" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).not.toHaveBeenCalled();
    expect(mocks.queueUnimedDocumentPdf).not.toHaveBeenCalled();
  });

  it("requires GENERATE_DOCUMENT permission", async () => {
    mocks.requireUnimedAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: "UNIMED_FORBIDDEN" } },
        { status: 403 },
      ),
    });

    const response = await POST(documentRequest(validInput));

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).toHaveBeenCalledWith("GENERATE_DOCUMENT");
    expect(mocks.queueUnimedDocumentPdf).not.toHaveBeenCalled();
  });

  it("enforces JSON content type and 8KB body limit", async () => {
    const wrongType = await POST(
      documentRequest(validInput, { contentType: "text/plain" }),
    );
    const oversized = await POST(
      documentRequest(validInput, {
        contentLength: String(8 * 1024 + 1),
      }),
    );

    expect(wrongType.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(mocks.queueUnimedDocumentPdf).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation and rejects unsupported reasons with 422", async () => {
    const missingConfirmation = await POST(
      documentRequest({ ...validInput, confirmed: false }),
    );
    mocks.findReason.mockResolvedValueOnce({ documentKind: "NONE" });
    const unsupportedReason = await POST(
      documentRequest({ ...validInput, reasonCode: 3 }),
    );

    expect(missingConfirmation.status).toBe(400);
    await expect(missingConfirmation.json()).resolves.toMatchObject({
      error: { code: "UNIMED_DOCUMENT_CONFIRMATION_REQUIRED" },
    });
    expect(unsupportedReason.status).toBe(422);
    await expect(unsupportedReason.json()).resolves.toMatchObject({
      error: { code: "UNIMED_DOCUMENT_REASON_UNSUPPORTED" },
    });
    expect(mocks.queueUnimedDocumentPdf).not.toHaveBeenCalled();
  });

  it("requires selected dependents for a dependent exclusion document", async () => {
    const response = await POST(
      documentRequest({ ...validInput, dependentIds: [], reasonCode: 1 }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "UNIMED_DOCUMENT_CONFIRMATION_REQUIRED",
        details: [{ path: "dependentIds" }],
      },
    });
    expect(mocks.queueUnimedDocumentPdf).not.toHaveBeenCalled();
  });

  it("queues PDF conversion without returning DOCX or beneficiary data", async () => {
    const response = await POST(
      documentRequest({
        beneficiaryId: " beneficiary-test-123 ",
        dependentIds: [" dependent-test-123 "],
        reasonCode: 2,
        confirmed: true,
      }),
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mocks.queueUnimedDocumentPdf).toHaveBeenCalledWith({
      beneficiaryId: "beneficiary-test-123",
      dependentIds: ["dependent-test-123"],
      manualDependents: [],
      documentKind: "RN561",
      moduleSessionId: undefined,
      reasonCode: 2,
      tenantId: "tenant-test-123",
    });
    await expect(response.json()).resolves.toEqual({
      job: { id: "pdf-job-test-123", progress: 0, status: "QUEUED" },
    });
  });

  it("queues an RN561 with a validated manual dependent", async () => {
    const response = await POST(
      documentRequest({
        ...validInput,
        dependentIds: [],
        manualDependents: [
          {
            clientId: "manual-dependent-123",
            fullName: " Dependente Manual ",
            cpf: "111.444.777-35",
          },
        ],
        reasonCode: 1,
      }),
    );

    expect(response.status).toBe(202);
    expect(mocks.queueUnimedDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        dependentIds: [],
        manualDependents: [
          {
            clientId: "manual-dependent-123",
            fullName: "Dependente Manual",
            cpf: "11144477735",
          },
        ],
        reasonCode: 1,
      }),
    );
  });

  it("rejects a manual dependent without a complete CPF", async () => {
    const response = await POST(
      documentRequest({
        ...validInput,
        dependentIds: [],
        manualDependents: [
          {
            clientId: "manual-dependent-123",
            fullName: "Dependente Manual",
            cpf: "123",
          },
        ],
        reasonCode: 1,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "UNIMED_DOCUMENT_CONFIRMATION_REQUIRED",
        details: [{ path: "manualDependents.0.cpf" }],
      },
    });
    expect(mocks.queueUnimedDocumentPdf).not.toHaveBeenCalled();
  });

  it("returns safe structured template errors", async () => {
    mocks.queueUnimedDocumentPdf.mockRejectedValue(
      new UnimedDocumentError("UNIMED_DOCUMENT_TEMPLATE_UNVERIFIED", 503),
    );

    const response = await POST(documentRequest(validInput));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("UNIMED_DOCUMENT_TEMPLATE_UNVERIFIED");
    expect(text).not.toContain("template.docx");
  });

  it("returns a safe structured error when the PDF queue is unavailable", async () => {
    mocks.queueUnimedDocumentPdf.mockRejectedValue(
      new UnimedDocumentPdfError(
        "UNIMED_DOCUMENT_PDF_QUEUE_UNAVAILABLE",
        503,
        "A conversão está temporariamente indisponível.",
      ),
    );

    const response = await POST(documentRequest(validInput));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNIMED_DOCUMENT_PDF_QUEUE_UNAVAILABLE" },
    });
  });

  it("does not expose unexpected errors or PII", async () => {
    mocks.queueUnimedDocumentPdf.mockRejectedValue(
      new Error("Pessoa Privada 52998224725 /secret/template.docx"),
    );

    const response = await POST(documentRequest(validInput));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("UNIMED_DOCUMENT_FAILED");
    expect(text).not.toContain("Pessoa Privada");
    expect(text).not.toContain("52998224725");
    expect(text).not.toContain("/secret");
  });
});
