import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ guard: vi.fn(), list: vi.fn(), administer: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/escalas/access.server", () => ({ requireEscalaAccess: mocks.guard }));
vi.mock("@/lib/escalas/approved-policy-service", () => ({ listEscalaApprovals: mocks.list, administerEscalaApproval: mocks.administer }));
vi.mock("@/lib/api/security", async original => ({ ...await original<typeof import("@/lib/api/security")>(), enforcePersistentRateLimit: async () => null }));
import { GET, POST } from "./route";
import { buildEscalaApprovedPolicy } from "@/lib/escalas/approved-policy";
const actor = { userId: "admin", tenantId: "t", admin: true };
beforeEach(() => { vi.resetAllMocks(); mocks.guard.mockResolvedValue({ ok: true, actor }); mocks.list.mockResolvedValue({ policies: [] }); });
describe("approved policy HTTP transport", () => {
  it("queries a canonical exact period and returns a real successful approval response", async () => {
    const query = await GET(new Request("http://localhost/api/escalas/approved-policy?branchCode=002&startDate=2026-11-30&endDate=2027-01-03"));
    expect(query.status).toBe(200); expect(await query.json()).toEqual({ policies: [] });
    expect(mocks.list).toHaveBeenCalledWith(actor, "02", "2026-11-30", "2027-01-03");
    mocks.administer.mockResolvedValue({ policy: { id: "approved", version: 1 } });
    const command = { action: "APPROVE", origin: null, selectedSeedAssignments: [], regimeModelSelections: [{ id: "model", label: "Approved", employeeId: "p" }],
      input: { schemaVersion: 1, branchCode: "02", branchName: "Synthetic", startDate: "2026-11-30", endDate: "2027-01-03", visibleMonth: "2026-12",
        defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo", policy: { source: "Reviewed", reviewed: true, reviewedBy: "Administrator",
          validFrom: "2026-01-01", validUntil: "2027-12-31", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: false,
          minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5,
          closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
        employees: [{ id: "p", name: "Synthetic", registration: "0001", sector: "Loja", role: "Atendente", weeklyHours: 40,
          shiftIds: ["s"], activeFrom: "2020-01-01", scheduleMode: "TIMED", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY",
          maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }],
        shifts: [{ id: "s", name: "Shift", segments: [{ start: 480, end: 720, kind: "WORK" }] }], demands: [], assignments: [] } };
    expect(buildEscalaApprovedPolicy({ input: command.input, version: 1, selectedSeedAssignments: [], regimeModelSelections: command.regimeModelSelections,
      provenance: { tenantId: "t", approvedById: "admin", approvedAt: "2026-11-13T12:00:00.000Z", origin: null } }).ok).toBe(true);
    const response = await POST(new Request("http://localhost/api/escalas/approved-policy", { method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(command) }));
    expect(response.status).toBe(201); expect(await response.json()).toEqual({ policy: { id: "approved", version: 1 } });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.administer).toHaveBeenCalledWith(actor, command);
  });
  it("rejects invalid dates and unknown query scope without calling the service", async () => {
    for (const query of ["branchCode=02&startDate=2026-02-30&endDate=2026-03-01", "branchCode=02&startDate=2026-11-30&endDate=2027-01-03&tenantId=foreign"])
      expect((await GET(new Request("http://localhost/api/escalas/approved-policy?" + query))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
