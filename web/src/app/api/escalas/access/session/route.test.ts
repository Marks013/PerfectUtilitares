import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), grants: vi.fn(), policy: vi.fn(), rate: vi.fn(), create: vi.fn(),
  get: vi.fn(), verify: vi.fn(), revoke: vi.fn(), cookieOptions: vi.fn(), cookieValue: undefined as string | undefined }));
const storage = vi.hoisted(() => ({ transaction: vi.fn(), tenant: vi.fn(), operator: vi.fn(), operatorLock: vi.fn(), accessLock: vi.fn(),
  list: vi.fn(), insert: vi.fn(), update: vi.fn(), read: vi.fn(), audit: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookieValue ? { value: mocks.cookieValue } : undefined }) }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaBranchAccess: { findMany: mocks.grants },
  escalaModuleAccessPolicy: { findUnique: mocks.policy }, $transaction: storage.transaction } }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: mocks.rate }));
vi.mock("@/lib/escalas/operator-session-issuer", () => ({ createEscalaScopedModuleSession: mocks.create }));
vi.mock("@/lib/escalas/operator-session-store", async original => ({ ...await original<typeof import("@/lib/escalas/operator-session-store")>(),
  getEscalaScopedModuleSession: mocks.get, verifyEscalaScopedSessionCookie: mocks.verify }));
vi.mock("@/lib/escalas/module-session", async original => ({ ...await original<typeof import("@/lib/escalas/module-session")>(),
  revokeEscalaModuleSessionCookie: mocks.revoke, escalaSessionCookieOptions: mocks.cookieOptions }));
import { DELETE, GET, PATCH, POST } from "./route";
const scope = () => ({ kind: "resolved", sessionId: "s", permissionVersion: 1, accessPolicyVersion: 1,
  expiresAtMs: Date.parse("2030-01-01T00:00:00.000Z"), principal: { kind: "operator", id: "operator-private",
    tenantId: "tenant-private", active: true, branchGrants: [{ tenantId: "tenant-private", operatorId: "operator-private",
      branchCode: "02", active: true, capabilities: ["workspace.read", "workspace.save"] }] } });
