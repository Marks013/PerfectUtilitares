/** Capture the actual private wire contract, with a fail-closed in-process transport.
 * The real Next.js solver client validates and selects every returned candidate.
 * No database, HTTP connection, real credentials or employee data is used.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { solveEscala, EscalaSolverError } from "../../../src/lib/escalas/solver-client";
import { compareRosterCoverage, completeRoster, coverageQuality, isOperationallyReusable, type RosterCoverageMode } from "../../../src/lib/escalas/roster-quality";
import { operationalEscalaInput } from "../../../src/lib/escalas/eligibility";
import { dateRange, dayOfWeek, visibleDates } from "../../../src/lib/escalas/dates";
import { validateEscala } from "../../../src/lib/escalas/validation";
import { isHoursReferenceOnly, validateHoursReferences } from "../../../src/lib/escalas/hours-reference";
import { escalaInputSchema } from "../../../src/lib/escalas/schema";
import type { EscalaInput, EscalaSolveResult } from "../../../src/lib/escalas/types";
import { independentShortage, weekendMetrics } from "../benchmark-metrics";
import { sundaySectorObservations, sundaySectorVariation } from "../../../src/lib/escalas/sunday-sector-observations";
import type { Scenario } from "./fixtures";

const endpoint = "http://cross-engine.invalid";
const maxBytes = 8 * 1024 * 1024;
const statuses = ["FEASIBLE", "OPTIMAL", "UNKNOWN", "INFEASIBLE", "MODEL_INVALID"] as const;
type SpikeTelemetry = { mappingSeconds: number; entities: number; initialized: number; bands: number; windows: number;
  firstFeasibleSeconds: number | null; partialModel: true; beforeSeed: number;
  seedMode: "DEFAULT" | "PATTERN"; seedOutcome: "NOT_REQUESTED" | "APPLIED" | "COMPLETE" | "TIME_LIMIT" | "NO_PATTERN" | "UNSUPPORTED"; seedSeconds: number };
type CgroupTelemetry = { version: 2; scope: "container-before-response"; cpuUsageUsec: number;
  memoryPeakBytes: number; memoryLimitBytes: number; cpuQuotaUsec: number; cpuPeriodUsec: number; pidsLimit: number };
export type WireReply = { httpStatus: number; body: unknown; maxRssKiB: number | null; spike?: SpikeTelemetry; cgroup?: CgroupTelemetry | null };
export type Adapter = (body: string) => WireReply;
type Status = typeof statuses[number];
type Stage = "NEW_PROPOSAL" | "REFERENCE_RETAINED" | "SEARCH_UNFINISHED" | "PROVEN_INFEASIBLE" | "OTHER";
export const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export function pairOrder(repetition: number, candidate: boolean) {
  return candidate ? (repetition % 2 ? ["timefold", "ortools"] as const : ["ortools", "timefold"] as const) : ["ortools"] as const;
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function knownStatus(value: unknown): Status | null {
  return statuses.includes(value as Status) ? value as Status : null;
}

/** ModelInputError contains schema paths/reason codes, never a value. Mask anything else. */
export function inputDiagnosticFields(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap(entry => {
    const record = asRecord(entry);
    if (!record || typeof record.path !== "string" || typeof record.reason !== "string"
      || !/^(?:input|startDate|endDate|planningWeekStartsOn|generationMode|defaultWeeklyHours|restRulesVersion|simulation|storeClosingMinutes|policy|employees|shifts|assignments|demands|movementPriorities|_initialAssignments|_coverageProtection|_coverageComparison|_coverageServiceProtection|_restPairTarget)(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d{1,5}\])*$/.test(record.path)
      || record.path.length > 120 || !/^[A-Z_]{1,60}$/.test(record.reason)) return [];
    return [{ path: record.path, reason: record.reason }];
  });
}
export function verifyReply(value: unknown): WireReply {
  const record = asRecord(value);
  const httpStatus = record?.httpStatus;
  const rss = record?.maxRssKiB;
  if (typeof httpStatus !== "number" || !Number.isInteger(httpStatus) || ![200, 400, 409, 413, 429, 500, 503, 504].includes(httpStatus)
    || (rss !== null && (typeof rss !== "number" || !Number.isFinite(rss) || rss < 0)) || !asRecord(record?.body))
    throw new Error("CROSS_ENGINE_REPLY_INVALID");
  if (httpStatus === 200 && !knownStatus(asRecord(record?.body)?.status)) throw new Error("CROSS_ENGINE_STATUS_INVALID");
  if (Buffer.byteLength(JSON.stringify(record?.body), "utf8") > maxBytes) throw new Error("CROSS_ENGINE_REPLY_LIMIT");
  let spike: SpikeTelemetry | undefined;
  if (record?.spike !== undefined) {
    const t = asRecord(record.spike);
    const nonnegative = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
    const count = (v: unknown): v is number => nonnegative(v) && Number.isInteger(v) && v <= 100_000;
    if (!t || t.partialModel !== true || !nonnegative(t.mappingSeconds) || !count(t.entities) || !count(t.initialized)
      || t.initialized > t.entities || !count(t.bands) || !count(t.windows)
      || (t.firstFeasibleSeconds !== null && !nonnegative(t.firstFeasibleSeconds))) throw new Error("CROSS_ENGINE_SPIKE_TELEMETRY_INVALID");
    const seedOutcome = t.seedOutcome;
    if (!count(t.beforeSeed) || t.beforeSeed > t.initialized || !nonnegative(t.seedSeconds)
      || (t.seedMode !== "DEFAULT" && t.seedMode !== "PATTERN")
      || (seedOutcome !== "NOT_REQUESTED" && seedOutcome !== "APPLIED" && seedOutcome !== "COMPLETE"
        && seedOutcome !== "TIME_LIMIT" && seedOutcome !== "NO_PATTERN" && seedOutcome !== "UNSUPPORTED"))
      throw new Error("CROSS_ENGINE_SEED_TELEMETRY_INVALID");
    if (t.seedMode === "DEFAULT" ? seedOutcome !== "NOT_REQUESTED" || t.seedSeconds !== 0 || t.beforeSeed !== t.initialized
      : seedOutcome === "NOT_REQUESTED" || (seedOutcome === "APPLIED" ? t.initialized !== t.entities || t.beforeSeed === t.entities
        : t.beforeSeed !== t.initialized || (seedOutcome === "COMPLETE" && t.beforeSeed !== t.entities)))
      throw new Error("CROSS_ENGINE_SEED_TELEMETRY_INVALID");
    spike = { mappingSeconds: t.mappingSeconds, entities: t.entities, initialized: t.initialized,
      bands: t.bands, windows: t.windows, firstFeasibleSeconds: t.firstFeasibleSeconds, partialModel: true,
      beforeSeed: t.beforeSeed, seedMode: t.seedMode, seedOutcome, seedSeconds: t.seedSeconds };
  }
  let cgroup: CgroupTelemetry | null = null;
  if (record?.cgroup !== undefined && record.cgroup !== null) {
    const t = asRecord(record.cgroup);
    const nonnegativeInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
    if (!t || t.version !== 2 || t.scope !== "container-before-response"
      || !nonnegativeInt(t.cpuUsageUsec) || !nonnegativeInt(t.memoryPeakBytes) || t.memoryPeakBytes === 0
      || t.memoryLimitBytes !== 1536 * 1024 * 1024 || t.pidsLimit !== 64
      || !nonnegativeInt(t.cpuQuotaUsec) || !nonnegativeInt(t.cpuPeriodUsec)
      || t.cpuPeriodUsec === 0 || t.cpuQuotaUsec !== t.cpuPeriodUsec) throw new Error("CROSS_ENGINE_CGROUP_TELEMETRY_INVALID");
    cgroup = { version: 2, scope: "container-before-response", cpuUsageUsec: t.cpuUsageUsec,
      memoryPeakBytes: t.memoryPeakBytes, memoryLimitBytes: t.memoryLimitBytes,
      cpuQuotaUsec: t.cpuQuotaUsec, cpuPeriodUsec: t.cpuPeriodUsec, pidsLimit: t.pidsLimit };
  }
  return { httpStatus, body: record?.body, maxRssKiB: rss as number | null, ...(spike ? { spike } : {}), cgroup };
}

