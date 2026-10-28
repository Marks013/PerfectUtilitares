import { describe, expect, it } from "vitest";
import { newInput, newEmployee } from "@/components/escalas/workspace-model";
import { fixedBoundaryReservations } from "./boundary";
import { validateEscala } from "./validation";
import { escalaInputSchema } from "./schema";
import { preservePublishedDays, publishedPlanningContext } from "./continuity";

function fixture() {
  const input = newInput("08", "Filial sintética", "2026-11", 40);
  input.employees = [{ ...newEmployee(40, input.shifts[0].id), id: "e", registration: "001", name: "Pessoa sintética", sector: "Loja", role: "Operador" }];
  return input;
}
describe("published overlap preservation", () => {
  it("does not blame the current proposal for an inconsistent sequence entirely in the future", () => {
    const input = fixture(); input.employees[0].scheduleMode = "MISSING"; input.employees[0].shiftIds = []; input.shifts = [];
    input.employees[0].planningFuture = [7, 8, 9, 10, 11, 12, 13].map(day => ({ employeeId: "e", date: "2026-12-" + String(day).padStart(2, "0"), kind: "DUTY" }));
    expect(validateEscala(input).issues.some(issue => issue.code === "WORK_STREAK")).toBe(false);
  });
  it("detects a current overnight shift occupying a published future rest day", () => {
    const input = fixture(); input.shifts[0].segments = [{ start: 1020, end: 1260, kind: "WORK" }, { start: 1260, end: 1320, kind: "BREAK" }, { start: 1320, end: 1620, kind: "WORK" }];
    input.assignments = [{ employeeId: "e", date: "2026-12-06", kind: "WORK", shiftId: input.shifts[0].id }];
    input.employees[0].planningFuture = [{ employeeId: "e", date: "2026-12-07", kind: "OFF" }];
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "OFF_OCCUPIED", date: "2026-12-07" }));
  });
  it("does not invent a Monday rest reservation contradicted by a published future workday", () => {
    const input = fixture(); const person = input.employees[0];
    person.scheduleMode = "MISSING"; person.shiftIds = []; input.shifts = [];
    person.offPattern = "CONSECUTIVE"; person.offMode = "MIXED"; person.fixedOffDays = [0];
    input.assignments = ["2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06"].map((date, index) => ({ employeeId: "e", date, kind: index === 0 || index === 6 ? "OFF" : "DUTY" }));
    person.planningFuture = [{ employeeId: "e", date: "2026-12-07", kind: "DUTY" }];
    expect(fixedBoundaryReservations(input)).toEqual([]);
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "CONSECUTIVE_OFF", date: "2026-12-06" }));
  });
  it("protects the first published future rest day when its pair depends on the current Sunday", () => {
    const input = fixture(); const person = input.employees[0];
    person.scheduleMode = "MISSING"; person.shiftIds = []; input.shifts = []; person.offPattern = "CONSECUTIVE";
    input.assignments = [{ employeeId: "e", date: "2026-12-06", kind: "DUTY" }];
    person.planningFuture = [{ employeeId: "e", date: "2026-12-07", kind: "OFF" }, { employeeId: "e", date: "2026-12-08", kind: "DUTY" }];
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "CONSECUTIVE_OFF", date: "2026-12-07" }));
  });
  it("accepts equivalent shared shifts copied by more than one published peer", () => {
    const input = fixture(); input.shifts = []; input.employees[0].shiftIds = [];
    const peer = fixture(); peer.assignments = [{ employeeId: "e", date: "2026-11-01", kind: "WORK", shiftId: peer.shifts[0].id }];
    const result = preservePublishedDays(input, [peer, structuredClone(peer)]);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]).toMatchObject({ kind: "WORK", locked: true });
    expect(result.shifts).toHaveLength(1);
  });
  it("uses following published days as context without moving them into the current month", () => {
    const input = fixture(); input.employees[0].scheduleMode = "MISSING"; input.employees[0].shiftIds = []; input.shifts = [];
    input.assignments = [1, 2, 3, 4, 5, 6].map(day => ({ employeeId: "e", date: "2026-12-0" + day, kind: "DUTY" }));
    const peer = fixture(); peer.assignments = [{ employeeId: "e", date: "2026-12-07", kind: "DUTY" }];
    const result = publishedPlanningContext(input, [peer]);
    expect(result.employees[0].planningFuture).toEqual(peer.assignments);
    expect(result.assignments).toHaveLength(6);
    expect(escalaInputSchema.safeParse(result).success).toBe(true);
    expect(validateEscala(result).issues).toContainEqual(expect.objectContaining({ code: "WORK_STREAK", date: "2026-12-07" }));
    expect(validateEscala(result).summaries[0].workDays).toBe(0);
  });
  it("drops client-supplied future context and rejects dates beyond its trusted horizon", () => {
    const input = fixture(); input.employees[0].planningFuture = [{ employeeId: "e", date: "2027-01-10", kind: "OFF" }];
    expect(escalaInputSchema.safeParse(input).success).toBe(false);
    expect(publishedPlanningContext(input, []).employees[0].planningFuture).toBeUndefined();
  });
  it("locks shared days from earlier and later published plans without mutating either source", () => {
    const input = fixture();
    const previous = fixture(); previous.employees[0].id = "old";
    previous.assignments = [{ employeeId: "old", date: "2026-11-01", kind: "OFF" }];
    const next = fixture(); next.employees[0].id = "next";
    next.assignments = [{ employeeId: "next", date: "2026-11-30", kind: "WORK", shiftId: next.shifts[0].id }];
    const result = preservePublishedDays(input, [previous, next]);
    expect(result.assignments).toEqual(expect.arrayContaining([
      { employeeId: "e", date: "2026-11-01", kind: "OFF", locked: true },
      { employeeId: "e", date: "2026-11-30", kind: "WORK", shiftId: input.shifts[0].id, locked: true },
    ]));
    expect(input.assignments).toEqual([]);
    expect(previous.assignments[0].locked).toBeUndefined();
  });
  it("refuses conflicting manual choices and conflicting published references instead of overwriting", () => {
    const input = fixture(); const peer = fixture();
    input.assignments = [{ employeeId: "e", date: "2026-11-01", kind: "WORK", shiftId: input.shifts[0].id }];
    peer.assignments = [{ employeeId: "e", date: "2026-11-01", kind: "OFF" }];
    expect(() => preservePublishedDays(input, [peer])).toThrow(/diverge/);
    const other = fixture(); other.assignments = input.assignments;
    input.assignments = [];
    expect(() => preservePublishedDays(input, [peer, other])).toThrow(/divergentes/);
  });
});
