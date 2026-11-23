import type { Prisma } from "@/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { parseWorkforceDraftState, projectWorkforceForDraft, readWorkforceForDraft } from "./global-workforce-draft";
import { escalaWorkforceSnapshotSchema } from "./global-workforce-domain";
import type { EscalaAssignment, EscalaEmployee, EscalaInput } from "./types";

const person: EscalaEmployee = {
  id: "local", name: "Pessoa sintética", registration: "0007", sector: "Caixa", role: "Atendente",
  weeklyHours: 42, shiftIds: [], scheduleMode: "UNTIMED", activeFrom: "2026-12-01", preferredOffDays: [],
  history: [], historyKnown: false, offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1,
};

function base(revision = 1) {
  const snapshot = escalaWorkforceSnapshotSchema.parse({
    version: 1, catalogs: [{ branchCode: "07", shifts: [] }],
    people: [{ branchCode: "07", employee: { ...person, id: "global" }, dismissedFrom: null }],
    absences: [],
  });
  return { revision, snapshot };
}

function input(assignments: EscalaAssignment[] = [], startDate = "2026-12-01", endDate = "2026-12-31"): EscalaInput {
  return {
    schemaVersion: 1, branchCode: "07", branchName: "Filial sintética", startDate, endDate, planningWeekStartsOn: "SUNDAY",
    defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo", assignments, shifts: [], demands: [], employees: [{ ...person }],
    policy: {
      source: "Teste", reviewed: true, reviewedBy: "Teste", validFrom: "2026-12-01", validUntil: "2027-01-31",
      weeklyLimit: 44, dailyLimitMinutes: 600, compensationAuthorized: true, minInterShiftMinutes: 660, minMealMinutes: 60,
      maxConsecutiveWorkDays: 5, minWeeklyRestMinutes: 2100, closedDates: [], holidayDates: [], authorizedHolidayDates: [],
      holidayRestAllowed: false, nightWorkReviewed: false,
    },
  };
}

const absence = (date: string): EscalaAssignment => ({ date, employeeId: "local", kind: "ABSENCE" });

