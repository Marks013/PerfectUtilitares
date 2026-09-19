import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginAction } from "./actions";

const mocks = vi.hoisted(() => {
  class AuthError extends Error {}

  return {
    AuthError,
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
});

vi.mock("next-auth", () => ({ AuthError: mocks.AuthError }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/auth", () => ({
  signIn: mocks.signIn,
  signOut: mocks.signOut,
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
  mocks.signIn.mockReset();
});

describe("loginAction", () => {
  it("passes normalized credentials to the shared authentication boundary", async () => {
    mocks.signIn.mockResolvedValue(undefined);

    await expect(loginAction(loginForm())).rejects.toThrow(
      "REDIRECT:/jornada",
    );

    expect(mocks.signIn).toHaveBeenCalledWith("credentials", {
      email: "user@example.com",
      password: "secret",
      redirect: false,
    });
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it("redirects authentication failures without losing the callback URL", async () => {
    mocks.signIn.mockRejectedValueOnce(new mocks.AuthError());

    await expect(loginAction(loginForm())).rejects.toThrow(
      "REDIRECT:/login?error=credentials&callbackUrl=%2Fjornada",
    );
    expect(mocks.redirect).not.toHaveBeenCalledWith("/jornada");
  });

  it("propagates unexpected authentication failures without a success redirect", async () => {
    const error = new Error("Authentication service unavailable");
    mocks.signIn.mockRejectedValueOnce(error);

    await expect(loginAction(loginForm())).rejects.toBe(error);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
