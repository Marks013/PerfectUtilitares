import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaBranchPolicyVersion } from "@/generated/prisma/client";
import type { EscalaInput } from "./types";
const mocks = vi.hoisted(() => ({ actor: { userId: "admin", tenantId: "t", admin: true }, rows: [] as EscalaBranchPolicyVersion[],
  user: vi.fn(), accessPolicy: vi.fn(), grants: vi.fn(), find: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(),
  source: vi.fn(), sourceRevision: vi.fn(), audit: vi.fn(), lock: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: async () => null }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: async () => ({ ok: true, actor: mocks.actor }) }));
vi.mock("@/lib/prisma", () => {
  const db = { user: { findFirst: mocks.user }, escalaModuleAccessPolicy: { findUnique: mocks.accessPolicy },
    escalaBranchAccess: { findMany: mocks.grants }, escalaBranchPolicyVersion: { findFirst: mocks.find, findMany: mocks.list, create: mocks.create, update: mocks.update },
    escalaWorkspace: { findFirst: mocks.source }, escalaRevision: { findUnique: mocks.sourceRevision }, auditLog: { create: mocks.audit }, $executeRaw: mocks.lock, $queryRaw: vi.fn() };
  return { prisma: { ...db, $transaction: async (callback: (tx: typeof db) => unknown) => callback(db) } };
});
import { administerEscalaApproval, loadEscalaApproval } from "./approved-policy-service";
import { GET, POST } from "../../app/api/escalas/approved-policy/route";
function requestInput(): EscalaInput {
  return { schemaVersion: 1, branchCode: "02", branchName: "Synthetic", startDate: "2026-11-30", endDate: "2027-01-03", visibleMonth: "2026-12",
    defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo", policy: { source: "Reviewed", reviewed: true, reviewedBy: "Administrator",
      validFrom: "2026-01-01", validUntil: "2027-12-31", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: false,
      minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5,
      closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false, limitContinuousWorkBlocks: false },
    employees: [{ id: "person", name: "Synthetic", registration: "0001", sector: "Loja", role: "Atendente", weeklyHours: 40,
      weeklyHoursMode: "INDIVIDUAL", shiftIds: ["s"], originalShiftIds: ["s"], activeFrom: "2020-01-01", scheduleMode: "TIMED",
      offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: true,
      history: [{ employeeId: "person", date: "2026-11-29", kind: "WORK", shiftId: "s" }] }],
    shifts: [{ id: "s", name: "Shift", segments: [{ start: 480, end: 720, kind: "WORK" }] }], demands: [], assignments: [] };
}
const approve = () => ({ action: "APPROVE", input: requestInput(), origin: null as null | { workspaceId: string; revision: number }, selectedSeedAssignments: [],
  regimeModelSelections: [{ id: "model", label: "Approved 40h", employeeId: "person" }] });
const request = (data: unknown) => new Request("http://localhost/api/escalas/approved-policy", { method: "POST",
  headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(data) });
