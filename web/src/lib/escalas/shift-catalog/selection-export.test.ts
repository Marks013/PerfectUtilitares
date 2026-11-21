import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaInput } from "../types";
import type { TurnoSelectionManifestRequest } from "./flow-contracts";
import { createTurnoSelectionManifest, downloadTurnoSelection } from "./selection-export";
import { POST } from "../../../app/api/escalas/turnos/export/manifest/route";
import { GET } from "../../../app/api/escalas/turnos/export/route";

const state = vi.hoisted(() => ({ sources: new Map<string, { input: unknown; revision: number }>(), manifests: new Map<string, unknown>(),
  actor: { userId: "admin", tenantId: "t", admin: true }, user: vi.fn(), grants: vi.fn(), policy: vi.fn(), catalog: vi.fn(), count: vi.fn(), create: vi.fn(), read: vi.fn(),
  workspace: vi.fn(), revision: vi.fn(), limit: vi.fn(), queryRaw: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: async () => ({ ok: true, actor: state.actor }) }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: state.limit }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $queryRaw: state.queryRaw,
  user: { findFirst: state.user }, escalaModuleAccessPolicy: { findUnique: state.policy },
  escalaBranchAccess: { findMany: state.grants },
  escalaWorkspace: { findFirst: state.workspace }, escalaRevision: { findUnique: state.revision },
  shiftCatalogEntry: { findMany: state.catalog, count: state.count }, turnoExportManifest: { create: state.create, findFirst: state.read },
} }));
const rows = [
  { code: 1500, firstIn: 480, firstOut: 720, secondIn: 780, secondOut: 1020 },
  { code: 1501, firstIn: 420, firstOut: 660, secondIn: 0, secondOut: 0 },
  { code: 1502, firstIn: 540, firstOut: 780, secondIn: 840, secondOut: 1080 },
];
function input(branchCode = "01"): EscalaInput {
  return { schemaVersion: 1, branchCode, branchName: "Filial sintética", startDate: "2026-11-30", endDate: "2027-01-03", visibleMonth: "2026-12",
    defaultWeeklyHours: 40, timeZone: "America/Sao_Paulo",
    policy: { source: "Fonte sintética", validFrom: "2026-01-01", validUntil: "2027-12-31", reviewed: true, reviewedBy: "Responsável",
      weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100,
      minMealMinutes: 60, maxConsecutiveWorkDays: 5, limitContinuousWorkBlocks: false, closedDates: [], holidayDates: [],
      authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false },
    employees: ["Ana", "Bruno", "Carla"].map((name, index) => ({ id: `e${index + 1}`, registration: index === 0 ? "0007" : index === 1 ? "7" : "AB07",
      name, sector: index === 1 ? "B" : "A", role: "Atendente", weeklyHours: 40, shiftIds: ["s1"], activeFrom: "", scheduleMode: "TIMED",
      offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [] })),
    shifts: [{ id: "s1", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }] },
      { id: "s2", name: "Manhã", segments: [{ start: 420, end: 660, kind: "WORK" }] }], assignments: [], demands: [] };
}
const filters = () => ({ branchCodes: [], employeeKeys: [], sectors: [], catalogCodes: [], registrations: [] });
function request(): Extract<TurnoSelectionManifestRequest, { mode: "EMPLOYEES" }> {
  return { selectionVersion: 2, mode: "EMPLOYEES", year: 2026, month: 12, sources: [{ workspaceId: "w1", revision: 1 }], filters: filters(),
    members: [{ workspaceId: "w1", employeeId: "e1", localShiftId: "s1" }, { workspaceId: "w1", employeeId: "e2", localShiftId: "s1" }] };
}
const http = (value: unknown) => new Request("http://localhost/api/escalas/turnos/export/manifest", { method: "POST",
  headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(value) });