const request = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/escalas/access/session",
  { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue(null); mocks.get.mockResolvedValue(null);
  mocks.cookieValue = undefined;
  mocks.cookieOptions.mockImplementation((maxAge: number) => ({ httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge }));
  storage.transaction.mockRejectedValue(new Error("Persistence must be explicitly configured by the real-route fixture"));
  mocks.rate.mockResolvedValue(null); mocks.policy.mockResolvedValue({ mode: "SCOPED" }); mocks.grants.mockResolvedValue([]);
  mocks.create.mockResolvedValue({ id: "s", value: "opaque.signature", expiresAt: new Date("2030-01-01"), maxAgeSeconds: 28800 });
  mocks.verify.mockResolvedValue(scope());
});
afterEach(() => vi.unstubAllEnvs());
const syntheticSigningKey = "synthetic-access-route-key-0000000000000000000000";
async function realSessionFixture() {
  vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", syntheticSigningKey);
  vi.stubEnv("DEFAULT_TENANT_SLUG", "synthetic-access-tenant");
  vi.stubEnv("UNIMED_ACCESS_SESSION_TTL_MINUTES", "480");
  vi.stubEnv("NODE_ENV", "production");
  const tenantId = "private-tenant", operatorId = "private-operator";
  const policy = { tenantId, mode: "SCOPED", version: 7 };
  const operator = { id: operatorId, tenantId, usernameNormalized: "maria", active: true, permissionVersion: 3,
    branchGrants: [{ tenantId, operatorId, branchCode: "02", active: true, capabilities: ["workspace.read", "schedule.generate"] }] };
  type StoredSession = { id: string; tenantId: string; operatorId: string | null; tokenHash: string;
    permissionVersion: number | null; accessPolicyVersion: number | null; createdAt: Date; expiresAt: Date; revokedAt: Date | null };
  let stored: StoredSession | null = null;
  storage.tenant.mockImplementation(async ({ where }) => where.slug === "synthetic-access-tenant" ? { id: tenantId } : null);
  storage.operatorLock.mockImplementation(async (_strings, requestedTenant, username) => requestedTenant === tenantId && username === "maria" ? [{ id: operatorId }] : []);
  storage.operator.mockImplementation(async ({ where }) => where.tenantId_id.tenantId === tenantId && where.tenantId_id.id === operatorId ? operator : null);
  mocks.policy.mockImplementation(async ({ where }) => where.tenantId === tenantId ? policy : null);
  storage.list.mockResolvedValue([]); storage.accessLock.mockResolvedValue(1); storage.audit.mockResolvedValue({ id: "synthetic-audit" });
  storage.insert.mockImplementation(async ({ data }) => { stored = { ...data, id: "synthetic-session", revokedAt: null }; return { id: "synthetic-session" }; });
  storage.read.mockImplementation(async ({ where }) => {
    if (!stored || where.tokenHash !== stored.tokenHash || (where.tenant && where.tenant.slug !== "synthetic-access-tenant")) return null;
    return { ...stored, tenant: { id: tenantId, escalaModuleAccessPolicy: policy }, operator };
  });
  storage.update.mockImplementation(async ({ where, data }) => {
    if (!stored || where.id !== stored.id || where.tenantId !== tenantId || where.tokenHash !== stored.tokenHash || stored.revokedAt !== null) return { count: 0 };
    Object.assign(stored, data); return { count: 1 };
  });
  const db = { tenant: { findUnique: storage.tenant }, escalaOperator: { findUnique: storage.operator },
    escalaModuleAccessPolicy: { findUnique: mocks.policy }, escalaModuleSession: { findMany: storage.list, create: storage.insert,
      findFirst: storage.read, updateMany: storage.update }, auditLog: { create: storage.audit },
    $executeRaw: storage.accessLock, $queryRaw: storage.operatorLock };
  storage.transaction.mockImplementation(async callback => callback(db));
  const issuer = await vi.importActual<typeof import("@/lib/escalas/operator-session-issuer")>("@/lib/escalas/operator-session-issuer");
  const reader = await vi.importActual<typeof import("@/lib/escalas/operator-session-store")>("@/lib/escalas/operator-session-store");
  const cookies = await vi.importActual<typeof import("@/lib/escalas/module-session")>("@/lib/escalas/module-session");
  mocks.create.mockImplementation(issuer.createEscalaScopedModuleSession);
  mocks.verify.mockImplementation(reader.verifyEscalaScopedSessionCookie);
  mocks.get.mockImplementation(reader.getEscalaScopedModuleSession);
  mocks.revoke.mockImplementation(cookies.revokeEscalaModuleSessionCookie);
  mocks.cookieOptions.mockImplementation(cookies.escalaSessionCookieOptions);
  return { policy, operator, cookies, session: () => {
    if (!stored) throw new Error("The real issuer must persist the synthetic session first");
    return stored;
  } };
}

