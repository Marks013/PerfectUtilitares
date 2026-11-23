import { beforeEach, describe, expect, it, vi } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { dateRange, dayOfWeek } from "./dates";
import { createEscala, generateEscala, saveEscala, upgradeEscalaCalendar } from "./service";
import type { EscalaInput } from "./types";

const db = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), versions: new Map<string, Record<string, unknown>>(),
  inserts: vi.fn(), updates: vi.fn(), audits: vi.fn(), published: vi.fn(), solve: vi.fn(), stale: false }));
vi.mock("./solver-client", async (original) => ({ ...await original<typeof import("./solver-client")>(), solveEscala: db.solve }));
vi.mock("@/lib/prisma", () => {
  const workspace = {
    findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string; revision?: number } }) => {
      const row = db.rows.get(where.id);
      if (!row || row.tenantId !== where.tenantId || where.revision !== undefined && (db.stale || row.revision !== where.revision)) return null;
      return row;
    }),
    findMany: db.published,
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      db.inserts(data);
      const row = { ...data, id: "new-draft", revision: 1, status: "DRAFT", updatedAt: new Date("2026-11-18T00:00:00Z") };
      db.rows.set(row.id, row); return row;
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; revision: number }; data: Record<string, unknown> }) => {
      const row = db.rows.get(where.id);
      if (!row || row.revision !== where.revision) return { count: 0 };
      db.updates(data); db.rows.set(where.id, { ...row, ...data }); return { count: 1 };
    }),
  };
  const revision = {
    findUnique: vi.fn(async ({ where }: { where: { tenantId_workspaceId_revision: { tenantId: string; workspaceId: string; revision: number } } }) => {
      const key = where.tenantId_workspaceId_revision;
      return db.versions.get(JSON.stringify([key.tenantId, key.workspaceId, key.revision])) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const value = { ...data, createdAt: new Date("2026-11-18T00:00:00Z") };
      db.versions.set(JSON.stringify([data.tenantId, data.workspaceId, data.revision]), value); return value;
    }),
  };
  const access = {
    escalaModuleAccessPolicy: { findUnique: vi.fn(async () => null) },
    user: { findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string } }) =>
      where.id === "synthetic-user" && where.tenantId === "synthetic-company"
        ? { ...where, status: "ACTIVE", role: "ADMIN", securityVersion: 1 } : null) },
  };
  const tables = { ...access, escalaWorkspace: workspace, escalaRevision: revision, auditLog: { create: db.audits } };
  const tx = { ...tables, $executeRaw: vi.fn(async () => 1), $queryRaw: vi.fn(async () => []) };
  return { prisma: { ...tables, $transaction: async (callback: (connection: typeof tx) => unknown) => callback(tx) } };
});

const actor = { userId: "synthetic-user", tenantId: "synthetic-company", admin: true, accountSessionId: "synthetic-session" };
function source(): EscalaInput {
  const input = newInput("06", "Filial sintética", "2026-12", 42);
  return { ...input, planningWeekStartsOn: "MONDAY", startDate: "2026-11-30", endDate: "2027-01-03",
    employees: [{ ...newEmployee(42, input.shifts[0].id), id: "e1", registration: "1", name: "Pessoa sintética", activeFrom: "2020-01-01" }],
    assignments: [{ employeeId: "e1", date: "2027-01-03", kind: "OFF", locked: true },
      { employeeId: "e1", date: "2026-12-03", kind: "ABSENCE", locked: true }] };
}

beforeEach(() => {
  db.published.mockReset().mockResolvedValue([]);
  db.solve.mockReset().mockResolvedValue({ status: "UNKNOWN", assignments: [], wallTimeSeconds: 0.1, message: "Processador simulado" });
  db.rows.clear(); db.versions.clear(); db.inserts.mockClear(); db.updates.mockClear(); db.audits.mockClear(); db.stale = false;
  db.rows.set("source", { id: "source", tenantId: actor.tenantId, branchCode: "06", branchName: "Filial sintética", startDate: "2026-11-30", endDate: "2027-01-03", revision: 7, status: "DRAFT", updatedAt: new Date("2026-11-18T00:00:00Z") });
  db.versions.set(JSON.stringify([actor.tenantId, "source", 7]), { revision: 7, status: "DRAFT", input: source(), createdAt: new Date("2026-11-18T00:00:00Z") });
});