const listing = (branch = "02") => new Request(`http://localhost/api/escalas/approved-policy?branchCode=${branch}&startDate=2026-11-30&endDate=2027-01-03`);
beforeEach(() => {
  vi.resetAllMocks(); mocks.actor = { userId: "admin", tenantId: "t", admin: true }; mocks.rows = [];
  mocks.user.mockResolvedValue({ id: "admin", tenantId: "t", status: "ACTIVE", role: "ADMIN" });
  mocks.accessPolicy.mockResolvedValue({ tenantId: "t", mode: "SCOPED", version: 1 }); mocks.grants.mockResolvedValue([]);
  mocks.find.mockImplementation(async ({ where }) => mocks.rows.find(row => row.tenantId === where.tenantId && (!where.id || row.id === where.id)) ?? null);
  mocks.list.mockImplementation(async ({ where }) => mocks.rows.filter(row => row.tenantId === where.tenantId && row.branchCode === where.branchCode
    && row.startDate === where.startDate && row.endDate === where.endDate));
  mocks.create.mockImplementation(async ({ data }) => { const row = { ...data, id: `approval-${mocks.rows.length + 1}`, revokedAt: null }; mocks.rows.push(row); return row; });
  mocks.update.mockImplementation(async ({ where, data }) => { const row = mocks.rows.find(row => row.id === where.tenantId_id.id); if (row) Object.assign(row, data); return row; });
});
describe("approved policy persistence and HTTP", () => {
  it("approves before a workspace exists, computes the hash server-side and lists exact metadata", async () => {
    const response = await POST(request(approve())); expect(response.status).toBe(201);
    const body = await response.json(); expect(body).toMatchObject({ policy: { id: "approval-1", branchCode: "02", version: 1, regimeModels: [{ id: "model" }] } });
    expect(mocks.rows[0].snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.rows[0].approvedById).toBe("admin"); expect(mocks.source).not.toHaveBeenCalled();
    expect((await loadEscalaApproval(mocks.actor, "approval-1")).snapshot.seed.employees[0].weeklyHours).toBe(40);
    const listingResponse = await GET(listing()); expect(listingResponse.status).toBe(200);
    const list = await listingResponse.json(); expect(list.policies).toHaveLength(1); expect(JSON.stringify(list)).not.toContain('"seed"');
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.create.mock.invocationCallOrder[0]);
  });
  it("retains approved factual history while derived published context is reloaded by server services", async () => {
    const command = approve(); command.origin = { workspaceId: "w", revision: 3 };
    command.input.employees[0].planningHistory = [...command.input.employees[0].history];
    mocks.source.mockResolvedValue({ id: "w", tenantId: "t", revision: 3, branchCode: "02", startDate: "2026-11-30", endDate: "2027-01-03" }); mocks.sourceRevision.mockResolvedValue({ input: command.input });
    await administerEscalaApproval(mocks.actor, command);
    const loaded = await loadEscalaApproval(mocks.actor, "approval-1");
    expect(loaded.snapshot.seed.employees[0].history).toEqual(command.input.employees[0].history);
    expect(loaded.snapshot.seed.employees[0].historyKnown).toBe(true);
    expect(loaded.snapshot.seed.employees[0]).not.toHaveProperty("planningHistory");
    expect(command.input.employees[0].planningHistory).toHaveLength(1);
  });
  it("authorizes the saved rules for branch operations without recording a labor review", async () => {
    const command = approve();
    command.origin = { workspaceId: "w", revision: 3 };
    command.input.policy = { ...command.input.policy, source: "", reviewed: false, reviewedBy: "" };
    mocks.source.mockResolvedValue({ id: "w", tenantId: "t", revision: 3, branchCode: "02", startDate: "2026-11-30", endDate: "2027-01-03" });
    mocks.sourceRevision.mockResolvedValue({ input: command.input });
    const response = await POST(request(command));
    expect(response.status).toBe(201);
    const loaded = await loadEscalaApproval(mocks.actor, "approval-1");
    expect(loaded.row.approvedById).toBe("admin");
    expect(loaded.snapshot.configuration.policy).toEqual(command.input.policy);
  });
  it("revokes without changing content and denies later operational loading", async () => {
    await administerEscalaApproval(mocks.actor, approve());
    const old = structuredClone(mocks.rows[0]);
    expect((await POST(request({ action: "REVOKE", id: "approval-1" }))).status).toBe(200);
    expect(mocks.rows[0].snapshot).toEqual(old.snapshot); expect(mocks.rows[0].snapshotHash).toBe(old.snapshotHash);
    await expect(loadEscalaApproval(mocks.actor, "approval-1")).rejects.toMatchObject({ code: "ESCALA_CONFIG_REVOKED" });
  });
  it("rejects stale origins, foreign policies, supplied authority and corrupted stored hashes", async () => {
    const command = approve(); command.origin = { workspaceId: "foreign", revision: 1 };
    mocks.source.mockResolvedValue(null); mocks.sourceRevision.mockResolvedValue(null);
    await expect(administerEscalaApproval(mocks.actor, command)).rejects.toMatchObject({ status: 409 });
    expect((await POST(request({ ...approve(), tenantId: "foreign", snapshotHash: "browser" }))).status).toBe(400);
    await expect(loadEscalaApproval(mocks.actor, "foreign")).rejects.toMatchObject({ code: "ESCALA_CONFIG_APPROVAL_REQUIRED" });
    await administerEscalaApproval(mocks.actor, approve()); mocks.rows[0].snapshotHash = "a".repeat(64);
    await expect(loadEscalaApproval(mocks.actor, "approval-1")).rejects.toMatchObject({ code: "ESCALA_CONFIG_APPROVAL_REQUIRED" });
  });
  it("allows only a granted exact branch to inspect metadata and reserves approval to administrators", async () => {
    await administerEscalaApproval(mocks.actor, approve()); mocks.actor = { userId: "reader", tenantId: "t", admin: false };
    mocks.user.mockResolvedValue({ id: "reader", tenantId: "t", status: "ACTIVE", role: "OPERATOR" });
    mocks.grants.mockResolvedValue([{ tenantId: "t", userId: "reader", branchCode: "02", role: "VIEWER" }]);
    expect((await GET(listing())).status).toBe(200); expect((await GET(listing("03"))).status).toBe(403);
    expect((await POST(request(approve()))).status).toBe(403); expect(mocks.rows).toHaveLength(1);
  });
});