// This function must never be called concurrently in one process. It restores every modified global.
let transportActive = false;
async function withTransport<T>(handler: (body: string) => WireReply, work: () => Promise<T>): Promise<T> {
  if (transportActive) throw new Error("CROSS_ENGINE_TRANSPORT_BUSY");
  transportActive = true;
  let directory: string | undefined;
  const savedFetch = globalThis.fetch;
  const oldUrl = process.env.ESCALAS_SOLVER_URL;
  const oldSecret = process.env.ESCALAS_SOLVER_SECRET_FILE;
  try {
    directory = mkdtempSync(join(tmpdir(), "cross-engine-"));
    const secret = randomBytes(48).toString("hex");
    const path = join(directory, "secret");
    writeFileSync(path, secret, { mode: 0o600 });
    process.env.ESCALAS_SOLVER_URL = endpoint;
    process.env.ESCALAS_SOLVER_SECRET_FILE = path;
    globalThis.fetch = async (url, init) => {
      const target = String(url);
      if (init?.method !== "POST" || new Headers(init.headers).get("authorization") !== "Bearer " + secret)
        throw new Error("CROSS_ENGINE_TRANSPORT_BLOCKED");
      if (target === endpoint + "/cancel") return Response.json({ state: "CANCELLED" });
      if (target !== endpoint + "/solve" || typeof init.body !== "string" || Buffer.byteLength(init.body, "utf8") > maxBytes)
        throw new Error("CROSS_ENGINE_TRANSPORT_BLOCKED");
      const reply = verifyReply(handler(init.body));
      return Response.json(reply.body, { status: reply.httpStatus });
    };
    return await work();
  } finally {
    globalThis.fetch = savedFetch;
    if (oldUrl === undefined) delete process.env.ESCALAS_SOLVER_URL; else process.env.ESCALAS_SOLVER_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.ESCALAS_SOLVER_SECRET_FILE; else process.env.ESCALAS_SOLVER_SECRET_FILE = oldSecret;
    try { if (directory) rmSync(directory, { recursive: true, force: true }); }
    finally { transportActive = false; }
  }
}

