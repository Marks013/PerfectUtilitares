import { describe, expect, it } from "vitest";
import { dateRange } from "./dates";
import { isHoursReferenceOnly } from "./hours-reference";
import type { EscalaInput } from "./types";
import { operationalEscalaInput } from "./eligibility";
import { makeScenario } from "../../../scripts/escalas/cross-engine/fixtures";
import { captureEnvelope, digest, envelopeProfile, inputDiagnosticFields, measureReferences, pairOrder, runTrial, verifyReply } from "../../../scripts/escalas/cross-engine/core";

describe("cross-engine synthetic fixtures and fail-closed comparator", () => {
  it("uses the real December calendar and synthetic operating cohorts", async () => {
    const scenario = makeScenario("december-representative");
    const { prepared } = scenario;
    expect(prepared.startDate).toBe("2026-12-01");
    expect(prepared.endDate).toBe("2026-12-31");
    expect(prepared.policy.closedDates).toContain("2026-12-25");
    expect(prepared.policy.holidayDates).toContain("2026-12-25");
    expect(prepared.policy.paidHolidayDates).toEqual(["2026-12-25"]);
    const wire = JSON.parse(await captureEnvelope(scenario)).input;
    expect(wire.policy.paidHolidayDates).toEqual(["2026-12-25"]);
    expect(prepared.employees).toHaveLength(140);
    expect(operationalEscalaInput(prepared).employees.filter(person => person.planningEnabled !== false)).toHaveLength(125);
    expect(prepared.assignments).toEqual([]);
  });
  it("never invokes a solver for reference-only hours", async () => {
    const scenario = makeScenario("hours-reference-only");
    expect(isHoursReferenceOnly(scenario.prepared)).toBe(true);
    expect(measureReferences(scenario).assignments).toBe(0);
    await expect(captureEnvelope(scenario)).rejects.toThrow("CROSS_ENGINE_REFERENCE_ONLY");
  });
  it("alternates paired execution and rejects malformed engine replies", () => {
    expect(pairOrder(0, true)).toEqual(["ortools", "timefold"]);
    expect(pairOrder(1, true)).toEqual(["timefold", "ortools"]);
    expect(pairOrder(0, false)).toEqual(["ortools"]);
    expect(() => verifyReply({ httpStatus: 200, body: { status: "MAYBE" }, maxRssKiB: 1 })).toThrow();
    expect(() => verifyReply({ httpStatus: 200, body: { status: "FEASIBLE" }, maxRssKiB: -1 })).toThrow();
  });
  it("validates comparable cgroup v2 counters and never invents missing measurements", () => {
    const reply = { httpStatus: 200, body: { status: "UNKNOWN" }, maxRssKiB: null };
    expect(verifyReply(reply).cgroup).toBeNull();
    const cgroup = { version: 2, scope: "container-before-response", cpuUsageUsec: 1234567,
      memoryPeakBytes: 167772160, memoryLimitBytes: 1536 * 1024 * 1024,
      cpuQuotaUsec: 100000, cpuPeriodUsec: 100000, pidsLimit: 64 };
    expect(verifyReply({ ...reply, cgroup }).cgroup).toEqual(cgroup);
    expect(() => verifyReply({ ...reply, cgroup: { ...cgroup, cpuQuotaUsec: 200000 } })).toThrow("CROSS_ENGINE_CGROUP_TELEMETRY_INVALID");
    expect(() => verifyReply({ ...reply, cgroup: { ...cgroup, cpuUsageUsec: -1 } })).toThrow();
    expect(() => verifyReply({ ...reply, cgroup: { ...cgroup, memoryLimitBytes: 2147483648 } })).toThrow();
  });
  it("keeps constructor-only evidence separate from search telemetry", () => {
    const spike = { mappingSeconds: .1, entities: 70, initialized: 70, bands: 14, windows: 80,
      firstFeasibleSeconds: .4, partialModel: true, beforeSeed: 10, seedMode: "PATTERN",
      seedOutcome: "APPLIED", seedSeconds: .2, guardedSeed: true, seedGuardViolation: 0,
      scoreCalculations: 1, moveEvaluations: 0, solvingSeconds: 0, seedOnly: true, firstFeasibleSource: "VALIDATED_SEED" };
    const reply = { httpStatus: 200, body: { status: "FEASIBLE" }, maxRssKiB: null, spike };
    expect(verifyReply(reply).spike?.seedOnly).toBe(true);
    expect(() => verifyReply({ ...reply, spike: { ...spike, moveEvaluations: 1 } })).toThrow("CROSS_ENGINE_SEED_ONLY_TELEMETRY");
    expect(() => verifyReply({ ...reply, spike: { ...spike, seedOnly: false } })).toThrow("CROSS_ENGINE_SEED_ONLY_TELEMETRY");
    expect(() => verifyReply({ ...reply, spike: { ...spike, guardedSeed: false } })).toThrow();
  });
  it("captures the actual client envelope, preserves globals, and records unsuccessful trials", async () => {
    const scenario = makeScenario("team-10-week");
    const oldFetch = globalThis.fetch;
    const frozen = await captureEnvelope(scenario);
    const payload = JSON.parse(frozen);
    expect(payload.input.storeClosingMinutes).toBeTypeOf("number");
    expect(payload.input.employees).toHaveLength(10);
    expect(globalThis.fetch).toBe(oldFetch);
    const trial = await runTrial(scenario, frozen, body => {
      expect(body).toBe(frozen);
      return { httpStatus: 200, body: { status: "UNKNOWN", assignments: [], message: "Synthetic test", wallTimeSeconds: 1 }, maxRssKiB: 20 };
    });
    expect(trial.inputHash).toBe(digest(frozen));
    expect(trial.rawStatus).toBe("UNKNOWN");
    expect(trial.engineNew).toBe(false);
    expect(trial.proposal).toBeUndefined();
    expect(globalThis.fetch).toBe(oldFetch);
  });
  it("does not turn an incomplete FEASIBLE reply into an accepted new roster", async () => {
    const scenario = makeScenario("team-10-week");
    const frozen = await captureEnvelope(scenario);
    const trial = await runTrial(scenario, frozen, () => ({
      httpStatus: 200, body: { status: "FEASIBLE", assignments: [], message: "Synthetic incomplete", wallTimeSeconds: 1 }, maxRssKiB: 1,
    }));
    expect(trial.rawStatus).toBe("FEASIBLE");
    expect(trial.rawAssessment?.complete).toBe(false);
    expect(trial.engineNew).toBe(false);
    expect(trial.acceptedNew).toBe(false);
  });
  it("captures admitted December bounds without sending the historical roster", async () => {
    const scenario = makeScenario("december-protected");
    const envelope = JSON.parse(await captureEnvelope(scenario)).input;
    expect(envelope.assignments).toEqual([]);
    expect(envelope._coverageComparison).toBeDefined();
    expect(envelope._coverageServiceProtection.days.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty("admittedDecemberOrigin");
  });
  it("accepts a complete valid raw candidate through the actual TypeScript client", async () => {
    const prepared: EscalaInput = {
      schemaVersion: 1, branchCode: "SYNTH", branchName: "Synthetic",
      startDate: "2026-11-02", endDate: "2026-11-08", defaultWeeklyHours: 42,
      timeZone: "America/Sao_Paulo",
      policy: { source: "Synthetic", validFrom: "2026-01-01", validUntil: "2026-12-31",
        reviewed: true, reviewedBy: "Synthetic", weeklyLimit: 44, dailyLimitMinutes: 528,
        compensationAuthorized: true, limitContinuousWorkBlocks: false, minInterShiftMinutes: 660,
        minWeeklyRestMinutes: 2100, minMealMinutes: 60, maxConsecutiveWorkDays: 5,
        closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
      employees: [{ id: "p1", registration: "01", name: "Synthetic person", sector: "Synthetic sector", role: "Repositor",
        weeklyHours: 42, shiftIds: ["day"], activeFrom: "2026-11-02", offMode: "VARIABLE", fixedOffDays: [],
        offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }],
      shifts: [{ id: "day", name: "Day", segments: [{ start: 480, end: 720, kind: "WORK" },
        { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }],
      demands: [], assignments: [],
    };
    const scenario = { id: "team-10-week" as const, prepared };
    const frozen = await captureEnvelope(scenario);
    const assignments = dateRange(prepared.startDate, prepared.endDate).map((date, day) => ({
      employeeId: "p1", date, ...(day === 0 || day === 6 ? { kind: "OFF" } : { kind: "WORK", shiftId: "day" }),
    }));
    const trial = await runTrial(scenario, frozen, () => ({ httpStatus: 200,
      body: { status: "FEASIBLE", assignments, message: "Synthetic valid", wallTimeSeconds: 1 }, maxRssKiB: 1 }));
    expect(trial.finalAssessment?.valid).toBe(true);
    expect(trial.engineNew).toBe(true);
  });
  it("captures a shared saved roster for repair, rather than silently creating a new seed", async () => {
    const scenario = makeScenario("team-10-week-repair");
    const frozen = await captureEnvelope(scenario);
    const profile = envelopeProfile(frozen);
    expect(profile.savedAssignments).toBe(70);
    expect(profile.activePositions).toBe(70);
    expect(profile.mode).toBe("DAYS_AND_HOURS");
    expect(profile.searchBudgetSeconds).toBe(12);
    expect(await captureEnvelope(scenario)).toBe(frozen);
  });
  it("uses the actual 23-second presence-recovery marker and keeps all locks", async () => {
    const scenario = makeScenario("december-presence-recovery");
    const frozen = await captureEnvelope(scenario);
    const wire = JSON.parse(frozen).input;
    expect(wire._restPairTarget).toBe(20);
    expect(wire.generationMode).toBe("DAYS_AND_HOURS");
    expect(wire._coverageComparison).toBeDefined();
    expect(wire._coverageServiceProtection.bands.length).toBeGreaterThan(0);
    expect(envelopeProfile(frozen)).toMatchObject({ days: 31, activePositions: 14, lockedAssignments: 14,
      searchBudgetSeconds: 23, processBudgetSeconds: 27, transportBudgetSeconds: 32 });
    const trial = await runTrial(scenario, frozen, () => ({ httpStatus: 200,
      body: { status: "FEASIBLE", assignments: wire.assignments, message: "Synthetic retained", wallTimeSeconds: 1 }, maxRssKiB: 1 }));
    expect(trial.unchangedReference).toBe(true);
    expect(trial.engineNew).toBe(false);
    expect(trial.acceptedNew).toBe(false);
  });
  it("keeps only safe input rejection fields and never reports payload or values", async () => {
    expect(inputDiagnosticFields([{ path: "_restPairTarget", reason: "INVALID_SCOPE" },
      { path: "employees[2].activeFrom", reason: "INVALID_VALUE" },
      { path: "not a schema path", reason: "SECRET" }, { path: "policy", reason: "not a code" }])).toEqual([
      { path: "_restPairTarget", reason: "INVALID_SCOPE" }, { path: "employees[2].activeFrom", reason: "INVALID_VALUE" }]);
    const scenario = makeScenario("team-10-week");
    const frozen = await captureEnvelope(scenario);
    const trial = await runTrial(scenario, frozen, () => ({ httpStatus: 400,
      body: { error: "INVALID_MODEL_INPUT", fields: [{ path: "_restPairTarget", reason: "INVALID_SCOPE" }] },
      maxRssKiB: null }));
    expect(trial.inputErrorFields).toEqual([{ path: "_restPairTarget", reason: "INVALID_SCOPE" }]);
    expect(trial.errorCode).toBe("SOLVER_INVALID_INPUT");
    expect(trial.engineNew).toBe(false);
  });
  it("keeps a full HOURS_ONLY grid with original day classifications", () => {
    const scenario = makeScenario("hours-only-with-grid");
    expect(isHoursReferenceOnly(scenario.prepared)).toBe(false);
    expect(scenario.prepared.assignments).toHaveLength(10 * dateRange(scenario.prepared.startDate, scenario.prepared.endDate).length);
    expect(scenario.reference?.assignments).toEqual(scenario.prepared.assignments);
  });
});