describe("username navigation session HTTP", () => {
  it.each([undefined, "", "short"] as const)("reports signing configuration %s as 503 through real GET and DELETE adapters", async unavailableKey => {
    const fixture = await realSessionFixture();
    const admitted = await POST(request({ username: "Maria" }));
    expect(admitted.status).toBe(200);
    const cookie = admitted.headers.get("set-cookie")?.split(";")[0].split("=")[1];
    if (!cookie) throw new Error("Expected a real signed cookie before the configuration outage");
    mocks.cookieValue = cookie;
    storage.transaction.mockClear(); storage.read.mockClear(); storage.update.mockClear();
    vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", unavailableKey);
    expect(() => fixture.cookies.decodeEscalaSessionCookie(cookie)).toThrow(fixture.cookies.EscalaSessionConfigurationError);
    await expect(mocks.verify(cookie)).rejects.toBeInstanceOf(fixture.cookies.EscalaSessionConfigurationError);
    await expect(mocks.revoke(cookie)).rejects.toBeInstanceOf(fixture.cookies.EscalaSessionConfigurationError);
    const unavailable = await GET();
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).not.toHaveProperty("access");
    const refusedLogout = await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: {
      origin: "http://localhost", cookie: "perfectutilitares.escalas-access=" + cookie } }));
    expect(refusedLogout.status).toBe(503);
    expect(await refusedLogout.json()).not.toHaveProperty("revoked");
    expect(refusedLogout.headers.get("set-cookie")).toBeNull();
    expect(fixture.session().revokedAt).toBeNull();
    expect(storage.transaction).not.toHaveBeenCalled(); expect(storage.read).not.toHaveBeenCalled(); expect(storage.update).not.toHaveBeenCalled();
    vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", syntheticSigningKey);
    expect((await GET()).status).toBe(200);
    const confirmedLogout = await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: {
      origin: "http://localhost", cookie: "perfectutilitares.escalas-access=" + cookie } }));
    expect(confirmedLogout.status).toBe(200);
    expect(await confirmedLogout.json()).toEqual({ revoked: true });
    expect(fixture.session().revokedAt).toBeInstanceOf(Date);
    expect((await GET()).status).toBe(401);
  });
  it.each([
    { label: "absent", cookie: undefined },
    { label: "empty", cookie: "" },
    { label: "missing separator", cookie: "malformed" },
    { label: "short signature", cookie: `${"A".repeat(43)}.A` },
    { label: "non-Base64url signature", cookie: `${"A".repeat(43)}.${"~".repeat(43)}` },
    { label: "noncanonical signature", cookie: `${"A".repeat(43)}.${"A".repeat(42)}B` },
    { label: "extra part", cookie: `${"A".repeat(43)}.${"A".repeat(43)}.extra` },
    { label: "extra empty part", cookie: `${"A".repeat(43)}.${"A".repeat(43)}.` },
  ])("keeps a $label cookie idempotent without signing configuration", async ({ cookie }) => {
    await realSessionFixture(); vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "");
    mocks.cookieValue = cookie;
    expect((await GET()).status).toBe(401);
    const response = await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: {
      origin: "http://localhost", ...(cookie ? { cookie: "perfectutilitares.escalas-access=" + cookie } : {}) } }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ revoked: true });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(storage.transaction).not.toHaveBeenCalled(); expect(storage.insert).not.toHaveBeenCalled();
    expect(storage.read).not.toHaveBeenCalled(); expect(storage.update).not.toHaveBeenCalled();
  });
  it("keeps a structurally valid mismatched signature idempotent with valid configuration without revoking another stored session", async () => {
    const fixture = await realSessionFixture();
    const admitted = await POST(request({ username: "Maria" }));
    expect(admitted.status).toBe(200);
    const cookie = admitted.headers.get("set-cookie")?.split(";")[0].split("=")[1];
    if (!cookie) throw new Error("Expected a real signed cookie");
    const [token, signed] = cookie.split(".");
    const invalid = token + "." + (signed[0] === "A" ? "B" : "A") + signed.slice(1);
    mocks.cookieValue = invalid;
    storage.transaction.mockClear(); storage.read.mockClear(); storage.update.mockClear(); storage.insert.mockClear();
    expect((await GET()).status).toBe(401);
    const response = await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: {
      origin: "http://localhost", cookie: "perfectutilitares.escalas-access=" + invalid } }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ revoked: true });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(fixture.session().revokedAt).toBeNull();
    expect(storage.insert).not.toHaveBeenCalled();
    expect(storage.transaction).not.toHaveBeenCalled(); expect(storage.read).not.toHaveBeenCalled(); expect(storage.update).not.toHaveBeenCalled();
  });
  it("keeps repeated valid logout idempotent after persisted revocation", async () => {
    const fixture = await realSessionFixture();
    const admitted = await POST(request({ username: "Maria" }));
    expect(admitted.status).toBe(200);
    const cookie = admitted.headers.get("set-cookie")?.split(";")[0].split("=")[1];
    if (!cookie) throw new Error("Expected a real signed cookie");
    const logout = () => DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: {
      origin: "http://localhost", cookie: "perfectutilitares.escalas-access=" + cookie } }));
    expect((await logout()).status).toBe(200);
    const revokedAt = fixture.session().revokedAt;
    expect(revokedAt).toBeInstanceOf(Date);
    const repeated = await logout();
    expect(repeated.status).toBe(200); expect(await repeated.json()).toEqual({ revoked: true });
    expect(fixture.session().revokedAt).toEqual(revokedAt);
    expect(storage.insert).toHaveBeenCalledTimes(1);
  });
  it("preserves account precedence during a signing outage without consulting the nominal cookie", async () => {
    await realSessionFixture(); vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "");
    mocks.cookieValue = "syntactically-present-but-unusable";
    mocks.auth.mockResolvedValue({ user: { id: "admin", tenantId: "private-tenant", role: "ADMIN", status: "ACTIVE" } });
    for (const response of [await GET(), await POST(request({ username: "Maria" }))]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ context: { channel: "ACCOUNT", administrator: true } });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.verify).not.toHaveBeenCalled();
    expect(storage.transaction).not.toHaveBeenCalled();
  });
  it("preserves content, length, malformed JSON and method boundaries before admission", async () => {
    const send = (body: string, headers: Record<string, string>) => POST(new Request("http://localhost/api/escalas/access/session", {
      method: "POST", headers: { origin: "http://localhost", ...headers }, body }));
    expect((await send("{}", { "content-type": "text/plain" })).status).toBe(415);
    expect((await send("{}", { "content-type": "application/json", "content-length": "4097" })).status).toBe(413);
    expect((await send("{", { "content-type": "application/json" })).status).toBe(400);
    expect((await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: { origin: "https://foreign.test" } }))).status).toBe(403);
    expect(PATCH().headers.get("allow")).toBe("GET, POST, DELETE");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("does not fall back to a module session when account verification is unavailable", async () => {
    mocks.auth.mockRejectedValue(new Error("Synthetic account failure")); mocks.get.mockResolvedValue(scope());
    expect((await GET()).status).toBe(503);
    expect((await POST(request({ username: "Maria" }))).status).toBe(503);
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("fails real issuance before persistence when its signing configuration is unavailable", async () => {
    await realSessionFixture(); vi.stubEnv("UNIMED_ACCESS_COOKIE_SECRET", "");
    const response = await POST(request({ username: "Maria" }));
    expect(response.status).toBe(503); expect(response.headers.get("set-cookie")).toBeNull();
    expect(storage.insert).not.toHaveBeenCalled(); expect(storage.audit).not.toHaveBeenCalled();
  });
  it("rejects a modified real cookie before looking up its persisted session", async () => {
    await realSessionFixture();
    const admitted = await POST(request({ username: "Maria" }));
    expect(admitted.status).toBe(200);
    const cookie = admitted.headers.get("set-cookie")?.split(";")[0].split("=")[1];
    if (!cookie) throw new Error("Expected a signed cookie");
    mocks.cookieValue = cookie + "x"; storage.read.mockClear();
    expect((await GET()).status).toBe(401); expect(storage.read).not.toHaveBeenCalled();
  });
  it("issues, verifies, reads and revokes a real signed nominal session through the HTTP handlers", async () => {
    const fixture = await realSessionFixture();
    const response = await POST(request({ username: "  ＭＡＲＩＡ " }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie")?.split(";")[0].split("=")[1];
    if (!cookie) throw new Error("Expected a signed session cookie");
    const token = fixture.cookies.decodeEscalaSessionCookie(cookie);
    if (!token) throw new Error("Expected a verified session token");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fixture.session()).toMatchObject({ tenantId: "private-tenant", operatorId: "private-operator", permissionVersion: 3, accessPolicyVersion: 7 });
    expect(fixture.session().tokenHash).toBe(fixture.cookies.hashEscalaSessionToken(token));
    expect(fixture.session().tokenHash).not.toBe(token);
    for (const flag of ["HttpOnly", "Secure", "SameSite=strict"]) expect(response.headers.get("set-cookie")).toContain(flag);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    const body = await response.json();
    expect(body.context).toMatchObject({ channel: "USERNAME", administrator: false, allBranches: false,
      branches: [{ code: "02", capabilities: ["workspace.read", "schedule.generate"] }] });
    expect(body.context.branches).toHaveLength(1);
    for (const hidden of ["private-tenant", "private-operator", fixture.session().tokenHash, cookie]) expect(JSON.stringify(body)).not.toContain(hidden);
    expect(storage.operatorLock.mock.calls[0].slice(1)).toEqual(["private-tenant", "maria"]);
    expect(storage.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 5000 });
    expect(storage.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 5000, timeout: 5000 });
    mocks.cookieValue = cookie;
    expect((await GET()).status).toBe(200);
    const locked = await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: {
      origin: "http://localhost", cookie: "perfectutilitares.unimed-access=preserve; perfectutilitares.escalas-access=" + cookie } }));
    expect(locked.status).toBe(200);
    expect(fixture.session().revokedAt).toBeInstanceOf(Date);
    expect(locked.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(locked.headers.get("set-cookie")).not.toContain("unimed-access");
    expect((await GET()).status).toBe(401);
    expect(storage.insert).toHaveBeenCalledTimes(1);
  });
  it.each(["ADMIN_ONLY", "LEGACY", "UNKNOWN"])("refuses real named admission in policy %s without creating a session", async mode => {
    const fixture = await realSessionFixture(); fixture.policy.mode = mode;
    const response = await POST(request({ username: "Maria" }));
    expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toBeNull();
    expect(storage.insert).not.toHaveBeenCalled(); expect(storage.audit).not.toHaveBeenCalled();
  });
  it.each(["permission-version", "policy-version", "legacy", "expired", "foreign-grant"])("rejects a real signed cookie after %s changes", async change => {
    const fixture = await realSessionFixture();
    const admitted = await POST(request({ username: "Maria" }));
    expect(admitted.status).toBe(200);
    mocks.cookieValue = admitted.headers.get("set-cookie")?.split(";")[0].split("=")[1];
    if (change === "permission-version") fixture.operator.permissionVersion++;
    if (change === "policy-version") fixture.policy.version++;
    if (change === "legacy") { fixture.session().operatorId = null; fixture.session().permissionVersion = null; }
    if (change === "expired") fixture.session().expiresAt = new Date(0);
    if (change === "foreign-grant") fixture.operator.branchGrants[0].tenantId = "foreign";
    expect((await GET()).status).toBe(401);
    expect(storage.insert).toHaveBeenCalledTimes(1);
  });
  it("withholds the real cookie when policy changes after issuance and before delivery verification", async () => {
    const fixture = await realSessionFixture();
    const transaction = storage.transaction.getMockImplementation();
    if (!transaction) throw new Error("Expected a synthetic transaction fixture");
    storage.transaction.mockImplementation(async (callback, options) => {
      const result = await transaction(callback, options);
      if (options?.isolationLevel === "ReadCommitted") { fixture.policy.mode = "ADMIN_ONLY"; fixture.policy.version++; }
      return result;
    });
    const response = await POST(request({ username: "Maria" }));
    expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toBeNull();
    expect(storage.insert).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
  });
  it("admits an existing named operator with scoped context and a protected cookie", async () => {
    const response = await POST(request({ username: "Operador" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    for (const flag of ["HttpOnly", "Secure", "SameSite=strict"]) expect(response.headers.get("set-cookie")).toContain(flag);
    const body = await response.json();
    expect(body).toMatchObject({ access: { role: "OPERATIONAL" }, context: { channel: "USERNAME",
      administrator: false, allBranches: false, branches: [{ code: "02", capabilities: ["workspace.read", "workspace.save"] }] } });
    expect(JSON.stringify(body)).not.toContain("tenant-private");
    expect(JSON.stringify(body)).not.toContain("operator-private");
    expect(mocks.create).toHaveBeenCalledWith("Operador");
    expect(mocks.verify).toHaveBeenCalledWith("opaque.signature");
  });
  it("rejects password fallback and browser authority fields", async () => {
    for (const body of [{ password: "old-password" }, { username: "O", tenantId: "foreign" }, { username: "O", capabilities: ["access.manage"] },
      { username: "O", branchCode: "07" }, { username: "O", role: "ADMIN" }, { username: "O", operatorId: "other" }, { username: "O".repeat(257) }, { username: "" }])
      expect((await POST(request(body))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("enforces origin and rate limits before admission", async () => {
    expect((await POST(request({ username: "O" }, "https://foreign.test"))).status).toBe(403);
    mocks.rate.mockResolvedValue(Response.json({}, { status: 429 }));
    expect((await POST(request({ username: "O" }))).status).toBe(429);
    expect(mocks.rate).toHaveBeenCalledWith(expect.any(Request), { keyPrefix: "escalas-access-unlock", limit: 5, windowMs: 900000 });
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("denies missing admission and a revocation racing cookie delivery", async () => {
    mocks.create.mockResolvedValueOnce(null);
    expect((await POST(request({ username: "unknown" }))).status).toBe(401);
    mocks.verify.mockResolvedValue(null);
    const response = await POST(request({ username: "O" }));
    expect(response.status).toBe(401); expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("reads effective scoped context and does not admit an unresolved legacy cookie", async () => {
    expect((await GET()).status).toBe(401);
    mocks.get.mockResolvedValue(scope());
    expect(await (await GET()).json()).toMatchObject({ context: { channel: "USERNAME", allBranches: false } });
  });
  it("preserves administrator precedence for GET and POST without looking up a username", async () => {
    mocks.policy.mockResolvedValue({ mode: "ADMIN_ONLY" });
    mocks.auth.mockResolvedValue({ user: { id: "admin", tenantId: "t", role: "ADMIN", status: "ACTIVE" } });
    for (const response of [await GET(), await POST(request({ username: "other" }))]) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ context: { channel: "ACCOUNT", administrator: true, allBranches: true } });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not fall back from blocked or unscoped accounts to a username cookie", async () => {
    for (const user of [{ id: "u", tenantId: "t", role: "ADMIN", status: "BLOCKED" },
      { id: "u", tenantId: null, role: "ADMIN", status: "ACTIVE" }]) {
      mocks.auth.mockResolvedValue({ user });
      expect((await GET()).status).toBe(403); expect((await POST(request({ username: "O" }))).status).toBe(403);
    }
    expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("projects an account grant under current policy without unioning a cookie", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "u", tenantId: "t", role: "OPERATOR", status: "ACTIVE" } });
    mocks.grants.mockResolvedValue([{ tenantId: "t", userId: "u", branchCode: "007", role: "VIEWER" }]);
    expect(await (await GET()).json()).toMatchObject({ context: { branches: [{ code: "07", capabilities: ["workspace.read", "export.schedule.pdf", "export.schedule.xlsx"] }] } });
    mocks.policy.mockResolvedValue({ mode: "ADMIN_ONLY" });
    expect(await (await GET()).json()).toMatchObject({ context: { branches: [] } });
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("reports infrastructure failure without granting context", async () => {
    mocks.create.mockRejectedValue(new Error("offline"));
    expect((await POST(request({ username: "O" }))).status).toBe(503);
    mocks.get.mockRejectedValue(new Error("offline"));
    expect((await GET()).status).toBe(503);
    mocks.revoke.mockRejectedValue(new Error("offline"));
    const refusal = await DELETE(new Request("http://localhost/api/escalas/access/session", { method: "DELETE", headers: { origin: "http://localhost" } }));
    expect(refusal.status).toBe(503); expect(refusal.headers.get("set-cookie")).toBeNull();
  });
  it("confirms server revocation before expiring only this module cookie", async () => {
    const response = await DELETE(new Request("http://localhost/api/escalas/access/session", {
      method: "DELETE", headers: { origin: "http://localhost", cookie: "perfectutilitares.unimed-access=keep; perfectutilitares.escalas-access=opaque" } }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ revoked: true });
    expect(mocks.revoke).toHaveBeenCalledWith("opaque");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).not.toContain("unimed-access");
    expect(PATCH().status).toBe(405);
  });
});
