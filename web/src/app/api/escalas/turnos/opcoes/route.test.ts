import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ guard: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: state.guard }));
import { GET } from "./route";
beforeEach(() => { vi.resetAllMocks(); state.guard.mockResolvedValue({ ok: true, actor: { tenantId: "t", userId: "a", admin: true } }); });
it("rejects unknown, duplicated and oversized query context before persistence", async () => {
  const url = "http://localhost/api/escalas/turnos/opcoes?workspaceId=w&expectedRevision=1&employeeId=p&effectiveFrom=2026-12-01&effectiveUntil=2026-12-31";
  for (const extra of ["&limit=101", "&workspaceId=other", "&tenantId=other", "&cursor=-1"]) expect((await GET(new Request(url + extra))).status).toBe(400);
});
it("preserves denial without consulting source data", async () => {
  state.guard.mockResolvedValue({ ok: false, response: Response.json({ error: { code: "DENIED" } }, { status: 401 }) });
  expect((await GET(new Request("http://localhost/api/escalas/turnos/opcoes"))).status).toBe(401);
});