describe("December origin ruler", () => {
  const versionKey = (id: string, revision: number) => JSON.stringify([actor.tenantId, id, revision]);
  async function convert() {
    const legacy = source();
    legacy.employees[0].sector = "Loja";
    legacy.employees[0].role = "Atendente";
    legacy.employees[0].scheduleMode = "TIMED";
    legacy.policy.calendarMode = "MANUAL";
    legacy.policy.coverageReview = "SUGGESTED";
    legacy.coverageBasis = "coverage-v2:aaaaaaaaaaaaaaaa";
    legacy.assignments = dateRange(legacy.startDate, legacy.endDate).map(date => [2, 6].includes(dayOfWeek(date))
      ? { employeeId: "e1", date, kind: "OFF" } : { employeeId: "e1", date, kind: "WORK", shiftId: legacy.shifts[0].id });
    legacy.demands = [
      { id: "origin-estimated-december", date: "2026-12-04", sector: "Loja", role: "Atendente", start: 1180, end: 1200, minimum: 2, estimated: true },
      { id: "origin-confirmed", date: "2026-12-04", sector: "Loja", start: 480, end: 600, minimum: 1, estimated: false },
      { id: "origin-estimated-november", date: "2026-11-30", sector: "Loja", start: 480, end: 600, minimum: 3, estimated: true },
      { id: "origin-estimated-january", date: "2027-01-03", sector: "Loja", start: 480, end: 600, minimum: 4, estimated: true },
    ];
    const original = db.versions.get(versionKey("source", 7));
    if (!original) throw new Error("Missing synthetic origin");
    original.input = legacy;
    const created = await upgradeEscalaCalendar(actor, "source", 7);
    const stored = db.versions.get(versionKey(created.id, created.revision));
    if (!stored) throw new Error("Missing synthetic draft");
    return { created, legacy, stored, original };
  }

  it("reloads the pinned origin after actual upgrade and passes its clipped ruler to generation", async () => {
    const { created, legacy, original, stored } = await convert();
    expect(created.input.needsRegeneration).toBe(true);
    expect(created.input.demands).toEqual([legacy.demands[1]]);
    const next = structuredClone(legacy);
    next.demands[0].minimum = 99;
    const originRow = db.rows.get("source");
    if (!originRow) throw new Error("Missing synthetic origin workspace");
    originRow.revision = 8;
    db.versions.set(versionKey("source", 8), { ...original, revision: 8, input: next });
    const before = structuredClone([original, stored]);
    const result = await generateEscala(actor, created.id, created.revision);
    expect(result.proposalInput.demands).toEqual(legacy.demands.slice(0, 2));
    expect(result.proposalInput.coverageBasis).toBe(legacy.coverageBasis);
    expect(result.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "COVERAGE_REVIEW_PENDING" })]));
    expect(db.solve).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      startDate: "2026-12-01", endDate: "2026-12-31", demands: legacy.demands.slice(0, 2),
    }), expect.objectContaining({ admittedDecemberOrigin: expect.objectContaining({
      startDate: "2026-12-01", endDate: "2026-12-31", demands: legacy.demands.slice(0, 2),
      assignments: legacy.assignments.filter(day => day.date.startsWith("2026-12")),
    }) }));
    expect([original, stored]).toEqual(before);
    expect(db.updates).not.toHaveBeenCalled();
  });

  it.each(["team", "hours", "restriction", "lock", "published-lock", "explicit-minimum"] as const)(
    "declines the historical December ruler after a relevant %s change", async change => {
      const { created, stored, legacy } = await convert();
      const changed = structuredClone(created.input);
      if (change === "team") changed.employees[0].role = "Outra função";
      if (change === "hours") changed.employees[0].weeklyHours = 40;
      if (change === "restriction") changed.policy.maxConsecutiveWorkDays = 4;
      if (change === "lock") changed.assignments[2].locked = true;
      if (change === "explicit-minimum") changed.demands[0].minimum++;
      if (change === "published-lock") db.published.mockResolvedValue([{ revisions: [{ input: legacy }] }]);
      stored.input = changed;

      const result = await generateEscala(actor, created.id, created.revision);
      expect(result.proposalInput.demands.some(demand => demand.id.startsWith("origin-estimated-"))).toBe(false);
      expect(result.proposalInput.demands).toContainEqual(changed.demands[0]);
      expect(db.solve).toHaveBeenCalledTimes(1);
      expect(db.solve.mock.calls[0]).toHaveLength(2);
      expect(db.updates).not.toHaveBeenCalled();
    });

  it.each(["branch", "tenant", "version"] as const)("stops before generation if the source %s cannot be verified", async change => {
    const { created } = await convert();
    const row = db.rows.get("source");
    if (!row) throw new Error("Missing synthetic origin workspace");
    if (change === "branch") row.branchCode = "09";
    if (change === "tenant") row.tenantId = "foreign-company";
    if (change === "version") db.versions.delete(versionKey("source", 7));

    await expect(generateEscala(actor, created.id, created.revision)).rejects.toMatchObject({ code: "ESCALA_DECEMBER_ORIGIN_UNAVAILABLE" });
    expect(db.solve).not.toHaveBeenCalled();
    expect(db.updates).not.toHaveBeenCalled();
  });
});

