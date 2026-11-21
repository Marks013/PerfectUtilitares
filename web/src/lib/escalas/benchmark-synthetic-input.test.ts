import { describe, expect, it } from "vitest";
import { escalaInputSchema } from "./schema";
import { syntheticInput } from "../../../scripts/escalas/benchmark-synthetic";

describe("synthetic solver benchmark calendar", () => {
  it.each([
    ["team-10-week", 10, 1, "2026-11-07"],
    ["branch-50-four-weeks", 50, 4, "2026-11-28"],
    ["branch-115-six-weeks", 115, 6, "2026-12-12"],
  ] as const)("creates a complete Sunday-Saturday scenario for %s", (id, people, weeks, endDate) => {
    const input = syntheticInput({ id, people, weeks });
    expect(input.startDate).toBe("2026-11-01");
    expect(input.endDate).toBe(endDate);
    expect(input.planningWeekStartsOn).toBe("SUNDAY");
    expect(input.employees).toHaveLength(people);
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    expect(input.visibleMonth).toBeUndefined();
    expect(input.assignments).toEqual([]);
  });
  it("keeps synthetic managers and supervisors untimed without fixed weekend rest", () => {
    const input = syntheticInput({
      id: "branch-115-six-weeks-untimed", people: 115, weeks: 6, untimedLeaders: true,
    });
    const leaders = input.employees.filter((person) => person.role === "Gerente" || person.role === "Encarregado");
    expect(input.endDate).toBe("2026-12-12");
    expect(input.employees).toHaveLength(115);
    expect(leaders).toHaveLength(10);
    expect(leaders.some((person) => person.role === "Gerente")).toBe(true);
    for (const leader of leaders) {
      expect(leader.scheduleMode).toBe("UNTIMED");
      expect(leader.shiftIds).toEqual([]);
      expect(leader.sourceSchedule).toBeUndefined();
      expect(leader.fixedOffDays).toEqual([]);
      expect(leader.offMode).toBe("VARIABLE");
    }
    expect(input.employees.filter((person) => person.scheduleMode === "TIMED")).toHaveLength(105);
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
  });
});
