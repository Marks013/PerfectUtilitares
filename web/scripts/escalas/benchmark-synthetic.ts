/** Bounded, reproducible synthetic benchmark; no database writes or production service changes. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { loadavg } from "node:os";
import { newEmployee, newInput } from "../../src/components/escalas/workspace-model";
import { prepareGeneration } from "../../src/lib/escalas/generation";
import { validateEscala } from "../../src/lib/escalas/validation";
import { dateRange } from "../../src/lib/escalas/dates";
import { escalaInputSchema } from "../../src/lib/escalas/schema";
import type { EscalaInput, EscalaSolveResult } from "../../src/lib/escalas/types";
import { independentShortage, weekendMetrics } from "./benchmark-metrics";
import { BASELINE_REVISION, benchmarkPython, sourceSnapshot, quantile } from "./benchmark-runtime";

type Variant = "baseline" | "corrected" | "workers2" | "linearization1" | "symmetry1";
type Scenario = { id: string; people: number; weeks: number };
const scenarios: Scenario[] = [
  { id: "team-10-week", people: 10, weeks: 1 },
  { id: "branch-50-four-weeks", people: 50, weeks: 4 },
  { id: "branch-115-six-weeks", people: 115, weeks: 6 },
];
let activeContainer: string | undefined;
function capture(args: string[], input?: string) {
  const result = spawnSync("docker", args, { input, encoding: "utf8", timeout: 35_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error("BENCHMARK_PROCESS_FAILED");
  return result.stdout;
}
function cleanup() {
  if (activeContainer) spawnSync("docker", ["stop", "--time", "2", activeContainer], { stdio: "ignore", timeout: 5000 });
  activeContainer = undefined;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { cleanup(); process.exit(130); });

function syntheticInput(scenario: Scenario) {
  const input = newInput("SYNTH", "Synthetic benchmark", "2026-11", 42);
  input.startDate = "2026-11-02";
  input.endDate = new Date(Date.parse(input.startDate + "T12:00:00Z") + (scenario.weeks * 7 - 1) * 86400000).toISOString().slice(0, 10);
  delete input.visibleMonth;
  // Explicitly synthetic calendar: no external demand or locality facts are inferred.
  input.policy.calendarMode = "MANUAL";
  input.policy.holidayDates = [];
  input.policy.closedDates = [];
  input.shifts = [{ id: "reference", name: "Synthetic 44h reference", segments: [
    { start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" },
    { start: 780, end: 1068, kind: "WORK" },
  ] }];
  input.employees = Array.from({ length: scenario.people }, (_, index) => ({
    ...newEmployee(42, "reference"), id: `person-${index}`, registration: String(index), name: `Synthetic person ${index}`,
    sector: `Sector ${Math.floor(index / 12) + 1}`, role: index % 12 === 0 ? "Encarregado" : "Repositor",
    activeFrom: "", scheduleMode: "TIMED" as const,
    sourceSchedule: { report: "FPRE136" as const, code: "SYNTHETIC", description: "Synthetic imported reference",
      weekday: "07:00-11:00 / 13:00-17:48", saturday: "07:00-11:00 / 00:00-00:00" },
  }));
  return escalaInputSchema.parse(prepareGeneration(input).input);
}

function operationalMetrics(input: EscalaInput, baseline: EscalaInput) {
  const entries = new Map(input.assignments.map(item => [`${item.employeeId}\0${item.date}`, item]));
  let collectiveRestDays = 0, leaderMissingDays = 0;
  for (const sector of new Set(input.employees.map(person => person.sector))) {
    const people = input.employees.filter(person => person.sector === sector && person.planningEnabled !== false);
    const leaders = people.filter(person => /ENCARREGAD|^ENC[. ]|GERENTE/i.test(person.role));
    for (const day of dateRange(input.startDate, input.endDate)) {
      if (input.policy.closedDates.includes(day)) continue;
      const available = people.filter(person => (!person.activeFrom || person.activeFrom <= day)
        && (!person.activeUntil || person.activeUntil >= day) && entries.get(`${person.id}\0${day}`)?.kind !== "ABSENCE");
      if (available.length >= 2 && available.every(person => entries.get(`${person.id}\0${day}`)?.kind === "OFF")) collectiveRestDays++;
      const availableLeaders = leaders.filter(person => entries.get(`${person.id}\0${day}`)?.kind !== "ABSENCE");
      if (availableLeaders.length && availableLeaders.every(person => !["WORK", "DUTY"].includes(entries.get(`${person.id}\0${day}`)?.kind || ""))) leaderMissingDays++;
    }
  }
  const original = new Map(baseline.assignments.map(item => [`${item.employeeId}\0${item.date}`, item]));
  const changed = input.assignments.filter(item => {
    const previous = original.get(`${item.employeeId}\0${item.date}`);
    return previous && (previous.kind !== item.kind || previous.shiftId !== item.shiftId);
  });
  return { collectiveRestDays, leaderMissingDays, changedDays: changed.length,
    changedPeople: new Set(changed.map(item => item.employeeId)).size };
}

async function main() {
  const payload = process.stdin.isTTY ? {} : JSON.parse(readFileSync(0, "utf8") || "{}");
  const repeats = Math.max(5, Math.min(20, Number(payload.repeats) || 5));
  const selected = payload.scenarios ? scenarios.filter(item => payload.scenarios.includes(item.id)) : scenarios;
  if (!selected.length) throw new Error("BENCHMARK_SCENARIO_FAILED");
  const requested: Variant[] = payload.variants || ["baseline", "corrected", "workers2", "linearization1", "symmetry1"];
  if (!requested.length || !requested.every(name => ["baseline", "corrected", "workers2", "linearization1", "symmetry1"].includes(name)))
    throw new Error("BENCHMARK_VARIANT_FAILED");
  const image = JSON.parse(capture(["image", "inspect", process.env.ESCALAS_BENCHMARK_IMAGE || "web-escalas-solver:latest"]))[0].Id as string;
  const snapshots = { baseline: sourceSnapshot(BASELINE_REVISION), corrected: sourceSnapshot() };
  const observations: { scenario: string; variant: Variant; seconds: number; rss: number; shortage: number | null }[] = [];
  for (const scenario of selected) {
    const input = syntheticInput(scenario);
    let comparison: EscalaInput | undefined;
    for (let repetition = -1; repetition < repeats; repetition++) {
      // Rotate order to avoid consistently favouring the first warmed implementation.
      const offset = (repetition + 1) % requested.length;
      const order = [...requested.slice(offset), ...requested.slice(0, offset)];
      for (const variant of order) {
        const snapshot = variant === "baseline" ? snapshots.baseline : snapshots.corrected;
        const workers = variant === "workers2" ? 2 : 1;
        const linearization = variant === "linearization1" ? 1 : 0;
        const symmetry = variant === "symmetry1" ? 1 : 0;
        activeContainer = "escalas-benchmark-" + randomUUID();
        const output = capture(["run", "--rm", "--pull=never", "--name", activeContainer, "--read-only", "--network", "none",
          "--cpus", String(workers), "--memory", "1536m", "--pids-limit", "96", "--env", "PYTHONDONTWRITEBYTECODE=1",
          "--env", `ESCALAS_SOLVER_WORKERS=${workers}`, "--env", `ESCALAS_SOLVER_LINEARIZATION=${linearization}`,
          "--env", `ESCALAS_SOLVER_SYMMETRY=${symmetry}`, "--workdir", "/app", "--entrypoint", "python", "-i", image,
          "-B", "-c", benchmarkPython], JSON.stringify({ ...snapshot, input }));
        activeContainer = undefined;
        const solved = JSON.parse(output) as { result: EscalaSolveResult; calls: object[]; maxRssKiB: number };
        const feasible = ["FEASIBLE", "OPTIMAL"].includes(solved.result.status);
        if (!feasible) throw new Error("BENCHMARK_EXPECTED_FEASIBLE_INPUT");
        const proposal = { ...input, assignments: solved.result.assignments };
        if (repetition < 0) {
          if (!comparison || variant === "baseline") comparison = proposal;
          continue;
        }
        if (!comparison) throw new Error("BENCHMARK_COMPARISON_MISSING");
        const validation = feasible ? validateEscala(proposal) : undefined;
        const deficits = feasible ? independentShortage(proposal) : undefined;
        const errors = validation?.issues.filter(issue => issue.severity === "ERROR").map(issue => issue.code) || [];
        observations.push({ scenario: scenario.id, variant, seconds: solved.result.wallTimeSeconds,
          rss: solved.maxRssKiB, shortage: deficits?.total ?? null });
        console.log(JSON.stringify({ kind: "measurement", scenario: scenario.id, variant, repetition,
          baselineRevision: BASELINE_REVISION, sourceHash: snapshot.hash, sourceHashes: snapshot.hashes, image,
          resources: { workers, cpus: workers, memoryMiB: 1536, linearization, symmetry }, hostLoad1m: loadavg()[0],
          status: solved.result.status, seconds: solved.result.wallTimeSeconds, maxRssKiB: solved.maxRssKiB,
          calls: solved.calls.length, phases: solved.result.optimization?.phases,
          shortagePersonMinutes: deficits?.total ?? null, shortageBySector: deficits?.bySector,
          ...(feasible ? { ...weekendMetrics(proposal), ...operationalMetrics(proposal, comparison) } : {}),
          errors: [...new Set(errors)] }));
        if (errors.length) throw new Error("BENCHMARK_INDEPENDENT_VALIDATION_FAILED");
      }
    }
  }
  if (sourceSnapshot().hash !== snapshots.corrected.hash) throw new Error("BENCHMARK_SOURCE_CHANGED");
  for (const scenario of selected) for (const variant of requested) {
    const rows = observations.filter(item => item.scenario === scenario.id && item.variant === variant);
    console.log(JSON.stringify({ kind: "summary", scenario: scenario.id, variant, samples: rows.length,
      medianSeconds: quantile(rows.map(item => item.seconds), .5), p95Seconds: quantile(rows.map(item => item.seconds), .95),
      peakRssKiB: Math.max(...rows.map(item => item.rss)),
      medianShortage: quantile(rows.flatMap(item => item.shortage === null ? [] : [item.shortage]), .5),
      nonFeasible: rows.filter(item => item.shortage === null).length }));
  }
}
main().catch(() => { cleanup(); console.error("Synthetic benchmark failed. No production data or services were changed."); process.exitCode = 1; });
