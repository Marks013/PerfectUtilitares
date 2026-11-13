import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalaInput } from "./types";
import { createEscala, generateEscala, getEscala, listEscalas, parseEscalaInput, preserveLockedAssignments, saveEscala } from "./service";
import { allowedBranches, branchPermission, escalaActor, requireEscalaPermission } from "./access";
import { addDays, dateRange, dayOfWeek } from "./dates";
import { validateEscala } from "./validation";
import { publishedPlanningContext } from "./continuity";
import { generationScenarioBasis } from "./hours-reference";

const mocks = vi.hoisted(() => ({
  workspace: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  revision: { findUnique: vi.fn(), create: vi.fn() }, grants: { findUnique: vi.fn(), findMany: vi.fn() },
  audit: { create: vi.fn() }, transaction: vi.fn(), solve: vi.fn(), peers: vi.fn(), advisory: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { escalaWorkspace: mocks.workspace, escalaRevision: mocks.revision, escalaBranchAccess: mocks.grants, auditLog: mocks.audit, $transaction: mocks.transaction } }));
vi.mock("./solver-client", async (original) => ({ ...await original<typeof import("./solver-client")>(), solveEscala: mocks.solve }));
const actor = { tenantId: "company-a", userId: "user-a", admin: true };
const operator = { ...actor, admin: false };

function input(): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "02", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
    policy: { source: "Instrumento validado no cenário", validFrom: "2026-01-01", validUntil: "2027-01-01", reviewed: true, reviewedBy: "Responsável", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5, limitContinuousWorkBlocks: false, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false },
    employees: [{ id: "e1", registration: "0001", name: "Ana", sector: "Reposição", role: "Repositor", weeklyHours: 42, shiftIds: ["day"], activeFrom: "2026-10-26", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, sundayRestRule: "CLT_386", preferredOffDays: [5, 6], historyKnown: false, history: [] }],
    shifts: [{ id: "day", name: "Diurno", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
    demands: Array.from({ length: 7 }, (_, index) => ({ id: `d${index}`, date: new Date(Date.UTC(2026, 9, 26 + index)).toISOString().slice(0, 10), sector: "Reposição", start: 480, end: 720, minimum: index < 5 ? 1 : 0 })),
    assignments: Array.from({ length: 7 }, (_, index) => ({ employeeId: "e1", date: new Date(Date.UTC(2026, 9, 26 + index)).toISOString().slice(0, 10), kind: index < 5 ? "WORK" as const : "OFF" as const, ...(index < 5 ? { shiftId: "day" } : {}) })),
  };
}
/** Complete v2 proposal: Thursday/Sunday rest, Saturday work, unchanged manual staffing minima. */
function generatedInput(): EscalaInput {
  const value = input();
  value.assignments = value.assignments.map(day => day.date === "2026-10-29" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" as const }
    : day.date === "2026-10-31" ? { ...day, kind: "WORK" as const, shiftId: "day" } : day);
  value.demands = value.demands.map(demand => ({ ...demand, minimum: demand.date === "2026-10-29" || demand.date === "2026-11-01" ? 0 : 1 }));
  return value;
}

function row(overrides = {}) { return { id: "w1", tenantId: actor.tenantId, branchCode: "02", branchName: "Filial 2", startDate: "2026-10-26", endDate: "2026-11-01", revision: 1, status: "DRAFT", updatedAt: new Date("2026-10-26T12:00:00Z"), ...overrides }; }
function version(value = input(), revision = 1, status = "DRAFT") { return { input: value, revision, status, createdAt: row().updatedAt }; }

function period(startDate: string, weeks = 1): EscalaInput {
  const value = input();
  value.startDate = startDate;
  value.endDate = addDays(startDate, weeks * 7 - 1);
  value.employees[0].activeFrom = "2020-01-01";
  value.employees[0].historyKnown = true;
  const assignment = (date: string) => ({ employeeId: "e1", date, kind: dayOfWeek(date) < 5 ? "WORK" as const : "OFF" as const, ...(dayOfWeek(date) < 5 ? { shiftId: "day" } : {}) });
  value.employees[0].history = dateRange(addDays(startDate, -21), addDays(startDate, -1)).map(assignment);
  value.assignments = dateRange(value.startDate, value.endDate).map(assignment);
  value.demands = dateRange(value.startDate, value.endDate).map((date) => ({ id: `d-${date}`, date, sector: "Reposição", start: 480, end: 720, minimum: dayOfWeek(date) < 5 ? 1 : 0 }));
  return value;
}

function useCurrent(value: EscalaInput, status = "DRAFT") {
  mocks.workspace.findFirst.mockResolvedValue(row({ branchCode: value.branchCode, startDate: value.startDate, endDate: value.endDate, status }));
  mocks.revision.findUnique.mockResolvedValue(version(value, 1, status));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.workspace.findFirst.mockResolvedValue(row());
  mocks.workspace.findMany.mockResolvedValue([row()]);
  mocks.workspace.create.mockResolvedValue(row());
  mocks.workspace.updateMany.mockResolvedValue({ count: 1 });
  mocks.revision.findUnique.mockResolvedValue(version());
  mocks.grants.findMany.mockResolvedValue([]);
  mocks.peers.mockResolvedValue([]);
  mocks.advisory.mockResolvedValue(1);
  mocks.transaction.mockImplementation((callback: (tx: unknown) => unknown) => callback({ escalaWorkspace: { ...mocks.workspace, findMany: mocks.peers }, escalaRevision: mocks.revision, auditLog: mocks.audit, $executeRaw: mocks.advisory }));
  mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments: generatedInput().assignments, wallTimeSeconds: 0.1, message: "Proposta viável" });
});

