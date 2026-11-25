/** Capture the actual private wire contract, with a fail-closed in-process transport.
 * The real Next.js solver client validates and selects every returned candidate.
 * No database, HTTP connection, real credentials or employee data is used.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { solveEscala, EscalaSolverError } from "../../../src/lib/escalas/solver-client";
import { compareRosterCoverage, completeRoster, isOperationallyReusable } from "../../../src/lib/escalas/roster-quality";
import { operationalEscalaInput } from "../../../src/lib/escalas/eligibility";
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
export type WireReply = { httpStatus: number; body: unknown; maxRssKiB: number | null };
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

export function verifyReply(value: unknown): WireReply {
  const record = asRecord(value);
  const httpStatus = record?.httpStatus;
  const rss = record?.maxRssKiB;
  if (typeof httpStatus !== "number" || !Number.isInteger(httpStatus) || ![200, 400, 409, 413, 429, 500, 503, 504].includes(httpStatus)
    || (rss !== null && (typeof rss !== "number" || !Number.isFinite(rss) || rss < 0)) || !asRecord(record?.body))
    throw new Error("CROSS_ENGINE_REPLY_INVALID");
  if (httpStatus === 200 && !knownStatus(asRecord(record?.body)?.status)) throw new Error("CROSS_ENGINE_STATUS_INVALID");
  if (Buffer.byteLength(JSON.stringify(record?.body), "utf8") > maxBytes) throw new Error("CROSS_ENGINE_REPLY_LIMIT");
  return { httpStatus, body: record?.body, maxRssKiB: rss as number | null };
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

function evaluate(input: EscalaInput, reference?: EscalaInput) {
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
  const comparison = reference ? compareRosterCoverage(reference, proposal, reference) : undefined;
  const shortage = independentShortage(proposal);
  return { valid, complete, errors, metrics: { shortagePersonMinutes: shortage.total,
    ...weekendMetrics(proposal), ...sundaySectorVariation(sundaySectorObservations(proposal)) },
    comparison: comparison ? { comparable: comparison.comparable, regressed: comparison.regressed,
      improved: comparison.improved, reason: comparison.reason } : null };
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
  const raw = asRecord(response?.body);
  const rawStatus = knownStatus(raw?.status);
  const rawFeasible = rawStatus === "FEASIBLE" || rawStatus === "OPTIMAL";
  // Wire assignments omit application metadata and exclude administrative records.
  // Raw evaluation is diagnostic; the real client below is the acceptance oracle.
  let rawAssessment: ReturnType<typeof evaluate> | null = null;
  if (rawFeasible && Array.isArray(raw?.assignments)) {
    try { rawAssessment = evaluate({ ...operationalEscalaInput(scenario.prepared),
      assignments: raw.assignments as EscalaInput["assignments"] }, scenario.reference); }
    catch { rawAssessment = { valid: false, complete: false, errors: ["RAW_EVALUATION_FAILED"], metrics: null, comparison: null }; }
  }
  const finalStatus = result?.status ?? null;
  const finalAssessment = result && (finalStatus === "FEASIBLE" || finalStatus === "OPTIMAL")
    ? evaluate({ ...scenario.prepared, assignments: result.assignments }, scenario.reference) : null;
  const outcome = (result?.outcome?.kind ?? "OTHER") as Stage;
  const processSeconds = typeof raw?.wallTimeSeconds === "number" && Number.isFinite(raw.wallTimeSeconds) && raw.wallTimeSeconds >= 0
    ? raw.wallTimeSeconds : null;
  const sameAsRaw = !!result && rawFeasible && Array.isArray(raw?.assignments)
    && digest(JSON.stringify(result.assignments.map(({ employeeId, date, kind, shiftId }) => [employeeId,date,kind,shiftId]).sort()))
    === digest(JSON.stringify((raw.assignments as EscalaInput["assignments"]).map(({ employeeId,date,kind,shiftId }) => [employeeId,date,kind,shiftId]).sort()));
  const deadline = JSON.parse(frozen).input._restPairTarget === 20 ? 32 : 20;
  const timely = engineSeconds !== null && engineSeconds <= deadline && productSeconds <= deadline;
  const errorCode = invocationError instanceof EscalaSolverError ? invocationError.code : invocationError ? "CLIENT_ERROR" : null;
  return { inputHash: digest(frozen), rawStatus, httpStatus: response?.httpStatus ?? null,
    processSeconds, engineSeconds, productSeconds, maxRssKiB: response?.maxRssKiB ?? null, finalStatus, outcome,
    rawAssessment, finalAssessment, sameAsRaw, timely, errorCode,
    acceptedNew: !errorCode && timely && outcome === "NEW_PROPOSAL" && finalAssessment?.valid === true
      && finalAssessment.comparison?.regressed !== true,
    // A TS repair or retained reference is never attributed to the optimizer.
    engineNew: !errorCode && timely && outcome === "NEW_PROPOSAL" && sameAsRaw && finalAssessment?.valid === true
      && finalAssessment.comparison?.regressed !== true,
    // Used in memory for paired coverage evaluation, stripped before writing JSONL.
    proposal: finalAssessment?.valid && result ? { ...scenario.prepared, assignments: result.assignments } : undefined,
  };
}
