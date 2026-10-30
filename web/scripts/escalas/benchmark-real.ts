/** Real importer benchmark. Private CSV contents and rosters never leave process memory. */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { loadavg } from "node:os";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { previewEscalaImport } from "../../src/lib/escalas/import";
import { previewFphi105Import } from "../../src/lib/escalas/fphi105";
import { prepareGeneration } from "../../src/lib/escalas/generation";
import { escalaInputSchema } from "../../src/lib/escalas/schema";
import { validateEscala } from "../../src/lib/escalas/validation";
import { newInput, changeBranchWeeklyHours } from "../../src/components/escalas/workspace-model";
import type { EscalaInput, EscalaSolveResult } from "../../src/lib/escalas/types";

const root = process.cwd();
let activeContainer: string | undefined;
function capture(args: string[], input?: string) {
  const result = spawnSync("docker", args, { cwd: root, input, encoding: "utf8", timeout: 35_000, maxBuffer: 12 * 1024 * 1024 });
  if (result.status !== 0 || result.error) throw new Error("BENCHMARK_PROCESS_FAILED");
  return result.stdout;
}
function cleanup() {
  if (activeContainer) spawnSync("docker", ["stop", "--time", "2", activeContainer], { stdio: "ignore", timeout: 5000 });
  activeContainer = undefined;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { cleanup(); process.exit(130); });

function independentShortage(input: EscalaInput) {
  const people = new Map(input.employees.map(person => [person.id, person]));
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const records: { id: string; sector: string; role: string; start: number; end: number }[] = [];
  for (const item of input.assignments) {
    if (item.kind !== "WORK") continue;
    const person = people.get(item.employeeId), shift = shifts.get(item.shiftId || "");
    if (!person || !shift) throw new Error("BENCHMARK_REFERENCE_FAILED");
    const midnight = Date.parse(item.date + "T00:00:00-03:00") / 60000;
    for (const segment of shift.segments) if (segment.kind === "WORK")
      records.push({ id: person.id, sector: person.sector, role: person.role, start: midnight + segment.start, end: midnight + segment.end });
  }
  let shortage = 0;
  const bySector: Record<string, number> = {};
  for (const demand of input.demands) {
    if (!demand.estimated || !demand.minimum) continue;
    const midnight = Date.parse(demand.date + "T00:00:00-03:00") / 60000;
    const start = midnight + demand.start, end = midnight + demand.end;
    const matches = records.filter(item => item.sector === demand.sector && (!demand.role || item.role === demand.role) && item.start < end && item.end > start);
    const edges = [...new Set([start, end, ...matches.flatMap(item => [Math.max(start, item.start), Math.min(end, item.end)])])].sort((a, b) => a - b);
    for (let index = 1; index < edges.length; index++) {
      const left = edges[index - 1], right = edges[index];
      const count = new Set(matches.filter(item => item.start <= left && item.end >= right).map(item => item.id)).size;
      const deficit = (right - left) * Math.max(0, demand.minimum - count);
      shortage += deficit;
      bySector[demand.sector] = (bySector[demand.sector] || 0) + deficit;
    }
  }
  return { total: shortage, bySector };
}

