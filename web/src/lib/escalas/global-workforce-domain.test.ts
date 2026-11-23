import { describe, expect, it } from "vitest";
import {
  applyEscalaWorkforceFphi105, dismissEscalaWorkforcePerson, escalaWorkforceSnapshotSchema,
  projectEscalaWorkforceDraft, setEscalaWorkforceReturnDate, type EscalaWorkforceSnapshot,
} from "./global-workforce-domain";
import type { EscalaEmployee } from "./types";

const startDate = "2026-12-01";
const endDate = "2026-12-31";
const registration = "0007";

function fixture(): EscalaWorkforceSnapshot {
  const employee = {
    id: "pessoa-sintetica", registration, name: "Pessoa sintética", role: "Atendente", sector: "Caixa",
    weeklyHours: 40, shiftIds: ["dia"], activeFrom: "2026-12-03", offMode: "VARIABLE",
    fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [],
    historyKnown: false, history: [],
  } satisfies EscalaEmployee;
  return {
    version: 1,
    people: [{ branchCode: "01", dismissedFrom: null, employee }],
    catalogs: [
      { branchCode: "01", shifts: [{ id: "dia", name: "Diurno", segments: [{ start: 480, end: 720, kind: "WORK" }] }] },
      { branchCode: "02", shifts: [] },
    ],
    absences: [],
  };
}