function runClient(scenario: Scenario) {
  return solveEscala(structuredClone(scenario.prepared), {
    ...(scenario.reference ? { qualityReference: structuredClone(scenario.reference) } : {}),
    ...(scenario.admittedDecemberOrigin ? { admittedDecemberOrigin: structuredClone(scenario.admittedDecemberOrigin) } : {}),
  });
}

/** Capture once using the real client, not a reimplementation of requestSolver. */
export async function captureEnvelope(scenario: Scenario): Promise<string> {
  if (isHoursReferenceOnly(scenario.prepared)) throw new Error("CROSS_ENGINE_REFERENCE_ONLY");
  let captured: string | undefined;
  await withTransport(body => {
    if (captured !== undefined) throw new Error("CROSS_ENGINE_MULTIPLE_SOLVES");
    captured = body;
    return { httpStatus: 200, body: { status: "UNKNOWN", assignments: [], message: "Synthetic capture", wallTimeSeconds: 0 }, maxRssKiB: null };
  }, () => runClient(scenario));
  if (captured === undefined) throw new Error("CROSS_ENGINE_NO_ENVELOPE");
  return captured;
}

export function measureReferences(scenario: Scenario) {
  if (!isHoursReferenceOnly(scenario.prepared)) throw new Error("CROSS_ENGINE_NOT_REFERENCE_ONLY");
  const validation = validateHoursReferences(scenario.prepared);
  return { valid: validation.valid, assignments: scenario.prepared.assignments.length,
    readyToPublish: validation.readyToPublish, issueCodes: [...new Set(validation.issues.map(issue => issue.code))].sort() };
}

/** Reconstruct the sector-wise prefix of the real comparator, on the
 * E2 fixtures only. Stable sorted ordinals, no employee/sector names or dates.
 * Role/time guards are still checked by the real TS comparator.
 */