async function download(manifestId: string, format = "TXT1", accept = false) {
  return GET(new Request(`http://localhost/api/escalas/turnos/export?manifestId=${manifestId}&format=${format}&acceptOmissions=${accept}`));
}
beforeEach(() => {
  vi.resetAllMocks(); state.sources.clear(); state.manifests.clear(); state.actor = { userId: "admin", tenantId: "t", admin: true };
  state.sources.set("w1", { input: input(), revision: 1 });
  state.user.mockImplementation(async ({ where }) => ({ id: where.id, tenantId: "t", status: "ACTIVE", role: "ADMIN", securityVersion: 0 }));
  state.policy.mockResolvedValue({ tenantId: "t", mode: "SCOPED", version: 1 }); state.limit.mockResolvedValue(null);
  state.grants.mockResolvedValue([]);
  state.queryRaw.mockResolvedValue([rows[0]]);
  state.workspace.mockImplementation(async ({ where }) => {
    const row = where.tenantId === "t" && state.sources.get(where.id);
    return row ? { id: where.id, tenantId: "t", branchCode: (row.input as EscalaInput).branchCode, branchName: "Filial", startDate: "2026-11-30",
      endDate: "2027-01-03", revision: row.revision, status: "DRAFT", updatedAt: new Date("2026-12-01") } : null;
  });
  state.revision.mockImplementation(async ({ where }) => {
    const scope = where.tenantId_workspaceId_revision, row = scope.tenantId === "t" && state.sources.get(scope.workspaceId);
    return row && row.revision === scope.revision ? { input: row.input, status: "DRAFT", revision: row.revision, createdAt: new Date("2026-12-01"), approvedPolicyVersionId: null } : null;
  });
  state.catalog.mockImplementation(async ({ where }) => rows.filter(row => where.tenantId === "t" && where.OR.some((condition: Record<string, number>) =>
    Object.entries(condition).every(([field, value]) => row[field as keyof typeof row] === value))));
  state.count.mockImplementation(async ({ where }) => rows.filter(row => where.tenantId === "t" && (!where.code || where.code.in.includes(row.code))).length);
  state.create.mockImplementation(async ({ data }) => { const id = `manifest-${state.manifests.size + 1}`; state.manifests.set(id, data); return { id }; });
  state.read.mockImplementation(async ({ where }) => { const data = state.manifests.get(where.id) as Record<string, unknown> | undefined;
    return data && Object.entries(where).every(([field, value]) => field === "id" || data[field] === value) ? data : null; });
});
describe("exact shift selections and HTTP files", () => {
  it("keeps the legacy v1 HTTP success DTO and omissions with real service and authorization", async () => {
    const response = await POST(http({ month: 12, year: 2026, selections: [{ workspaceId: "w1", revision: 1,
      employees: [{ employeeId: "e1", localShiftId: "s1" }] }] }));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const manifest = await response.json();
    expect(manifest).toEqual({ manifestId: "manifest-1", expiresAt: expect.any(String), month: 12, year: 2026, rowCount: 1,
      omissions: [{ workspaceId: "w1", employeeId: "e2", registration: "7", reason: "NO_REFERENCE" },
        { workspaceId: "w1", employeeId: "e3", registration: "AB07", reason: "NO_REFERENCE" }], formats: ["TXT1", "TXT2"] });
    expect(state.create).toHaveBeenCalledTimes(1); expect(state.manifests.size).toBe(1);
    expect((state.manifests.get(manifest.manifestId) as { payload: { version: number } }).payload.version).toBe(1);
  });
  it.each(["BLOCKED", "OPERATOR"] as const)("withholds a legacy v1 preview after account becomes %s during persistence without claiming rollback", async change => {
    const original = state.create.getMockImplementation();
    state.create.mockImplementationOnce(async args => {
      const result = await original?.(args);
      state.user.mockResolvedValue({ id: "admin", tenantId: "t", status: change === "BLOCKED" ? "BLOCKED" : "ACTIVE",
        role: change === "OPERATOR" ? "OPERATOR" : "ADMIN", securityVersion: 0 });
      return result;
    });
    const response = await POST(http({ month: 12, year: 2026, selections: [{ workspaceId: "w1", revision: 1,
      employees: [{ employeeId: "e1", localShiftId: "s1" }] }] }));
    expect(state.create).toHaveBeenCalledTimes(1); expect(state.manifests.size).toBe(1);
    expect((state.manifests.get("manifest-1") as { payload: { version: number } }).payload.version).toBe(1);
    expect(response.status).toBe(403); expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toBeNull();
    const body = await response.json(); expect(body).toMatchObject({ error: { code: "ESCALA_ACCESS_REQUIRED" } });
    expect(body).not.toHaveProperty("manifestId"); expect(body).not.toHaveProperty("omissions");
  });
  it("previews and downloads the same exact employee set, preserving registrations and unique TXT2 counts", async () => {
    const response = await POST(http(request())); expect(response.status).toBe(201);
    const manifest = await response.json();
    expect(manifest.counts).toMatchObject({ found: 3, selected: 2, includedEmployees: 2, includedCodes: 1, txt1Lines: 2, txt2Lines: 1, omitted: 0 });
    expect(manifest.omissions).toEqual([]); expect(manifest.rows.map((row: { registration: string }) => row.registration)).toEqual(["0007", "7"]);
    const txt1 = await download(manifest.manifestId); expect(txt1.status).toBe(200);
    expect(await txt1.text()).toBe("0007,08:00,12:00,13:00,17:00\r\n7,08:00,12:00,13:00,17:00\r\n");
    const txt2 = await download(manifest.manifestId, "TXT2"); expect(txt2.status).toBe(200);
    expect(await txt2.text()).toBe("1500,08:00 12:00 13:00 17:00,08:00,12:00,13:00,17:00\r\n");
    expect(txt2.headers.get("cache-control")).toBe("private, no-store");
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it("omits Afastados from v2 preview, saved selection and both TXT downloads", async () => {
    const source = state.sources.get("w1")?.input as EscalaInput;
    source.employees[1].sector = " Afástados ";
    source.employees[1].shiftIds = ["s2"];
    const value = request();
    value.members[1].localShiftId = "s2";
    value.filters.employeeKeys = value.members.map(({ workspaceId, employeeId }) => ({ workspaceId, employeeId }));
    value.filters.sectors = [{ workspaceId: "w1", value: "A" }, { workspaceId: "w1", value: "Afastados" }];
    const response = await POST(http(value));
    expect(response.status).toBe(201);
    const manifest = await response.json();
    expect(manifest.counts).toMatchObject({ found: 1, selected: 1, includedEmployees: 1, includedCodes: 1, omitted: 0 });
    expect(manifest.rows.map((row: { employeeId: string }) => row.employeeId)).toEqual(["e1"]);
    expect(manifest.context.members).toEqual([value.members[0]]);
    expect(manifest.context.filters.employeeKeys).toEqual([value.filters.employeeKeys[0]]);
    expect(manifest.context.filters.sectors).toEqual([value.filters.sectors[0]]);
    expect(state.manifests.get(manifest.manifestId)).toMatchObject({
      payload: { version: 2, request: manifest.context, selectionDigest: manifest.selectionDigest },
    });
    const txt1 = await download(manifest.manifestId);
    expect(txt1.status).toBe(200);
    expect(await txt1.text()).toBe("0007,08:00,12:00,13:00,17:00\r\n");
    const txt2 = await download(manifest.manifestId, "TXT2");
    expect(txt2.status).toBe(200);
    expect(await txt2.text()).toBe("1500,08:00 12:00 13:00 17:00,08:00,12:00,13:00,17:00\r\n");
  });
  it("checks explicit member IDs before removing administrative selections and blocks empty filters", async () => {
    const source = state.sources.get("w1")?.input as EscalaInput;
    source.employees[1].sector = "Afastados";
    const value = request();
    const [worker, administrative] = value.members;
    const unknown = { ...worker, employeeId: "foreign" };
    await expect(createTurnoSelectionManifest(state.actor, { ...value, members: [administrative, unknown] }))
      .rejects.toMatchObject({ code: "TURNO_SELECTION_OUTSIDE_FILTER" });
    await expect(createTurnoSelectionManifest(state.actor, { ...value, members: [worker, administrative, administrative] }))
      .rejects.toMatchObject({ code: "TURNO_INVALID_SELECTION" });
    await expect(createTurnoSelectionManifest(state.actor, { ...value, members: [administrative] }))
      .rejects.toMatchObject({ code: "TURNO_EXPORT_EMPTY" });
    await expect(createTurnoSelectionManifest(state.actor, { ...value, filters: { ...value.filters,
      employeeKeys: [{ workspaceId: administrative.workspaceId, employeeId: administrative.employeeId }] } }))
      .rejects.toMatchObject({ code: "TURNO_SELECTION_OUTSIDE_FILTER" });
    await expect(createTurnoSelectionManifest(state.actor, { ...value, filters: { ...value.filters,
      sectors: [{ workspaceId: "w1", value: "Afastados" }] } }))
      .rejects.toMatchObject({ code: "TURNO_SELECTION_OUTSIDE_FILTER" });
    source.employees[1].id = worker.employeeId;
    const duplicateSource = await POST(http(value));
    expect(duplicateSource.status).toBe(400);
    expect(await duplicateSource.json()).toMatchObject({ error: { code: "ESCALA_INVALID_INPUT" } });
    expect(state.create).not.toHaveBeenCalled();
  });
  it("rejects downloads from a v2 manifest that included someone later excluded as Afastados", async () => {
    const manifest = await createTurnoSelectionManifest(state.actor, request());
    const source = state.sources.get("w1")?.input as EscalaInput;
    source.employees[1].sector = "Afastados";
    const response = await download(manifest.manifestId);
    expect(response.status).toBe(409);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(await response.json()).toMatchObject({ error: { code: "TURNO_MANIFEST_STALE" } });
  });
  it("exports standalone catalog definitions without people and rejects TXT1", async () => {
    state.sources.clear();
    const response = await POST(http({ selectionVersion: 2, mode: "CATALOG", scope: "ALL", year: 2026, month: 12, sources: [], filters: filters(), codes: [1502, 1500] }));
    expect(response.status).toBe(201); const manifest = await response.json();
    expect(manifest.formats).toEqual(["TXT2"]); expect(manifest.counts).toMatchObject({ selected: 2, includedEmployees: 0, txt1Lines: 0, txt2Lines: 2 });
    expect((await download(manifest.manifestId)).status).toBe(400);
    const result = await download(manifest.manifestId, "TXT2"); expect(result.status).toBe(200);
    expect(await result.text()).toBe("1500,08:00 12:00 13:00 17:00,08:00,12:00,13:00,17:00\r\n1502,09:00 13:00 14:00 18:00,09:00,13:00,14:00,18:00\r\n");
    state.count.mockResolvedValue(4);
    expect((await download(manifest.manifestId, "TXT2")).status).toBe(200);
  });
  it("requires actual usage for USED and never substitutes the full catalog or unrelated employee", async () => {
    const value: Extract<TurnoSelectionManifestRequest, { mode: "CATALOG" }> = { selectionVersion: 2, mode: "CATALOG", scope: "USED", year: 2026, month: 12,
      sources: [{ workspaceId: "w1", revision: 1 }], filters: filters(), codes: [1502] };
    await expect(createTurnoSelectionManifest(state.actor, value)).rejects.toMatchObject({ code: "TURNO_SELECTION_OUTSIDE_FILTER" });
    value.codes = [1500];
    value.filters = { ...filters(), employeeKeys: [{ workspaceId: "w1", employeeId: "e1" }] };
    expect((await createTurnoSelectionManifest(state.actor, value)).rows).toHaveLength(1);
    expect((await POST(http({ ...value, codes: [] }))).status).toBe(400);
  });
  it("does not count a shift referenced only by Afastados as USED", async () => {
    const source = state.sources.get("w1")?.input as EscalaInput;
    source.employees[1].sector = "Afastados";
    source.employees[1].shiftIds = ["s2"];
    const value: Extract<TurnoSelectionManifestRequest, { mode: "CATALOG" }> = { selectionVersion: 2, mode: "CATALOG", scope: "USED",
      year: 2026, month: 12, sources: [{ workspaceId: "w1", revision: 1 }], filters: filters(), codes: [1501] };
    await expect(createTurnoSelectionManifest(state.actor, value)).rejects.toMatchObject({ code: "TURNO_SELECTION_OUTSIDE_FILTER" });
    const manifest = await createTurnoSelectionManifest(state.actor, { ...value, codes: [1500] });
    expect(manifest.counts).toMatchObject({ found: 1, selected: 1, txt2Lines: 1 });
    expect(manifest.rows).toMatchObject([{ code: 1500 }]);
  });
  it("keeps registration filters textual, diagnoses missing code, and invalidates the accepted omission after SYNC", async () => {
    const value = request(); value.members = [value.members[0]]; value.filters.registrations = ["7"];
    await expect(createTurnoSelectionManifest(state.actor, value)).rejects.toMatchObject({ status: 400 });
    value.filters.registrations = ["0007"]; state.catalog.mockResolvedValue([]);
    const manifest = await createTurnoSelectionManifest(state.actor, value);
    expect(manifest.omissions).toMatchObject([{ employeeId: "e1", reason: "CATALOG_REQUIRED" }]);
    state.catalog.mockResolvedValue([rows[0]]);
    expect((await download(manifest.manifestId, "TXT1", true)).status).toBe(409);
  });
  it("requires one explicitly chosen variant belonging to the same catalog filter", async () => {
    const source = state.sources.get("w1")?.input as EscalaInput; source.employees[0].shiftIds.push("s2");
    const value = request(); value.members = [{ workspaceId: "w1", employeeId: "e1", localShiftId: "s2" }]; value.filters.catalogCodes = [1500];
    await expect(createTurnoSelectionManifest(state.actor, value)).rejects.toMatchObject({ status: 400 });
    value.filters.catalogCodes = [1501];
    const manifest = await createTurnoSelectionManifest(state.actor, value); expect(manifest.rows).toMatchObject([{ code: 1501, localShiftId: "s2" }]);
    expect(await (await download(manifest.manifestId)).text()).toBe("0007,07:00,11:00,00:00,00:00\r\n");
  });
  it("intersects all five filters on the same relationship in both modes, preserving sector identity", async () => {
    state.sources.set("w2", { input: input("02"), revision: 1 });
    const base = request(); base.sources.push({ workspaceId: "w2", revision: 1 }); base.members = [base.members[0]];
    base.filters = { branchCodes: ["001"], employeeKeys: [{ workspaceId: "w1", employeeId: "e1" }], sectors: [{ workspaceId: "w1", value: "A" }, { workspaceId: "w1", value: "B" }], catalogCodes: [1500], registrations: ["0007"] };
    expect((await createTurnoSelectionManifest(state.actor, base)).counts.found).toBe(1);
    const used: Extract<TurnoSelectionManifestRequest, { mode: "CATALOG" }> = { selectionVersion: 2, year: base.year, month: base.month,
      sources: base.sources, filters: base.filters, mode: "CATALOG", scope: "USED", codes: [1500] };
    expect((await createTurnoSelectionManifest(state.actor, used)).counts.txt2Lines).toBe(1);
    base.filters.sectors = [{ workspaceId: "w1", value: "B" }]; used.filters = base.filters;
    await expect(createTurnoSelectionManifest(state.actor, base)).rejects.toMatchObject({ code: "TURNO_SELECTION_OUTSIDE_FILTER" });
    await expect(createTurnoSelectionManifest(state.actor, used)).rejects.toMatchObject({ code: "TURNO_SELECTION_OUTSIDE_FILTER" });
    base.filters.sectors = [{ workspaceId: "w2", value: "A" }];
    await expect(createTurnoSelectionManifest(state.actor, base)).rejects.toMatchObject({ status: 400 });
  });
  it("diagnoses every duplicate registration and blocks both files, even with omission acceptance", async () => {
    state.sources.set("w2", { input: input("02"), revision: 1 });
    const value = request(); value.sources.push({ workspaceId: "w2", revision: 1 });
    value.members = [value.members[0], { workspaceId: "w2", employeeId: "e1", localShiftId: "s1" }];
    const manifest = await createTurnoSelectionManifest(state.actor, value);
    expect(manifest.rows).toEqual([]); expect(manifest.blockers[0].members).toHaveLength(2);
    expect(manifest.omissions).toHaveLength(2); expect(manifest.counts.txt1Lines).toBe(0);
    for (const format of ["TXT1", "TXT2"]) expect((await download(manifest.manifestId, format, true)).status).toBe(409);
  });
  it("requires explicit variants, preserves excluded TIMED people, and never omits unselected people", async () => {
    const source = state.sources.get("w1")?.input as EscalaInput; source.employees[0].shiftIds.push("s2"); source.employees[1].planningEnabled = false;
    const value = request(); value.members[0].localShiftId = null;
    const manifest = await createTurnoSelectionManifest(state.actor, value);
    expect(manifest.omissions).toMatchObject([{ employeeId: "e1", reason: "AMBIGUOUS_REFERENCE" }]);
    expect(manifest.counts).toMatchObject({ selected: 2, includedEmployees: 1, omitted: 1 });
    expect((await download(manifest.manifestId)).status).toBe(409);
    const accepted = await download(manifest.manifestId, "TXT1", true); expect(accepted.status).toBe(200); expect(await accepted.text()).toBe("7,08:00,12:00,13:00,17:00\r\n");
  });
  it("rejects stale sources, foreign members, references outside filters and empty selections", async () => {
    for (const value of [{ ...request(), sources: [{ workspaceId: "w1", revision: 2 }] }, { ...request(), members: [{ workspaceId: "foreign", employeeId: "e1", localShiftId: "s1" }] },
      { ...request(), members: [] }, { ...request(), members: [{ workspaceId: "w1", employeeId: "e1", localShiftId: "s2" }] }]) {
      expect((await POST(http(value))).status).toBeGreaterThanOrEqual(400);
    }
    expect(state.create).not.toHaveBeenCalled();
  });
  it("revalidates revision, complete preview, expiry and ownership at download", async () => {
    const manifest = await createTurnoSelectionManifest(state.actor, request());
    const source = state.sources.get("w1"); if (!source) throw new Error("fixture"); source.revision = 2;
    expect((await download(manifest.manifestId)).status).toBe(409); source.revision = 1;
    (source.input as EscalaInput).employees[0].shiftIds.push("s2"); expect((await download(manifest.manifestId)).status).toBe(409);
    (source.input as EscalaInput).employees[0].shiftIds.pop();
    const stored = state.manifests.get(manifest.manifestId) as { expiresAt: Date }; stored.expiresAt = new Date(0);
    expect((await download(manifest.manifestId)).status).toBe(404); stored.expiresAt = new Date(Date.now() + 10000);
    state.actor = { userId: "other", tenantId: "t", admin: true }; expect((await download(manifest.manifestId)).status).toBe(404);
  });
  it("withholds a rebuilt file after late revocation", async () => {
    const manifest = await createTurnoSelectionManifest(state.actor, request());
    const original = state.catalog.getMockImplementation();
    state.catalog.mockImplementationOnce(async args => { state.user.mockResolvedValue({ id: "admin", tenantId: "t", status: "BLOCKED", role: "ADMIN", securityVersion: 1 }); return original?.(args); });
    const response = await download(manifest.manifestId); expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("json"); expect(response.headers.get("content-disposition")).toBeNull();
  });
  it("rejects an operational account before loading sources or catalog", async () => {
    state.actor = { userId: "operator", tenantId: "t", admin: false };
    state.user.mockResolvedValue({ id: "operator", tenantId: "t", status: "ACTIVE", role: "OPERATOR", securityVersion: 0 });
    const response = await POST(http(request())); expect(response.status).toBe(403);
    expect(state.workspace).not.toHaveBeenCalled(); expect(state.catalog).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
  });
  it("withholds a manifest after late revocation while persisting its frozen payload", async () => {
    const original = state.create.getMockImplementation();
    state.create.mockImplementationOnce(async args => { const result = await original?.(args);
      state.user.mockResolvedValue({ id: "admin", tenantId: "t", status: "BLOCKED", role: "ADMIN", securityVersion: 1 }); return result; });
    const response = await POST(http(request())); expect(response.status).toBe(403);
    expect(response.headers.get("content-disposition")).toBeNull();
  });
  it.each(["OVERNIGHT", "PAID_BREAK", "TOO_MANY_PERIODS"])("does not flatten %s references", async reason => {
    const source = state.sources.get("w1")?.input as EscalaInput;
    if (reason === "OVERNIGHT") source.shifts[0].segments = [{ start: 1320, end: 1560, kind: "WORK" }];
    else if (reason === "PAID_BREAK") source.shifts[0].segments[1].kind = "PAID_BREAK";
    else if (reason === "TOO_MANY_PERIODS") {
      source.shifts[0].segments = [
        { start: 420, end: 480, kind: "WORK" },
        { start: 480, end: 540, kind: "BREAK" },
        { start: 540, end: 600, kind: "WORK" },
        { start: 600, end: 660, kind: "BREAK" },
        { start: 660, end: 720, kind: "WORK" },
      ];
    }
    const value = request(); value.members = [value.members[0]];
    const manifest = await createTurnoSelectionManifest(state.actor, value);
    expect(manifest.omissions[0].reason).toBe(reason); expect(manifest.rows).toEqual([]);
    expect((await download(manifest.manifestId, "TXT1", true)).status).toBe(409);
  });
  it.each(["REGISTRATION_MISSING", "PARTIAL", "STALE_REFERENCE"])("fails closed on a source rejected by the canonical schema: %s", async reason => {
    const source = state.sources.get("w1")?.input as EscalaInput;
    if (reason === "REGISTRATION_MISSING") source.employees[0].registration = "";
    else if (reason === "PARTIAL") source.shifts[0].segments = [{ start: 480, end: 720, kind: "BREAK" }];
    else source.shifts = source.shifts.filter(shift => shift.id !== "s1");
    const response = await POST(http(request())); expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "ESCALA_INVALID_INPUT" } });
    expect(state.create).not.toHaveBeenCalled();
  });
  it("checks a supplied digest and does not treat it as permission", async () => {
    await expect(downloadTurnoSelection(state.actor, { version: 2, request: request(), selectionDigest: "0".repeat(64) }, "TXT1", true)).rejects.toMatchObject({ code: "TURNO_MANIFEST_STALE" });
  });
});