describe("canonical scheduling branch service", () => {
  it.each(["schema", "validation"] as const)("records the service %s boundary without changing its public rejection", async stage => {
    const input = generatedInput(); input.employees[0].name = "PRIVATE_SERVICE_SENTINEL";
    useCurrent(input);
    const assignments = stage === "schema" ? [{ employeeId: "e1", date: input.startDate, kind: "OFF", shiftId: "PRIVATE_SERVICE_SENTINEL" }]
      : input.assignments.map(({ employeeId, date }) => ({ employeeId, date, kind: "OFF" }));
    mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments, message: "PRIVATE_SERVICE_SENTINEL", wallTimeSeconds: 1 });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE", message: "O cálculo não passou pela conferência. Sua escala salva foi mantida; tente novamente." });
      expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "escala_solver_rejected", stage: stage === "schema" ? "service-schema" : "service-validation", code: stage === "schema" ? "SCHEMA_INVALID" : "RULES_INVALID" }));
      expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE_SERVICE_SENTINEL");
      expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it("permits internal publication with unconfirmed compensation while preserving the configured flag", async () => {
    const value = input(); value.simulation = false; value.policy.compensationAuthorized = false;
    useCurrent(value);
    const saved = await saveEscala(actor, "w1", 1, value, true);
    expect(saved.status).toBe("PUBLISHED");
    expect(saved.validation.readyToPublish).toBe(true);
    expect(saved.validation.issues).toContainEqual(expect.objectContaining({ code: "COMPENSATION_REQUIRED", severity: "WARNING" }));
    expect(saved.input.policy.compensationAuthorized).toBe(false);
    expect(mocks.revision.create.mock.calls[0][0].data.input.policy.compensationAuthorized).toBe(false);
  });
  it("prepares and saves real hours references without a roster or a solver request", async () => {
    const value = input(); value.generationMode = "HOURS_ONLY"; value.needsRegeneration = true;
    value.assignments = [{ employeeId: "e1", date: value.startDate, kind: "ABSENCE", locked: true }];
    useCurrent(value);
    const generated = await generateEscala(actor, "w1", 1);
    expect(mocks.solve).not.toHaveBeenCalled();
    expect(generated.proposalInput.assignments).toEqual(value.assignments);
    expect(generated.preparation.generatedCoverageSlots).toBe(0);
    expect(generated.validation.valid).toBe(true);
    expect(generated.validation.readyToPublish).toBe(false);
    expect(generated.validation.summaries).toEqual([]);
    const saved = await saveEscala(actor, "w1", 1, generated.proposalInput);
    expect(saved.input.needsRegeneration).toBe(false);
    expect(saved.validation.valid).toBe(true);
    await expect(saveEscala(actor, "w1", 1, generated.proposalInput, true)).rejects.toMatchObject({ code: "ESCALA_NOT_READY" });
  });
  it.each(["mode", "hours", "team"])("invalidates prepared references after changing %s with no assignments", async field => {
    const value = input(); value.generationMode = "HOURS_ONLY"; value.assignments = [];
    value.generationBasis = generationScenarioBasis(value); useCurrent(value);
    const next = structuredClone(value);
    if (field === "mode") next.generationMode = "REST_ONLY";
    if (field === "hours") next.defaultWeeklyHours = 44;
    if (field === "team") next.employees.push({ ...next.employees[0], id: "e2", registration: "0002" });
    const saved = await saveEscala(actor, "w1", 1, next);
    expect(saved.input.needsRegeneration).toBe(true);
    expect(saved.input.generationBasis).toBeUndefined();
  });
  it("keeps prepared references valid after editing display labels only", async () => {
    const value = input(); value.generationMode = "HOURS_ONLY"; value.assignments = [];
    value.generationBasis = generationScenarioBasis(value); useCurrent(value);
    const next = structuredClone(value); next.branchName = "Título revisado";
    next.employees[0].name = "Pessoa de teste"; next.shifts[0].name = "Referência revisada";
    const saved = await saveEscala(actor, "w1", 1, next);
    expect(saved.input.needsRegeneration).not.toBe(true);
    expect(saved.validation.valid).toBe(true);
  });
  it("rejects incomplete HOURS_ONLY baselines before calling the solver", async () => {
    const value = input(); value.generationMode = "HOURS_ONLY"; value.assignments.pop(); useCurrent(value);
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "ESCALA_HOURS_BASELINE_INCOMPLETE" });
    expect(mocks.solve).not.toHaveBeenCalled();
  });
  it("independently rejects a solver changing HOURS_ONLY work and rest classifications", async () => {
    const value = input(); value.generationMode = "HOURS_ONLY"; useCurrent(value);
    mocks.solve.mockResolvedValue({ status: "FEASIBLE", message: "Changed", wallTimeSeconds: 1,
      assignments: value.assignments.map(day => day.date === value.startDate ? { ...day, kind: "OFF" } : day) });
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });
  it("rejects edited late work even when a caller marks the draft outdated", async () => {
    const before = input();
    const changed = structuredClone(before);
    changed.needsRegeneration = true;
    changed.shifts[0].segments = changed.shifts[0].segments.map(segment => ({ ...segment, start: segment.start + 157, end: segment.end + 157 }));
    await expect(saveEscala(actor, "w1", 1, changed)).rejects.toMatchObject({ code: "ESCALA_CLOSING_EXCEEDED", status: 422 });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    expect(mocks.revision.create).not.toHaveBeenCalled();
  });

  it("saves a reduced closing as an outdated draft, permits unlocking and refuses publication until corrected", async () => {
    const before = generatedInput();
    before.demands.push(...dateRange(before.startDate, before.endDate).map(date => ({ id: `outside-morning-${date}`, date, sector: "Reposição", start: 0, end: 1020, minimum: 0 })));
    before.assignments[0].locked = true;
    useCurrent(before);
    const changed = structuredClone(before);
    changed.storeClosingMinutes = 1020;
    changed.assignments[0].locked = false;
    const saved = await saveEscala(actor, "w1", 1, changed);
    expect(saved.input.needsRegeneration).toBe(true);
    expect(saved.input.assignments[0].locked).toBe(false);
    expect(saved.validation.valid).toBe(false);
    expect(saved.validation.issues).toContainEqual(expect.objectContaining({ code: "STORE_CLOSING_EXCEEDED" }));
    expect(mocks.revision.create).toHaveBeenCalledOnce();
    useCurrent(saved.input);
    await expect(saveEscala(actor, "w1", 1, saved.input, true)).rejects.toMatchObject({ code: "ESCALA_NOT_READY", status: 422 });
    expect(mocks.revision.create).toHaveBeenCalledOnce();
    const corrected = structuredClone(saved.input);
    corrected.shifts[0].segments = corrected.shifts[0].segments.map(segment => ({ ...segment, start: segment.start - 24, end: segment.end - 24 }));
    corrected.needsRegeneration = false;
    corrected.demands = corrected.demands.map(demand => demand.minimum > 0 ? { ...demand, start: demand.start - 24, end: demand.end - 24 } : demand);
    const correctedDraft = await saveEscala(actor, "w1", 1, corrected);
    expect(correctedDraft.input.needsRegeneration).toBe(true); // A caller-supplied false flag does not certify preparation.
    useCurrent(correctedDraft.input);
    mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments: corrected.assignments, wallTimeSeconds: 0.1, message: "Verified corrected clocks" });
    const generated = await generateEscala(actor, "w1", 1);
    expect(generated.proposalInput.needsRegeneration).toBe(false);
    const result = await saveEscala(actor, "w1", 1, generated.proposalInput, true);
    expect(result.status).toBe("PUBLISHED");
    expect(result.validation.readyToPublish).toBe(true);
  });

  it("checks even an already published late snapshot again before idempotent publication", async () => {
    const value = input();
    value.demands = [];
    value.shifts[0].segments = value.shifts[0].segments.map(segment => ({ ...segment, start: segment.start + 157, end: segment.end + 157 }));
    useCurrent(value, "PUBLISHED");
    expect((await getEscala(actor, "w1")).validation.issues.map(issue => issue.code)).not.toContain("STORE_CLOSING_EXCEEDED");
    await expect(saveEscala(actor, "w1", 1, value, true)).rejects.toMatchObject({ code: "ESCALA_NOT_READY" });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
  });

  it("stops before the solver when published overlapping work exceeds the current closing", async () => {
    const current = period("2026-10-26", 2);
    current.demands = [];
    const published = period("2026-11-02");
    published.demands = [];
    published.shifts[0].segments = published.shifts[0].segments.map(segment => ({ ...segment, start: segment.start + 157, end: segment.end + 157 }));
    current.assignments = current.assignments.filter(day => day.date < published.startDate);
    useCurrent(current);
    mocks.workspace.findMany.mockResolvedValue([{ revisions: [{ input: published }] }]);
    const original = structuredClone(published);
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "ESCALA_CLOSING_PUBLISHED_CONFLICT", status: 409, message: expect.stringContaining("2026-11-02") });
    expect(mocks.solve).not.toHaveBeenCalled();
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    expect(published).toEqual(original);
  });

  it("flags a legacy draft with actual work after closing without writing or modifying published history", async () => {
    const value = input();
    value.shifts[0].segments = value.shifts[0].segments.map(segment => ({ ...segment, start: segment.start + 180, end: segment.end + 180 }));
    useCurrent(value);
    const draft = await getEscala(actor, "w1");
    expect(draft.input.needsRegeneration).toBe(true);
    expect(draft.input.assignments).toEqual(value.assignments);
    expect(draft.validation.issues).toContainEqual(expect.objectContaining({ code: "SCENARIO_OUTDATED" }));
    expect(value.needsRegeneration).toBeUndefined();
    expect(mocks.revision.create).not.toHaveBeenCalled();
    useCurrent(value, "PUBLISHED");
    expect((await getEscala(actor, "w1")).input.needsRegeneration).toBeUndefined();
  });

  it("persists a closing override and invalidates the old roster even when a client omits the stale flag", async () => {
    const before = input();
    const value = { ...before, storeClosingMinutes: 1260, needsRegeneration: false,
      demands: [...before.demands, { id: "estimate", sector: "Reposição", date: before.startDate, start: 480, end: 720, minimum: 1, estimated: true }] };
    const saved = await saveEscala(actor, "w1", 1, value);
    expect(saved.input.storeClosingMinutes).toBe(1260);
    expect(saved.input.needsRegeneration).toBe(true);
    expect(saved.input.assignments).toEqual(before.assignments);
    expect(saved.input.demands).toEqual(before.demands);
    expect(mocks.revision.create.mock.calls[0][0].data.input.storeClosingMinutes).toBe(1260);
  });

  it("persists REST_ONLY and generates the fixed-reference preview without another save", async () => {
    const value = generatedInput(); value.generationMode = "REST_ONLY";
    value.shifts.push({ ...structuredClone(value.shifts[0]), id: "other" });
    value.employees[0].shiftIds.push("other");
    const saved = await saveEscala(actor, "w1", 1, value);
    expect(saved.input.generationMode).toBe("REST_ONLY");
    expect(mocks.revision.create.mock.calls[0][0].data.input.generationMode).toBe("REST_ONLY");
    useCurrent(value);
    const result = await generateEscala(actor, "w1", 1);
    expect(result.result.status).toBe("FEASIBLE");
    expect(result.proposalInput.generationMode).toBe("REST_ONLY");
    expect(mocks.solve.mock.calls[0][0].employees[0].shiftIds).toEqual(["day", "other"]);
    expect(mocks.revision.create).toHaveBeenCalledTimes(1);
  });

  it("rejects a solver clock substitution on a free REST_ONLY day but allows its locked exception", async () => {
    const value = generatedInput(); value.generationMode = "REST_ONLY";
    value.demands = [];
    value.shifts.push({ ...structuredClone(value.shifts[0]), id: "other",
      segments: value.shifts[0].segments.map(part => ({ ...part, start: part.start + 30, end: part.end + 30 })) });
    value.employees[0].shiftIds.push("other");
    const assignments = structuredClone(value.assignments);
    assignments[0].shiftId = "other";
    useCurrent(value);
    mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments, wallTimeSeconds: 0.1, message: "Viável" });
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
    value.assignments[0] = { ...assignments[0], locked: true };
    assignments[0].locked = true;
    useCurrent(value);
    expect((await generateEscala(actor, "w1", 1)).result.status).toBe("FEASIBLE");
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
  });

  it("creates one canonical branch and stores the same identity in its first revision", async () => {
    const value = input(); value.branchCode = "0008";
    mocks.workspace.create.mockResolvedValue(row({ branchCode: "08" }));
    const result = await createEscala(actor, value);
    expect(result.input.branchCode).toBe("08");
    expect(mocks.workspace.create).toHaveBeenCalledWith({ data: expect.objectContaining({ branchCode: "08", tenantId: actor.tenantId }) });
    expect(mocks.revision.create.mock.calls[0][0].data.input.branchCode).toBe("08");
    expect(value.branchCode).toBe("0008");
  });
  it("reads historical aliases canonically without rewriting their stored snapshots", async () => {
    const original = input(); original.branchCode = "0002";
    mocks.workspace.findFirst.mockResolvedValue(row({ branchCode: "0002" }));
    mocks.revision.findUnique.mockResolvedValue(version(original));
    expect((await getEscala(actor, "w1")).input.branchCode).toBe("02");
    expect(original.branchCode).toBe("0002");
    expect(mocks.revision.create).not.toHaveBeenCalled();
  });
  it("saves an equivalent numeric alias but still rejects another branch", async () => {
    const value = input(); value.branchCode = "0002";
    expect((await saveEscala(actor, "w1", 1, value)).input.branchCode).toBe("02");
    expect(mocks.revision.create.mock.calls[0][0].data.input.branchCode).toBe("02");
  });
  it("queries the canonical grant without granting more privileges", async () => {
    mocks.grants.findUnique.mockResolvedValue({ role: "VIEWER" });
    expect(await branchPermission(operator, "0008")).toEqual({ canEdit: false, canPublish: false });
    expect(mocks.grants.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_userId_branchCode: { tenantId: actor.tenantId, userId: actor.userId, branchCode: "08" } } }));
  });
  it("reports a concurrent duplicate canonical workspace as a recoverable conflict", async () => {
    mocks.workspace.create.mockRejectedValue({ code: "P2002", meta: { target: ["tenantId", "branchCode", "startDate", "endDate"] } });
    const value = input(); value.branchCode = "8";
    await expect(createEscala(actor, value)).rejects.toMatchObject({ status: 409, code: "ESCALA_ALREADY_EXISTS" });
    expect(mocks.revision.create).not.toHaveBeenCalled();
  });
  it("retains published continuity when the imported historical branch has leading zeros", () => {
    const current = period("2026-11-02"), previous = period("2026-10-26");
    previous.branchCode = "0002";
    expect(() => publishedPlanningContext(current, [previous])).not.toThrow();
  });
});