function auditSectorMetrics(input: EscalaInput, quality: ReturnType<typeof coverageQuality>) {
  const dates = dateRange(input.startDate, input.endDate);
  if (input.branchCode !== "SYNTH" || input.startDate !== "2026-11-01" || input.visibleMonth
    || (dates.length !== 7 && dates.length !== 28)) return undefined;
  const visible = new Set(visibleDates(input));
  const sectors = [...new Set([...input.employees.map(p => p.sector), ...input.demands.map(d => d.sector)])].sort();
  return sectors.map(sector => {
    let horizon = 0, month = 0, sundays = 0, monthSundays = 0, closing = 0;
    const presence: number[] = [];
    for (const [index, day] of dates.entries()) {
      const key = sector + "\0" + day, gap = quality.daily.get(key) ?? 0;
      horizon += gap;
      if (visible.has(day)) month += gap;
      if (dayOfWeek(day) === 6) {
        sundays += gap;
        if (visible.has(day)) monthSundays += gap;
      }
      closing += quality.closing.get(key) ?? 0;
      if (quality.present.has(day + "\0" + sector)) presence.push(index);
    }
    return { horizon, month, sundays, monthSundays, closing, peak: quality.peaks.get(sector) ?? 0, presence };
  });
}

function evaluate(input: EscalaInput, reference?: EscalaInput, mode?: RosterCoverageMode) {
  const parsed = escalaInputSchema.safeParse(input);
  if (!parsed.success) return { valid: false, complete: false, errors: ["SCHEMA_INVALID"], metrics: null, comparison: null };
  const proposal = operationalEscalaInput(parsed.data);
  const validation = validateEscala(proposal);
  const complete = completeRoster(proposal, false);
  const keys = new Set(proposal.assignments.map(day => day.employeeId + "\0" + day.date));
  const valid = isOperationallyReusable(validation) && complete && keys.size === proposal.assignments.length;
  const errors = [...new Set(validation.issues.filter(issue => issue.severity === "ERROR"
    || issue.code === "DAY_PENDING" || issue.code === "MEAL_INTERVAL_EXCESSIVE").map(issue => issue.code))].sort();
  if (!complete) errors.push("INCOMPLETE");
  if (keys.size !== proposal.assignments.length) errors.push("DUPLICATE_ASSIGNMENTS");
  if (!valid) return { valid, complete, errors, metrics: null, comparison: null };
  const comparison = reference ? compareRosterCoverage(reference, proposal, reference, mode) : undefined;
  const shortage = independentShortage(proposal);
  // Keep the E1 legacy sum for historical comparison. Use the same frozen
  // estimated-only ruler for both engines; no double counting of role/general.
  const estimated = { ...proposal, demands: proposal.demands.filter(d => d.estimated === true) };
  const quality = coverageQuality(estimated);
  const normalized = [...quality.daily.values()].reduce((sum, count) => sum + count, 0);
  const allCoverage = proposal.demands.every(d => d.estimated === true) ? quality : coverageQuality(proposal);
  const coverageAudit = auditSectorMetrics(proposal, allCoverage);
  return { valid, complete, errors, metrics: { shortagePersonMinutes: shortage.total, shortageBySector: shortage.bySector,
    normalizedEstimatedShortage: normalized, ...(coverageAudit ? { coverageAudit } : {}),
    ...weekendMetrics(proposal), ...sundaySectorVariation(sundaySectorObservations(proposal)) },
    comparison: comparison ? { comparable: comparison.comparable, regressed: comparison.regressed,
      improved: comparison.improved, reason: comparison.reason } : null };
}

