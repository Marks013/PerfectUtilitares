import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/test/unimed-route-rate-limit.mock";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("bcryptjs", () => ({ compare: mocks.compare }));
vi.mock("@/lib/api/security", () => ({
  enforcePersistentRateLimit: vi.fn(async () => null),
  enforceRateLimit: vi.fn(() => null),
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
vi.mock("@/lib/unimed/module-session", () => ({
  UNIMED_ACCESS_COOKIE: "perfectutilitares.unimed-access",
  createUnimedModuleSession: mocks.createSession,
  getUnimedModuleSession: mocks.getSession,
  revokeUnimedModuleSessionCookie: mocks.revoke,
  unimedSessionCookieOptions: (maxAge: number) => ({
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "strict",
    secure: true,
  }),
}));

import { DELETE, POST } from "@/app/api/unimed/access/session/route";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.UNIMED_ACCESS_STANDARD_PASSWORD_HASH = `$2b$12$${"s".repeat(53)}`;
  process.env.UNIMED_ACCESS_ADMIN_PASSWORD_HASH = `$2b$12$${"a".repeat(53)}`;
  mocks.createSession.mockResolvedValue({
    value: "opaque.signed",
    expiresAt: new Date(Date.now() + 60_000),
    maxAgeSeconds: 60,
    operatorName: "Administrador",
    role: "ADMIN",
  });
});

describe("Unimed access session API", () => {
  it("identifies the administrator password and sets a hardened cookie", async () => {
    mocks.compare.mockImplementation(async (_password: string, hash: string) =>
      hash.endsWith("a"),
    );
    const response = await POST(
      new Request("https://example.test/api/unimed/access/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "secret",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledWith(
      "ADMIN",
      "Administrador",
    );
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=strict/i);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
  });

  it("uses the fixed standard operator name for the standard password", async () => {
    mocks.compare.mockImplementation(async (_password: string, hash: string) =>
      hash.endsWith("s"),
    );
    mocks.createSession.mockResolvedValueOnce({
      value: "opaque.standard",
      expiresAt: new Date(Date.now() + 60_000),
      maxAgeSeconds: 60,
      operatorName: "Dp Planalto",
      role: "STANDARD",
    });

    const response = await POST(
      new Request("https://example.test/api/unimed/access/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "standard-secret",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.createSession).toHaveBeenCalledWith(
      "STANDARD",
      "Dp Planalto",
    );
  });

  it("rejects an incorrect password without creating a session", async () => {
    mocks.compare.mockResolvedValue(false);
    const response = await POST(
      new Request("https://example.test/api/unimed/access/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "wrong",
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("revokes the server session and expires the cookie", async () => {
    const response = await DELETE(
      new Request("https://example.test/api/unimed/access/session", {
        method: "DELETE",
        headers: {
          cookie: "perfectutilitares.unimed-access=opaque.signed",
        },
      }),
    );
    expect(mocks.revoke).toHaveBeenCalledWith("opaque.signed");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
