import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST } from "./route";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), rate: vi.fn(), download: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: mocks.guard }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: mocks.rate }));
vi.mock("@/lib/escalas/shift-catalog/export", () => ({ downloadTurnoExport: mocks.download }));

const actor = { userId: "u1", tenantId: "t1", admin: true };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true, actor });
  mocks.rate.mockResolvedValue(null);
  mocks.download.mockResolvedValue({ bytes: new TextEncoder().encode("0001,08:00,12:00,14:00,18:24\r\n"), omissions: [], month: 12, year: 2026 });
});

describe("/api/escalas/turnos/export", () => {
  it.each(["TXT1", "TXT2"] as const)("downloads %s as private UTF-8 text with CRLF", async format => {
    const response = await GET(new Request(`http://localhost/api/escalas/turnos/export?manifestId=m1&format=${format}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toContain("\r\n");
    expect(mocks.download).toHaveBeenCalledWith(actor, "m1", format, false);
  });

  it("rejects unauthenticated and malformed downloads", async () => {
    mocks.guard.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/escalas/turnos/export?manifestId=x&format=TXT1"))).status).toBe(401);
    expect((await GET(new Request("http://localhost/api/escalas/turnos/export?manifestId=x&format=CSV"))).status).toBe(400);
  });

  it.each([{ name: "POST", handle: POST }, { name: "PATCH", handle: PATCH }, { name: "DELETE", handle: DELETE }])("rejects unsupported $name without invoking catalog operations", ({ handle }) => {
    const response = handle();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")?.split(",").map(method => method.trim())).toEqual(["GET"]);
    expect(mocks.download).not.toHaveBeenCalled();
  });
});
