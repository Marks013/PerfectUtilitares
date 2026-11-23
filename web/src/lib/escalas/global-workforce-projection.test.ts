import { describe, expect, it } from "vitest";
import { type EscalaWorkforceSnapshot, escalaWorkforceSnapshotSchema } from "./global-workforce-domain";
import { materializeEscalaWorkforceDraft } from "./global-workforce-projection";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift } from "./types";

const day = (date: number) => `2026-12-${String(date).padStart(2, "0")}`;
const shift: EscalaShift = { id: "turno-local", name: "Diurno", segments: [{ start: 480, end: 720, kind: "WORK" }] };
const off = (date: number, locked = false): EscalaAssignment => ({ employeeId: "local", date: day(date), kind: "OFF", locked });
const work = (date: number): EscalaAssignment => ({ ...off(date), kind: "WORK", shiftId: shift.id });
const absence = (date: number): EscalaAssignment => ({ employeeId: "local", date: day(date), kind: "ABSENCE" });
const key = (date: number) => `local\0${day(date)}`;

function fixture(assignments: EscalaAssignment[] = []) {
  const employee: EscalaEmployee = {
    id: "local", registration: "0007", name: "Pessoa sintética", role: "Atendente", sector: "Caixa",
    weeklyHours: 40, scheduleMode: "TIMED", shiftIds: [shift.id], activeFrom: day(1),
    offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1,
    preferredOffDays: [], historyKnown: false, history: [],
  };
  const input: EscalaInput = {
    branchCode: "01", branchName: "Filial sintética", schemaVersion: 1, timeZone: "America/Sao_Paulo",
    planningWeekStartsOn: "SUNDAY", startDate: day(1), endDate: day(31), defaultWeeklyHours: 40,
    policy: {
      source: "Cenário sintético", validFrom: day(1), validUntil: day(31), reviewed: true, reviewedBy: "Teste",
      weeklyLimit: 40, dailyLimitMinutes: 480, compensationAuthorized: false, minInterShiftMinutes: 660,
      minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5,
      closedDates: [day(25)], holidayDates: [day(25)], authorizedHolidayDates: [], holidayRestAllowed: false,
      nightWorkReviewed: false,
    },
    demands: [], employees: [employee], shifts: [shift], assignments,
    generationBasis: "a".repeat(64), coverageBasis: "b".repeat(64),
  };
  const snapshot = escalaWorkforceSnapshotSchema.parse({
    version: 1,
    people: [{ branchCode: "01", dismissedFrom: null, employee: { ...employee, id: "global" } }],
    catalogs: [{ branchCode: "01", shifts: [shift] }, { branchCode: "02", shifts: [] }],
    absences: [],
  });
  return { workspace: { status: "DRAFT" as const, input }, snapshot };
}

function addAbsence(snapshot: EscalaWorkforceSnapshot, start: number, end: number | null) {
  snapshot.absences.push({ registration: "0007", startDate: day(start), endDate: end === null ? null : day(end), source: "FPHI105" });
}

