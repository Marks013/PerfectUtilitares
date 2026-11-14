import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { matchesRestOnlyReferences, prepareGeneration } from "./generation";
import { prepareRoster, preparedShiftSignature } from "./preparation";
import { escalaInputSchema } from "./schema";
import type { EscalaInput, EscalaShift } from "./types";

function fixture(): EscalaInput {
  const value = newInput("08", "Loja", "2026-11", 42);
  value.generationMode = "DAYS_AND_HOURS";
  value.employees = [{ ...newEmployee(42, "source"), id: "p1", registration: "01", name: "Pessoa", sector: "Caixa", role: "Operador",
    scheduleMode: "TIMED", sourceSchedule: { report: "FPRE136", code: "1", description: "Referência",
      weekday: "07:00-11:00 / 13:00-16:20", saturday: "07:00-11:00" } }];
  value.shifts = [{ id: "source", name: "Original", segments: [{ start: 420, end: 660, kind: "WORK" },
    { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 980, kind: "WORK" }] }];
  value.demands = []; value.assignments = [];
  return value;
}
const paid = (shift: EscalaShift) => shift.segments.reduce((sum, part) => sum + (part.kind === "BREAK" ? 0 : part.end - part.start), 0);
const options = (value: EscalaInput) => value.employees[0].shiftIds.map(id => value.shifts.find(shift => shift.id === id) as EscalaShift);

