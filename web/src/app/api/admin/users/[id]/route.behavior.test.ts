import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  removePdfJobFiles: vi.fn(),
  deleteAccount: vi.fn(),
}));

const session = {
  user: {
    id: "admin-user-id",
    tenantId: "tenant-test-id",
    email: "admin@example.test",
    name: "Admin",
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
  },
  expires: "2099-01-01T00:00:00.000Z",
};

vi.mock("@/lib/api/security", () => ({
  enforcePersistentRateLimit: async () => null,
  enforceRateLimit: () => null,
  jsonError: (
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) => Response.json({ error: { code, message, details } }, { status }),
  methodNotAllowed: (allowed: string[]) =>
    new Response(null, {
      status: 405,
      headers: { Allow: allowed.join(", ") },
    }),
  readJsonBody: async (request: Request) => {
    try {
      return { ok: true as const, data: await request.json() };
    } catch {
      return {
        ok: false as const,
        response: Response.json(
          { error: { code: "INVALID_JSON" } },
          { status: 400 },
        ),
      };
    }
  },
  requireAdmin: async () => ({ ok: true as const, session }),
  requireContentType: () => null,
  requireMaxContentLength: () => null,
  requireSameOrigin: () => null,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));

vi.mock("@/lib/pdf/storage", () => ({
  removePdfJobFiles: mocks.removePdfJobFiles,
}));

vi.mock("@/lib/users/account-mutations", () => ({
  adminUserSelect: { id: true, email: true },
  updateUserWithAdminInvariant: mocks.update,
  deleteAccountWithAdminInvariant: mocks.deleteAccount,
}));

import { DELETE, GET, PATCH } from "./route";

const origin = "http://localhost:3000";
const targetId = "target-user-id";

function context(id = targetId) {
  return { params: Promise.resolve({ id }) };
}

function request(method: string, body?: unknown) {
  return new Request(`${origin}/api/admin/users/${targetId}`, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      "x-forwarded-for": `admin-user-behavior-${method}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("admin user resource behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: targetId,
      email: "user@example.test",
    });
    mocks.update.mockResolvedValue({
      ok: true,
      user: { id: targetId, email: "updated@example.test" },
    });
    mocks.deleteAccount.mockResolvedValue({
      ok: true,
      user: {
        id: targetId,
        email: "user@example.test",
        tenantId: "tenant-test-id",
        role: "OPERATOR",
        status: "ACTIVE",
      },
      pdfJobIds: ["pdf-job-one", "pdf-job-two"],
    });
    mocks.removePdfJobFiles.mockResolvedValue(undefined);
  });

  it("reads an existing user and rejects invalid or missing ids", async () => {
    const success = await GET(request("GET"), context());
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toMatchObject({ id: targetId });

    const invalid = await GET(request("GET"), context("short"));
    expect(invalid.status).toBe(400);

    mocks.findUnique.mockResolvedValueOnce(null);
    const missing = await GET(request("GET"), context());
    expect(missing.status).toBe(404);
  });

  it("validates PATCH identity and body before persistence", async () => {
    const self = await PATCH(
      request("PATCH", { name: "Updated" }),
      context(session.user.id),
    );
    expect(self.status).toBe(400);

    const invalidId = await PATCH(
      request("PATCH", { name: "Updated" }),
      context("short"),
    );
    expect(invalidId.status).toBe(400);

    const empty = await PATCH(request("PATCH", {}), context());
    expect(empty.status).toBe(400);

    const malformed = await PATCH(
      new Request(`${origin}/api/admin/users/${targetId}`, {
        method: "PATCH",
        headers: { origin, "content-type": "application/json" },
        body: "{",
      }),
      context(),
    );
    expect(malformed.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates a user and maps invariant outcomes", async () => {
    const success = await PATCH(
      request("PATCH", { name: "Updated User" }),
      context(),
    );
    expect(success.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith({
      targetUserId: targetId,
      actorUserId: session.user.id,
      data: { name: "Updated User" },
    });

    mocks.update.mockResolvedValueOnce({
      ok: false,
      reason: "USER_NOT_FOUND",
    });
    expect(
      (await PATCH(request("PATCH", { role: "OPERATOR" }), context())).status,
    ).toBe(404);

    mocks.update.mockResolvedValueOnce({
      ok: false,
      reason: "LAST_ACTIVE_ADMIN",
    });
    expect(
      (await PATCH(request("PATCH", { status: "BLOCKED" }), context())).status,
    ).toBe(400);
  });

  it("deletes a user, cleans every PDF job and maps invariant outcomes", async () => {
    const success = await DELETE(request("DELETE"), context());
    expect(success.status).toBe(200);
    await expect(success.json()).resolves.toEqual({ id: targetId });
    expect(mocks.removePdfJobFiles).toHaveBeenCalledTimes(2);

    const self = await DELETE(request("DELETE"), context(session.user.id));
    expect(self.status).toBe(400);

    const invalid = await DELETE(request("DELETE"), context("short"));
    expect(invalid.status).toBe(400);

    mocks.deleteAccount.mockResolvedValueOnce({
      ok: false,
      reason: "USER_NOT_FOUND",
    });
    expect((await DELETE(request("DELETE"), context())).status).toBe(404);

    mocks.deleteAccount.mockResolvedValueOnce({
      ok: false,
      reason: "LAST_ACTIVE_ADMIN",
    });
    expect((await DELETE(request("DELETE"), context())).status).toBe(400);
  });
});