describe("projeção da base global no rascunho", () => {
  it("preserva matrícula, ID interno, folgas, horários, contexto e assinatura quando não há delta", () => {
    const { workspace, snapshot } = fixture([off(1), work(2)]);
    const projected = materializeEscalaWorkforceDraft(workspace, snapshot);
    expect(projected.changed).toBe(false);
    expect(projected.input).toBe(workspace.input);
    expect(projected.managedAbsenceKeys.size).toBe(0);
    snapshot.people[0].employee.role = "Caixa";
    const updated = materializeEscalaWorkforceDraft(workspace, snapshot);
    expect(updated.input.employees[0]).toMatchObject({ id: "local", registration: "0007", role: "Caixa" });
    expect(updated.input.assignments).toEqual([off(1), work(2)]);
    expect(updated.input.needsRegeneration).toBe(true);
    expect(updated.input.generationBasis).toBeUndefined();
    expect(updated.input.coverageBasis).toBeUndefined();
  });

  it("não projeta outras filiais nem materializa uma filial sem origem confirmada", () => {
    const { workspace, snapshot } = fixture();
    snapshot.people.push({
      ...snapshot.people[0], branchCode: "02", employee: { ...snapshot.people[0].employee, id: "outra", registration: "0012", shiftIds: [] },
    });
    expect(materializeEscalaWorkforceDraft(workspace, snapshot).input.employees.map(person => person.registration)).toEqual(["0007"]);
    expect(() => materializeEscalaWorkforceDraft({ ...workspace, input: { ...workspace.input, branchCode: "03" } }, snapshot))
      .toThrow("não tem uma equipe global confirmada");
  });

  it("rejeita publicado sem modificar a revisão que o chamou", () => {
    const { workspace, snapshot } = fixture([off(1)]);
    const original = structuredClone(workspace.input);
    expect(() => materializeEscalaWorkforceDraft({ ...workspace, status: "PUBLISHED" }, snapshot)).toThrow("Reabra a publicação");
    expect(workspace.input).toEqual(original);
  });

  it("projeta ausência aberta até o fim do rascunho, preserva feriado e registra apenas os dias que assumiu", () => {
    const holiday = { employeeId: "local", date: day(25), kind: "HOLIDAY", locked: true } as const;
    const { workspace, snapshot } = fixture([off(23), off(24), holiday]);
    addAbsence(snapshot, 24, null);
    const projected = materializeEscalaWorkforceDraft(workspace, snapshot);
    expect(projected.input.assignments).toContainEqual(off(23));
    expect(projected.input.assignments).toContainEqual(holiday);
    expect(projected.input.assignments).toContainEqual(absence(24));
    expect(projected.input.assignments).toContainEqual(absence(31));
    expect(projected.managedAbsenceKeys).toEqual(new Set([24, 26, 27, 28, 29, 30, 31].map(key)));
    expect(snapshot.absences[0].endDate).toBeNull();
    expect(workspace.input.assignments).toEqual([off(23), off(24), holiday]);
  });

  it("após o retorno remove apenas dias geridos e deixa os dias livres sem inventar trabalho ou folga", () => {
    const legacy = absence(19);
    const manual = { ...absence(21), absenceSource: "MANUAL" as const };
    const { workspace, snapshot } = fixture([legacy, absence(20), manual, off(22)]);
    addAbsence(snapshot, 18, 19);
    const keys = new Set([key(20), key(21)]);
    const projected = materializeEscalaWorkforceDraft(workspace, snapshot, keys);
    expect(projected.input.assignments).toEqual([legacy, manual, off(22), absence(18)]);
    expect(projected.managedAbsenceKeys).toEqual(new Set([key(18)]));
    const again = materializeEscalaWorkforceDraft({ ...workspace, input: projected.input }, snapshot, projected.managedAbsenceKeys);
    expect(again.changed).toBe(false);
    expect(again.managedAbsenceKeys).toEqual(projected.managedAbsenceKeys);
  });

  it("preserva dias anteriores ao desligamento e não mantém atribuições após a data efetiva", () => {
    const { workspace, snapshot } = fixture([work(9), off(10), work(11)]);
    snapshot.people[0].dismissedFrom = day(10);
    addAbsence(snapshot, 11, null);
    const projected = materializeEscalaWorkforceDraft(workspace, snapshot);
    expect(projected.input.employees[0].activeUntil).toBe(day(9));
    expect(projected.input.assignments).toEqual([work(9)]);
    expect(projected.managedAbsenceKeys.size).toBe(0);
  });

  it("bloqueia conflito com trava explícita ou ausência anterior não pertencente à base", () => {
    const { workspace, snapshot } = fixture([off(10, true)]);
    addAbsence(snapshot, 10, null);
    expect(() => materializeEscalaWorkforceDraft(workspace, snapshot)).toThrow("conflita com um dia bloqueado");
    snapshot.people[0].dismissedFrom = day(9);
    workspace.input.assignments = [absence(10)];
    expect(() => materializeEscalaWorkforceDraft(workspace, snapshot)).toThrow("atingiria um dia bloqueado ou protegido");
    expect(workspace.input.assignments).toEqual([absence(10)]);
  });

  it("bloqueia retirada de vínculo que contém decisões de continuidade", () => {
    const { workspace, snapshot } = fixture();
    workspace.input.employees[0].historyKnown = true;
    snapshot.people[0].branchCode = "02";
    expect(() => materializeEscalaWorkforceDraft(workspace, snapshot)).toThrow("ajuste manual ou registro de continuidade");
  });

  it("não reinterpreta a geometria de um turno nem remapeia automaticamente um trabalho existente", () => {
    const { workspace, snapshot } = fixture([work(2)]);
    snapshot.catalogs[0].shifts[0].segments[0].end++;
    expect(() => materializeEscalaWorkforceDraft(workspace, snapshot)).toThrow("outra geometria");
    snapshot.catalogs[0].shifts[0].id = "novo-turno";
    snapshot.people[0].employee.shiftIds = ["novo-turno"];
    expect(() => materializeEscalaWorkforceDraft(workspace, snapshot)).toThrow("não é compatível com o turno");
    expect(workspace.input.assignments).toEqual([work(2)]);
  });
});