/** Counts the transported workload, not internal CP variables or the exact search space. */
export function envelopeProfile(frozen: string) {
  const input = JSON.parse(frozen).input as EscalaInput & {
    _initialAssignments?: unknown[]; _restPairTarget?: number;
    _coverageComparison?: { bands?: unknown[]; dailyBands?: unknown[] };
    _coverageServiceProtection?: { bands?: unknown[]; days?: unknown[] };
  };
  const dates = dateRange(input.startDate, input.endDate);
  const active = input.employees.filter(person => person.planningEnabled !== false);
  let positions = 0, timedPositions = 0, untimedPositions = 0;
  let catalogOptions = 0, fixedClockPeople = 0;
  for (const person of active) {
    const days = dates.filter(day => day >= person.activeFrom && (!person.activeUntil || day <= person.activeUntil)).length;
    positions += days;
    const untimed = person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING";
    if (untimed) untimedPositions += days;
    else {
      timedPositions += days;
      const fixed = !!person.fixedImportedShiftId && person.shiftIds.includes(person.fixedImportedShiftId);
      if (fixed) fixedClockPeople++;
      // Catalog count only; date-specific locks, overrides and legality affect true domains.
      catalogOptions += (fixed ? 1 : person.shiftIds.length) * days;
    }
  }
  const special = input._restPairTarget === 20;
  return { days: dates.length, employeesOnWire: input.employees.length, includedOnWire: active.length,
    activePositions: positions, timedPositions, untimedPositions, fixedClockPeople, catalogOptionPositions: catalogOptions,
    shifts: input.shifts.length, paidHolidayCount: input.policy.paidHolidayDates?.length ?? 0,
    estimatedDemands: input.demands.filter(demand => demand.estimated === true).length,
    confirmedDemands: input.demands.filter(demand => demand.estimated !== true).length,
    savedAssignments: input.assignments.length, lockedAssignments: input.assignments.filter(day => day.locked).length,
    initialAssignmentCount: input._initialAssignments?.length ?? 0,
    protectedBands: input._coverageServiceProtection?.bands?.length ?? 0,
    protectedDays: input._coverageServiceProtection?.days?.length ?? 0,
    comparisonBands: input._coverageComparison?.bands?.length ?? 0,
    comparisonDailyBands: input._coverageComparison?.dailyBands?.length ?? 0,
    mode: input.generationMode ?? "DAYS_AND_HOURS", searchBudgetSeconds: special ? 23 : 12,
    processBudgetSeconds: special ? 27 : 18, transportBudgetSeconds: special ? 32 : 20 };
}

