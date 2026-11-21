import { beforeEach, describe, expect, it, vi } from "vitest";
import { listTurnoCatalogOptions } from "./catalog-options";
import { buildEscalaApprovedPolicy } from "../approved-policy";
import { escalaInputSchema } from "../schema";
import type { EscalaInput } from "../types";
import { GET, POST } from "../../../app/api/escalas/turnos/opcoes/route";

const state = vi.hoisted(() => ({ workspace: vi.fn(), revision: vi.fn(), catalog: vi.fn(), approval: vi.fn(), session: vi.fn(), user: vi.fn(), policy: vi.fn(),
  actor: { userId: null as string | null, tenantId: "t", admin: false, moduleSessionId: "session" }, limit: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: async () => ({ ok: true, actor: state.actor }) }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: state.limit }));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaWorkspace: { findFirst: state.workspace }, escalaRevision: { findUnique: state.revision },
  escalaModuleAccessPolicy: { findUnique: state.policy }, escalaModuleSession: { findFirst: state.session }, user: { findFirst: state.user },
  escalaBranchPolicyVersion: { findFirst: state.approval }, shiftCatalogEntry: { findMany: state.catalog } } }));
function fixture(): EscalaInput {
  return { schemaVersion: 1, branchCode: "01", branchName: "Filial sintética", startDate: "2026-11-30", endDate: "2027-01-03", visibleMonth: "2026-12",
    defaultWeeklyHours: 40, timeZone: "America/Sao_Paulo",
    policy: { source: "Fonte sintética", validFrom: "2026-01-01", validUntil: "2027-12-31", reviewed: true, reviewedBy: "Responsável", weeklyLimit: 44,
      dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60,
      maxConsecutiveWorkDays: 5, limitContinuousWorkBlocks: false, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false },
    employees: [{ id: "e1", registration: "0007", name: "Pessoa sintética", sector: "A", role: "Atendente", weeklyHours: 40, shiftIds: ["s1"],
      activeFrom: "", scheduleMode: "TIMED", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] }],
    shifts: [{ id: "s1", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }] }], assignments: [], demands: [] };
}
const query = { workspaceId: "w1", expectedRevision: 1, employeeId: "e1", effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-31", search: "", cursor: 0, limit: 1 };
const request = (extra = "") => new Request("http://localhost/api/escalas/turnos/opcoes?workspaceId=w1&expectedRevision=1&employeeId=e1&effectiveFrom=2026-12-01&effectiveUntil=2026-12-31&limit=1" + extra);
beforeEach(() => {
  vi.resetAllMocks(); state.actor = { userId: null, tenantId: "t", admin: false, moduleSessionId: "session" }; state.limit.mockResolvedValue(null);
  const input = escalaInputSchema.parse(fixture());
  state.workspace.mockResolvedValue({ id: "w1", tenantId: "t", branchCode: "01", branchName: "Filial", startDate: input.startDate, endDate: input.endDate, revision: 1, status: "DRAFT", updatedAt: new Date("2026-12-01") });
  state.revision.mockResolvedValue({ input, revision: 1, status: "DRAFT", approvedPolicyVersionId: "approval", createdAt: new Date("2026-12-01") });
  const built = buildEscalaApprovedPolicy({ input, version: 1, provenance: { tenantId: "t", approvedById: "admin", approvedAt: "2026-11-13T12:00:00.000Z", origin: null },
    selectedSeedAssignments: [], regimeModelSelections: [{ id: "model", label: "Modelo", employeeId: "e1" }] });
  if (!built.ok) throw new Error("Invalid options fixture");
  state.approval.mockResolvedValue({ ...built.value, id: "approval", approvedAt: new Date(built.value.approvedAt), revokedAt: null });
  state.policy.mockResolvedValue({ tenantId: "t", mode: "SCOPED", version: 1 });
  state.session.mockResolvedValue({ id: "session", tenantId: "t", operatorId: "o", permissionVersion: 1, accessPolicyVersion: 1,
    createdAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60000), revokedAt: null,
    operator: { id: "o", tenantId: "t", active: true, permissionVersion: 1, branchGrants: [{ tenantId: "t", operatorId: "o", branchCode: "01", active: true, capabilities: ["workspace.read", "shift.manage"] }] } });
  state.catalog.mockResolvedValue([{ code: 1500, firstIn: 480, firstOut: 720, secondIn: 780, secondOut: 1020 }]);
});
describe("contextual catalog options with real access and services", () => {
  it("returns only permitted existing definitions with exact context through HTTP", async () => {
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ context: { workspaceId: "w1", revision: 1, employeeId: "e1", effectiveFrom: query.effectiveFrom, effectiveUntil: query.effectiveUntil }, entries: [{ code: 1500 }], nextCursor: null, pageSize: 1 });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(state.catalog).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "t", code: { gt: 0 }, OR: [{ firstIn: 480, firstOut: 720, secondIn: 780, secondOut: 1020 }] } }));
    expect(POST().status).toBe(405);
  });
  it("returns an empty page instead of global fallback when no approved tuple matches", async () => {
    state.catalog.mockResolvedValue([{ code: 1501, firstIn: 420, firstOut: 660, secondIn: 0, secondOut: 0 }]);
    expect((await listTurnoCatalogOptions(state.actor, query)).entries).toEqual([]);
    state.catalog.mockResolvedValue([]); expect((await listTurnoCatalogOptions(state.actor, query)).entries).toEqual([]);
  });
  it("rejects stale revision, missing person, outside dates and revoked approval", async () => {
    expect((await GET(new Request(request().url.replace("expectedRevision=1", "expectedRevision=2")))).status).toBe(409);
    expect((await GET(new Request(request().url.replace("employeeId=e1", "employeeId=foreign")))).status).toBe(404);
    expect((await GET(new Request(request().url.replace("2026-12-31", "2027-01-04")))).status).toBe(400);
    const approval = await state.approval(); state.approval.mockResolvedValue({ ...approval, revokedAt: new Date() });
    expect((await GET(request())).status).toBe(409); expect(state.catalog).not.toHaveBeenCalled();
  });
  it("withholds the page after session revocation during the query", async () => {
    state.catalog.mockImplementationOnce(async () => { const session = await state.session(); state.session.mockResolvedValue({ ...session, revokedAt: new Date() }); return [{ code: 1500, firstIn: 480, firstOut: 720, secondIn: 780, secondOut: 1020 }]; });
    const response = await GET(request()); expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "ESCALA_ACCESS_REQUIRED" } });
  });
  it("keeps assignment eligibility for excluded or uncontrolled people without inventing options", async () => {
    const revision = await state.revision(); revision.input.employees[0].planningEnabled = false;
    expect((await listTurnoCatalogOptions(state.actor, query)).entries).toEqual([]); expect(state.catalog).not.toHaveBeenCalled();
  });
  it("withholds swap options for Afastados and restores them after return to an operational sector", async () => {
    state.actor = { userId: "admin", tenantId: "t", admin: true, moduleSessionId: "" };
    state.user.mockResolvedValue({ id: "admin", tenantId: "t", status: "ACTIVE", role: "ADMIN", securityVersion: 0 });
    const revision = await state.revision();
    const employee = revision.input.employees[0];
    employee.sector = " Afástados ";
    employee.planningEnabled = true;
    const excluded = await GET(request());
    expect(excluded.status).toBe(200);
    expect(await excluded.json()).toMatchObject({ entries: [], nextCursor: null });
    expect(state.catalog).not.toHaveBeenCalled();
    employee.sector = "A";
    const eligible = await GET(request());
    expect(eligible.status).toBe(200);
    expect(await eligible.json()).toMatchObject({ entries: [{ code: 1500 }] });
  });
  it("paginates and searches company-wide only for an authorized administrator", async () => {
    state.actor = { userId: "admin", tenantId: "t", admin: true, moduleSessionId: "" };
    state.user.mockResolvedValue({ id: "admin", tenantId: "t", status: "ACTIVE", role: "ADMIN", securityVersion: 0 });
    const rows = [1500, 1501, 1502].map(code => ({ code, firstIn: 480, firstOut: 720, secondIn: 780, secondOut: 1020 }));
    state.catalog.mockImplementation(async ({ where }) => rows.filter(row => row.code > where.code.gt));
    const page = await listTurnoCatalogOptions(state.actor, query); expect(page.entries.map(entry => entry.code)).toEqual([1500]); expect(page.nextCursor).toBe("1500");
    expect((await listTurnoCatalogOptions(state.actor, { ...query, cursor: 1500 })).entries[0].code).toBe(1501);
    expect((await listTurnoCatalogOptions(state.actor, { ...query, search: "1502" })).entries[0].code).toBe(1502);
  });
});
