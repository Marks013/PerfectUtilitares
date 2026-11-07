import { describe, expect, it } from "vitest";
import { monthlySundays } from "./monthly-sundays";
import type { EscalaInput } from "./types";

describe("visible-month Sunday counts", () => {
  it("counts a Saturday shift that occupies Sunday without assuming that missing date was rest", () => {
    const input = { startDate: "2026-11-02", endDate: "2026-11-08",
      employees: [{ id: "person", activeFrom: "" }],
      shifts: [{ id: "night", segments: [{ start: 1380, end: 1560, kind: "WORK" }] }],
      assignments: [{ employeeId: "person", date: "2026-11-07", kind: "WORK", shiftId: "night" }, { employeeId: "person", date: "2026-11-08", kind: "OFF" }],
    } as unknown as EscalaInput;
    expect(monthlySundays(input).get("person")).toEqual({ worked: 1, off: 0, absent: 0, unknown: 0, available: 1 });
  });
  it("separates unavailable and unknown Sundays without counting technical padding or history", () => {
    const input = {
      startDate: "2026-10-26", endDate: "2026-12-06", visibleMonth: "2026-11",
      employees: [{ id: "person", activeFrom: "", history: [{ employeeId: "person", date: "2026-10-25", kind: "OFF" }] }],
      assignments: [
        { employeeId: "person", date: "2026-11-01", kind: "WORK" },
        { employeeId: "person", date: "2026-11-08", kind: "DUTY" },
        { employeeId: "person", date: "2026-11-15", kind: "OFF" },
        { employeeId: "person", date: "2026-11-22", kind: "ABSENCE" },
        { employeeId: "person", date: "2026-12-06", kind: "OFF" },
      ],
    } as unknown as EscalaInput;
    expect(monthlySundays(input).get("person")).toEqual({ worked: 2, off: 1, absent: 1, unknown: 1, available: 3 });
  });
  it("does not count dates outside employment as available", () => {
    const input = { startDate: "2026-11-01", endDate: "2026-11-30", visibleMonth: "2026-11",
      employees: [{ id: "person", activeFrom: "2026-11-09", activeUntil: "2026-11-23" }],
      assignments: [{ employeeId: "person", date: "2026-11-15", kind: "OFF" }, { employeeId: "person", date: "2026-11-22", kind: "WORK" }],
    } as unknown as EscalaInput;
    expect(monthlySundays(input).get("person")).toEqual({ worked: 1, off: 1, absent: 0, unknown: 0, available: 2 });
  });
});
