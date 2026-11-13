import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/auth";
import { DELETE, GET, PATCH, POST } from "./route";

const mocks = vi.hoisted(() => ({
  session: null as AppSession | null,
  guard: vi.fn(),
  branches: vi.fn(),
  rate: vi.fn(),
  list: vi.fn(),
  sync: vi.fn(),
  preview: vi.fn(),
  apply: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: mocks.guard }));
vi.mock("@/lib/escalas/access", async original => ({ ...await original<typeof import("@/lib/escalas/access")>(), allowedBranches: mocks.branches }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: mocks.rate }));
vi.mock("@/lib/escalas/shift-catalog/catalog", () => ({ listTurnoCatalog: mocks.list, syncTurnoCatalog: mocks.sync }));
vi.mock("@/lib/escalas/shift-catalog/swap", () => ({ previewTurnoSwap: mocks.preview, applyTurnoSwap: mocks.apply }));

const actor = { userId: "u1", tenantId: "t1", admin: true };
const post = (body: unknown, origin = "http://localhost") => new Request("http://localhost/api/escalas/turnos", {
  method: "POST",
  headers: { origin, "content-type": "application/json" },
  body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { user: { id: "u1", tenantId: "t1", role: "ADMIN", status: "ACTIVE" }, expires: "2099" };
  mocks.guard.mockResolvedValue({ ok: true, actor });
  mocks.branches.mockResolvedValue(null);
  mocks.rate.mockResolvedValue(null);
  mocks.list.mockResolvedValue({ entries: [{ code: 1500, markings: ["08:00", "12:00", "14:00", "18:24"], name: "08:00 12:00 14:00 18:24" }], nextCursor: null, pageSize: 30 });
  mocks.sync.mockResolvedValue({ entries: [], createdCount: 1, unchangedCount: 0 });
  mocks.preview.mockResolvedValue({ previewId: "a".repeat(64), workspaceId: "w1", expectedRevision: 3, employeeId: "e1", registration: "0001", target: { code: 1500, markings: ["08:00", "12:00", "14:00", "18:24"], name: "08:00 12:00 14:00 18:24" }, affected: [], preserved: [], validationIssues: [], validationLevel: "FULL_SCHEDULE", canApply: true });
  mocks.apply.mockResolvedValue({ id: "w1", revision: 4, status: "DRAFT" });
});

describe("/api/escalas/turnos", () => {
  it("lists searchable company-catalog entries", async () => {
    const response = await GET(new Request("http://localhost/api/escalas/turnos?search=08%3A00&cursor=1499&limit=10"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ entries: [{ code: 1500 }], nextCursor: null });
    expect(mocks.list).toHaveBeenCalledWith(actor, "08:00", 1499, 10);
  });

  it("registers selected December references through the explicit transaction action", async () => {
    const response = await POST(post({ action: "SYNC", confirm: true, sources: [{ workspaceId: "w1", expectedRevision: 3, localShiftIds: ["s1"] }] }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ createdCount: 1 });
    expect(mocks.sync).toHaveBeenCalledWith(actor, expect.objectContaining({ action: "SYNC", confirm: true }));
  });

  it("previews and applies a collaborator swap only after explicit confirmation", async () => {
    const base = { workspaceId: "w1", expectedRevision: 3, employeeId: "e1", catalogCode: 1500, effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-31" };
    const preview = await POST(post({ action: "PREVIEW_SWAP", ...base }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).previewId).toBe("a".repeat(64));
    const applied = await POST(post({ action: "APPLY_SWAP", ...base, previewId: "a".repeat(64), confirm: true }));
    expect(applied.status).toBe(200);
    expect(await applied.json()).toMatchObject({ revision: 4 });
    expect(mocks.apply).toHaveBeenCalledWith(actor, expect.objectContaining({ previewId: "a".repeat(64), confirm: true }));
  });

  it("rejects unauthenticated, foreign-origin and malformed requests", async () => {
    mocks.guard.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/escalas/turnos"))).status).toBe(401);
    expect((await POST(post({ action: "SYNC" }, "https://foreign.test"))).status).toBe(403);
    expect((await POST(post({ action: "UNKNOWN" }))).status).toBe(400);
  });

  it.each([{ name: "PATCH", handle: PATCH }, { name: "DELETE", handle: DELETE }])("rejects unsupported $name without invoking catalog operations", ({ handle }) => {
    const response = handle();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")?.split(",").map(method => method.trim())).toEqual(["GET","POST"]);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
