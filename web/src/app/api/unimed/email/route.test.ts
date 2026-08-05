import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  requireUnimedAccess: vi.fn(),
  sendUnimedExclusionEmail: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/unimed/access.server", () => ({
  requireUnimedAccess: mocks.requireUnimedAccess,
}));

vi.mock("@/lib/unimed/email", () => ({
  sendUnimedExclusionEmail: mocks.sendUnimedExclusionEmail,
  UnimedEmailInProgressError: class UnimedEmailInProgressError extends Error {},
}));

import { GET, POST } from "@/app/api/unimed/email/route";

let requestSequence = 1;

function emailRequest(
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
    "x-forwarded-for": `127.2.0.${requestSequence++}`,
  });
  if (options.contentLength) {
    headers.set("content-length", options.contentLength);
  }

  return new Request("http://localhost/api/unimed/email", {
    method: "POST",
    headers,
    body: payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUnimedAccess.mockResolvedValue({
    ok: true,
    session: {
      expires: new Date(Date.now() + 60_000).toISOString(),
      user: {
        id: "user-12345678",
        tenantId: "tenant-12345678",
        role: "OPERATOR",
        status: "ACTIVE",
      },
    },
    tenantId: "tenant-12345678",
    accessLevel: "OPERATOR",
    moduleSessionId: "module-session-12345678",
    operatorName: "Operador Teste",
  });
  mocks.sendUnimedExclusionEmail.mockResolvedValue({ recipients: 2 });
});

const validInput = {
  beneficiaryId: "beneficiary-123",
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  confirmed: true,
};

describe("Unimed email API", () => {
  it("accepts only POST", () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("checks same-origin before module permission", async () => {
    const response = await POST(
      emailRequest(validInput, { origin: "https://attacker.test" }),
    );

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).not.toHaveBeenCalled();
    expect(mocks.sendUnimedExclusionEmail).not.toHaveBeenCalled();
  });

  it("requires SEND_EMAIL permission", async () => {
    mocks.requireUnimedAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: "UNIMED_FORBIDDEN" } },
        { status: 403 },
      ),
    });

    const response = await POST(emailRequest(validInput));

    expect(response.status).toBe(403);
    expect(mocks.requireUnimedAccess).toHaveBeenCalledWith("SEND_EMAIL");
    expect(mocks.sendUnimedExclusionEmail).not.toHaveBeenCalled();
  });

  it("enforces JSON content type and the 8KB body limit", async () => {
    const wrongType = await POST(
      emailRequest(validInput, { contentType: "text/plain" }),
    );
    const oversized = await POST(
      emailRequest(validInput, { contentLength: String(8 * 1024 + 1) }),
    );

    expect(wrongType.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(mocks.sendUnimedExclusionEmail).not.toHaveBeenCalled();
  });

  it("requires explicit user confirmation and a valid beneficiary id", async () => {
    const response = await POST(
      emailRequest({
        beneficiaryId: "short",
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        confirmed: false,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNIMED_EMAIL_CONFIRMATION_REQUIRED" },
    });
    expect(mocks.sendUnimedExclusionEmail).not.toHaveBeenCalled();
  });

  it("sends only within the session tenant and returns a count", async () => {
    const response = await POST(
      emailRequest({
        beneficiaryId: " beneficiary-123 ",
        idempotencyKey: "00000000-0000-4000-8000-000000000001",
        confirmed: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.sendUnimedExclusionEmail).toHaveBeenCalledWith({
      accessLevel: "OPERATOR",
      tenantId: "tenant-12345678",
      beneficiaryId: "beneficiary-123",
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      moduleSessionId: "module-session-12345678",
      operatorName: "Operador Teste",
    });
    expect(await response.json()).toEqual({
      sent: { recipients: 2 },
    });
  });

  it("does not expose recipients, beneficiary data or service errors", async () => {
    mocks.sendUnimedExclusionEmail.mockRejectedValue(
      new Error(
        "CPF 12345678900 recipient private@example.com RESEND_API_KEY secret",
      ),
    );

    const response = await POST(emailRequest(validInput));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(text).toContain("UNIMED_EMAIL_FAILED");
    expect(text).not.toContain("12345678900");
    expect(text).not.toContain("private@example.com");
    expect(text).not.toContain("RESEND_API_KEY");
  });
});
