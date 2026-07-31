import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth, type AppSession } from "@/auth";
import {
  getPdfOwnerContext,
  getPdfPrincipal,
  pdfJobAccessWhere,
  type PdfOwnerContext,
} from "@/lib/pdf/access";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPdfPrincipal", () => {
  it("uses a stable IP HMAC for public admission regardless of the cookie", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.15" });
    const first = getPdfPrincipal(
      { ownerSessionHash: "a".repeat(64), session: null },
      headers,
    );
    const second = getPdfPrincipal(
      { ownerSessionHash: "b".repeat(64), session: null },
      headers,
    );

    expect(first).toEqual(second);
    expect(first.tier).toBe("public");
    expect(first.key).toMatch(/^ip:[a-f0-9]{64}$/);
    expect(first.key).not.toContain("203.0.113.15");
  });

  it("uses a hashed user principal after authentication", () => {
    const principal = getPdfPrincipal(
      { ownerSessionHash: null, session: session() },
      new Headers(),
    );

    expect(principal.tier).toBe("authenticated");
    expect(principal.key).toMatch(/^user:[a-f0-9]{64}$/);
    expect(principal.key).not.toContain("user-12345678");
  });
});

function session(role: "ADMIN" | "OPERATOR" = "OPERATOR"): AppSession {
  return {
    expires: new Date(Date.now() + 60_000).toISOString(),
    user: {
      id: "user-12345678",
      status: "ACTIVE",
      role,
    },
  };
}

describe("pdfJobAccessWhere", () => {
  it("isolates anonymous jobs by the hashed owner token", () => {
    const owner: PdfOwnerContext = {
      ownerSessionHash: "a".repeat(64),
      session: null,
    };

    expect(pdfJobAccessWhere(owner)).toEqual({
      OR: [{ ownerSessionHash: "a".repeat(64) }],
    });
  });

  it("allows a signed-in user to retain guest jobs from the same browser", () => {
    const owner: PdfOwnerContext = {
      ownerSessionHash: "b".repeat(64),
      session: session(),
    };

    expect(pdfJobAccessWhere(owner)).toEqual({
      OR: [
        { userId: "user-12345678" },
        { ownerSessionHash: "b".repeat(64) },
      ],
    });
  });

  it("does not match any owner without a session or cookie", () => {
    expect(
      pdfJobAccessWhere({ ownerSessionHash: null, session: null }),
    ).toEqual({ ownerSessionHash: "__missing_owner__" });
  });

  it("preserves unrestricted operational access for administrators", () => {
    expect(
      pdfJobAccessWhere({
        ownerSessionHash: null,
        session: session("ADMIN"),
      }),
    ).toEqual({});
  });
});

describe("getPdfOwnerContext", () => {
  it("creates a secure short-lived owner cookie for anonymous visitors", async () => {
    const set = vi.fn();
    vi.mocked(auth).mockResolvedValue(null as never);
    vi.mocked(cookies).mockResolvedValue({
      get: vi.fn(() => undefined),
      set,
    } as never);

    const owner = await getPdfOwnerContext({ createAnonymous: true });

    expect(owner.session).toBeNull();
    expect(owner.ownerSessionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(set).toHaveBeenCalledWith(
      "perfectutilitares.pdf-owner",
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        maxAge: 120 * 60,
        path: "/",
        sameSite: "lax",
      }),
    );
    expect(set.mock.calls[0]?.[1]).not.toBe(owner.ownerSessionHash);
  });
});
