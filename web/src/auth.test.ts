import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  config: null as unknown,
  findUnique: vi.fn(),
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
  role: "ADMIN" | "OPERATOR";
  status: "ACTIVE" | "BLOCKED" | "BANNED";
};

type AuthConfiguration = {
  providers: Array<{
    authorize(credentials: unknown): Promise<Record<string, unknown> | null>;
  }>;
  callbacks: {
    redirect(input: { url: string; baseUrl: string }): Promise<string>;
    jwt(input: {
      token: Record<string, unknown>;
      user?: Partial<AuthUser>;
    }): Promise<Record<string, unknown>>;
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
  role: "ADMIN",
  status: "ACTIVE",
};

function authConfig() {
  return mocks.config as AuthConfiguration;
}

describe("NextAuth beta regression contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = "https://perfectutilitares.example";
    process.env.AUTH_URL = "https://perfectutilitares.example";
  });

  it("rejects malformed, inactive and invalid-password credentials", async () => {
    const authorize = authConfig().providers[0]?.authorize;
    expect(authorize).toBeDefined();

    await expect(authorize?.({ email: "invalid", password: "" })).resolves.toBeNull();
    expect(mocks.findUnique).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValueOnce({ ...activeUser, status: "BLOCKED" });
    await expect(
      authorize?.({ email: activeUser.email, password: "password" }),
    ).resolves.toBeNull();
    expect(mocks.compare).not.toHaveBeenCalled();

    mocks.findUnique.mockResolvedValueOnce(activeUser);
    mocks.compare.mockResolvedValueOnce(false);
    await expect(
      authorize?.({ email: activeUser.email, password: "password" }),
    ).resolves.toBeNull();
  });

  it("returns only session-safe fields for valid credentials", async () => {
    mocks.findUnique.mockResolvedValueOnce(activeUser);
    mocks.compare.mockResolvedValueOnce(true);

    const result = await authConfig().providers[0]?.authorize({
      email: "ADMIN@EXAMPLE.TEST",
      password: "password",
    });

    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { email: activeUser.email },
    });
    expect(result).toEqual({
      id: activeUser.id,
      tenantId: activeUser.tenantId,
      email: activeUser.email,
      name: activeUser.name,
      role: activeUser.role,
      status: activeUser.status,
    });
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

  it("refreshes mutable authorization fields in existing JWTs", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      email: "operator@example.test",
      name: "Operador",
      role: "OPERATOR",
      tenantId: "tenant-2",
      status: "BLOCKED",
    });

    const token = await authConfig().callbacks.jwt({
      token: { id: activeUser.id, role: "ADMIN", status: "ACTIVE" },
    });

    expect(token).toMatchObject({
      id: activeUser.id,
      email: "operator@example.test",
      name: "Operador",
      role: "OPERATOR",
      tenantId: "tenant-2",
      status: "BLOCKED",
    });
  });

  it("marks a deleted JWT subject as banned", async () => {
    mocks.findUnique.mockResolvedValueOnce(null);

    const token = await authConfig().callbacks.jwt({
      token: { id: "deleted-user", status: "ACTIVE" },
    });

    expect(token.status).toBe("BANNED");
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
