import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSecurityStamp } from "@/lib/auth/security-stamp";
import { getHashedRateLimitKey, SharedRateLimitUnavailableError } from "@/lib/api/rate-limit";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  config: null as unknown,
  findUnique: vi.fn(),
  checkSharedRateLimit: vi.fn(),
}));

vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api/rate-limit")>(),
  checkSharedRateLimit: mocks.checkSharedRateLimit,
}));

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    mocks.config = config;
    return {
      auth: vi.fn(),
      handlers: { GET: vi.fn(), POST: vi.fn() },
      signIn: vi.fn(),
      signOut: vi.fn(),
    };
  },
}));

vi.mock("next-auth/providers/credentials", () => ({
  default: (provider: unknown) => provider,
}));

vi.mock("bcryptjs", () => ({
  compare: mocks.compare,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
    },
  },
}));

import "./auth";

type AuthUser = {
  id: string;
  tenantId: string | null;
  email: string;
  name: string;
  passwordHash: string;
  securityVersion: number;
  role: "ADMIN" | "OPERATOR";
  status: "ACTIVE" | "BLOCKED" | "BANNED";
};

type AuthConfiguration = {
  providers: Array<{
    authorize(credentials: unknown, request: Request): Promise<Record<string, unknown> | null>;
  }>;
  callbacks: {
    redirect(input: { url: string; baseUrl: string }): Promise<string>;
    jwt(input: {
      token: Record<string, unknown>;
      user?: Partial<AuthUser> & { securityStamp?: string };
    }): Promise<Record<string, unknown> | null>;
    session(input: {
      session: {
        user: Record<string, unknown>;
        expires: string;
      };
      token: Record<string, unknown>;
    }): { user: Record<string, unknown>; expires: string };
  };
};

const activeUser: AuthUser = {
  id: "user-1",
  tenantId: "tenant-1",
  email: "admin@example.test",
  name: "Administrador",
  passwordHash: "password-hash",
  securityVersion: 1,
  role: "ADMIN",
  status: "ACTIVE",
};

function authConfig() {
  return mocks.config as AuthConfiguration;
}

function loginRequest() {
  return new Request("https://perfectutilitares.example/api/auth/callback/credentials", {
    method: "POST",
    headers: { "x-real-ip": "203.0.113.10" },
  });
}

