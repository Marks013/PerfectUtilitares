import { describe, expect, it } from "vitest";
import { escalaInputSchema } from "@/lib/escalas/schema";
import type { EscalaEmployee, EscalaShift } from "@/lib/escalas/types";
import {
  addDate,
  clock,
  datesBetween,
  isCurrentResponse,
  mergeImport,
  monthPeriod,
  newEmployee,
  newInput,
  parseClock,
  replaceAssignment,
  responseMessage,
} from "./workspace-model";

function employee(registration: string): EscalaEmployee {
  return {
    ...newEmployee(42, "turno-inicial"),
    registration,
    name: `Pessoa ${registration}`,
    sector: "Reposição",
    role: "Repositor",
    activeFrom: "2020-01-01",
  };
}

describe("Escalas workspace model", () => {
  it.each([
    [40, 480],
    [42, 504],
    [44, 528],
  ] as const)("creates the %ih template using %i exact minutes without certifying a policy", (hours, expected) => {
    const input = newInput(" 02 ", " Centro ", "2026-10", hours);
    expect(input.branchCode).toBe("02");
    expect(input.branchName).toBe("Centro");
    expect(input.defaultWeeklyHours).toBe(hours);
    expect(input.policy.reviewed).toBe(false);
    expect(input.policy.compensationAuthorized).toBe(false);
    expect(input.policy.nightWorkReviewed).toBe(false);
    expect(
      input.shifts[0].segments
        .filter((segment) => segment.kind !== "BREAK")
        .reduce((sum, segment) => sum + segment.end - segment.start, 0),
    ).toBe(expected);
    expect(input.employees).toEqual([]);
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
  });

  it("expands the month to full Monday–Sunday weeks, including both boundaries", () => {
    expect(monthPeriod("2026-10")).toEqual({
      startDate: "2026-09-28",
      endDate: "2026-11-01",
    });
    expect(monthPeriod("2026-08")).toEqual({
      startDate: "2026-07-27",
      endDate: "2026-09-06",
    });
    expect(datesBetween("2026-07-27", "2026-09-06")).toHaveLength(42);
  });

  it("does date arithmetic across years without the workstation timezone", () => {
    expect(addDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDate("2024-03-01", -1)).toBe("2024-02-29");
  });

  it.each(["", "2026-13", "2026-00", "26-10", "1999-12", "2000-01", "2099-12", "2100-01"])(
    "rejects an invalid month: %s",
    (month) => {
      expect(() => monthPeriod(month)).toThrow();
    },
  );

  it("preserves exact minute displays and explicit next-day offsets", () => {
    expect(clock(504)).toBe("08:24");
    expect(clock(528)).toBe("08:48");
    expect(parseClock("25:15")).toBe(1515);
    expect(clock(parseClock("25:15"))).toBe("25:15");
  });

  it.each(["8:24", "08:60", "49:00", "48:01", "8.24", "-1:00"])(
    "rejects malformed or out-of-bound clock input: %s",
    (value) => {
      expect(() => parseClock(value)).toThrow();
    },
  );

  it("requires actual admission and explicit history for a new person", () => {
    const result = newEmployee(40, "horario-40");
    expect(result.activeFrom).toBe("");
    expect(result.historyKnown).toBe(false);
    expect(result.history).toEqual([]);
    expect(result.maxConsecutiveSundays).toBe(1);
    expect(result.weeklyHours).toBe(40);
    expect(result.shiftIds).toEqual(["horario-40"]);
  });

  it("replaces only the selected person and date, preserving locked decisions elsewhere", () => {
    const before = [
      {
        employeeId: "a",
        date: "2026-10-01",
        kind: "WORK" as const,
        shiftId: "x",
      },
      {
        employeeId: "b",
        date: "2026-10-01",
        kind: "WORK" as const,
        shiftId: "x",
        locked: true,
      },
      { employeeId: "a", date: "2026-10-02", kind: "OFF" as const },
    ];
    const after = replaceAssignment(before, {
      employeeId: "a",
      date: "2026-10-01",
      kind: "OFF",
    });
    expect(after).toHaveLength(3);
    expect(after).toContainEqual(before[1]);
    expect(after).toContainEqual(before[2]);
    expect(before[0].kind).toBe("WORK");
  });

  it("adds an import without replacing existing people or duplicating an identical shift", () => {
    const input = newInput("1", "Centro", "2026-10", 42);
    input.employees = [employee("0001")];
    const added = employee("0002");
    const result = mergeImport(input, [added], [input.shifts[0]]);
    expect(result.employees.map((person) => person.registration)).toEqual(["0001", "0002"]);
    expect(result.shifts).toHaveLength(1);
    expect(input.employees).toHaveLength(1);
  });

  it("rejects a colliding registration instead of silently updating a person", () => {
    const input = newInput("1", "Centro", "2026-10", 42);
    input.employees = [employee("0001")];
    expect(() => mergeImport(input, [employee("0001")], [])).toThrow("matrícula já cadastrada");
    expect(input.employees).toHaveLength(1);
  });

  it("rejects a shift identifier with different hours without mutating the proposal", () => {
    const input = newInput("1", "Centro", "2026-10", 42);
    const conflicting: EscalaShift = {
      ...input.shifts[0],
      segments: [{ start: 480, end: 960, kind: "WORK" }],
    };
    expect(() => mergeImport(input, [], [conflicting])).toThrow("configuração diferente");
    expect(input.shifts[0].segments).toHaveLength(3);
  });

  it("does not allow duplicate registrations within one preview", () => {
    const input = newInput("1", "Centro", "2026-10", 42);
    expect(() => mergeImport(input, [employee("0001"), employee("0001")], [])).toThrow("matrícula já cadastrada");
  });

  it("extracts structured errors without exposing raw server payloads", () => {
    expect(
      responseMessage({
        error: { code: "STALE", message: "Revisão alterada" },
      }),
    ).toBe("Revisão alterada");
    expect(responseMessage({ error: "Acesso negado" })).toBe("Acesso negado");
    expect(responseMessage(null)).toBe("Resposta inválida do servidor.");
  });

  it("ignores a late response after cancellation even if the underlying operation completes", async () => {
    const controller = new AbortController();
    let currentVersion = 1;
    const responseVersion = currentVersion;
    let resolve: (value: string) => void = () => undefined;
    const response = new Promise<string>((done) => {
      resolve = done;
    });
    const applied: string[] = [];
    const operation = response.then((value) => {
      if (isCurrentResponse(controller.signal, responseVersion, currentVersion)) applied.push(value);
    });
    currentVersion += 1;
    controller.abort();
    resolve("resultado antigo");
    await operation;
    expect(applied).toEqual([]);
    expect(isCurrentResponse(new AbortController().signal, currentVersion, currentVersion)).toBe(true);
    expect(isCurrentResponse(new AbortController().signal, responseVersion, currentVersion)).toBe(false);
  });
});
