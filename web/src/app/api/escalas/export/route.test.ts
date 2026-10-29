import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfJsServerDocumentOptions } from "@/lib/pdf/pdfjs-server";
import { unzipSync, strFromU8 } from "fflate";
import { readSheet } from "read-excel-file/node";
import type { AppSession } from "@/auth";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaError } from "@/lib/escalas/access";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ session: null as AppSession | null, get: vi.fn() }));
vi.mock("@/lib/escalas/module-session", () => ({ getEscalaModuleSession: vi.fn(async () => null) }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/escalas/service", () => ({ getEscala: mocks.get }));
function workspace(): EscalaWorkspace {
  const employee = { id: "e1", registration: "0001", name: "Ána Silva", sector: "Reposição", role: "Repositor", weeklyHours: 42 as const, shiftIds: ["day"], activeFrom: "2020-01-01", offMode: "VARIABLE" as const, fixedOffDays: [], offPattern: "ANY" as const, maxConsecutiveSundays: 1 as const, preferredOffDays: [], historyKnown: false, history: [] };
  return { id: "w1", revision: 3, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-10-26",
    input: { schemaVersion: 1, branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
      policy: { source: "", validFrom: "2026-01-01", validUntil: "2027-01-01", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
      employees: [employee, { ...employee, id: "e2", registration: "0002", name: "=FORMULA", sector: "Açougue", role: "Açougueiro" }],
      shifts: [{ id: "day", name: "Diurno", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
      assignments: [{ employeeId: "e1", date: "2026-10-26", kind: "WORK", shiftId: "day" }], demands: [] },
    validation: { valid: true, readyToPublish: false, issues: [{ code: "HISTORY_PENDING", severity: "PENDING", employeeId: "e1", date: "2026-10-26", message: "Histórico ainda não informado" }], summaries: [{ employeeId: "e1", workedMinutes: 504, workDays: 1, offDays: 0, maxStreak: 1, sundaysWorked: 0 }], minimumCoverageMargin: null } };
}
beforeEach(() => { vi.resetAllMocks(); mocks.session = { user: { id: "u1", tenantId: "t1", role: "ADMIN", status: "ACTIVE" }, expires: "2099" }; mocks.get.mockResolvedValue(workspace()); });

describe("/api/escalas/export", () => {
  it("exports a real XLSX from the authorized exact revision with grouping and literal formula-like names", async () => {
    const response = await GET(new Request("http://localhost/api/escalas/export?id=w1&format=xlsx&revision=3"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toContain("v3.xlsx");
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1", 3);
    const bytes = Buffer.from(await response.arrayBuffer());
    const zip = unzipSync(bytes);
    const content = strFromU8(zip["xl/worksheets/sheet1.xml"]);
    expect(content).not.toContain("<f>");
    expect(content).toContain("=FORMULA");
    const rows = await readSheet(bytes);
    expect(rows[3].slice(0, 4)).toEqual(["Setor", "Matrícula", "Colaborador", "Cargo"]);
    expect(rows[3]).toHaveLength(12);
    expect(rows.some(row => row[0] === "Setor: Açougue")).toBe(true);
    expect(rows.find(row => row[2] === "=FORMULA")?.slice(0, 4)).toEqual(["Açougue", "0002", "=FORMULA", "Açougueiro"]);
    const ana = rows.find((row) => row[2] === "Ána Silva");
    expect(ana?.slice(5)).toEqual(["T01", "NP", "NP", "NP", "NP", "NP", "NP"]);
    const details = await readSheet(bytes, "Horarios");
    const detail = details.find(row => row[2] === "Ána Silva");
    expect(detail?.[4]).toBe("T01");
    expect(detail?.[7]).toBe("08:24");
    expect(strFromU8(zip["xl/workbook.xml"])).toContain("$1:$4");
  });
  it("exports a readable compact draft PDF without the removed load summary", async () => {
    const response = await GET(new Request("http://localhost/api/escalas/export?id=w1&format=pdf&mode=rest"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(1);
    expect(document.getTitle()).toContain("Filial 2");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = pdfjs.getDocument(pdfJsServerDocumentOptions(bytes));
    const readable = await loading.promise;
    try {
      const page = await readable.getPage(1);
      const content = await page.getTextContent();
      const text = content.items.filter(item => "str" in item).map(item => item.str).join(" ");
      expect(text).toContain("Ána Silva");
      expect(text).toContain("=FORMULA");
      expect(text).toContain("T01");
      expect(text).toContain("RASCUNHO");
      expect(text).not.toContain("Resumo de carga e turnos");
    } finally { await loading.destroy(); }
  });
  it("fails closed for missing access and rejects invalid formats/versions", async () => {
    mocks.get.mockRejectedValue(new EscalaError(404, "ESCALA_NOT_FOUND", "Escala não encontrada."));
    expect((await GET(new Request("http://localhost/api/escalas/export?id=foreign&format=pdf"))).status).toBe(404);
    expect((await GET(new Request("http://localhost/api/escalas/export?id=w1&format=csv"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/escalas/export?id=w1&format=pdf&revision=0"))).status).toBe(400);
    mocks.session = null;
    expect((await GET(new Request("http://localhost/api/escalas/export?id=w1&format=pdf"))).status).toBe(401);
    expect(POST().status).toBe(405);
  });
  it.each(["pdf", "xlsx"])("rejects %s exports of a persisted stale scenario with a direct recovery message", async (format) => {
    const current = workspace();
    current.input = { ...current.input, needsRegeneration: true };
    mocks.get.mockResolvedValue(current);
    const response = await GET(new Request(`http://localhost/api/escalas/export?id=w1&format=${format}`));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(expect.objectContaining({ error: expect.objectContaining({ code: "ESCALA_SCENARIO_OUTDATED", message: expect.stringContaining("Gere") }) }));
  });

});

describe("/api/escalas/export mode boundaries", () => {
  it.each(["rest", "hours", "both"] as const)("exports real %s worksheets from the authorized revision", async (mode) => {
    const response = await GET(new Request("http://localhost/api/escalas/export?id=w1&format=xlsx&revision=3&mode=" + mode));
    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer()), archive = unzipSync(bytes), workbook = strFromU8(archive["xl/workbook.xml"]);
    expect(workbook.includes('name="Escala"')).toBe(mode !== "hours");
    expect(workbook.includes('name="Horarios"')).toBe(mode !== "rest");
    if (mode !== "rest") {
      const rows = await readSheet(Buffer.from(bytes), "Horarios");
      expect(rows).toContainEqual(["Reposição", "0001", "Ána Silva", "Repositor", "T01", "08:00-12:00 / 13:00-17:24", "12:00-13:00", "08:24"]);
    }
    expect(mocks.get).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "t1" }), "w1", 3);
  });
  it("rejects an unknown export view without reading a workspace", async () => {
    const response = await GET(new Request("http://localhost/api/escalas/export?id=w1&format=pdf&mode=invalid"));
    expect(response.status).toBe(400); expect(mocks.get).not.toHaveBeenCalled();
  });
});

it("requires recalculation of legacy six-day reports instead of silently exporting them", async () => {
  const current = workspace(); current.input.policy.maxConsecutiveWorkDays = 6; mocks.get.mockResolvedValue(current);
  const response = await GET(new Request("http://localhost/api/escalas/export?id=w1&format=xlsx"));
  expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: { code: "ESCALA_SCENARIO_OUTDATED" } });
});
