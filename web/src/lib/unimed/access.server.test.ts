import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/api/security", () => ({
  jsonError: (status: number, code: string, message: string) =>
    Response.json({ error: { code, message } }, { status }),
}));

vi.mock("@/lib/unimed/module-session", () => ({
  getUnimedModuleSession: mocks.getSession,
}));

import { requireUnimedAccess } from "@/lib/unimed/access.server";

beforeEach(() => vi.clearAllMocks());

describe("password-protected Unimed access", () => {
  it("requires an active module session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const result = await requireUnimedAccess("VIEW");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      await expect(result.response.json()).resolves.toMatchObject({
        error: { code: "UNIMED_ACCESS_REQUIRED" },
      });
    }
  });

  it("allows standard calculation actions", async () => {
    mocks.getSession.mockResolvedValue({
      id: "session-1",
      tenantId: "tenant-1",
      level: "OPERATOR",
    });
    await expect(requireUnimedAccess("CALCULATE")).resolves.toEqual({
      ok: true,
      moduleSessionId: "session-1",
      tenantId: "tenant-1",
      accessLevel: "OPERATOR",
    });
  });

  it("blocks standard sessions from management actions", async () => {
    mocks.getSession.mockResolvedValue({
      id: "session-1",
      tenantId: "tenant-1",
      level: "OPERATOR",
    });
    const result = await requireUnimedAccess("PUBLISH");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("allows administrator sessions to manage the module", async () => {
    mocks.getSession.mockResolvedValue({
      id: "session-2",
      tenantId: "tenant-1",
      level: "ADMIN",
    });
    await expect(requireUnimedAccess("MANAGE_CONFIG")).resolves.toMatchObject({
      ok: true,
      accessLevel: "ADMIN",
    });
  });
});
