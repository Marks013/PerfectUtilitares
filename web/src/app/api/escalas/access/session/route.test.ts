import { hash } from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rate: vi.fn(), create: vi.fn(), get: vi.fn(), revoke: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: mocks.rate }));
vi.mock("@/lib/escalas/module-session", () => ({ ESCALA_ACCESS_COOKIE: "perfectutilitares.escalas-access", createEscalaModuleSession: mocks.create, getEscalaModuleSession: mocks.get, revokeEscalaModuleSessionCookie: mocks.revoke, escalaSessionCookieOptions: (maxAge: number) => ({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge }) }));
import { DELETE, GET, PATCH, POST } from "./route";
function request(body: unknown, origin = "http://localhost") { return new Request("http://localhost/api/escalas/access/session", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubEnv("UNIMED_ACCESS_STANDARD_PASSWORD_HASH", await hash("operational-test-only", 4)); vi.stubEnv("UNIMED_ACCESS_ADMIN_PASSWORD_HASH", await hash("admin-test-only", 4));
  mocks.rate.mockResolvedValue(null); mocks.get.mockResolvedValue(null); mocks.create.mockResolvedValue({ id: "s1", value: "opaque-token.signature", expiresAt: new Date("2030-01-01T00:00:00Z"), maxAgeSeconds: 28800 });
});
afterEach(() => vi.unstubAllEnvs());
describe("/api/escalas/access/session", () => {
  it("validates the real bcrypt STANDARD password, returns protected session metadata and never a tenant/secret", async () => {
    const response = await POST(request({ password: "operational-test-only" }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    for (const flag of ["perfectutilitares.escalas-access=", "HttpOnly", "Secure", "SameSite=strict"]) expect(response.headers.get("set-cookie")).toContain(flag);
    expect(await response.json()).toEqual({ access: { role: "OPERATIONAL", expiresAt: "2030-01-01T00:00:00.000Z" } });
    expect(mocks.create).toHaveBeenCalledWith();
  });
  it("does not accept the Unimed admin credential or any browser-supplied scope", async () => {
    expect((await POST(request({ password: "admin-test-only" }))).status).toBe(401);
    expect((await POST(request({ password: "operational-test-only", tenantId: "foreign" }))).status).toBe(400);
    expect((await POST(request({ password: "operational-test-only", branchCode: "07" }))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("blocks foreign origin and repeated attempts before comparing a password", async () => {
    expect((await POST(request({ password: "operational-test-only" }, "https://foreign.test"))).status).toBe(403);
    mocks.rate.mockResolvedValue(Response.json({}, { status: 429 }));
    expect((await POST(request({ password: "operational-test-only" }))).status).toBe(429);
    expect(mocks.rate).toHaveBeenCalledWith(expect.any(Request), { keyPrefix: "escalas-access-unlock", limit: 5, windowMs: 900000 }); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("fails closed for missing configuration and invalid or excessive inputs", async () => {
    expect((await POST(request({ password: "" }))).status).toBe(400);
    expect((await POST(request({ password: "á".repeat(40) }))).status).toBe(400);
    vi.stubEnv("UNIMED_ACCESS_STANDARD_PASSWORD_HASH", "invalid");
    expect((await POST(request({ password: "operational-test-only" }))).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("reports session expiry and checks a real successful session response", async () => {
    expect((await GET()).status).toBe(401); mocks.get.mockResolvedValue({ id: "s1", tenantId: "not-exposed", expiresAt: new Date("2030-01-01") });
    const response = await GET(); expect(response.status).toBe(200); expect(await response.json()).toEqual({ access: { role: "OPERATIONAL", expiresAt: "2030-01-01T00:00:00.000Z" } });
  });
  it("confirms server-side revocation before expiring only the Escalas cookie", async () => {
    const response = await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: { origin: "http://localhost", cookie: "perfectutilitares.unimed-access=unchanged; perfectutilitares.escalas-access=opaque" } }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ revoked: true }); expect(mocks.revoke).toHaveBeenCalledWith("opaque");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0"); expect(response.headers.get("set-cookie")).not.toContain("unimed-access");
    expect((await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE" }))).status).toBe(403);
  });
  it("keeps failure states truthful and restricts methods", async () => {
    mocks.create.mockRejectedValue(new Error("unavailable")); expect((await POST(request({ password: "operational-test-only" }))).status).toBe(503);
    mocks.get.mockRejectedValue(new Error("unavailable")); expect((await GET()).status).toBe(503);
    mocks.revoke.mockRejectedValue(new Error("unavailable"));
    expect((await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: { origin: "http://localhost" } }))).status).toBe(503);
    expect(PATCH().status).toBe(405); expect(PATCH().headers.get("allow")).toBe("GET, POST, DELETE");
  });
});
