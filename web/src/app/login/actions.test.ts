import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginAction } from "./actions";

const mocks = vi.hoisted(() => {
  class AuthError extends Error {}
  class SharedRateLimitUnavailableError extends Error {}

  return {
    AuthError,
    checkSharedRateLimit: vi.fn(),
    getClientIp: vi.fn(() => "203.0.113.10"),
    getHashedRateLimitKey: vi.fn(() => "login:hashed"),
    headers: vi.fn(async () => new Headers()),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    signIn: vi.fn(),
    signOut: vi.fn(),
    SharedRateLimitUnavailableError,
  };
});

vi.mock("next-auth", () => ({ AuthError: mocks.AuthError }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/auth", () => ({
  signIn: mocks.signIn,
  signOut: mocks.signOut,
}));
vi.mock("@/lib/api/rate-limit", () => ({
  checkSharedRateLimit: mocks.checkSharedRateLimit,
  getClientIp: mocks.getClientIp,
  getHashedRateLimitKey: mocks.getHashedRateLimitKey,
  SharedRateLimitUnavailableError: mocks.SharedRateLimitUnavailableError,
}));

function loginForm() {
  const form = new FormData();
  form.set("email", " User@Example.com ");
  form.set("password", "secret");
  form.set("callbackUrl", "/jornada");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClientIp.mockReturnValue("203.0.113.10");
  mocks.getHashedRateLimitKey.mockReturnValue("login:hashed");
});

describe("loginAction", () => {
  it("uses the shared persistent bucket with a hashed identifier", async () => {
    mocks.checkSharedRateLimit.mockResolvedValue({
      limited: false,
      remaining: 7,
      resetAt: Date.now() + 60_000,
    });
    mocks.signIn.mockResolvedValue(undefined);

    await expect(loginAction(loginForm())).rejects.toThrow(
      "REDIRECT:/jornada",
    );

    expect(mocks.getHashedRateLimitKey).toHaveBeenCalledWith(
      "login",
      "203.0.113.10\0user@example.com",
    );
    expect(mocks.checkSharedRateLimit).toHaveBeenCalledWith(
      "login:hashed",
      {
        limit: 8,
        windowMs: 15 * 60_000,
      },
    );
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it("blocks authentication when the shared limit is exceeded", async () => {
    mocks.checkSharedRateLimit.mockResolvedValue({
      limited: true,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });

    await expect(loginAction(loginForm())).rejects.toThrow(
      "REDIRECT:/login?error=rate&callbackUrl=%2Fjornada",
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("fails closed when the shared store is unavailable", async () => {
    mocks.checkSharedRateLimit.mockRejectedValue(
      new mocks.SharedRateLimitUnavailableError(),
    );

    await expect(loginAction(loginForm())).rejects.toThrow(
      "REDIRECT:/login?error=rate-unavailable&callbackUrl=%2Fjornada",
    );
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});