describe("Escalas publication continuity", () => {
  it("reconstructs trusted planning history by textual registration and semantic shift, without attendance inference", async () => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    current.employees[0].historyKnown = false;
    current.employees[0].planningHistory = [{ employeeId: "e1", date: "2026-11-01", kind: "WORK", shiftId: "day" }];
    const previous = period("2026-10-26");
    previous.employees[0].id = "old-person";
    previous.employees[0].shiftIds = ["old-shift"];
    previous.shifts[0].id = "old-shift";
    previous.shifts[0].segments[2].end = 1020;
    for (const item of [...previous.assignments, ...previous.employees[0].history]) {
      item.employeeId = "old-person";
      if (item.shiftId) item.shiftId = "old-shift";
    }
    useCurrent(current);
    mocks.workspace.findMany.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    mocks.solve.mockResolvedValue({ status: "UNKNOWN", assignments: [], wallTimeSeconds: 1, message: "Prazo" });
    const result = await generateEscala(actor, "w1", 1);
    const person = result.proposalInput.employees[0];
    expect(person.history).toEqual([]);
    expect(person.historyKnown).toBe(false);
    expect(person.planningHistory).toHaveLength(7);
    expect(person.planningHistory?.at(-1)).toEqual({ employeeId: "e1", date: "2026-11-01", kind: "OFF" });
    const work = person.planningHistory?.find((item) => item.kind === "WORK");
    expect(work?.shiftId).toMatch(/^plan-/);
    expect(result.proposalInput.shifts.find((shift) => shift.id === work?.shiftId)?.segments).toEqual(previous.shifts[0].segments);
    expect(mocks.solve.mock.calls[0][0]).toEqual(result.proposalInput);
    expect(mocks.workspace.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: actor.tenantId, branchCode: "02", id: { not: "w1" } }),
      select: { revisions: expect.objectContaining({ where: { tenantId: actor.tenantId, status: "PUBLISHED" }, take: 1, orderBy: { revision: "desc" } }) } }));
    expect(publishedPlanningContext(current, [previous]).shifts).toEqual(result.proposalInput.shifts);
  });

  it("rejects the seventh contiguous workday across two non-overlapping published periods", async () => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    current.employees[0].historyKnown = false;
    const previous = period("2026-10-26");
    previous.assignments = previous.assignments.map((item, index) => ({ employeeId: "e1", date: item.date, kind: index === 0 ? "OFF" : "WORK", ...(index === 0 ? {} : { shiftId: "day" }) }));
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ status: 409, code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining("2026-11-02") });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
  });

  it("checks a later published period when inserting its preceding week", async () => {
    const current = period("2026-10-26");
    current.assignments = current.assignments.map((item, index) => ({ employeeId: "e1", date: item.date, kind: index === 0 ? "OFF" : "WORK", ...(index === 0 ? {} : { shiftId: "day" }) }));
    const later = period("2026-11-02");
    later.employees[0].history = [];
    later.employees[0].historyKnown = false;
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: later }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining("2026-11-02") });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
  });

  it("preserves protective Sunday rotation from the previous published Sunday", async () => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    current.employees[0].historyKnown = false;
    current.assignments[4] = { employeeId: "e1", date: "2026-11-06", kind: "OFF" };
    current.assignments[6] = { employeeId: "e1", date: "2026-11-08", kind: "WORK", shiftId: "day" };
    current.demands[4].minimum = 0;
    const previous = period("2026-10-26");
    previous.assignments[4] = { employeeId: "e1", date: "2026-10-30", kind: "OFF" };
    previous.assignments[6] = { employeeId: "e1", date: "2026-11-01", kind: "WORK", shiftId: "day" };
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining("domingo") });
  });

  it("rejects conflicting published duplicates and respects binding dates, disabled people and textual registrations", () => {
    const current = period("2026-11-02");
    const previous = period("2026-10-26");
    const conflict = structuredClone(previous);
    conflict.assignments[0] = { employeeId: "e1", date: previous.startDate, kind: "OFF" };
    expect(() => publishedPlanningContext(current, [previous, conflict])).toThrow(/divergentes/);
    current.employees[0].registration = "1";
    expect(publishedPlanningContext(current, [previous]).employees[0].planningHistory).toBeUndefined();
    current.employees[0].registration = "0001";
    current.employees[0].activeFrom = current.startDate;
    expect(publishedPlanningContext(current, [previous]).employees[0].planningHistory).toBeUndefined();
    current.employees[0].activeFrom = "";
    current.employees[0].planningEnabled = false;
    expect(publishedPlanningContext(current, [previous]).employees[0].planningHistory).toBeUndefined();
    current.employees[0].planningEnabled = true;
    expect(() => publishedPlanningContext(current, [{ ...previous, branchCode: "3" }])).toThrow(/filial/);
  });

  it.each(["work", "off"])("protects inter-shift rest and an occupied %s day at the publication boundary", async (kind) => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    const previous = period("2026-10-26");
    previous.shifts.push({ id: "night", name: "Noturno", segments: [{ start: 1200, end: 1440, kind: "WORK" }, { start: 1440, end: 1500, kind: "BREAK" }, { start: 1500, end: 1740, kind: "WORK" }] });
    previous.employees[0].shiftIds.push("night");
    previous.assignments[6] = { employeeId: "e1", date: "2026-11-01", kind: "WORK", shiftId: "night" };
    // Keep this case about inter-shift rest, not a separate six-day streak.
    if (kind === "work") {
      current.assignments[4] = { employeeId: "e1", date: "2026-11-06", kind: "OFF" };
      current.assignments[5] = { employeeId: "e1", date: "2026-11-07", kind: "WORK", shiftId: "day" };
      current.demands[4].minimum = 0; current.demands[5].minimum = 1;
    }
    if (kind === "off") {
      current.assignments[0] = { employeeId: "e1", date: "2026-11-02", kind: "OFF" };
      current.assignments[5] = { employeeId: "e1", date: "2026-11-07", kind: "WORK", shiftId: "day" };
      current.demands[0].minimum = 0; current.demands[5].minimum = 1;
    }
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining(kind === "off" ? "ainda contém trabalho" : "entre jornadas") });
  });

  it("resolves consecutive rest against the previous published Sunday without fabricating attendance", async () => {
    const current = period("2026-11-02");
    current.employees[0].history = [];
    current.employees[0].offPattern = "CONSECUTIVE";
    current.employees[0].offMode = "MIXED";
    current.employees[0].fixedOffDays = [0];
    current.assignments[0] = { employeeId: "e1", date: "2026-11-02", kind: "OFF" };
    current.assignments[5] = { employeeId: "e1", date: "2026-11-07", kind: "WORK", shiftId: "day" };
    current.demands[0].minimum = 0; current.demands[5].minimum = 1;
    const previous = period("2026-10-26");
    previous.assignments[6] = { employeeId: "e1", date: "2026-11-01", kind: "WORK", shiftId: "day" };
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_CONTINUITY", message: expect.stringContaining("consecutivas") });
  });

  it("fails clearly when copied planning shifts exceed the existing 120-shift input limit", () => {
    const current = period("2026-11-02");
    current.shifts = Array.from({ length: 120 }, (_, index) => ({ ...current.shifts[0], id: `shift-${index}` }));
    const previous = period("2026-10-26");
    previous.shifts[0].segments[2].end = 1020;
    expect(() => publishedPlanningContext(current, [previous])).toThrow(/120/);
  });

  it("allows identical assignments in overlapping complete-week periods", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    const result = await saveEscala(actor, "w1", 1, current, true);
    expect(result.status).toBe("PUBLISHED");
    expect(result.revision).toBe(2);
    expect(mocks.revision.create).toHaveBeenCalledOnce();
  });

  it("rejects divergent published work/off decisions without writes or personal data in the error", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    previous.assignments[0] = { employeeId: "e1", date: "2026-11-02", kind: "OFF" };
    previous.assignments[5] = { employeeId: "e1", date: "2026-11-07", kind: "WORK", shiftId: "day" };
    previous.demands[0].minimum = 0; previous.demands[5].minimum = 1;
    expect(validateEscala(current).readyToPublish).toBe(true);
    expect(validateEscala(previous).readyToPublish).toBe(true);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    const original = JSON.stringify(current);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ status: 409, code: "ESCALA_PUBLISHED_OVERLAP", message: expect.stringContaining("2026-11-02") });
    try { await saveEscala(actor, "w1", 1, current, true); } catch (error) {
      expect(String(error)).not.toContain("Ana");
      expect(String(error)).not.toContain("0001");
    }
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    expect(mocks.revision.create).not.toHaveBeenCalled();
    expect(mocks.audit.create).not.toHaveBeenCalled();
    expect(JSON.stringify(current)).toBe(original);
  });

  it("compares exact textual registrations and semantic segments rather than names, IDs or lock flags", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    const employee = previous.employees[0];
    employee.id = "imported-person"; employee.name = "Nome atualizado"; employee.shiftIds = ["imported-shift"];
    previous.shifts[0].id = "imported-shift"; previous.shifts[0].name = "Outro nome do mesmo turno";
    for (const assignment of [...previous.assignments, ...employee.history]) {
      assignment.employeeId = employee.id;
      if (assignment.shiftId) assignment.shiftId = "imported-shift";
      assignment.locked = true;
    }
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    expect((await saveEscala(actor, "w1", 1, current, true)).status).toBe("PUBLISHED");
    const otherRegistration = structuredClone(previous);
    otherRegistration.employees[0].registration = "1";
    otherRegistration.shifts[0].segments.forEach((segment) => { segment.start += 60; segment.end += 60; });
    mocks.peers.mockResolvedValue([{ revisions: [{ input: otherRegistration }] }]);
    expect((await saveEscala(actor, "w1", 1, current, true)).status).toBe("PUBLISHED");
  });

  it("rejects different shift segments even when employee and shift IDs are equal", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    previous.shifts[0].segments.forEach((segment) => { segment.start += 60; segment.end += 60; });
    previous.demands.forEach((demand) => { demand.start += 60; demand.end += 60; });
    expect(validateEscala(previous).readyToPublish).toBe(true);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_OVERLAP" });
    expect(mocks.revision.create).not.toHaveBeenCalled();
  });

  it("checks the latest published revision even when the other workspace currently has a draft", async () => {
    const current = period("2026-10-26", 2);
    const previous = period("2026-11-02", 2);
    previous.assignments[0] = { employeeId: "e1", date: "2026-11-02", kind: "OFF" };
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ status: "DRAFT", revision: 8, revisions: [{ input: previous, revision: 5, status: "PUBLISHED" }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_OVERLAP" });
    expect(mocks.peers).toHaveBeenCalledWith({
      where: { tenantId: "company-a", branchCode: "02", id: { not: "w1" }, startDate: { lte: "2026-11-29" }, endDate: { gte: "2026-10-05" } },
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      select: { revisions: { where: { tenantId: "company-a", status: "PUBLISHED" }, orderBy: { revision: "desc" }, take: 1, select: { input: true } } },
    });
  });

  it("compares declared current history with an earlier published schedule without changing history", async () => {
    const current = period("2026-11-02");
    const previous = period("2026-10-26");
    const record = current.employees[0].history.find((assignment) => assignment.date === "2026-10-30");
    if (record) { record.kind = "OFF"; delete record.shiftId; }
    expect(validateEscala(current).readyToPublish).toBe(true);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    const history = JSON.stringify(current.employees[0].history);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_OVERLAP", message: expect.stringContaining("2026-10-30") });
    expect(JSON.stringify(current.employees[0].history)).toBe(history);
  });

  it("protects the declared history of a later published schedule when approving an earlier period", async () => {
    const current = period("2026-10-26");
    const previous = period("2026-11-02");
    const record = previous.employees[0].history.find((assignment) => assignment.date === "2026-10-26");
    if (record) { record.kind = "OFF"; delete record.shiftId; }
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }]);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ code: "ESCALA_PUBLISHED_OVERLAP", message: expect.stringContaining("2026-10-26") });
  });

  it("protects the fixed Monday reservation paired with a published final Sunday off, across different imported IDs", async () => {
    const previous = period("2026-10-26");
    previous.employees[0].offMode = "FIXED";
    previous.employees[0].fixedOffDays = [0, 6];
    previous.employees[0].offPattern = "CONSECUTIVE";
    previous.assignments[0] = { employeeId: "e1", date: "2026-10-26", kind: "OFF" };
    previous.assignments[5] = { employeeId: "e1", date: "2026-10-31", kind: "WORK", shiftId: "day" };
    previous.demands[0].minimum = 0; previous.demands[5].minimum = 1;
    expect(validateEscala(previous).readyToPublish).toBe(true);
    const current = period("2026-11-02");
    current.employees[0].history = current.employees[0].history.map((assignment) => {
      const published = previous.assignments.find((item) => item.date === assignment.date);
      return published ? { ...published } : assignment;
    });
    current.employees[0].id = "future-person";
    current.employees[0].shiftIds = ["future-shift"];
    current.shifts[0].id = "future-shift";
    for (const assignment of [...current.assignments, ...current.employees[0].history]) {
      assignment.employeeId = "future-person";
      if (assignment.shiftId) assignment.shiftId = "future-shift";
    }
    expect(validateEscala(current).readyToPublish).toBe(true);
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ status: "DRAFT", revisions: [{ input: previous }] }]);
    const historical = JSON.stringify(current.employees[0].history);
    await expect(saveEscala(actor, "w1", 1, current, true)).rejects.toMatchObject({ status: 409, code: "ESCALA_PUBLISHED_OVERLAP", message: expect.stringContaining("2026-11-02") });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    expect(JSON.stringify(current.employees[0].history)).toBe(historical);
    expect(previous.assignments).toHaveLength(7);
    expect(previous.employees[0].history).toHaveLength(21);
  });

  it("does not compare two historical declarations without a published assignment on that date", async () => {
    const current = period("2026-11-02");
    const previous = period("2026-11-09");
    const record = previous.employees[0].history.find((assignment) => assignment.date === "2026-10-26");
    if (record) { record.kind = "OFF"; delete record.shiftId; }
    useCurrent(current);
    mocks.peers.mockResolvedValue([{ revisions: [{ input: previous }] }, { revisions: [] }]);
    expect((await saveEscala(actor, "w1", 1, current, true)).status).toBe("PUBLISHED");
  });

  it("acquires the parameterized branch lock before reading peers or writing and uses fresh statement snapshots", async () => {
    const events: string[] = [];
    mocks.advisory.mockImplementation(async () => { events.push("lock"); return 1; });
    mocks.peers.mockImplementation(async () => { events.push("read"); return []; });
    mocks.workspace.updateMany.mockImplementation(async () => { events.push("update"); return { count: 1 }; });
    await saveEscala(actor, "w1", 1, input(), true);
    expect(events).toEqual(["lock", "read", "update"]);
    const [sql, key] = mocks.advisory.mock.calls[0];
    expect(Array.from(sql as TemplateStringsArray).join("?")).toBe("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))");
    expect(key).toBe('escalas-publication:["company-a","02"]');
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
    expect(mocks.workspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "w1", tenantId: "company-a", revision: 1 } }));
  });

  it("does not lock or compare peers when saving an unpublished draft", async () => {
    await saveEscala(actor, "w1", 1, input());
    expect(mocks.advisory).not.toHaveBeenCalled();
    expect(mocks.peers).not.toHaveBeenCalled();
  });

  it("fails closed for an unreadable published snapshot and rechecks idempotent publications", async () => {
    useCurrent(input(), "PUBLISHED");
    mocks.peers.mockResolvedValue([{ revisions: [{ input: { schemaVersion: 999 } }] }]);
    await expect(saveEscala(actor, "w1", 1, input(), true)).rejects.toMatchObject({ status: 409, code: "ESCALA_PUBLISHED_OVERLAP" });
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    mocks.peers.mockResolvedValue([]);
    mocks.workspace.findFirst.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await expect(saveEscala(actor, "w1", 1, input(), true)).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
  });
});