describe("calendar upgrade persistence", () => {
  it("creates an independent December draft with only in-month commitments", async () => {
    const before = structuredClone(db.versions.get(JSON.stringify([actor.tenantId, "source", 7])));
    const created = await upgradeEscalaCalendar(actor, "source", 7);
    expect(created).toMatchObject({ id: "new-draft", revision: 1, status: "DRAFT", input: { planningWeekStartsOn: "SUNDAY", planningCalendarSource: { workspaceId: "source", revision: 7 }, startDate: "2026-12-01", endDate: "2026-12-31" } });
    expect(db.inserts).toHaveBeenCalledTimes(1);
    expect(db.updates).not.toHaveBeenCalled();
    expect(db.versions.get(JSON.stringify([actor.tenantId, "source", 7]))).toEqual(before);
    const absence = { employeeId: "e1", date: "2026-12-03", kind: "ABSENCE", locked: true };
    expect(created.input.assignments).toEqual([absence]);
    expect(created.input.employees[0].planningFuture).toBeUndefined();
    const client = structuredClone(created.input);
    client.employees[0].history = [{ employeeId: "e1", date: "2026-11-30", kind: "OFF" }];
    client.employees[0].historyKnown = true;
    const saved = await saveEscala(actor, created.id, created.revision, client);
    expect(saved.revision).toBe(2);
    expect(saved.input.employees[0]).toMatchObject({ history: [], historyKnown: false });
    const persisted = db.versions.get(JSON.stringify([actor.tenantId, "new-draft", 2]));
    expect(persisted).toMatchObject({ input: { planningCalendarSource: { workspaceId: "source", revision: 7 }, assignments: [absence], employees: [expect.objectContaining({ history: [], historyKnown: false })] } });
    expect(db.versions.get(JSON.stringify([actor.tenantId, "source", 7]))).toEqual(before);
  });

  it("preserves published days in December and the original identifier of an equivalent clock", async () => {
    const legacy = source();
    const originalClock = legacy.shifts[0];
    legacy.shifts.push({ ...structuredClone(originalClock), id: "equivalent-clock" });
    const work = { employeeId: "e1", date: "2026-12-02", kind: "WORK", shiftId: originalClock.id, locked: true } as const;
    legacy.assignments.push(work);
    const snapshot = db.versions.get(JSON.stringify([actor.tenantId, "source", 7]));
    if (!snapshot) throw new Error("Missing synthetic source revision");
    snapshot.input = legacy;

    const published = structuredClone(legacy);
    published.assignments = [
      { ...work, shiftId: "equivalent-clock" },
      { employeeId: "e1", date: "2026-12-06", kind: "OFF" },
      { employeeId: "e1", date: "2026-11-30", kind: "OFF" },
    ];
    db.published.mockResolvedValue([{ revisions: [{ input: published }] }]);

    const result = await upgradeEscalaCalendar(actor, "source", 7);
    expect(db.published).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      tenantId: actor.tenantId, branchCode: "06", startDate: { lte: "2026-12-31" }, endDate: { gte: "2026-12-01" },
    }) }));
    expect(result.input.assignments).toEqual([
      { employeeId: "e1", date: "2026-12-03", kind: "ABSENCE", locked: true },
      work,
      { employeeId: "e1", date: "2026-12-06", kind: "OFF", locked: true },
    ]);
    expect(result.input.shifts.find(shift => shift.id === originalClock.id)).toEqual(originalClock);
    expect(result.input.employees[0].planningHistory).toBeUndefined();
    expect(snapshot.input).toBe(legacy);
    expect(db.updates).not.toHaveBeenCalled();
  });

  it("rejects stale and cross-company requests before creating another draft", async () => {
    await expect(upgradeEscalaCalendar(actor, "source", 6)).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
    await expect(upgradeEscalaCalendar({ ...actor, tenantId: "other-company" }, "source", 7)).rejects.toMatchObject({ code: "ESCALA_NOT_FOUND" });
    db.stale = true;
    await expect(upgradeEscalaCalendar(actor, "source", 7)).rejects.toMatchObject({ code: "ESCALA_STALE_REVISION" });
    expect(db.inserts).not.toHaveBeenCalled();
  });

  it("does not accept forged source metadata through ordinary create or save", async () => {
    await expect(createEscala(actor, { ...source(), planningCalendarSource: { workspaceId: "source", revision: 7 } })).rejects.toMatchObject({ code: "ESCALA_CALENDAR_SOURCE_INVALID" });
    const created = await upgradeEscalaCalendar(actor, "source", 7);
    const client = structuredClone(created.input); delete client.planningCalendarSource;
    await expect(saveEscala(actor, created.id, 1, client)).rejects.toMatchObject({ code: "ESCALA_CALENDAR_SOURCE_CHANGED" });
    expect(db.updates).not.toHaveBeenCalled();
  });
});
