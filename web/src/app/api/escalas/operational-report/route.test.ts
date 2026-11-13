import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { validateEscala } from "@/lib/escalas/validation";
import { EscalaError } from "@/lib/escalas/access";
import { GET, POST, HEAD } from "./route";

const mocks = vi.hoisted(() => ({ access: vi.fn(), get: vi.fn(), limit: vi.fn(), capacity: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: mocks.access }));
vi.mock("@/lib/escalas/service", () => ({ getEscala: mocks.get }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: mocks.limit }));
vi.mock("@/lib/system/resource-capacity", async original => ({ ...await original<typeof import("@/lib/system/resource-capacity")>(), assertResourceCapacity: mocks.capacity }));
beforeEach(() => {
  vi.resetAllMocks();
  const input = newInput("06", "Loja sintética", "2026-12", 42); input.visibleMonth = "2026-12";
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.employees = [{ ...newEmployee(42, "day"), id: "a", name: "Pessoa sintética", sector: "Setor A", role: "Atendente" }];
  input.assignments = [{ employeeId: "a", date: "2026-12-01", kind: "WORK", shiftId: "day" }];
  mocks.access.mockResolvedValue({ ok: true, actor: { tenantId: "tenant-a", userId: "user-a" } });
  mocks.get.mockResolvedValue({ id: "synthetic", revision: 19, status: "DRAFT", input, canEdit: true, canPublish: false, updatedAt: "2026-12-01", validation: { valid: true, readyToPublish: false, issues: [], summaries: [], minimumCoverageMargin: null } });
  mocks.limit.mockResolvedValue(null); mocks.capacity.mockResolvedValue(undefined);
});
const request = (extra = "") => new Request("http://localhost/api/escalas/operational-report?workspaceId=synthetic&revision=19&month=2026-12&format=pdf&section=journeys" + extra);
describe("GET optional operational PDF", () => {
  it("returns real PDF contents for the authorized saved revision without changing it", async () => {
    const original = structuredClone(await mocks.get()); mocks.get.mockClear();
    const response = await GET(request());
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-a" }), "synthetic");
    const bytes = new Uint8Array(await response.arrayBuffer()); expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"), task = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
    const document = await task.promise;
    try { const content = await (await document.getPage(1)).getTextContent(); const text = content.items.filter(item => "str" in item).map(item => item.str).join(" ");
      expect(text).toContain("Pessoa sintética"); expect(text).toContain("08:00-12:00"); expect(text).toContain("19");
    } finally { await task.destroy(); }
    expect(await mocks.get()).toEqual(original);
  });
  it.each(["&format=xlsx", "&sector=Other", "&date=2026-11-30", "&section=unknown"])("rejects invalid selections %s", async extra => {
    expect((await GET(request(extra))).status).toBe(400);
  });
  it("rejects a changed revision and preserves service tenant denial", async () => {
    const foreign = new Request(request().url, { headers: { origin: "https://foreign.invalid" } });
    expect((await GET(foreign)).status).toBe(403); expect(mocks.get).not.toHaveBeenCalled();
    expect((await GET(new Request(request().url.replace("revision=19", "revision=18")))).status).toBe(409);
    mocks.get.mockRejectedValue(new EscalaError(403, "DENIED", "Sem acesso"));
    expect((await GET(request())).status).toBe(403);
  });
  it("returns the access denial before loading data and permits GET only", async () => {
    mocks.access.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await GET(request())).status).toBe(401); expect(mocks.get).not.toHaveBeenCalled(); expect(POST().status).toBe(405);
    expect(HEAD().status).toBe(405);
  });
  it("returns a structured internal error without leaking exception contents", async () => {
    mocks.get.mockRejectedValue(new Error("synthetic-private-payload"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("synthetic-private-payload");
  });
  it.each((["REST_ONLY", "DAYS_AND_HOURS", "HOURS_ONLY"] as const).flatMap(mode => [false, true].map(withProtected => ({ mode, withProtected }))))("returns real reference PDF in $mode with protected=$withProtected without clearing pending state", async ({ mode, withProtected }) => {
    const current = await mocks.get();
    current.input.generationMode = mode;
    current.input.shifts[0].segments[2].end = 1020;
    current.input.assignments = withProtected ? [{ employeeId: "a", date: "2026-12-02", kind: "ABSENCE", locked: true }, { employeeId: "a", date: "2026-12-25", kind: "HOLIDAY", locked: true }] : [];
    current.input.needsRegeneration = true;
    current.validation = validateEscala(current.input);
    expect(current.validation.valid).toBe(false);
    const before = structuredClone(current);
    const response = await GET(request("&section=variants"));
    expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"), task = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
    const document = await task.promise;
    try {
      const parts: string[] = [];
      for (let i = 1; i <= document.numPages; i++) { const content = await (await document.getPage(i)).getTextContent(); parts.push(content.items.filter(item => "str" in item).map(item => item.str).join(" ")); }
      const text = parts.join(" ").replace(/\s+/g, " ");
      expect(text).toContain("Pessoa sintética"); expect(text).toContain("08:00-12:00"); expect(text).toContain("13:00-17:00");
      expect(text).toContain("sem grade diária"); expect(text).not.toMatch(/Calendário mensal|Mapa diário|Pessoas-dia/);
    } finally { await task.destroy(); }
    expect(current).toEqual(before); expect(current.input.needsRegeneration).toBe(true); expect(current.validation.valid).toBe(false);
  });
  it.each(["REST_ONLY", "DAYS_AND_HOURS", "HOURS_ONLY"] as const)("does not bypass an invalid real roster in %s", async mode => {
    const current = await mocks.get(); current.input.generationMode = mode; current.input.needsRegeneration = true;
    current.validation = validateEscala(current.input);
    const response = await GET(request()); expect(response.status).toBe(409);
    expect(mocks.capacity).not.toHaveBeenCalled();
  });
  it.each(["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const)("rejects the CI221 empty-reference fixture in %s instead of emitting a fabricated PDF", async mode => {
    const current = await mocks.get();
    current.input.generationMode = mode;
    current.input.employees[0].shiftIds = [];
    current.input.assignments = [{ employeeId: "a", date: "2026-12-02", kind: "ABSENCE", locked: true }, { employeeId: "a", date: "2026-12-25", kind: "HOLIDAY", locked: true }];
    current.validation = validateEscala(current.input);
    const before = structuredClone(current);
    const response = await GET(request("&section=variants"));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "ESCALA_REPORT_REFERENCES_INVALID" } });
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(mocks.capacity).not.toHaveBeenCalled(); expect(current).toEqual(before);
  });
  it("rejects invalid reference clocks without requiring a monthly roster", async () => {
    const current = await mocks.get(); current.input.assignments = []; current.input.needsRegeneration = true;
    current.input.shifts[0].segments[2].end = 1260; current.validation = validateEscala(current.input);
    expect((await GET(request())).status).toBe(409); expect(mocks.capacity).not.toHaveBeenCalled();
  });
  it("returns structured 422 instead of a completed PDF for unsupported identification", async () => {
    const current = await mocks.get(); current.input.employees[0].name = "Pessoa 漢";
    const response = await GET(request()); expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toContain("application/json"); expect(response.headers.get("content-disposition")).toBeNull();
    const body = await response.text(); expect(body).toContain("ESCALA_OPERATIONAL_FONT_UNSUPPORTED"); expect(body).not.toContain("漢");
  });
});