describe("Escalas permissions", () => {
  it("requires an active tenant and gives ADMIN access only to the session tenant", async () => {
    expect(() => escalaActor({ user: { id: "a", tenantId: null, role: "ADMIN", status: "ACTIVE" }, expires: "2099" })).toThrow(/empresa/);
    expect(() => escalaActor({ user: { id: "a", tenantId: "a", role: "ADMIN", status: "BLOCKED" }, expires: "2099" })).toThrow(/ativo/);
    expect(escalaActor({ user: { id: "a", tenantId: "a", role: "OPERATOR", status: "ACTIVE" }, expires: "2099" })).toEqual({ userId: "a", tenantId: "a", admin: false });
    await expect(branchPermission(actor, "2")).resolves.toEqual({ canEdit: true, canPublish: true });
    expect(mocks.grants.findUnique).not.toHaveBeenCalled();
  });
  it("denies operators without explicit branch grants", async () => {
    mocks.grants.findUnique.mockResolvedValue(null);
    await expect(branchPermission(operator, "2")).rejects.toMatchObject({ status: 403 });
    expect(mocks.grants.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_userId_branchCode: { tenantId: "company-a", userId: "user-a", branchCode: "02" } } }));
    mocks.grants.findUnique.mockResolvedValue({ role: "OTHER" });
    await expect(branchPermission(operator, "2")).rejects.toMatchObject({ status: 403 });
  });
  it.each(["VIEWER", "PLANNER", "APPROVER"])("resolves %s without escalating privileges", async (role) => {
    mocks.grants.findUnique.mockResolvedValue({ role });
    const permission = await branchPermission(operator, "2");
    expect(permission).toEqual({ canEdit: role !== "VIEWER", canPublish: role === "APPROVER" });
    if (role !== "APPROVER") expect(() => requireEscalaPermission(permission, "publish")).toThrow(/publicar/);
    if (role === "VIEWER") expect(() => requireEscalaPermission(permission, "edit")).toThrow(/alterar/);
  });
  it("lists only explicitly granted branches for operators", async () => {
    mocks.grants.findMany.mockResolvedValue([{ branchCode: "2" }]);
    expect(await allowedBranches(operator)).toEqual(["02"]);
    expect(await allowedBranches(actor)).toBeNull();
    await listEscalas(operator);
    expect(mocks.workspace.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "company-a", branchCode: { in: ["02"] } } }));
  });
});