function weekendMetrics(input: EscalaInput) {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const groups = new Map<string, { sector: string; saturday?: number; sunday?: number }[]>();
  const firstHistoryDay = new Date(Date.parse(input.startDate + "T12:00:00Z") - 21 * 86400000).toISOString().slice(0, 10);
  const weekdayOf = (day: string) => new Date(day + "T12:00:00Z").getUTCDay();
  for (const person of input.employees.filter(person => person.planningEnabled !== false)) {
    const assignments = input.assignments.filter(item => item.employeeId === person.id);
    const prior = [...new Map([...(person.planningHistory || []), ...person.history].map(item => [item.date, item])).values()];
    const occupied = (entries: typeof assignments) => {
      const dates = new Set<string>();
      for (const item of entries) {
        if (item.kind === "DUTY") dates.add(item.date);
        if (item.kind !== "WORK") continue;
        for (const segment of shifts.get(item.shiftId || "")?.segments || []) {
          if (segment.kind === "BREAK") continue;
          for (let offset = Math.floor(segment.start / 1440); offset <= Math.floor((segment.end - 1) / 1440); offset++)
            dates.add(new Date(Date.parse(item.date + "T12:00:00Z") + offset * 86400000).toISOString().slice(0, 10));
        }
      }
      return dates;
    };
    const currentOccupied = occupied(assignments), priorOccupied = occupied(prior);
    const score = (weekday: number) => {
      const pythonWeekday = (weekday + 6) % 7;
      const available = assignments.filter(item => weekdayOf(item.date) === weekday && item.kind !== "ABSENCE"
        && !(item.kind === "OFF" && item.locked) && !person.fixedOffDays.includes(pythonWeekday)
        && !input.policy.closedDates.includes(item.date)
        && !(input.policy.holidayDates.includes(item.date) && !input.policy.authorizedHolidayDates.includes(item.date) && !input.simulation));
      if (!available.length) return undefined;
      const historicWork = [...priorOccupied].filter(day => firstHistoryDay <= day && day < input.startDate && weekdayOf(day) === weekday);
      const known = new Set([...prior.filter(item => firstHistoryDay <= item.date && item.date < input.startDate
        && weekdayOf(item.date) === weekday && ["WORK", "DUTY", "OFF"].includes(item.kind)).map(item => item.date), ...historicWork]);
      return Math.floor(10000 * (available.filter(item => currentOccupied.has(item.date)).length + historicWork.length) / (available.length + known.size));
    };
    const untimed = ["MISSING", "UNTIMED"].includes(person.scheduleMode || "");
    const key = JSON.stringify([person.sector, untimed, untimed ? [] : person.weeklyHours,
      Math.min(person.maxConsecutiveSundays, person.sundayRestRule === "COMMERCE" ? 2 : 1)]);
    const group = groups.get(key) || [];
    group.push({ sector: person.sector, saturday: score(6), sunday: score(0) });
    groups.set(key, group);
  }
  const spread = (key: "saturday" | "sunday") => [...groups.values()].reduce((sum, group) => {
    const scores = group.map(item => item[key]).filter((value): value is number => value !== undefined);
    return sum + (scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0);
  }, 0);
  const sectors: Record<string, number> = {};
  for (const group of groups.values()) {
    const scores = group.map(item => item.sunday).filter((value): value is number => value !== undefined);
    sectors[group[0].sector] = (sectors[group[0].sector] || 0) + (scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0);
  }
  return { saturdayRateSpread: spread("saturday"), sundayRateSpread: spread("sunday"), sectorSundayRateSpreads: sectors };
}

function sourceSnapshot(revision?: string) {
  const modules = revision ? ["hints", "optimization", "solver"] : ["hints", "optimization", "candidate_optimization", "weekend_balance", "solver"];
  const sources: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  for (const name of modules) {
    const path = "ops/escalas/" + (!revision && name === "solver" ? "candidate_solver" : name) + ".py";
    if (revision) {
      const result = spawnSync("git", ["show", revision + ":web/" + path], { cwd: root, encoding: "utf8" });
      if (result.status !== 0 || result.error || !result.stdout) throw new Error("BENCHMARK_SOURCE_FAILED");
      sources[name] = result.stdout;
    } else sources[name] = readFileSync(path, "utf8");
    hashes[name] = createHash("sha256").update(sources[name]).digest("hex");
  }
  if (!revision) for (const name of modules)
    if (createHash("sha256").update(readFileSync("ops/escalas/" + (name === "solver" ? "candidate_solver" : name) + ".py", "utf8")).digest("hex") !== hashes[name])
      throw new Error("BENCHMARK_SOURCE_CHANGED");
  return { sources, hashes };
}

const python = String.raw`import sys,json,time,types
from ortools.sat.python import cp_model
request=json.load(sys.stdin)
for name,source in request['sources'].items():
    module=types.ModuleType(name)
    sys.modules[name]=module
    exec(compile(source,name+'.py','exec'),module.__dict__)
module=sys.modules['solver']
native=cp_model.CpSolver.solve
calls=[]
started=time.monotonic()
def traced(self,model,*args,**kwargs):
    before=time.monotonic()
    status=native(self,model,*args,**kwargs)
    calls.append({'at':round(before-started,3),'status':self.status_name(status),'seconds':round(time.monotonic()-before,3)})
    return status
cp_model.CpSolver.solve=traced
result=module.solve(request['input'])
print(json.dumps({'result':result,'calls':calls}))`;