describe("base global de Escalas", () => {
  it("mantém os zeros da matrícula, valida filial e não permite a mesma identidade em duas filiais", () => {
    const base = fixture();
    base.people[0].branchCode = "1";
    const snapshot = escalaWorkforceSnapshotSchema.parse(base);
    expect(snapshot.people[0]).toMatchObject({ branchCode: "01", employee: { registration: "0007" } });
    expect(escalaWorkforceSnapshotSchema.safeParse({
      ...base,
      people: [...base.people, { ...base.people[0], branchCode: "02", employee: { ...base.people[0].employee, shiftIds: [] } }],
    }).success).toBe(false);
    expect(escalaWorkforceSnapshotSchema.safeParse({
      ...base,
      people: [{ ...base.people[0], branchCode: "02" }],
    }).success).toBe(false);
    expect(escalaWorkforceSnapshotSchema.safeParse({ ...base, unexpected: true }).success).toBe(false);
  });

  it("recusa datas invertidas, matrículas desconhecidas e dados específicos do rascunho", () => {
    const base = fixture();
    const person = base.people[0];
    expect(escalaWorkforceSnapshotSchema.safeParse({
      ...base,
      people: [{ ...person, employee: { ...person.employee, activeUntil: endDate, planningHistory: [] } }],
    }).success).toBe(false);
    expect(escalaWorkforceSnapshotSchema.safeParse({
      ...base, people: [{ ...person, dismissedFrom: startDate }],
    }).success).toBe(false);
    expect(escalaWorkforceSnapshotSchema.safeParse({
      ...base, absences: [{ registration, startDate: endDate, endDate: startDate, source: "FPHI105" }],
    }).success).toBe(false);
    expect(() => applyEscalaWorkforceFphi105(base, [{ registration: "7", startDate, endDate: null }]))
      .toThrowError(expect.objectContaining({ code: "ESCALA_WORKFORCE_UNKNOWN_REGISTRATION" }));
  });

  it("valida somente filiais anteriores distintas, conhecidas e diferentes da atual", () => {
    const base = fixture();
    base.people[0].previousBranchCodes = ["2"];
    const checked = escalaWorkforceSnapshotSchema.parse(base);
    expect(checked.people[0].previousBranchCodes).toEqual(["02"]);
    for (const previousBranchCodes of [["02", "2"], ["03"], ["01"]]) {
      expect(escalaWorkforceSnapshotSchema.safeParse({
        ...base, people: [{ ...base.people[0], previousBranchCodes }],
      }).success).toBe(false);
    }
  });

  it("projeta o mesmo intervalo aberto em janelas distintas sem gravar um término fictício", () => {
    const base = fixture();
    const record = { registration, startDate, endDate: null };
    const opened = applyEscalaWorkforceFphi105(base, [record]);
    expect(opened.absences).toEqual([{ ...record, source: "FPHI105" }]);
    expect(base.absences).toEqual([]);
    expect(applyEscalaWorkforceFphi105(opened, [record])).toBe(opened);
    expect(projectEscalaWorkforceDraft(opened, "01", startDate, "2026-12-04").absenceDates.get(registration))
      .toEqual(new Set(["2026-12-03", "2026-12-04"]));
    expect(projectEscalaWorkforceDraft(opened, "1", "2026-12-30", endDate).absenceDates.get(registration))
      .toEqual(new Set(["2026-12-30", endDate]));
    expect(projectEscalaWorkforceDraft(opened, "02", startDate, endDate).absenceDates.size).toBe(0);
  });

  it("fecha o mesmo evento por reimportação, conserva o término inclusivo e não reabre com fonte sem retorno", () => {
    const record = { registration, startDate: "2026-12-05", endDate: null };
    const opened = applyEscalaWorkforceFphi105(fixture(), [record]);
    const closed = applyEscalaWorkforceFphi105(opened, [{ ...record, endDate: "2026-12-06" }]);
    expect(closed.absences).toEqual([{ ...record, source: "FPHI105", endDate: "2026-12-06" }]);
    expect(applyEscalaWorkforceFphi105(closed, [record])).toBe(closed);
    expect(projectEscalaWorkforceDraft(closed, "01", "2026-12-06", "2026-12-07").absenceDates.get(registration))
      .toEqual(new Set(["2026-12-06"]));
    expect(() => applyEscalaWorkforceFphi105(opened, [record, { ...record, endDate: endDate }]))
      .toThrowError(expect.objectContaining({ code: "ESCALA_WORKFORCE_CONFLICTING_ABSENCE" }));
  });

  it("permite retorno manual mas mantém indisponibilidade por outro afastamento", () => {
    const first = { registration, startDate: "2026-12-05", endDate: null };
    const second = { registration, startDate: "2026-12-07", endDate: "2026-12-08" };
    const opened = applyEscalaWorkforceFphi105(fixture(), [first, second]);
    const closed = setEscalaWorkforceReturnDate(opened, first, "2026-12-07");
    expect(closed.absences[0]).toMatchObject({ endDate: "2026-12-06", source: "MANUAL" });
    expect(projectEscalaWorkforceDraft(closed, "01", "2026-12-05", "2026-12-09").absenceDates.get(registration))
      .toEqual(new Set(["2026-12-05", "2026-12-06", "2026-12-07", "2026-12-08"]));
    expect(setEscalaWorkforceReturnDate(closed, first, "2026-12-07")).toBe(closed);
    expect(() => setEscalaWorkforceReturnDate(opened, first, first.startDate))
      .toThrowError(expect.objectContaining({ code: "ESCALA_WORKFORCE_INVALID_RETURN" }));
  });

  it("preserva a parte anterior ao desligamento e não reativa a pessoa com retorno", () => {
    const first = { registration, startDate: "2026-12-05", endDate: null };
    const opened = applyEscalaWorkforceFphi105(fixture(), [first]);
    const dismissed = dismissEscalaWorkforcePerson(opened, registration, "2026-12-08");
    const returned = setEscalaWorkforceReturnDate(dismissed, first, "2026-12-09");
    expect(returned.people[0].dismissedFrom).toBe("2026-12-08");
    expect(projectEscalaWorkforceDraft(returned, "01", "2026-12-07", "2026-12-09")).toMatchObject({
      employees: [{ registration, activeUntil: "2026-12-07" }],
      absenceDates: new Map([[registration, new Set(["2026-12-07"])]]),
    });
    expect(projectEscalaWorkforceDraft(returned, "01", "2026-12-08", endDate).employees).toEqual([]);
    const onAdmission = dismissEscalaWorkforcePerson(fixture(), registration, "2026-12-03");
    expect(projectEscalaWorkforceDraft(onAdmission, "01", startDate, endDate).employees).toEqual([]);
    expect(opened.people[0].dismissedFrom).toBeNull();
  });

  it("limita a projeção ao horizonte do rascunho", () => {
    expect(() => projectEscalaWorkforceDraft(fixture(), "01", endDate, startDate))
      .toThrowError(expect.objectContaining({ code: "ESCALA_WORKFORCE_INVALID_PERIOD" }));
  });
});
