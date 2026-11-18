import { beforeEach, describe, expect, it, vi } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { createEscala, saveEscala, upgradeEscalaCalendar } from "./service";
import type { EscalaInput } from "./types";

const db = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), versions: new Map<string, Record<string, unknown>>(),
  inserts: vi.fn(), updates: vi.fn(), audits: vi.fn(), stale: false }));
vi.mock("@/lib/prisma", () => {
  const workspace = {
    findFirst: vi.fn(async ({ where }: { where: { id: string; tenantId: string; revision?: number } }) => {
      const row = db.rows.get(where.id);
      if (!row || row.tenantId !== where.tenantId || where.revision !== undefined && (db.stale || row.revision !== where.revision)) return null;
      return row;
    }),
    findMany: vi.fn(async () => []),
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
  const tx = { escalaWorkspace: workspace, escalaRevision: revision, auditLog: { create: db.audits } };
  return { prisma: { ...tx, $transaction: async (callback: (connection: typeof tx) => unknown) => callback(tx) } };
});

const actor = { userId: "synthetic-user", tenantId: "synthetic-company", admin: true };
function source(): EscalaInput {
  const input = newInput("06", "Filial sintética", "2026-12", 42);
  return { ...input, planningWeekStartsOn: "MONDAY", startDate: "2026-11-30", endDate: "2027-01-03",
    employees: [{ ...newEmployee(42, input.shifts[0].id), id: "e1", registration: "1", name: "Pessoa sintética", activeFrom: "2020-01-01" }],
    assignments: [{ employeeId: "e1", date: "2027-01-03", kind: "OFF", locked: true }] };
}

beforeEach(() => {
  db.rows.clear(); db.versions.clear(); db.inserts.mockClear(); db.updates.mockClear(); db.audits.mockClear(); db.stale = false;
  db.rows.set("source", { id: "source", tenantId: actor.tenantId, branchCode: "06", branchName: "Filial sintética", startDate: "2026-11-30", endDate: "2027-01-03", revision: 7, status: "DRAFT", updatedAt: new Date("2026-11-18T00:00:00Z") });
  db.versions.set(JSON.stringify([actor.tenantId, "source", 7]), { revision: 7, status: "DRAFT", input: source(), createdAt: new Date("2026-11-18T00:00:00Z") });
});

describe("calendar upgrade persistence", () => {
  it("creates a dated new revision, preserves the source and rehydrates its boundary on save", async () => {
    const before = structuredClone(db.versions.get(JSON.stringify([actor.tenantId, "source", 7])));
    const created = await upgradeEscalaCalendar(actor, "source", 7);
    expect(created).toMatchObject({ id: "new-draft", revision: 1, status: "DRAFT", input: { planningWeekStartsOn: "SUNDAY", planningCalendarSource: { workspaceId: "source", revision: 7 }, startDate: "2026-11-29", endDate: "2027-01-02" } });
    expect(db.inserts).toHaveBeenCalledTimes(1);
    expect(db.updates).not.toHaveBeenCalled();
    expect(db.versions.get(JSON.stringify([actor.tenantId, "source", 7]))).toEqual(before);
    const outer = { employeeId: "e1", date: "2027-01-03", kind: "OFF", locked: true };
    expect(created.input.employees[0].planningFuture).toEqual([outer]);
    const client = structuredClone(created.input); client.employees[0].planningFuture = [];
    const saved = await saveEscala(actor, created.id, created.revision, client);
    expect(saved.revision).toBe(2);
    expect(saved.input.employees[0].planningFuture).toEqual([outer]);
    const persisted = db.versions.get(JSON.stringify([actor.tenantId, "new-draft", 2]));
    expect(persisted).toMatchObject({ input: { planningCalendarSource: { workspaceId: "source", revision: 7 }, employees: [expect.objectContaining({ planningFuture: [outer] })] } });
    expect(db.versions.get(JSON.stringify([actor.tenantId, "source", 7]))).toEqual(before);
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