describe("stable automatic clock reference boundaries", () => {
  it("selects one nearby geometry without rotating arrival, departure or meal at the same weekly hours", () => {
    const raw = fixture(), original = structuredClone(raw);
    const reference = prepareRoster({ ...raw, simulation: true }, 42, "EXCLUDE", "PRESERVE_START");
    const prepared = prepareGeneration(raw).input, shifts = options(prepared);
    expect(shifts).toHaveLength(1);
    expect(prepared.employees[0].fixedImportedShiftId).toBe(shifts[0].id);
    expect(shifts[0]).toEqual(options(reference)[0]);
    expect(shifts.every(shift => paid(shift) === 504)).toBe(true);
    expect(shifts[0].segments[0].start).toBe(raw.shifts[0].segments[0].start);
    expect(shifts[0].segments.find(part => part.kind === "BREAK")?.start).toBe(raw.shifts[0].segments.find(part => part.kind === "BREAK")?.start);
    expect(shifts.every(shift => shift.segments.find(part => part.kind === "BREAK")?.end
      === (shift.segments.find(part => part.kind === "BREAK")?.start ?? 0) + 120)).toBe(true);
    expect(prepared.employees[0].sourceSchedule).toEqual(raw.employees[0].sourceSchedule);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
    expect(raw).toEqual(original);
  });

  it("keeps the saved stable automatic reference without discarding its unchanged work or protected absence", () => {
    const saved = prepareRoster({ ...fixture(), simulation: true }, 42, "EXCLUDE", "PRESERVE_START");
    const shiftId = saved.employees[0].shiftIds[0];
    saved.assignments = [{ employeeId: "p1", date: saved.startDate, kind: "WORK", shiftId },
      { employeeId: "p1", date: "2026-11-02", kind: "ABSENCE", locked: true }];
    const first = prepareGeneration(saved), second = prepareGeneration(first.input);
    expect(first.input.employees[0].shiftIds).toEqual([shiftId]);
    expect(first.preparation.adjustedEmployeeIds).toEqual([]);
    expect(first.input.assignments).toEqual(saved.assignments);
    expect(second.input.employees[0].shiftIds).toEqual(first.input.employees[0].shiftIds);
    expect(second.input.shifts).toEqual(first.input.shifts);
    expect(second.input.assignments).toEqual(saved.assignments);
  });

  it("excludes a legacy short imported roster without expanding its clock, preserving protected records", () => {
    const raw = fixture(), source = raw.employees[0].sourceSchedule;
    if (!source) throw new Error("Fixture reference missing");
    source.weekday = "14:00-17:00 / 17:15-20:05";
    raw.shifts[0].segments = [{ start: 840, end: 1020, kind: "WORK" },
      { start: 1020, end: 1035, kind: "BREAK" }, { start: 1035, end: 1205, kind: "WORK" }];
    raw.employees[0].simulationDailyMinutes = 350;
    raw.assignments = [
      { employeeId: "p1", date: "2026-11-02", kind: "WORK", shiftId: "source" },
      { employeeId: "p1", date: "2026-11-03", kind: "OFF" },
      { employeeId: "p1", date: "2026-11-04", kind: "WORK", shiftId: "source" },
      { employeeId: "p1", date: "2026-11-05", kind: "WORK", shiftId: "source", locked: true },
      { employeeId: "p1", date: "2026-11-06", kind: "ABSENCE" },
    ];
    const original = structuredClone(raw);
    const first = prepareGeneration(raw), second = prepareGeneration(first.input);
    for (const result of [first, second]) {
      expect(result.preparation.adjustedEmployeeIds).toEqual([]);
      expect(result.preparation.excludedEmployeeIds).toEqual(["p1"]);
      expect(result.input.assignments).toEqual(original.assignments.filter(record => record.locked || record.kind === "ABSENCE"));
      expect(result.input.employees[0].planningEnabled).toBe(false);
      expect(result.input.employees[0].sourceSchedule).toEqual(original.employees[0].sourceSchedule);
      expect(result.input.shifts).toEqual(original.shifts);
      expect(result.input.demands).toEqual(original.demands);
    }
    expect(raw).toEqual(original);
  });

  it("does not rebalance an already compatible stable clock when the work-block preference is enabled", () => {
    const saved = prepareGeneration(fixture()).input, canonical = options(saved)[0];
    expect(canonical.segments.filter(part => part.kind === "WORK").every(part => part.end - part.start <= 270)).toBe(true);
    saved.assignments = [{ employeeId: "p1", date: "2026-11-02", kind: "WORK", shiftId: canonical.id },
      { employeeId: "p1", date: "2026-11-03", kind: "ABSENCE", locked: true }];
    saved.policy.limitContinuousWorkBlocks = true;
    const result = prepareGeneration(saved);
    expect(result.preparation.adjustedEmployeeIds).toEqual([]);
    expect(result.input.assignments).toEqual(saved.assignments);
    expect(result.input.employees[0].shiftIds).toContain(canonical.id);
    expect(result.input.shifts.find(shift => shift.id === canonical.id)).toEqual(canonical);
  });

  it("never widens a manually edited or manually selected valid reference", () => {
    const saved = prepareRoster({ ...fixture(), simulation: true }, 42, "EXCLUDE", "PRESERVE_START");
    saved.shifts[0].segments[0].end += 5; saved.shifts[0].segments[1].start += 5;
    saved.shifts[0].segments[1].end += 5; saved.shifts[0].segments[2].start += 5;
    const edited = prepareGeneration(saved).input;
    expect(edited.shifts).toEqual(saved.shifts);
    expect(edited.employees[0].shiftIds).toEqual(saved.employees[0].shiftIds);
    saved.shifts[0].id = "manual"; saved.employees[0].shiftIds = ["manual"];
    expect(prepareGeneration(saved).input.shifts).toEqual(saved.shifts);
  });

  it("keeps REST_ONLY free days on its stable clock and rejects another real unselected clock", () => {
    const complete = prepareGeneration(fixture()).input;
    const rest = prepareGeneration({ ...complete, generationMode: "REST_ONLY" }).input;
    expect(rest.employees[0].shiftIds).toEqual(complete.employees[0].shiftIds);
    const other = { ...structuredClone(options(rest)[0]), id: "unselected" };
    other.segments = other.segments.map(part => ({ ...part, start: part.start + 30, end: part.end + 30 }));
    rest.shifts.push(other);
    expect(matchesRestOnlyReferences(rest, [{ employeeId: "p1", date: "2026-11-02", kind: "WORK", shiftId: rest.employees[0].shiftIds[0] }])).toBe(true);
    expect(matchesRestOnlyReferences(rest, [{ employeeId: "p1", date: "2026-11-02", kind: "WORK", shiftId: other.id }])).toBe(false);
    expect(prepareGeneration({ ...fixture(), generationMode: "REST_ONLY" }).input.employees[0].shiftIds).toHaveLength(1);
  });

  it("excludes short references and keeps every included optional continuous work block within 4h30", () => {
    const raw = fixture(); raw.policy.limitContinuousWorkBlocks = true;
    const balanced = options(prepareGeneration(raw).input);
    expect(balanced).toHaveLength(1);
    expect(balanced.every(shift => shift.segments.filter(part => part.kind === "WORK").every(part => part.end - part.start <= 270))).toBe(true);
    const source = raw.employees[0].sourceSchedule;
    if (!source) throw new Error("Fixture reference missing");
    source.weekday = "07:00-12:00";
    raw.shifts[0].segments = [{ start: 420, end: 720, kind: "WORK" }];
    const short = prepareGeneration(raw).input;
    expect(short.employees[0].planningEnabled).toBe(false);
    expect(short.shifts).toEqual(raw.shifts);
  });

  it.each([119, 120])("retains %i required references without filling spare slots with automatic alternatives", required => {
    const saved = prepareRoster({ ...fixture(), simulation: true }, 42, "EXCLUDE", "PRESERVE_START");
    const reference = options(saved)[0], canonical = reference.id;
    const addReference = (id: string, offset: number) => {
      saved.shifts.push({ ...structuredClone(reference), id, name: `Referência ${id}`,
        segments: reference.segments.map(part => ({ ...part, start: part.start + offset, end: part.end + offset })) });
    };
    const manualCount = required - 4;
    for (let index = 0; index < manualCount; index += 12) {
      const ids: string[] = [];
      for (let offset = index; offset < Math.min(index + 12, manualCount); offset++) {
        const id = `manual-${offset}`; ids.push(id); addReference(id, offset + 1);
      }
      saved.employees.push({ ...newEmployee(42, ids[0]), id: `manual-person-${index}`, registration: `M${index}`,
        name: `Pessoa ${index}`, sector: "Caixa", role: "Operador", scheduleMode: "TIMED", shiftIds: ids });
    }
    addReference("original-only", 116); addReference("history-only", 117); addReference("locked-only", 118);
    saved.employees[1].originalShiftIds = ["original-only"];
    saved.employees[0].history = [{ employeeId: "p1", date: "2026-10-25", kind: "WORK", shiftId: "history-only" }];
    saved.employees[0].shiftIds.push("locked-only");
    saved.assignments = [{ employeeId: "p1", date: saved.startDate, kind: "WORK", shiftId: "locked-only", locked: true }];
    const before = structuredClone(saved);
    expect(saved.shifts).toHaveLength(required);
    expect(escalaInputSchema.safeParse(saved).success).toBe(true);
    const prepared = prepareGeneration(saved).input;
    expect(prepared.shifts).toHaveLength(required);
    expect(prepared.employees[0].shiftIds[0]).toBe(canonical);
    expect(prepared.employees[0].shiftIds).toHaveLength(2); // Stable base plus its existing locked exception.
    for (const shift of before.shifts) expect(prepared.shifts).toContainEqual(shift);
    expect(prepared.employees.slice(1)).toEqual(before.employees.slice(1));
    expect(prepared.employees[0].history).toEqual(before.employees[0].history);
    expect(prepared.assignments).toEqual(before.assignments);
    expect(escalaInputSchema.safeParse(prepared).success).toBe(true);
    expect(saved).toEqual(before);
  });

  it("does not add night work within an explicit closing and preserves locked references, absences and source data", () => {
    const raw = fixture(), source = raw.employees[0].sourceSchedule;
    raw.storeClosingMinutes = 1330;
    if (!source) throw new Error("Fixture reference missing");
    source.weekday = "12:50-16:30 / 18:30-22:10";
    raw.shifts[0].segments = [{ start: 770, end: 990, kind: "WORK" }, { start: 990, end: 1110, kind: "BREAK" }, { start: 1110, end: 1330, kind: "WORK" }];
    raw.assignments = [{ employeeId: "p1", date: raw.startDate, kind: "WORK", shiftId: "source", locked: true },
      { employeeId: "p1", date: "2026-11-02", kind: "ABSENCE" }];
    const prepared = prepareGeneration(raw).input;
    const unlocked = options(prepared).filter(shift => shift.id !== "source");
    expect(unlocked).toHaveLength(1);
    expect(unlocked.every(shift => shift.segments.at(-1)?.end === 1330)).toBe(true);
    expect(prepared.assignments).toEqual(raw.assignments);
    expect(prepared.shifts.find(shift => shift.id === "source")).toEqual(raw.shifts[0]);
    expect(prepared.employees[0].sourceSchedule).toEqual(source);
    expect(new Set(unlocked.map(preparedShiftSignature)).size).toBe(unlocked.length);
  });
});
