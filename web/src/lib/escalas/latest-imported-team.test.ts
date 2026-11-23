import type { Prisma } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { loadLatestEscalaImportedTeam, persistEscalaImportedTeam, preserveLatestEscalaImportedTeamBeforeDelete } from "./latest-imported-team";
import type { EscalaEmployee, EscalaInput, EscalaShift } from "./types";

const baseShift: EscalaShift = { id: "base", name: "Diurno", segments: [
  { kind: "WORK", start: 480, end: 720 }, { kind: "BREAK", start: 720, end: 780 }, { kind: "WORK", start: 780, end: 1044 },
] };
const importedShift: EscalaShift = { ...baseShift, id: "imported" };

function employee(id: string, registration: string, overrides: Partial<EscalaEmployee> = {}): EscalaEmployee {
  return { id, registration, name: "Colaborador", sector: "Loja", role: "Operador", weeklyHours: 42,
    shiftIds: [baseShift.id], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY",
    maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [], scheduleMode: "TIMED", ...overrides };
}

function input(overrides: Partial<EscalaInput> = {}): EscalaInput {
  return { schemaVersion: 1, branchCode: "02", branchName: "Filial", startDate: "2026-11-30", endDate: "2027-01-03",
    defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo", policy: {
      source: "Cenário sintético", validFrom: "2026-01-01", validUntil: "2027-12-31", reviewed: true,
      reviewedBy: "Responsável", weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true,
      minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5,
      closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: true, nightWorkReviewed: false,
    }, employees: [], shifts: [baseShift], demands: [], assignments: [], ...overrides };
}

function repository(source: EscalaInput) {
  const workspaces = vi.fn().mockResolvedValue([{ id: "novembro" }, { id: "novembro-2" }]);
  const audit = vi.fn().mockResolvedValue({ entityId: "novembro", metadata: {
    tenantId: "empresa", revision: 4, adminImport: { purpose: "EMPLOYEES", startDate: "2026-11-01", endDate: "2026-11-30" },
  } });
  const revision = vi.fn().mockResolvedValue({ tenantId: "empresa", workspaceId: "novembro", revision: 4, input: source,
    workspace: { branchCode: "02" } });
  const stored = vi.fn().mockResolvedValue(null);
  const upsert = vi.fn().mockImplementation(async ({ create }) => { stored.mockResolvedValue(create); });
  const db = { escalaImportedTeam: { findUnique: stored, upsert }, escalaWorkspace: { findMany: workspaces }, auditLog: { findFirst: audit },
    escalaRevision: { findUnique: revision } } as unknown as Prisma.TransactionClient;
  return { db, workspaces, audit, revision, stored, upsert };
}

const previous = (overrides: Partial<EscalaInput> = {}) => input({ startDate: "2026-10-26", endDate: "2026-12-06", ...overrides });