describe("Escalas revision service", () => {
  it("rejects malformed snapshots and stores a complete tenant-scoped first revision atomically", async () => {
    expect(() => parseEscalaInput({ ...input(), tenantId: "foreign" })).toThrow(/tenantId/);
    expect(parseEscalaInput(input()).employees[0].registration).toBe("0001");
    const result = await createEscala(actor, input());
    expect(result.revision).toBe(1);
    expect(result.validation.readyToPublish).toBe(true);
    expect(mocks.revision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: "company-a", workspaceId: "w1", revision: 1, status: "DRAFT", input: input(), createdById: "user-a" }) });
    const audit = mocks.audit.create.mock.calls[0][0];
    expect(audit.data.metadata).toEqual({ tenantId: "company-a", revision: 1, employeeCount: 1 });
    expect(JSON.stringify(audit)).not.toContain("Ana");
  });
  it("sorts branches naturally before rendering lists", async () => {
    mocks.workspace.findMany.mockResolvedValue([row({ id: "10", branchCode: "10" }), row({ id: "2", branchCode: "2" }), row({ id: "1", branchCode: "1" })]);
    expect((await listEscalas(actor)).map((workspace) => workspace.id)).toEqual(["1", "2", "10"]);
  });
  it("does not disclose a workspace belonging to another company", async () => {
    mocks.workspace.findFirst.mockResolvedValue(null);
    await expect(getEscala(actor, "foreign-id")).rejects.toMatchObject({ status: 404 });
    expect(mocks.workspace.findFirst).toHaveBeenCalledWith({ where: { id: "foreign-id", tenantId: "company-a" } });
    expect(mocks.revision.findUnique).not.toHaveBeenCalled();
  });
  it("reads an immutable historical revision and fails for an absent version", async () => {
    const result = await getEscala(actor, "w1", 1);
    expect(result.input).toEqual(input());
    expect(mocks.revision.findUnique).toHaveBeenCalledWith({ where: { tenantId_workspaceId_revision: { tenantId: "company-a", workspaceId: "w1", revision: 1 } } });
    mocks.revision.findUnique.mockResolvedValue(null);
    await expect(getEscala(actor, "w1", 9)).rejects.toMatchObject({ status: 404 });
  });
  it("saves a new draft without updating the previous published revision", async () => {
    mocks.revision.findUnique.mockResolvedValue(version(input(), 1, "PUBLISHED"));
    const result = await saveEscala(actor, "w1", 1, input());
    expect(result).toMatchObject({ revision: 2, status: "DRAFT" });
    expect(mocks.revision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ revision: 2, status: "DRAFT" }) });
    expect(mocks.workspace.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "w1", tenantId: "company-a", revision: 1 } }));
  });
  it("persists provisional estimates without treating a legacy global review as a mandatory minimum", async () => {
    const value = input(); value.policy.coverageReview = "CONFIRMED";
    value.demands = value.demands.map((demand) => ({ ...demand, estimated: true }));
    const saved = await saveEscala(actor, "w1", 1, value);
    expect(saved.input.demands.every((demand) => demand.estimated === true)).toBe(true);
    const stored = mocks.revision.create.mock.calls[0][0].data.input as EscalaInput;
    expect(stored.demands.every((demand) => demand.estimated === true)).toBe(true);
    expect(value.demands.every((demand) => demand.estimated === true)).toBe(true);
  });
  it("preserves explicit mandatory minima when a save resets the legacy branch review", async () => {
    const previous = input(); previous.policy.coverageReview = "CONFIRMED";
    previous.demands = previous.demands.map((demand) => ({ ...demand, estimated: false }));
    useCurrent(previous);
    const next = structuredClone(previous); next.policy.coverageReview = "SUGGESTED";
    const result = await saveEscala(actor, "w1", 1, next);
    expect(result.input.policy.coverageReview).toBe("SUGGESTED");
    expect(result.input.demands.every((demand) => demand.estimated === false)).toBe(true);
    expect(previous.demands.every((demand) => demand.estimated === false)).toBe(true);
  });
  it("rejects stale revisions before writes and enforces the transactional compare-and-swap", async () => {
    await expect(saveEscala(actor, "w1", 2, input())).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.workspace.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveEscala(actor, "w1", 1, input())).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
    expect(mocks.revision.create).not.toHaveBeenCalled();
  });
  it("keeps branch and period identity fixed", async () => {
    await expect(saveEscala(actor, "w1", 1, { ...input(), branchCode: "3" })).rejects.toMatchObject({ code: "ESCALA_IDENTITY_CHANGED" });
  });
  it("publishes only an independently ready snapshot, preserving the approval revision", async () => {
    const result = await saveEscala(actor, "w1", 1, input(), true);
    expect(result).toMatchObject({ revision: 2, status: "PUBLISHED" });
    expect(mocks.revision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "PUBLISHED", revision: 2 }) });
    const pending = input(); pending.policy.reviewed = false;
    const internal = await saveEscala(actor, "w1", 1, pending, true);
    expect(internal.status).toBe("PUBLISHED");
    expect(internal.input.policy.reviewed).toBe(false);
    expect(internal.validation.issues).toContainEqual(expect.objectContaining({ code: "POLICY_PENDING", severity: "WARNING" }));
    const invalid = input(); invalid.assignments = [];
    await expect(saveEscala(actor, "w1", 1, invalid, true)).rejects.toMatchObject({ status: 422 });
    mocks.revision.findUnique.mockResolvedValue(version(input(), 1, "PUBLISHED"));
    expect((await saveEscala(actor, "w1", 1, input(), true)).revision).toBe(1);
  });
  it("preserves locked cells and shift definitions; only approvers can explicitly unlock unchanged assignments", () => {
    const previous = input(); previous.assignments[0].locked = true;
    const changed = structuredClone(previous); changed.assignments[0] = { ...changed.assignments[0], kind: "OFF", shiftId: undefined };
    expect(() => preserveLockedAssignments(previous, changed)).toThrow(/bloqueado/);
    const changedShift = structuredClone(previous); changedShift.shifts[0].segments[2].end -= 1;
    expect(() => preserveLockedAssignments(previous, changedShift)).toThrow(/horário/);
    const unlock = structuredClone(previous); unlock.assignments[0].locked = false;
    expect(() => preserveLockedAssignments(previous, unlock)).toThrow();
    expect(() => preserveLockedAssignments(previous, unlock, true)).not.toThrow();
    expect(() => preserveLockedAssignments(previous, previous)).not.toThrow();
  });
  it("generates a preview and revalidates it without persisting", async () => {
    useCurrent(generatedInput());
    const result = await generateEscala(actor, "w1", 1);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.readyToPublish).toBe(false);
    expect(result.validation.issues.some(issue => issue.code === "COVERAGE_REVIEW_PENDING")).toBe(true);
    expect(result.proposalInput.assignments).toEqual(generatedInput().assignments);
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.solve.mockResolvedValue({ status: "UNKNOWN", assignments: [], wallTimeSeconds: 1, message: "Prazo encerrado" });
    const unfinished = await generateEscala(actor, "w1", 1);
    expect(unfinished.proposalInput.simulation).toBe(true);
    expect(unfinished.proposalInput.assignments).toEqual(generatedInput().assignments);
    expect(unfinished.proposalInput.demands.filter(demand => demand.estimated !== true)).toEqual(generatedInput().demands);
  });
  it("rejects a generated response when another editor changed the revision", async () => {
    mocks.revision.findUnique.mockResolvedValueOnce(version()).mockResolvedValueOnce(version(input(), 2));
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
  });
  it("rejects a feasible response with an unassigned day even when missing days are draft pendings", async () => {
    mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments: input().assignments.slice(1), wallTimeSeconds: 0.1, message: "Concluído" });
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("generates one joint preview with pending policy and automatically proposed coverage, without approving or persisting", async () => {
    const value = input(); value.assignments = []; value.demands = [];
    value.policy.reviewed = false; value.policy.source = ""; value.policy.reviewedBy = "";
    useCurrent(value);
    const result = await generateEscala(actor, "w1", 1);
    expect(mocks.solve).toHaveBeenCalledTimes(1);
    expect(mocks.solve.mock.calls[0]).toHaveLength(1);
    expect(result.preparation).toMatchObject({ includedEmployees: 1, untimedEmployees: 0 });
    expect(result.preparation.generatedCoverageSlots).toBeGreaterThan(0);
    expect(result.proposalInput.policy).toMatchObject({ reviewed: false, source: "", reviewedBy: "", coverageReview: "SUGGESTED" });
    expect(result.validation.valid).toBe(true);
    expect(result.validation.readyToPublish).toBe(false);
    expect(result.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "POLICY_PENDING" }), expect.objectContaining({ code: "COVERAGE_REVIEW_PENDING" })]));
    expect(result.validation.issues.some((issue) => issue.code === "DAY_PENDING" || issue.code === "COVERAGE_PENDING")).toBe(false);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("identifies incomplete setup before contacting the solver", async () => {
    const empty = input(); empty.employees = []; empty.assignments = [];
    mocks.revision.findUnique.mockResolvedValue(version(empty));
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ status: 422, code: "ESCALA_SETUP_REQUIRED" });
    expect(mocks.solve).not.toHaveBeenCalled();
  });
  it("generates rest rotation for an untimed manager without requiring a fictitious shift", async () => {
    const value = generatedInput();
    value.employees[0] = { ...value.employees[0], scheduleMode: "UNTIMED", shiftIds: [] };
    value.shifts = []; value.demands = [];
    value.assignments = value.assignments.map((item) => ({ employeeId: item.employeeId, date: item.date, kind: item.kind === "WORK" ? "DUTY" : item.kind }));
    useCurrent(value);
    mocks.solve.mockResolvedValue({ status: "OPTIMAL", assignments: value.assignments, wallTimeSeconds: 0.1, message: "Concluído" });
    const result = await generateEscala(actor, "w1", 1);
    expect(result.validation.readyToPublish).toBe(true);
    expect(result.validation.summaries[0]).toMatchObject({ workDays: 5, offDays: 2, workedMinutes: 0 });
  });
  it.each(["excluded", "inactive", "no-shift"])("rejects %s setup before contacting Python", async (scenario) => {
    const value = input();
    if (scenario === "excluded") { value.employees[0].planningEnabled = false; value.assignments = []; }
    if (scenario === "inactive") { value.employees[0].activeFrom = "2027-01-01"; value.assignments = []; }
    if (scenario === "no-shift") value.employees[0].shiftIds = [];
    useCurrent(value);
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "ESCALA_SETUP_REQUIRED", status: 422 });
    expect(mocks.solve).not.toHaveBeenCalled();
  });
  it("retains the explicit holiday-rest restriction but permits a 42h draft without fabricating compensation", async () => {
    const cct = input(); cct.policy.normativeProfile = "SINDECOMU_SUPERMARKETS_2026_2027";
    useCurrent(cct);
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "ESCALA_CCT_HOLIDAY_REST", status: 422 });
    const extended = input(); extended.policy.compensationAuthorized = false;
    extended.assignments = extended.assignments.map(day => day.date === "2026-10-29" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" as const }
      : day.date === "2026-10-31" ? { ...day, kind: "WORK" as const, shiftId: "day" } : day);
    extended.demands = extended.demands.map(demand => ({ ...demand, minimum: demand.date === "2026-10-29" || demand.date === "2026-11-01" ? 0 : 1 }));
    mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments: extended.assignments, wallTimeSeconds: 0.1, message: "Synthetic valid v2 proposal" });
    useCurrent(extended);
    const proposal = await generateEscala(actor, "w1", 1);
    expect(proposal.proposalInput.simulation).toBe(true);
    expect(proposal.proposalInput.policy.compensationAuthorized).toBe(false);
    expect(proposal.validation.valid).toBe(true);
    expect(proposal.validation.readyToPublish).toBe(false);
    expect(proposal.validation.issues).toContainEqual(expect.objectContaining({ code: "COVERAGE_REVIEW_PENDING", severity: "PENDING" }));
    expect(proposal.validation.issues.some(issue => issue.code === "COMPENSATION_REQUIRED" && issue.severity === "WARNING")).toBe(true);
    expect(mocks.solve).toHaveBeenCalledOnce();
  });
  it("does not misclassify unsupported non-worked holidays as a staffing impossibility", async () => {
    const holiday = generatedInput(); holiday.policy.holidayRestAllowed = false; holiday.policy.holidayDates = ["2026-10-28"];
    mocks.revision.findUnique.mockResolvedValue(version(holiday));
    const proposal = await generateEscala(actor, "w1", 1);
    expect(proposal.proposalInput.policy.authorizedHolidayDates).toEqual([]);
    expect(proposal.validation.issues.some(issue => issue.code === "HOLIDAY_WORK" && issue.severity === "WARNING")).toBe(true);
    expect(proposal.validation.readyToPublish).toBe(false);
    expect(mocks.solve).toHaveBeenCalledOnce();
  });
  it("permits internal publication with documentary warnings but still rejects operational violations", async () => {
    const pending = { ...input(), simulation: true };
    pending.policy.compensationAuthorized = false;
    useCurrent(pending);
    const saved = await saveEscala(actor, "w1", 1, pending, true);
    expect(saved.status).toBe("PUBLISHED");
    expect(saved.input.policy.compensationAuthorized).toBe(false);
    expect(saved.validation.issues).toContainEqual(expect.objectContaining({ code: "COMPENSATION_REQUIRED", severity: "WARNING" }));
    const writes = mocks.workspace.updateMany.mock.calls.length;
    const invalid = structuredClone(pending); invalid.policy.dailyLimitMinutes = 480;
    await expect(saveEscala(actor, "w1", 1, invalid, true)).rejects.toMatchObject({ status: 422, code: "ESCALA_NOT_READY" });
    expect(mocks.workspace.updateMany).toHaveBeenCalledTimes(writes);
    expect(mocks.revision.create).toHaveBeenCalledTimes(1);
    expect(mocks.audit.create).toHaveBeenCalledTimes(1);
  });
  it("never returns a hard-invalid solved proposal for application", async () => {
    mocks.solve.mockResolvedValue({ status: "FEASIBLE", assignments: input().assignments.map((item) => ({ employeeId: item.employeeId, date: item.date, kind: "OFF" })), wallTimeSeconds: 0.1, message: "Resposta inconsistente" });
    await expect(generateEscala(actor, "w1", 1)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("clears the persisted regeneration marker only for a successful verified proposal", async () => {
    const stale = { ...generatedInput(), needsRegeneration: true };
    useCurrent(stale);
    const completed = await generateEscala(actor, "w1", 1);
    expect(completed.proposalInput.needsRegeneration).toBe(false);
    expect(completed.validation.issues.some(issue => issue.code === "SCENARIO_OUTDATED")).toBe(false);
    expect(stale.needsRegeneration).toBe(true);
    mocks.solve.mockResolvedValue({ status: "UNKNOWN", assignments: [], wallTimeSeconds: 1, message: "Prazo encerrado" });
    const unfinished = await generateEscala(actor, "w1", 1);
    expect(unfinished.proposalInput.needsRegeneration).toBe(true);
    expect(unfinished.validation.issues).toContainEqual(expect.objectContaining({ code: "SCENARIO_OUTDATED", severity: "PENDING" }));
    expect(stale.needsRegeneration).toBe(true);
  });

});

describe("Generation conflict explanations", () => {
  it.each(["REST_ONLY", "DAYS_AND_HOURS"] as const)("preserves the infeasible diagnosis and offers clock flexibility only for %s", async generationMode => {
    const value = input(); value.generationMode = generationMode;
    value.shifts.push({ ...structuredClone(value.shifts[0]), id: "late",
      segments: value.shifts[0].segments.map(part => ({ ...part, start: part.start + 60, end: part.end + 60 })) });
    value.employees[0].shiftIds.push("late");
    value.demands = [{ id: "late-coverage", date: value.startDate, sector: "Reposição", start: 1080, end: 1104, minimum: 1, estimated: false }];
    useCurrent(value);
    const before = structuredClone(value);
    const calculation = { status: "INFEASIBLE", assignments: [], wallTimeSeconds: 0.1, message: "Nenhuma solução para a cobertura obrigatória" };
    mocks.solve.mockResolvedValue(calculation);
    const answer = await generateEscala(actor, "w1", 1);
    expect(answer.result).toMatchObject({ ...calculation, message: expect.stringContaining(calculation.message), conflicts: [] });
    if (generationMode === "REST_ONLY") {
      expect(answer.result.message).toContain("os horários de entrada e saída são mantidos");
      expect(answer.result.message).toContain('Se puder flexibilizá-los, selecione "Folgas e horários" e gere novamente.');
    } else {
      expect(answer.result.message).toBe(calculation.message);
    }
    expect(calculation.message).toBe("Nenhuma solução para a cobertura obrigatória");
    expect(answer.proposalInput.generationMode).toBe(generationMode);
    expect(answer.proposalInput.assignments).toEqual(before.assignments);
    expect(answer.proposalInput.employees[0].shiftIds).toEqual(["day", "late"]);
    expect(value).toEqual(before);
    expect(mocks.workspace.create).not.toHaveBeenCalled();
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    expect(mocks.revision.create).not.toHaveBeenCalled();
    expect(mocks.audit.create).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("explains an infeasible mandatory coverage budget without blaming nonexistent locks or changing the workspace", async () => {
    const value = input();
    value.assignments = [];
    value.demands = dateRange(value.startDate, value.endDate).flatMap((date) => value.shifts[0].segments.filter(segment => segment.kind === "WORK").map((segment, index) => ({ id: date + "-" + index, date, sector: "Reposição", start: segment.start, end: segment.end, minimum: 1, estimated: false })));
    useCurrent(value);
    const before = JSON.stringify(value);
    mocks.solve.mockResolvedValue({ status: "INFEASIBLE", assignments: [], wallTimeSeconds: 0.1, message: "Nenhuma solução" });
    const answer = await generateEscala(actor, "w1", 1);
    expect(answer.result.status).toBe("INFEASIBLE");
    expect(answer.result.conflicts).toContainEqual(expect.objectContaining({ code: "COVERAGE_WEEKLY_CAPACITY", target: "coverage", sector: "Reposição", message: expect.stringContaining("58h48") }));
    expect(answer.result.conflicts?.[0].message).toContain("42h00");
    expect(JSON.stringify(value)).toBe(before);
    expect(mocks.workspace.updateMany).not.toHaveBeenCalled();
    expect(mocks.revision.create).not.toHaveBeenCalled();
  });
});


describe("coverage provenance is preserved across every branch", () => {
  it.each(["02", "07", "LOJA-OUTRA"])("never promotes an estimate while creating branch %s with a legacy global confirmation", async branch => {
    const value = input(); value.branchCode = branch;
    value.policy.coverageReview = "CONFIRMED";
    value.demands[0].estimated = true;
    value.demands[1].estimated = false;
    const created = await createEscala(actor, value);
    expect(created.input.demands[0].estimated).toBe(true);
    expect(created.input.demands[1].estimated).toBe(false);
    const persisted = mocks.revision.create.mock.calls[0][0].data.input as EscalaInput;
    expect(persisted.demands[0].estimated).toBe(true);
    expect(persisted.demands[1].estimated).toBe(false);
  });
  it.each(["CONFIRMED", "SUGGESTED"] as const)("never promotes an estimate when saving a legacy revision as %s", async review => {
    const previous = input(); previous.policy.coverageReview = "CONFIRMED";
    previous.demands[0].estimated = true;
    previous.demands[1].estimated = false;
    useCurrent(previous);
    const next = structuredClone(previous); next.policy.coverageReview = review;
    const saved = await saveEscala(actor, "w1", 1, next);
    expect(saved.input.demands[0].estimated).toBe(true);
    expect(saved.input.demands[1].estimated).toBe(false);
    expect(previous.demands[0].estimated).toBe(true);
    expect(previous.demands[1].estimated).toBe(false);
  });
});

describe("Shared operational provenance", () => {
  const shared = { tenantId: "company-a", userId: null, admin: false, moduleSessionId: "operational-session" };
  it("creates and saves a real draft revision without assigning shared actions to an individual account", async () => {
    const created = await createEscala(shared, input());
    expect(created.canEdit).toBe(true); expect(created.canPublish).toBe(false);
    expect(mocks.revision.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ createdById: null, accessChannel: "ESCALAS_MODULE_PASSWORD", moduleSessionId: "operational-session", tenantId: "company-a" }) });
    const saved = await saveEscala(shared, "w1", 1, input());
    expect(saved.revision).toBe(2);
    expect(mocks.audit.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ userId: null, metadata: expect.objectContaining({ accessChannel: "ESCALAS_MODULE_PASSWORD", moduleSessionId: "operational-session", tenantId: "company-a", previousRevision: 1 }) }) });
    await expect(saveEscala(shared, "w1", 1, input(), true)).rejects.toMatchObject({ status: 403, code: "ESCALA_ACTION_FORBIDDEN" });
  });
  it("never resolves a foreign workspace or revision merely because the browser knows its id", async () => {
    mocks.workspace.findFirst.mockResolvedValue(null);
    await expect(getEscala(shared, "foreign-workspace")).rejects.toMatchObject({ status: 404 });
    expect(mocks.workspace.findFirst).toHaveBeenLastCalledWith({ where: { id: "foreign-workspace", tenantId: "company-a" } });
    expect(mocks.revision.findUnique).not.toHaveBeenCalled();
  });
});
