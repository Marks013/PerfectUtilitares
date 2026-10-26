import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { unzipSync, strFromU8 } from "fflate";
import { readSheet } from "read-excel-file/node";
import type { AppSession } from "@/auth";
import type { EscalaWorkspace } from "@/lib/escalas/types";
import { EscalaError } from "@/lib/escalas/access";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ session: null as AppSession | null, get: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/escalas/service", () => ({ getEscala: mocks.get }));
function workspace(): EscalaWorkspace {
  const employee = { id: "e1", registration: "0001", name: "Ána Silva", sector: "Reposição", role: "Repositor", weeklyHours: 42 as const, shiftIds: ["day"], activeFrom: "2020-01-01", offMode: "VARIABLE" as const, fixedOffDays: [], offPattern: "ANY" as const, maxConsecutiveSundays: 1 as const, preferredOffDays: [], historyKnown: false, history: [] };
  return { id: "w1", revision: 3, status: "DRAFT", canEdit: true, canPublish: true, updatedAt: "2026-10-26",
    input: { schemaVersion: 1, branchCode: "2", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
      policy: { source: "", validFrom: "2026-01-01", validUntil: "2027-01-01", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 6, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
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
    expect(rows[1].slice(1, 5)).toEqual(["Açougue", "Açougueiro", "0002", "=FORMULA"]);
    const ana = rows.find((row) => row[4] === "Ána Silva" && row[5] === "2026-10-26");
    expect(ana?.[8]).toBe(504);
    expect(ana?.[9]).toBe(42);
  });
  it("exports a readable real PDF with a schedule and summary page", async () => {
    const response = await GET(new Request("http://localhost/api/escalas/export?id=w1&format=pdf"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    const document = await PDFDocument.load(await response.arrayBuffer());
    expect(document.getPageCount()).toBe(2);
    expect(document.getTitle()).toContain("Filial 2");
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
});
