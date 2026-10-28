import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSession } from "@/auth";
import { ESCALA_IMPORT_TEMPLATE } from "@/lib/escalas/import";
import { DELETE, GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ session: null as AppSession | null, rate: vi.fn(), grant: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => mocks.session) }));
vi.mock("@/lib/api/security", async (original) => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: mocks.rate }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaBranchAccess: { findUnique: mocks.grant } } }));
function upload(content = ESCALA_IMPORT_TEMPLATE, name = "base.csv", type = "text/csv", fields = { branchCode: "2", startDate: "2026-10-26", defaultWeeklyHours: "42" }) {
  const body = new FormData();
  Object.entries(fields).forEach(([key, value]) => { body.set(key, value); });
  body.set("file", new File([content], name, { type }));
  return new Request("http://localhost/api/escalas/import", { method: "POST", headers: { origin: "http://localhost" }, body });
}
beforeEach(() => { vi.resetAllMocks(); mocks.session = { user: { id: "u1", tenantId: "t1", role: "ADMIN", status: "ACTIVE" }, expires: "2099" }; mocks.rate.mockResolvedValue(null); });

describe("/api/escalas/import", () => {
  it("previews one complete FPRE136 CSV with only the authorized branch and retains employees without schedules", async () => {
    const report = '0001,-,Empresa,Pág.:,1\nQuadro de Horários\n,Nome,Cargo,Horário\n"02.01 , ICARAIMA, ADMINISTRATIVO"\nHorário:,0011,-,Sem horário\n1,-,Pessoa Sintética,Operador,00:00,-,00:00,00:00,-,00:00\nSábado:,00:00,-,00:00,00:00,-,00:00,00:00,0011\n"06.02 , BIG, LOJA"\n2,-,Outra Pessoa,Operador,07:00,-,11:00,13:00,-,16:20\nSábado:,07:00,-,11:00,13:00,-,16:20,07:00,0026';
    const response = await POST(upload(report, "FPRE136.CSV"));
    expect(response.status).toBe(200);
    const { preview } = await response.json();
    expect(preview.report).toMatchObject({ branchCode: "02", sourceEmployees: 2, otherBranchesExcluded: 1, missingSchedule: 1 });
    expect(preview.employees).toHaveLength(1);
    expect(preview.employees[0]).toMatchObject({ registration: "1", activeFrom: "", planningEnabled: true, scheduleMode: "MISSING", shiftIds: [], sundayRestRule: "PROTECTIVE" });
    expect(preview.issues).toEqual([]);
    expect(preview.shifts).toEqual([]);
    expect(JSON.stringify(preview)).not.toContain("Outra Pessoa");
  });
  it("downloads a private explicit template and previews real CSV without persistence", async () => {
    const template = await GET();
    expect(template.status).toBe(200);
    expect(template.headers.get("cache-control")).toBe("private, no-store");
    expect(await template.text()).toContain("Admissao");
    const response = await POST(upload());
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.preview.employees[0]).toMatchObject({ registration: "0001", activeFrom: "2020-01-01", historyKnown: false });
    expect(result.preview.shifts[0].segments).toHaveLength(3);
    expect(result.preview.issues).toEqual([]);
  });
  it("rejects operators without branch permission before processing personal cells", async () => {
    if (mocks.session) mocks.session.user.role = "OPERATOR";
    mocks.grant.mockResolvedValue(null);
    const response = await POST(upload());
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ESCALA_BRANCH_FORBIDDEN");
  });
  it("rejects spreadsheet impostors and unsupported file types", async () => {
    const impostor = await POST(upload("not-a-zip", "base.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    expect(impostor.status).toBe(400);
    expect((await impostor.json()).error.code).toBe("XLSX_UNSAFE");
    expect((await POST(upload("data", "base.xls", "application/vnd.ms-excel"))).status).toBe(415);
  });
  it("rejects invalid options, unknown layouts, oversized uploads and missing sessions", async () => {
    expect((await POST(upload(ESCALA_IMPORT_TEMPLATE, "base.csv", "text/csv", { branchCode: "2", startDate: "2026-02-30", defaultWeeklyHours: "42" }))).status).toBe(400);
    expect((await POST(upload("FPRE131\nDados"))).status).toBe(400);
    expect((await POST(upload("x".repeat(513 * 1024)))).status).toBe(400);
    mocks.session = null;
    expect((await GET()).status).toBe(401);
    expect((await POST(upload())).status).toBe(401);
    expect(DELETE().status).toBe(405);
  });
});