async function main() {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const buffer = Buffer.from(payload.fpreBase64, "base64");
  const absences = payload.fphiBase64 ? Buffer.from(payload.fphiBase64, "base64") : undefined;
  const repeats = payload.calibration === true ? Math.max(1, Math.min(3, Number(payload.repeats) || 1)) : Math.max(10, Math.min(20, Number(payload.repeats) || 10));
  const branches: string[] = payload.branches || ["02", "06", "07", "08", "11", "16", "18"];
  if (!branches.every(branch => /^\d{2}$/.test(branch))) throw new Error("BENCHMARK_BRANCH_FAILED");
  const image = JSON.parse(capture(["image", "inspect", "web-escalas-solver:latest"]))[0].Id as string;
  const sources = {
    baseline: sourceSnapshot("2b1ea26"),
    corrected: sourceSnapshot(),
  };
  let runOrdinal = 0;
  for (const branch of branches) {
    const initial = newInput(branch, "Filial " + branch, "2026-11", 44);
    const preview = await previewEscalaImport(buffer, "csv", { startDate: initial.startDate, defaultWeeklyHours: 44, branchCode: branch });
    let input = changeBranchWeeklyHours({ ...initial, employees: preview.employees, shifts: preview.shifts }, 42);
    const leaves = absences ? previewFphi105Import(absences, { ...input, employees: input.employees }) : undefined;
    if (leaves) input = { ...input, assignments: leaves.assignments };
    input = escalaInputSchema.parse(prepareGeneration(input).input);
    const nightReferences = input.employees.filter(person => person.sourceSchedule?.weekday.includes("22:10"));
    const facts = { people: input.employees.length, excluded: input.employees.filter(person => person.planningEnabled === false).length,
      missingClocks: input.employees.filter(person => ["MISSING", "UNTIMED"].includes(person.scheduleMode || "")).length,
      source2210: nightReferences.length, included2210: nightReferences.filter(person => person.planningEnabled !== false).length,
      absenceDays: input.assignments.filter(item => item.kind === "ABSENCE").length, matchedAbsenceRows: leaves?.counts.matchedRows || 0 };
    // Keep constraints and roles; remove personal identifiers before the solver subprocess.
    const identifiers = new Map(input.employees.map((person, index) => [person.id, "person-" + index]));
    const anonymize = (item: EscalaInput["assignments"][number]) => ({ ...item, employeeId: identifiers.get(item.employeeId) || item.employeeId });
    input = { ...input, assignments: input.assignments.map(anonymize), employees: input.employees.map((person, index) => ({
      ...person, id: identifiers.get(person.id) as string, name: "Person " + index, registration: String(index),
      history: person.history.map(anonymize), planningHistory: person.planningHistory?.map(anonymize), planningFuture: person.planningFuture?.map(anonymize),
    })) };
    for (let repetition = 0; repetition < repeats; repetition++) {
      const order: (keyof typeof sources)[] = (Number(branch) + repetition) % 2 ? ["corrected", "baseline"] : ["baseline", "corrected"];
      for (const variant of order) {
      activeContainer = "escalas-benchmark-" + randomUUID();
      const output = capture(["run", "--rm", "--name", activeContainer, "--read-only", "--network", "none", "--cpus", "1", "--memory", "1536m", "--pids-limit", "64",
        "--env", "PYTHONDONTWRITEBYTECODE=1", "--workdir", "/app", "--entrypoint", "python", "-i", image, "-B", "-c", python],
        JSON.stringify({ sources: sources[variant].sources, input }));
      activeContainer = undefined;
      const solved = JSON.parse(output) as { result: EscalaSolveResult; calls: { at: number; status: string; seconds: number }[] };
      const candidate = { ...input, assignments: solved.result.assignments };
      const feasible = ["OPTIMAL", "FEASIBLE"].includes(solved.result.status);
      const checked = feasible ? validateEscala(candidate) : undefined;
      const errors = checked?.issues.filter(issue => issue.severity === "ERROR").map(issue => issue.code) || [];
      const before = new Map(input.assignments.map(item => [item.employeeId + item.date, item]));
      const changed = candidate.assignments.filter(item => {
        const old = before.get(item.employeeId + item.date);
        return old && old.kind !== "ABSENCE" && (old.kind !== item.kind || old.shiftId !== item.shiftId);
      });
      const preferences = candidate.assignments.filter(item => ["WORK", "DUTY"].includes(item.kind) && input.employees.find(person => person.id === item.employeeId)?.preferredOffDays.includes((new Date(item.date + "T12:00:00Z").getUTCDay() + 6) % 7)).length;
      const deficits = feasible ? independentShortage(candidate) : undefined;
      console.log(JSON.stringify({ branch, variant, repetition, runOrdinal: runOrdinal++, baselineRevision: "2b1ea26", calibration: payload.calibration === true, sourceHashes: sources[variant].hashes,
        resources: { cpus: 1, memoryMiB: 1536, pids: 64 }, image, hostLoad1m: loadavg()[0], ...facts, status: solved.result.status, seconds: solved.result.wallTimeSeconds,
        calls: solved.calls.length, firstSolveAt: solved.calls[0]?.at, phases: solved.result.optimization?.phases,
        shortagePersonMinutes: deficits?.total ?? null, shortageBySector: deficits?.bySector, ...(feasible ? weekendMetrics(candidate) : {}),
        changedDays: changed.length, changedPeople: new Set(changed.map(item => item.employeeId)).size, preferencePenalty: preferences,
        partialWeekPending: checked?.issues.filter(issue => issue.code === "PARTIAL_WEEK_PENDING").length || 0,
        preservedAbsences: input.assignments.filter(item => item.kind === "ABSENCE").every(old => candidate.assignments.some(item => item.employeeId === old.employeeId && item.date === old.date && item.kind === "ABSENCE")),
        errors: [...new Set(errors)] }));
      }
    }
  }
}
main().catch(() => { cleanup(); console.error("Benchmark failed without exposing private input. Check the environment and input contract."); process.exitCode = 1; });
