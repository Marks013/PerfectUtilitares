import { describe, expect, it } from "vitest";
import { addEmployeeFromEscalaApprovedModel, buildEscalaApprovedPolicy,
  createInputFromEscalaApprovedPolicy, readEscalaApprovedPolicy } from "./approved-policy";
import type { EscalaInput } from "./types";

function request() {
  const input: EscalaInput = {
    schemaVersion: 1, branchCode: "02", branchName: "Filial 02",
    startDate: "2026-11-30", endDate: "2027-01-03", visibleMonth: "2026-12",
    defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo", generationMode: "DAYS_AND_HOURS",
    policy: { source: "Configuração revista", validFrom: "2026-01-01", validUntil: "2027-12-31",
      reviewed: true, reviewedBy: "Administrador", weeklyLimit: 44, dailyLimitMinutes: 600,
      compensationAuthorized: false, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100,
      minMealMinutes: 60, maxConsecutiveWorkDays: 5, closedDates: ["2026-12-25"],
      holidayDates: ["2026-12-25"], authorizedHolidayDates: [], holidayRestAllowed: false,
      nightWorkReviewed: false, allowShortMealSimulation: false, limitContinuousWorkBlocks: false },
    employees: [{ id: "person", registration: "0001", name: "Pessoa exemplo", sector: "Loja", role: "Atendente",
      weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL", shiftIds: ["s"], originalShiftIds: ["s"],
      scheduleMode: "TIMED", activeFrom: "2020-01-01", offMode: "VARIABLE", fixedOffDays: [],
      offPattern: "ANY", maxConsecutiveSundays: 2, sundayRestRule: "UNREVIEWED", preferredOffDays: [],
      historyKnown: true, history: [{ employeeId: "person", date: "2026-11-29", kind: "WORK", shiftId: "s" }],
      sourceSchedule: { report: "FPRE136", code: "001", description: "Origem aprovada", weekday: "08-17", saturday: "" } }],
    shifts: [{ id: "s", name: "Turno", segments: [{ start: 480, end: 720, kind: "WORK" }] }],
    demands: [{ id: "d", date: "2026-12-01", sector: "Loja", start: 480, end: 720, minimum: 1 }],
    assignments: [
      { employeeId: "person", date: "2026-12-01", kind: "WORK", shiftId: "s" },
      { employeeId: "person", date: "2026-12-02", kind: "OFF" },
      { employeeId: "person", date: "2026-12-03", kind: "ABSENCE", locked: true },
      { employeeId: "person", date: "2026-12-25", kind: "HOLIDAY" },
      { employeeId: "person", date: "2026-12-04", kind: "DUTY" },
    ],
  };
  return { input, version: 1, provenance: { tenantId: "tenant", approvedById: "admin",
    approvedAt: "2026-11-13T12:00:00.000Z", origin: null },
    selectedSeedAssignments: [{ employeeId: "person", date: "2026-12-03", kind: "ABSENCE" }],
    regimeModelSelections: [{ id: "regime-40", label: "Regime aprovado de 40h", employeeId: "person" }] };
}
function candidate() {
  const result = buildEscalaApprovedPolicy(request());
  if (!result.ok) throw new Error("Fixture de aprovação inválida");
  return result.value;
}