describe("source of the imported planning team", () => {
  it("reads the newest team import event in the authorized branch and its exact revision", async () => {
    const imported = employee("person", "0007", { shiftIds: [importedShift.id], fixedImportedShiftId: importedShift.id, historyKnown: true,
      history: [{ employeeId: "person", date: "2026-10-25", kind: "OFF" }] });
    const source = previous({ employees: [
      imported,
      employee("expired", "0008", { activeUntil: "2026-11-18" }),
      employee("future-manual", "0009", { activeFrom: "2026-12-01" }),
    ], shifts: [baseShift, importedShift], assignments: [{ employeeId: "person", date: "2026-11-15", kind: "ABSENCE", locked: true }] });
    const repo = repository(source);
    const approved = input({ employees: [employee("stale-seed", "0005")] });
    const result = await loadLatestEscalaImportedTeam(repo.db, "empresa", approved);
    expect(result).toMatchObject({ workspaceId: "novembro", revision: 4 });
    expect(repo.workspaces).toHaveBeenCalledWith({ where: { tenantId: "empresa", branchCode: "02" }, select: { id: true } });
    expect(repo.audit).toHaveBeenCalledWith(expect.objectContaining({ where: {
      entity: "EscalaWorkspace", action: "UPDATE", entityId: { in: ["novembro", "novembro-2"] }, AND: [
        { metadata: { path: ["tenantId"], equals: "empresa" } },
        { metadata: { path: ["adminImport", "purpose"], equals: "EMPLOYEES" } },
      ],
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }));
    expect(repo.revision).toHaveBeenCalledWith(expect.objectContaining({ where: {
      tenantId_workspaceId_revision: { tenantId: "empresa", workspaceId: "novembro", revision: 4 },
    } }));
    expect(result?.input).toMatchObject({ assignments: [], employees: [{
      id: "person", registration: "0007", activeFrom: "", history: [], historyKnown: false, shiftIds: [importedShift.id],
    }], needsRegeneration: true, policy: approved.policy, shifts: [baseShift, importedShift] });
  });

  it("removes imported overrides dated in the source and keeps the shift underlying those overrides", async () => {
    const selected: EscalaShift = { ...baseShift, id: "manual" };
    const person = employee("person", "0010", { shiftIds: ["base", "manual"], originalShiftIds: ["base"], manualShiftBaseIds: ["base"],
      manualShiftOverrides: [{ catalogCode: 1500, shiftId: "manual", markings: ["08:00", "12:00", "13:00", "17:24"],
        effectiveFrom: "2026-11-01", effectiveUntil: "2026-11-02" }],
      manualShiftByDate: { "2026-11-01": "manual", "2026-11-02": "manual" } });
    const { db } = repository(previous({ employees: [person], shifts: [baseShift, selected] }));
    const result = await loadLatestEscalaImportedTeam(db, "empresa", input());
    expect(result?.input.employees[0]).toMatchObject({ shiftIds: ["base"], originalShiftIds: ["base"] });
    expect(result?.input.employees[0]).not.toHaveProperty("manualShiftOverrides");
    expect(result?.input.employees[0]).not.toHaveProperty("manualShiftByDate");
    expect(result?.input.shifts).toEqual([baseShift]);
  });

  it("retains assignments explicitly approved for the target and refuses incompatible imported people", async () => {
    const person = employee("person", "0007");
    const assignments: EscalaInput["assignments"] = [{ employeeId: person.id, date: "2026-12-15", kind: "OFF", locked: true }];
    const approved = input({ employees: [person], assignments });
    const repo = repository(previous({ employees: [person] }));
    expect((await loadLatestEscalaImportedTeam(repo.db, "empresa", approved))?.input.assignments).toEqual(assignments);
    repo.revision.mockResolvedValue({ tenantId: "empresa", workspaceId: "novembro", revision: 4, workspace: { branchCode: "02" },
      input: previous({ employees: [employee("other", "0007")] }) });
    await expect(loadLatestEscalaImportedTeam(repo.db, "empresa", approved)).rejects.toMatchObject({ code: "ESCALA_IMPORTED_TEAM_SEED_CONFLICT" });
  });

  it("refuses a different geometry for an already approved shift identifier", async () => {
    const repo = repository(previous({ employees: [employee("person", "0007")], shifts: [{
      ...baseShift, segments: [{ kind: "WORK", start: 520, end: 770 }],
    }] }));
    await expect(loadLatestEscalaImportedTeam(repo.db, "empresa", input())).rejects.toMatchObject({ code: "ESCALA_IMPORTED_TEAM_SEED_CONFLICT" });
  });

  it("fails closed for an event without its exact revision or outside the selected branch", async () => {
    const repo = repository(previous());
    repo.revision.mockResolvedValueOnce(null);
    await expect(loadLatestEscalaImportedTeam(repo.db, "empresa", input())).rejects.toMatchObject({ code: "ESCALA_IMPORTED_TEAM_INVALID" });
    repo.revision.mockResolvedValueOnce({ tenantId: "empresa", workspaceId: "novembro", revision: 4,
      workspace: { branchCode: "07" }, input: previous({ branchCode: "07" }) });
    await expect(loadLatestEscalaImportedTeam(repo.db, "empresa", input())).rejects.toMatchObject({ code: "ESCALA_IMPORTED_TEAM_INVALID" });
  });

  it("returns no import when a branch has no matching team import event", async () => {
    const repo = repository(previous());
    repo.audit.mockResolvedValue(null);
    await expect(loadLatestEscalaImportedTeam(repo.db, "empresa", input())).resolves.toBeUndefined();
    expect(repo.revision).not.toHaveBeenCalled();
  });

  it("keeps the last confirmed team after the originating workspace is deleted", async () => {
    const source = previous({ employees: [employee("person", "0007", { historyKnown: true,
      history: [{ employeeId: "person", date: "2026-10-25", kind: "OFF" }] }),
    employee("outside", "0008", { activeFrom: "2026-12-01" })],
    assignments: [{ employeeId: "person", date: "2026-11-15", kind: "ABSENCE", locked: true }] });
    const repo = repository(source);
    await persistEscalaImportedTeam(repo.db, { tenantId: "empresa", workspaceId: "importacao-nova", revision: 5,
      startDate: "2026-11-01", endDate: "2026-11-30", input: source });
    expect(repo.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_branchCode: { tenantId: "empresa", branchCode: "02" } },
      create: expect.objectContaining({ sourceWorkspaceId: "importacao-nova", sourceRevision: 5, snapshot: {
        version: 1, employees: [expect.objectContaining({ registration: "0007", history: [], historyKnown: false })], shifts: [baseShift],
      } }),
    }));
    const result = await loadLatestEscalaImportedTeam(repo.db, "empresa", input());
    expect(result).toMatchObject({ workspaceId: "importacao-nova", revision: 5, input: { assignments: [],
      employees: [expect.objectContaining({ registration: "0007" })] } });
    expect(repo.audit).not.toHaveBeenCalled();
    expect(repo.revision).not.toHaveBeenCalled();
  });

  it("pins the latest legacy source before its deletion without pinning older workspaces", async () => {
    const source = previous({ employees: [employee("person", "0007")] });
    const repo = repository(source);
    await preserveLatestEscalaImportedTeamBeforeDelete(repo.db, "empresa", "02", "novembro-2");
    expect(repo.upsert).not.toHaveBeenCalled();
    expect(repo.revision).not.toHaveBeenCalled();

    await preserveLatestEscalaImportedTeamBeforeDelete(repo.db, "empresa", "02", "novembro");
    expect(repo.upsert).toHaveBeenCalledTimes(1);
    repo.revision.mockResolvedValue(null);
    repo.audit.mockClear();
    expect(await loadLatestEscalaImportedTeam(repo.db, "empresa", input())).toMatchObject({ workspaceId: "novembro", revision: 4 });
    expect(repo.audit).not.toHaveBeenCalled();
  });

  it("refuses a corrupt durable source instead of using an earlier import", async () => {
    const repo = repository(previous());
    repo.stored.mockResolvedValue({ tenantId: "empresa", branchCode: "02", sourceWorkspaceId: "newer", sourceRevision: 8,
      snapshot: { version: 3 } });
    await expect(loadLatestEscalaImportedTeam(repo.db, "empresa", input())).rejects.toMatchObject({ code: "ESCALA_IMPORTED_TEAM_INVALID" });
    expect(repo.audit).not.toHaveBeenCalled();
  });
});