export async function runTrial(scenario: Scenario, frozen: string, adapter: Adapter) {
  let response: WireReply | undefined;
  let result: EscalaSolveResult | undefined;
  let invocationError: unknown;
  let adapterFailure = false;
  let invoked = 0;
  let engineSeconds: number | null = null;
  const started = performance.now();
  try {
    result = await withTransport(body => {
      invoked++;
      if (invoked !== 1 || body !== frozen) { adapterFailure = true; throw new Error("CROSS_ENGINE_ENVELOPE_DRIFT"); }
      const engineStarted = performance.now();
      try { response = verifyReply(adapter(frozen)); return response; }
      catch (error) { adapterFailure = true; throw error; }
      finally { engineSeconds = (performance.now() - engineStarted) / 1000; }
    }, () => runClient(scenario));
  } catch (error) { invocationError = error; }
  const productSeconds = (performance.now() - started) / 1000;
  if (adapterFailure || invoked !== 1) throw new Error("CROSS_ENGINE_TRIAL_INFRASTRUCTURE");
  const wire = JSON.parse(frozen).input;
  const coverageMode = wire._restPairTarget === 20 ? "DECEMBER_PRESENCE_PRIORITY"
    : scenario.admittedDecemberOrigin ? "DECEMBER_DEMAND" : undefined;
  const raw = asRecord(response?.body);
  const rawStatus = knownStatus(raw?.status);
  const safeError = typeof raw?.error === "string" && /^[A-Z_]{1,60}$/.test(raw.error) ? raw.error : null;
  const failureStage = ["MAPPING", "SEED", "FACTORY", "SEARCH", "RESULT"].includes(String(raw?.failureStage)) ? raw?.failureStage : null;
  const failureType = typeof raw?.failureType === "string" && /^[A-Za-z0-9_]{1,64}$/.test(raw.failureType) ? raw.failureType : null;
  const rawRejectionStage = ["INPUT_CHECK", "COVERAGE_CHECK", "SEARCH"].includes(String(raw?.rejectionStage)) ? raw?.rejectionStage : null;
  const rawDiagnosticFamilies = Array.isArray(raw?.solverDiagnostics) ? [...new Set(raw.solverDiagnostics.flatMap(entry => {
    const family = asRecord(entry)?.family;
    return typeof family === "string" && ["AVAILABILITY", "BLOCKS", "DAYS_WORKED", "WEEKLY_MINUTES", "COVERAGE", "REST"].includes(family) ? [family] : [];
  }))].sort() : [];
  const rawFeasible = rawStatus === "FEASIBLE" || rawStatus === "OPTIMAL";
  // Wire assignments omit application metadata and exclude administrative records.
  // Raw evaluation is diagnostic; the real client below is the acceptance oracle.
  let rawAssessment: ReturnType<typeof evaluate> | null = null;
  if (rawFeasible && Array.isArray(raw?.assignments)) {
    try { rawAssessment = evaluate({ ...operationalEscalaInput(scenario.prepared),
      assignments: raw.assignments as EscalaInput["assignments"] }, scenario.reference, coverageMode); }
    catch { rawAssessment = { valid: false, complete: false, errors: ["RAW_EVALUATION_FAILED"], metrics: null, comparison: null }; }
  }
  const finalStatus = result?.status ?? null;
  const finalAssessment = result && (finalStatus === "FEASIBLE" || finalStatus === "OPTIMAL")
    ? evaluate({ ...scenario.prepared, assignments: result.assignments }, scenario.reference, coverageMode) : null;
  const outcome = (result?.outcome?.kind ?? "OTHER") as Stage;
  const processSeconds = typeof raw?.wallTimeSeconds === "number" && Number.isFinite(raw.wallTimeSeconds) && raw.wallTimeSeconds >= 0
    ? raw.wallTimeSeconds : null;
  // A malicious/malformed reply must not make the reporting path crash.
  const dayIdentity = (days: unknown) => {
    if (!Array.isArray(days)) return null;
    const entries: string[] = [];
    for (const day of days) {
      const r = asRecord(day);
      if (!r || typeof r.employeeId !== "string" || typeof r.date !== "string" || typeof r.kind !== "string"
        || (r.shiftId !== undefined && typeof r.shiftId !== "string")) return null;
      entries.push(JSON.stringify([r.employeeId, r.date, r.kind, r.shiftId]));
    }
    return digest(JSON.stringify(entries.sort()));
  };
  const finalIdentity = dayIdentity(result?.assignments);
  const rawIdentity = dayIdentity(raw?.assignments);
  const sameAsRaw = rawFeasible && finalIdentity !== null && rawIdentity !== null && finalIdentity === rawIdentity;
  const unchangedReference = !!scenario.reference && finalIdentity !== null
    && finalIdentity === dayIdentity(scenario.reference.assignments);
  const deadline = wire._restPairTarget === 20 ? 32 : 20;
  const timely = engineSeconds !== null && engineSeconds <= deadline && productSeconds <= deadline;
  const errorCode = invocationError instanceof EscalaSolverError ? invocationError.code : invocationError ? "CLIENT_ERROR" : null;
  return { inputHash: digest(frozen), rawStatus, rawRejectionStage, rawDiagnosticFamilies,
    adapterError: safeError, failureStage, failureType,
    inputErrorFields: response?.httpStatus === 400 ? inputDiagnosticFields(raw?.fields) : [], httpStatus: response?.httpStatus ?? null,
    processSeconds, engineSeconds, productSeconds, ...(response?.spike ? { spike: response.spike } : {}), maxRssKiB: response?.maxRssKiB ?? null, cgroup: response?.cgroup ?? null, finalStatus, outcome,
    rawAssessment, finalAssessment, sameAsRaw, unchangedReference, timely, errorCode,
    acceptedNew: !errorCode && timely && outcome === "NEW_PROPOSAL" && !unchangedReference && finalAssessment?.valid === true
      && finalAssessment.comparison?.regressed !== true,
    // A TS repair or retained reference is never attributed to the optimizer.
    engineNew: !errorCode && timely && outcome === "NEW_PROPOSAL" && !unchangedReference && sameAsRaw && rawAssessment?.valid === true && finalAssessment?.valid === true
      && finalAssessment.comparison?.regressed !== true,
    // Used in memory for paired coverage evaluation, stripped before writing JSONL.
    proposal: finalAssessment?.valid && result ? { ...scenario.prepared, assignments: result.assignments } : undefined,
  };
}