describe("approved branch/period policy candidate", () => {
  it("builds a complete typed seed, preserves approved actual continuity and excludes generated roster", () => {
    const source = request();
    const before = structuredClone(source);
    const result = buildEscalaApprovedPolicy(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { snapshot, snapshotHash } = result.value;
    expect(source).toEqual(before);
    expect(snapshot.seed.assignments).toEqual([source.input.assignments[2]]);
    expect(snapshot.seed.employees[0]).toEqual(source.input.employees[0]);
    expect(snapshot.regimeModels[0].protectedFields.weeklyHours).toBe(40);
    expect(snapshot.regimeModels[0].protectedFields).not.toHaveProperty("sourceSchedule");
    expect(snapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(readEscalaApprovedPolicy(JSON.parse(JSON.stringify(snapshot)), snapshotHash).ok).toBe(true);
    const fresh = createInputFromEscalaApprovedPolicy(snapshot, snapshotHash);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.value.startDate).toBe(source.input.startDate);
    expect(fresh.value.visibleMonth).toBe("2026-12");
    fresh.value.employees[0].name = "Mudança posterior";
    expect(snapshot.seed.employees[0].name).toBe("Pessoa exemplo");
  });
  it("approves and restores a Sunday schedule without invalidating legacy snapshots", () => {
    const legacy = candidate();
    // Captured with the original serializer and fixture at 03233b3.
    expect(legacy.snapshotHash).toBe("89bc235a7578db77b53d5420971e1ed0a73e83cf2488aceb8f2b6703816f702e");
    const legacyJson = JSON.parse(JSON.stringify(legacy.snapshot));
    expect(legacyJson.configuration).not.toHaveProperty("planningWeekStartsOn");
    expect(createInputFromEscalaApprovedPolicy(legacyJson, legacy.snapshotHash).ok).toBe(true);

    const source = request();
    source.input.planningWeekStartsOn = "SUNDAY";
    source.input.startDate = "2026-11-29";
    source.input.endDate = "2027-01-02";
    source.input.employees[0].history[0].date = "2026-11-28";
    const approved = buildEscalaApprovedPolicy(source);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const { snapshot, snapshotHash } = approved.value;
    expect(snapshot.configuration.planningWeekStartsOn).toBe("SUNDAY");
    const restored = createInputFromEscalaApprovedPolicy(JSON.parse(JSON.stringify(snapshot)), snapshotHash);
    expect(restored).toMatchObject({ ok: true, value: { planningWeekStartsOn: "SUNDAY", startDate: "2026-11-29", endDate: "2027-01-02" } });
    const tampered = { ...snapshot, configuration: { ...snapshot.configuration, planningWeekStartsOn: "MONDAY" } };
    expect(readEscalaApprovedPolicy(tampered, snapshotHash).ok).toBe(false);
  });

  it("signs the clipped December period while preserving the declared employee history", () => {
    const source = request();
    Object.assign(source.input, { startDate: "2026-12-01", endDate: "2026-12-31", planningWeekStartsOn: "SUNDAY" });
    source.input.employees[0].history = [{ employeeId: "person", date: "2026-11-29", kind: "OFF" }];
    const before = structuredClone(source);
    const approved = buildEscalaApprovedPolicy(source);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const { snapshot, snapshotHash } = approved.value;
    expect(createInputFromEscalaApprovedPolicy(JSON.parse(JSON.stringify(snapshot)), snapshotHash)).toMatchObject({
      ok: true, value: { startDate: "2026-12-01", endDate: "2026-12-31", planningWeekStartsOn: "SUNDAY",
        employees: [expect.objectContaining({ historyKnown: true, history: source.input.employees[0].history, shiftIds: ["s"] })],
        assignments: [source.input.assignments[2]] },
    });
    const expanded = { ...snapshot, configuration: { ...snapshot.configuration, startDate: "2026-11-29", endDate: "2027-01-02" } };
    expect(readEscalaApprovedPolicy(expanded, snapshotHash).ok).toBe(false);
    expect(source).toEqual(before);
  });

  it("hashes object keys stably, includes provenance and retains meaningful array order", () => {
    const source = request();
    const reversed = Object.fromEntries(Object.entries(source).reverse());
    expect(buildEscalaApprovedPolicy(reversed)).toEqual(buildEscalaApprovedPolicy(source));
    const previous = candidate().snapshotHash;
    source.provenance.approvedById = "other-admin";
    const changed = buildEscalaApprovedPolicy(source);
    expect(changed.ok && changed.value.snapshotHash).not.toBe(previous);
  });
  it("includes a selected same-period holiday and reads reordered stored JSON keys", () => {
    const source = request();
    const result = buildEscalaApprovedPolicy({ ...source, selectedSeedAssignments: [
      ...source.selectedSeedAssignments, { employeeId: "person", date: "2026-12-25", kind: "HOLIDAY" },
    ] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.seed.assignments.map(entry => entry.kind)).toEqual(["ABSENCE", "HOLIDAY"]);
    const reordered = { ...result.value.snapshot,
      configuration: Object.fromEntries(Object.entries(result.value.snapshot.configuration).reverse()) };
    expect(readEscalaApprovedPolicy(reordered, result.value.snapshotHash).ok).toBe(true);
  });
  it("does not transport unselected absences/holidays, generation caches or derived published context", () => {
    const source = request();
    source.selectedSeedAssignments = [];
    source.input.generationBasis = "generation-v1:0123456789abcdef";
    source.input.coverageBasis = "coverage-v1:0123456789abcdef";
    source.input.needsRegeneration = true;
    const result = buildEscalaApprovedPolicy(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.seed.assignments).toEqual([]);
    expect(result.value.snapshot.configuration).not.toHaveProperty("generationBasis");
    expect(result.value.snapshot.configuration).not.toHaveProperty("coverageBasis");
    expect(result.value.snapshot.configuration).not.toHaveProperty("needsRegeneration");
    source.input.employees[0].planningHistory = source.input.employees[0].history;
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
    delete source.input.employees[0].planningHistory;
    source.input.employees[0].planningFuture = [{ employeeId: "person", date: "2027-01-04", kind: "OFF" }];
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
  });
  it.each(["WORK", "OFF", "DUTY"])("rejects generated %s as an explicit seed selection", kind => {
    expect(buildEscalaApprovedPolicy({ ...request(), selectedSeedAssignments: [
      { employeeId: "person", date: "2026-12-01", kind },
    ] }).ok).toBe(false);
  });
  it("requires exact real source assignments, employment dates and holiday calendar", () => {
    const source = request();
    for (const choice of [
      { employeeId: "other", date: "2026-12-03", kind: "ABSENCE" },
      { employeeId: "person", date: "2026-11-03", kind: "ABSENCE" },
      { employeeId: "person", date: "2026-12-04", kind: "ABSENCE" },
    ]) expect(buildEscalaApprovedPolicy({ ...source, selectedSeedAssignments: [choice] }).ok).toBe(false);
    source.input.employees[0].activeFrom = "2026-12-04";
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
    source.input.employees[0].activeFrom = "2020-01-01";
    source.input.assignments[2].kind = "HOLIDAY";
    expect(buildEscalaApprovedPolicy({ ...source, selectedSeedAssignments: [
      { employeeId: "person", date: "2026-12-03", kind: "HOLIDAY" },
    ] }).ok).toBe(false);
  });
  it("rejects duplicate models, duplicate selections, foreign references and incomplete configuration", () => {
    const source = request();
    expect(buildEscalaApprovedPolicy({ ...source, regimeModelSelections: [...source.regimeModelSelections, ...source.regimeModelSelections] }).ok).toBe(false);
    expect(buildEscalaApprovedPolicy({ ...source, selectedSeedAssignments: [...source.selectedSeedAssignments, ...source.selectedSeedAssignments] }).ok).toBe(false);
    expect(buildEscalaApprovedPolicy({ ...source, regimeModelSelections: [{ id: "r", label: "R", employeeId: "other" }] }).ok).toBe(false);
    source.input.employees[0].shiftIds = ["other"];
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
    source.input.employees[0].shiftIds = ["s"];
    source.input.policy.reviewed = false;
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
    source.input.policy.reviewed = true;
    source.input.policy.validUntil = "2026-12-01";
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
  });
  it.each(["2", "002", " 02 "])("rejects noncanonical branch %s before its normalization hides changes", branchCode => {
    const source = request(); source.input.branchCode = branchCode;
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
  });
  it("rejects invalid dates, versions, unknown fields and unsupported schedules", () => {
    const source = request();
    expect(buildEscalaApprovedPolicy({ ...source, version: 0 }).ok).toBe(false);
    expect(buildEscalaApprovedPolicy({ ...source, snapshotHash: "client" }).ok).toBe(false);
    source.input.startDate = "2026-11-31";
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
    source.input.startDate = "2026-11-30";
    source.input.employees[0].scheduleMode = "MISSING";
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
  });
  it("does not materialize manual overrides before validating the raw approved state", () => {
    const source = request();
    source.input.employees[0].manualShiftOverrides = [{ catalogCode: 1500, shiftId: "missing-manual",
      markings: ["08:00", "12:00", "00:00", "00:00"], effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-02" }];
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
    source.input.employees[0].manualShiftOverrides[0].shiftId = "s";
    // A person with explicit manual selection is not silently converted into a generic regime model.
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
  });
  it("preserves valid manual choices on seed people without making them generic models", () => {
    const source = request();
    source.input.employees.push({ ...structuredClone(source.input.employees[0]), id: "template", registration: "0003",
      historyKnown: false, history: [] });
    source.regimeModelSelections[0].employeeId = "template";
    const person = source.input.employees[0];
    person.manualShiftOverrides = [{ catalogCode: 1500, shiftId: "s", markings: ["08:00", "12:00", "00:00", "00:00"],
      effectiveFrom: "2026-12-01", effectiveUntil: "2026-12-02" }];
    const result = buildEscalaApprovedPolicy(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.snapshot.seed.employees[0]).toEqual(person);
    expect(result.value.snapshot.seed.employees[0]).not.toHaveProperty("manualShiftByDate");
    // A mismatched existing shift cannot be repaired by materialization before comparison.
    source.input.shifts[0].segments[0].end = 721;
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
  });
  it("rejects foreign imported restrictions and keeps untimed people without fabricated clocks", () => {
    const source = request();
    source.input.employees[0].fixedImportedShiftId = "foreign";
    expect(buildEscalaApprovedPolicy(source).ok).toBe(false);
    delete source.input.employees[0].fixedImportedShiftId;
    source.input.employees[0].scheduleMode = "UNTIMED";
    source.input.employees[0].shiftIds = [];
    delete source.input.employees[0].originalShiftIds;
    source.input.employees[0].history = [];
    source.input.employees[0].historyKnown = false;
    source.input.assignments = source.input.assignments.filter(entry => entry.kind !== "WORK");
    source.input.shifts = [];
    const result = buildEscalaApprovedPolicy(source);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.snapshot.seed.shifts).toEqual([]);
      expect(result.value.snapshot.seed.employees[0].scheduleMode).toBe("UNTIMED");
    }
  });
  it("rejects stored content tampering, unknown keys, model mutation and bad hashes", () => {
    const approved = candidate();
    const changed = structuredClone(approved.snapshot);
    changed.configuration.policy.dailyLimitMinutes = 599;
    expect(readEscalaApprovedPolicy(changed, approved.snapshotHash).ok).toBe(false);
    expect(readEscalaApprovedPolicy({ ...approved.snapshot, extra: true }, approved.snapshotHash).ok).toBe(false);
    expect(readEscalaApprovedPolicy(approved.snapshot, "a".repeat(64)).ok).toBe(false);
    changed.regimeModels[0].protectedFields.weeklyHours = 44;
    expect(readEscalaApprovedPolicy(changed, approved.snapshotHash).ok).toBe(false);
  });
  it("enrolls from a server-resolved model without copying personal provenance or overriding contract", () => {
    const approved = candidate();
    const enrollment = { id: "new", regimeModelId: "regime-40", name: "Nova pessoa", registration: "0002",
      activeFrom: "2026-12-01", preferredOffDays: [3] };
    const result = addEmployeeFromEscalaApprovedModel(approved.snapshot, approved.snapshotHash, enrollment);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.employees[1]).toMatchObject({ weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL",
      registration: "0002", historyKnown: false, history: [], preferredOffDays: [3] });
    expect(result.value.employees[1]).not.toHaveProperty("sourceSchedule");
    expect(approved.snapshot.seed.employees).toHaveLength(1);
    for (const extra of [{ weeklyHours: 44 }, { protectedFields: {} }, { regimeModelId: "foreign" },
      { id: "person" }, { registration: "0001" }]) {
      expect(addEmployeeFromEscalaApprovedModel(approved.snapshot, approved.snapshotHash, { ...enrollment, ...extra }).ok).toBe(false);
    }
  });
});
