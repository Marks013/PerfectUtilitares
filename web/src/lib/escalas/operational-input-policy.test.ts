import { describe, expect, it } from "vitest";
import { applyLocalHolidayCalendar } from "./calendar";
import { assertEscalaOperationalInput } from "./operational-input-policy";
import type { EscalaInput } from "./types";
const fixture = () => ({ schemaVersion: 1, branchCode: "02", startDate: "2026-11-30", endDate: "2027-01-03",
  policy: { weeklyLimit: 42 }, shifts: [{ id: "s", segments: [] }],
  employees: [{ id: "p", name: "Nome", weeklyHours: 40, preferredOffDays: [], shiftIds: ["s"], history: [], historyKnown: false }],
  assignments: [{ employeeId: "p", date: "2026-12-01", kind: "WORK", shiftId: "s", locked: false },
    { employeeId: "p", date: "2026-12-02", kind: "ABSENCE", locked: false }],
}) as unknown as EscalaInput;
describe("raw operational field comparison", () => {
  it("permits a name/preference edit with explicit capability and an unchanged individual contract", () => {
    const old = fixture(), next = structuredClone(old);
    next.employees[0].name = "Atualizado"; next.employees[0].preferredOffDays = [3];
    expect(() => assertEscalaOperationalInput(old, next, ["employee.manage"])).not.toThrow();
    expect(() => assertEscalaOperationalInput(old, next, [])).toThrow();
  });
  it.each(["weeklyHours", "historyKnown", "sourceSchedule", "activeFrom", "scheduleMode", "planningEnabled", "manualShiftOverrides"])("protects employee %s", field => {
    const old = fixture(), next = structuredClone(old);
    Object.assign(next.employees[0], { [field]: "browser-authority" });
    expect(() => assertEscalaOperationalInput(old, next, ["employee.manage", "shift.manage", "schedule.apply"])).toThrow();
  });
  it("protects rules, fingerprints, shift definitions and roster removal", () => {
    const old = fixture();
    for (const next of [{ ...old, generationBasis: "generation-v1:0123456789abcdef" },
      { ...old, policy: { ...old.policy, weeklyLimit: 44 as const } }, { ...old, shifts: [] }, { ...old, employees: [] }]) {
      expect(() => assertEscalaOperationalInput(old, next, ["schedule.apply", "employee.manage", "shift.manage"])).toThrow();
    }
  });
  it("allows manual assignment only with apply and preserves absences and unknown locks", () => {
    const old = fixture(), next = structuredClone(old);
    next.assignments[0] = { ...next.assignments[0], kind: "OFF", shiftId: undefined };
    expect(() => assertEscalaOperationalInput(old, next, ["schedule.apply"])).not.toThrow();
    expect(() => assertEscalaOperationalInput(old, next, [])).toThrow();
    next.assignments.pop();
    expect(() => assertEscalaOperationalInput(old, next, ["schedule.apply"])).toThrow();
    delete old.assignments[0].locked;
    next.assignments = [{ ...old.assignments[0], locked: false }, old.assignments[1]];
    expect(() => assertEscalaOperationalInput(old, next, ["schedule.apply"])).toThrow();
  });
  it("permits only an unlocked work shift change through the authorized catalog operation", () => {
    const old = fixture(), next = structuredClone(old);
    next.employees[0].shiftIds.push("approved");
    next.assignments[0].shiftId = "approved";
    const capabilities = ["workspace.save", "shift.manage"] as const;

    expect(() => assertEscalaOperationalInput(old, next, capabilities, false, true)).not.toThrow();
    expect(() => assertEscalaOperationalInput(old, next, capabilities)).toThrow();
    expect(() => assertEscalaOperationalInput(old, next, ["workspace.save"], false, true)).toThrow();
    expect(() => assertEscalaOperationalInput(old, next, ["shift.manage"], false, true)).toThrow();

    const [changed, absence] = next.assignments;
    for (const assignments of [
      [{ ...changed, kind: "OFF" as const, shiftId: undefined }, absence],
      [{ ...changed, locked: true }, absence],
      [{ ...changed, date: "2026-12-03" }, absence],
      [{ ...changed, employeeId: "other" }, absence],
      [absence],
      [changed, absence, { ...changed, date: "2026-12-03" }],
    ]) {
      expect(() => assertEscalaOperationalInput(old, { ...next, assignments }, capabilities, false, true)).toThrow();
    }

    for (const locked of [true, undefined]) {
      old.assignments[0].locked = locked;
      next.assignments[0].locked = locked;
      expect(() => assertEscalaOperationalInput(old, next, capabilities, false, true)).toThrow();
    }
    old.assignments[0].locked = false;
    next.assignments[0].locked = false;
    next.employees[0].weeklyHours = 42;
    expect(() => assertEscalaOperationalInput(old, next, capabilities, false, true)).toThrow();
  });
  it("allows only canonical new closures in a signed proposal", () => {
    const old = fixture();
    old.demands = [];
    old.policy = { ...old.policy, calendarMode: "LOCAL", holidayDates: ["2026-12-25"], closedDates: ["2026-12-25"] };
    const canonical = applyLocalHolidayCalendar(old);
    expect(old.policy.holidayDates).not.toContain("2027-01-01");
    expect(canonical.policy.paidHolidayDates).toContain("2027-01-01");
    const holiday = { employeeId: "p", date: "2027-01-01", kind: "HOLIDAY" as const };
    const next = { ...canonical, assignments: [...old.assignments, holiday] };
    expect(() => assertEscalaOperationalInput(old, next, ["schedule.apply"], true)).not.toThrow();
    expect(() => assertEscalaOperationalInput(old, next, ["schedule.apply"])).toThrow();
    const other = "2026-12-30";
    const unexpected = { ...next, policy: { ...next.policy, holidayDates: [...next.policy.holidayDates, other] },
      assignments: [...old.assignments, { ...holiday, date: other }] };
    expect(() => assertEscalaOperationalInput(old, unexpected, ["schedule.apply"], true)).toThrow();
  });

  it("signed proposals still preserve protected assignments and require apply", () => {
    const old = fixture(), next = structuredClone(old);
    next.assignments[1].kind = "OFF";
    expect(() => assertEscalaOperationalInput(old, next, ["schedule.apply"], true)).toThrow();
  });
});
