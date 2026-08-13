import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generatePresenceInvitationToken,
  generatePresenceSessionToken,
  generatePresenceShortCode,
  getPresenceCookieName,
  getPresenceCookieOptions,
  hashPresenceSecret,
} from "@/lib/presence/tokens";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("presence tokens", () => {
  it("generates high-entropy invitation and session tokens", () => {
    expect(generatePresenceInvitationToken()).toMatch(
      /^c_[A-Za-z0-9_-]{43}$/,
    );
    expect(generatePresenceSessionToken()).toMatch(/^s_[A-Za-z0-9_-]{43}$/);
    expect(generatePresenceShortCode()).toMatch(/^p_[A-Za-z0-9_-]{16}$/);
  });

  it("hashes secrets with the application secret", () => {
    vi.stubEnv("AUTH_SECRET", "test-secret-with-enough-entropy");
    expect(hashPresenceSecret("same-token")).toBe(
      hashPresenceSecret("same-token"),
    );
    expect(hashPresenceSecret("same-token")).not.toBe(
      hashPresenceSecret("other-token"),
    );
  });

  it("uses isolated cookie names for different invitations", () => {
    expect(getPresenceCookieName("evento-a", "ana")).not.toBe(
      getPresenceCookieName("evento-a", "bruno"),
    );
  });

  it("creates an HttpOnly same-site cookie", () => {
    const options = getPresenceCookieOptions(
      new Date("2026-09-01T00:00:00.000Z"),
    );
    expect(options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });
});