describe("NextAuth beta regression contract", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.checkSharedRateLimit.mockResolvedValue({ limited: false, remaining: 7 });
    process.env.APP_URL = "https://perfectutilitares.example";
    process.env.AUTH_URL = "https://perfectutilitares.example";
  });

  it("rejects malformed, inactive and invalid-password credentials", async () => {
    const authorize = authConfig().providers[0]?.authorize;
    expect(authorize).toBeDefined();

    await expect(authorize?.({ email: "invalid", password: "" }, loginRequest())).resolves.toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.checkSharedRateLimit).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValueOnce({ ...activeUser, status: "BLOCKED" });
    await expect(
      authorize?.({ email: activeUser.email, password: "password" }, loginRequest()),
    ).resolves.toBeNull();
    expect(mocks.compare).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValueOnce(activeUser);
    mocks.compare.mockResolvedValueOnce(false);
    await expect(
      authorize?.({ email: activeUser.email, password: "password" }, loginRequest()),
    ).resolves.toBeNull();
  });

  it("returns only session-safe fields for valid credentials", async () => {
    mocks.findUnique.mockResolvedValueOnce(activeUser);
    mocks.compare.mockResolvedValueOnce(true);

    const result = await authConfig().providers[0]?.authorize({
      email: "ADMIN@EXAMPLE.TEST",
      password: "password",
    }, loginRequest());

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { email: activeUser.email },
    });
    expect(result).toEqual({
      securityStamp: getSecurityStamp(activeUser),
      id: activeUser.id,
      tenantId: activeUser.tenantId,
      email: activeUser.email,
      name: activeUser.name,
      role: activeUser.role,
      status: activeUser.status,
    });
    expect(mocks.checkSharedRateLimit).toHaveBeenNthCalledWith(1,
      getHashedRateLimitKey("login", `203.0.113.10\0${activeUser.email}`),
      { limit: 8, windowMs: 15 * 60_000 },
    );
    expect(mocks.checkSharedRateLimit).toHaveBeenNthCalledWith(2,
      getHashedRateLimitKey("login-ip", "203.0.113.10"),
      { limit: 80, windowMs: 15 * 60_000 },
    );
  });

  it.each(["login", "login-ip"])("rejects credentials before lookup or bcrypt when %s is limited", async (prefix) => {
    mocks.checkSharedRateLimit.mockImplementation(async (key: string) => ({
      limited: key.startsWith(`${prefix}:`), remaining: 0,
    }));

    await expect(authConfig().providers[0]?.authorize({
      email: activeUser.email, password: "password",
    }, loginRequest())).resolves.toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("fails closed before lookup or bcrypt when the shared store is unavailable", async () => {
    const error = new SharedRateLimitUnavailableError();
    mocks.checkSharedRateLimit.mockRejectedValueOnce(error);

    await expect(authConfig().providers[0]?.authorize({
      email: activeUser.email, password: "password",
    }, loginRequest())).rejects.toBe(error);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.compare).not.toHaveBeenCalled();
  });

  it("allows relative and same-origin redirects while rejecting external origins", async () => {
    const redirect = authConfig().callbacks.redirect;

    await expect(
      redirect({ url: "/dashboard", baseUrl: "http://localhost:3000" }),
    ).resolves.toBe("https://perfectutilitares.example/dashboard");
    await expect(
      redirect({
        url: "https://perfectutilitares.example/conta?tab=senha",
        baseUrl: "http://localhost:3000",
      }),
    ).resolves.toBe(
      "https://perfectutilitares.example/conta?tab=senha",
    );
    await expect(
      redirect({
        url: "https://attacker.example/phishing",
        baseUrl: "http://localhost:3000",
      }),
    ).resolves.toBe("https://perfectutilitares.example");
  });

  it("refreshes cosmetic fields while preserving an existing JWT", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      ...activeUser,
      name: "Operador",
    });

    const token = await authConfig().callbacks.jwt({
      token: { id: activeUser.id, securityStamp: getSecurityStamp(activeUser) },
    });

    expect(token).toMatchObject({
      id: activeUser.id,
      email: activeUser.email,
      name: "Operador",
      role: activeUser.role,
      tenantId: activeUser.tenantId,
      status: activeUser.status,
    });
  });

  it.each([
    { role: "OPERATOR" },
    { status: "BLOCKED" },
    { tenantId: "tenant-2" },
    { email: "changed@example.test" },
    { passwordHash: "changed-hash" },
    { securityVersion: 2 },
  ])("invalidates an existing JWT after a security change: %j", async (change) => {
    mocks.findUnique.mockResolvedValueOnce({ ...activeUser, ...change });
    await expect(authConfig().callbacks.jwt({
      token: { id: activeUser.id, securityStamp: getSecurityStamp(activeUser) },
    })).resolves.toBeNull();
  });

  it("invalidates a legacy JWT without a security stamp", async () => {
    mocks.findUnique.mockResolvedValueOnce(activeUser);
    await expect(authConfig().callbacks.jwt({
      token: { id: activeUser.id },
    })).resolves.toBeNull();
  });

  it("invalidates a deleted JWT subject", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);

    const token = await authConfig().callbacks.jwt({
      token: { id: activeUser.id, securityStamp: getSecurityStamp(activeUser) },
    });

    expect(token).toBeNull();
  });

  it("projects the JWT identity into the session", () => {
    const session = authConfig().callbacks.session({
      session: {
        user: { email: null, name: null },
        expires: "2099-01-01T00:00:00.000Z",
      },
      token: {
        id: activeUser.id,
        tenantId: activeUser.tenantId,
        email: activeUser.email,
        name: activeUser.name,
        role: activeUser.role,
        status: activeUser.status,
      },
    });

    expect(session.user).toMatchObject({
      id: activeUser.id,
      tenantId: activeUser.tenantId,
      email: activeUser.email,
      name: activeUser.name,
      role: activeUser.role,
      status: activeUser.status,
    });
  });
});