describe("estado global revisionado do rascunho", () => {
  it("lê apenas a base da empresa e devolve null para uma filial sem catálogo conectado", async () => {
    const findUnique = vi.fn().mockResolvedValue(base());
    const tx = { escalaWorkforce: { findUnique } } as unknown as Prisma.TransactionClient;
    await expect(readWorkforceForDraft(tx, "tenant-a", "7")).resolves.toEqual(base());
    expect(findUnique).toHaveBeenCalledWith({ where: { tenantId: "tenant-a" }, select: { revision: true, snapshot: true } });
    await expect(readWorkforceForDraft(tx, "tenant-a", "08")).resolves.toBeNull();
    findUnique.mockResolvedValueOnce(null);
    await expect(readWorkforceForDraft(tx, "tenant-a", "07")).resolves.toBeNull();
    findUnique.mockResolvedValueOnce({ revision: 1, snapshot: {} });
    await expect(readWorkforceForDraft(tx, "tenant-a", "07")).rejects.toMatchObject({ code: "ESCALA_WORKFORCE_INVALID" });
  });

  it("projeta um afastamento aberto em dois períodos e remove depois apenas as datas geridas pela base", () => {
    const opened = base();
    opened.snapshot.absences.push({ registration: "0007", startDate: "2026-12-30", endDate: null, source: "FPHI105" });
    const legacy = absence("2027-01-03");
    const manual = { ...absence("2027-01-04"), absenceSource: "MANUAL" as const };
    const dec = projectWorkforceForDraft(input(), null, opened);
    const jan = projectWorkforceForDraft(input([legacy, manual], "2027-01-03", "2027-01-09"), null, opened);
    expect(dec.input.assignments).toEqual([absence("2026-12-30"), absence("2026-12-31")]);
    expect(jan.input.assignments).toHaveLength(7);
    expect(jan.state.managedAbsenceKeys).toHaveLength(5);
    expect(jan.state.managedAbsenceKeys[0]).toEqual(["local", "2027-01-05"]);
    const persisted = JSON.stringify(jan.state);
    expect(persisted).not.toContain("\\u0000");
    const closed = structuredClone(opened);
    closed.revision = 2;
    closed.snapshot.absences[0].endDate = "2026-12-31";
    expect(projectWorkforceForDraft(dec.input, dec.state, closed)).toMatchObject({ input: dec.input, state: { baseRevision: 2 }, changed: true });
    const returned = projectWorkforceForDraft(jan.input, JSON.parse(persisted), closed);
    expect(returned.input.assignments).toEqual([legacy, manual]);
    expect(returned.state.managedAbsenceKeys).toEqual([]);
    expect(projectWorkforceForDraft(returned.input, returned.state, closed)).toEqual({ ...returned, changed: false });
  });

  it("restaura vigência própria quando o término imposto pela base é corrigido", () => {
    const drafted = input();
    drafted.employees[0].activeUntil = "2026-12-24";
    const dismissed = base();
    dismissed.snapshot.people[0].dismissedFrom = "2026-12-09";
    const first = projectWorkforceForDraft(drafted, null, dismissed);
    expect(first.input.employees[0].activeUntil).toBe("2026-12-08");
    expect(first.state.managedEmploymentEnds).toEqual([{ employeeId: "local", localActiveUntil: "2026-12-24", baseActiveUntil: "2026-12-08" }]);
    const corrected = base(2);
    corrected.snapshot.people[0].dismissedFrom = "2026-12-28";
    const next = projectWorkforceForDraft(first.input, first.state, corrected);
    expect(next.input.employees[0].activeUntil).toBe("2026-12-24");
    expect(next.state.managedEmploymentEnds).toEqual([]);
    expect(projectWorkforceForDraft(next.input, next.state, base(3)).input.employees[0].activeUntil).toBe("2026-12-24");
  });

  it("não confunde omissão da equipe com desligamento ou ignora uma mudança protegida", () => {
    const unlisted = base();
    unlisted.snapshot.people[0].listed = false;
    const unlocked = { date: "2026-12-03", employeeId: "local", kind: "OFF" as const, locked: false };
    expect(projectWorkforceForDraft(input([unlocked]), null, unlisted).input.employees).toEqual([]);
    expect(unlisted.snapshot.people[0].dismissedFrom).toBeNull();
    expect(() => projectWorkforceForDraft(input([{ ...unlocked, locked: true }]), null, unlisted))
      .toThrow(expect.objectContaining({ code: "ESCALA_WORKFORCE_DRAFT_CONFLICT" }));
  });

  it("falha fechada com estado inválido, duplicado, adiantado ou pertencente a outro rascunho", () => {
    expect(parseWorkforceDraftState(undefined)).toBeNull();
    expect(parseWorkforceDraftState(null)).toBeNull();
    const valid = { baseRevision: 1, managedEmploymentEnds: [], managedAbsenceKeys: [["local", "2026-12-03"]] };
    expect(parseWorkforceDraftState(valid)).toEqual(valid);
    expect(parseWorkforceDraftState({ ...valid, baseRevision: 2_147_483_647 })?.baseRevision).toBe(2_147_483_647);
    for (const tampered of [
      { ...valid, extra: true }, { ...valid, baseRevision: 2 }, { ...valid, managedAbsenceKeys: [...valid.managedAbsenceKeys, ...valid.managedAbsenceKeys] },
      { ...valid, managedAbsenceKeys: [["other", "2026-12-03"]] }, { ...valid, managedAbsenceKeys: [["local", "2027-01-03"]] },
      { ...valid, managedAbsenceKeys: ["local\0" + "2026-12-03"] },
    ]) {
      expect(() => projectWorkforceForDraft(input(), tampered, base())).toThrow(expect.objectContaining({ code: "ESCALA_WORKFORCE_DRAFT_STATE_INVALID" }));
    }
  });
});
