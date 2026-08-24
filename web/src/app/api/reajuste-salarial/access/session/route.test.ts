import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ compare: mocks.compare }));
vi.mock("@/lib/api/security", () => ({
  enforcePersistentRateLimit: vi.fn(async () => null),
  jsonError: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
  readJsonBody: async (request: Request) => ({
    ok: true,
    data: await request.json(),
  }),
  requireContentType: vi.fn(() => null),
  requireMaxContentLength: vi.fn(() => null),
  requireSameOrigin: vi.fn(() => null),
}));
vi.mock("@/lib/reajuste-salarial/access-session", () => ({
  REAJUSTE_ACCESS_COOKIE: "perfectutilitares.reajuste-salarial-access",
  createReajusteModuleSession: mocks.createSession,
  getReajusteModuleSession: mocks.getSession,
  reajusteSessionCookieOptions: (maxAge: number) => ({
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "strict",
    secure: true,
  }),
  revokeReajusteModuleSessionCookie: mocks.revoke,
}));

import { DELETE, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REAJUSTE_ACCESS_STANDARD_PASSWORD_HASH = `$2b$12$${"s".repeat(53)}`;
  mocks.createSession.mockResolvedValue({
    value: "opaque.signed",
    expiresAt: new Date(Date.now() + 60_000),
    maxAgeSeconds: 60,
    operatorName: "Dp Planalto",
    role: "STANDARD",
  });
});

function request(password: string) {
  return new Request(
    "https://example.test/api/reajuste-salarial/access/session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    },
  );
}

describe("salary adjustment access session API", () => {
  it("unlocks without an app login using the dedicated module password", async () => {
    mocks.compare.mockResolvedValue(true);
    const response = await POST(request("standard-secret"));

    expect(response.status).toBe(200);
    expect(mocks.compare).toHaveBeenCalledOnce();
    expect(mocks.compare).toHaveBeenCalledWith(
      "standard-secret",
      process.env.REAJUSTE_ACCESS_STANDARD_PASSWORD_HASH,
    );
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=strict/i);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("rejects an incorrect password without creating a session", async () => {
    mocks.compare.mockResolvedValue(false);
    const response = await POST(request("wrong"));

    expect(response.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("revokes the isolated module session and expires its cookie", async () => {
    const response = await DELETE(
      new Request("https://example.test/api/reajuste-salarial/access/session", {
        method: "DELETE",
        headers: {
          cookie:
            "perfectutilitares.reajuste-salarial-access=opaque.signed",
        },
      }),
    );

    expect(mocks.revoke).toHaveBeenCalledWith("opaque.signed");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
