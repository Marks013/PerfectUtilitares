/** Real importer benchmark. Private CSV contents and rosters never leave process memory. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
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
  for (const demand of input.demands) {
    if (!demand.estimated || !demand.minimum) continue;
    const midnight = Date.parse(demand.date + "T00:00:00-03:00") / 60000;
    const start = midnight + demand.start, end = midnight + demand.end;
    const matches = records.filter(item => item.sector === demand.sector && (!demand.role || item.role === demand.role) && item.start < end && item.end > start);
    const edges = [...new Set([start, end, ...matches.flatMap(item => [Math.max(start, item.start), Math.min(end, item.end)])])].sort((a, b) => a - b);
    for (let index = 1; index < edges.length; index++) {
      const left = edges[index - 1], right = edges[index];
      const count = new Set(matches.filter(item => item.start <= left && item.end >= right).map(item => item.id)).size;
      shortage += (right - left) * Math.max(0, demand.minimum - count);
    }
  }
  return shortage;
}

function weekendMetrics(input: EscalaInput) {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const groups = new Map<string, { saturday: number; sunday: number }[]>();
  for (const person of input.employees.filter(person => person.planningEnabled !== false)) {
    const assignments = input.assignments.filter(item => item.employeeId === person.id);
    const occupied = new Set<string>();
    for (const item of assignments) {
      if (item.kind === "DUTY") occupied.add(item.date);
      if (item.kind !== "WORK") continue;
      for (const segment of shifts.get(item.shiftId || "")?.segments || []) {
        if (segment.kind === "BREAK") continue;
        for (let offset = Math.floor(segment.start / 1440); offset <= Math.floor((segment.end - 1) / 1440); offset++)
          occupied.add(new Date(Date.parse(item.date + "T12:00:00Z") + offset * 86400000).toISOString().slice(0, 10));
      }
    }
    const score = (weekday: number) => {
      const available = assignments.filter(item => new Date(item.date + "T12:00:00Z").getUTCDay() === weekday && item.kind !== "ABSENCE");
      return Math.floor(10000 * available.filter(item => occupied.has(item.date)).length / Math.max(1, available.length));
    };
    const key = JSON.stringify([person.sector, ["MISSING", "UNTIMED"].includes(person.scheduleMode || ""), person.weeklyHours,
      Math.min(person.maxConsecutiveSundays, person.sundayRestRule === "COMMERCE" ? 2 : 1)]);
    const group = groups.get(key) || [];
    group.push({ saturday: score(6), sunday: score(0) });
    groups.set(key, group);
  }
  const spread = (key: "saturday" | "sunday") => [...groups.values()].reduce((sum, group) => sum + Math.max(...group.map(item => item[key])) - Math.min(...group.map(item => item[key])), 0);
  return { saturdayRateSpread: spread("saturday"), sundayRateSpread: spread("sunday") };
}

const python = String.raw`import sys,json,time,types
from ortools.sat.python import cp_model
request=json.load(sys.stdin)
module=types.ModuleType('benchmark_solver')
exec(compile(request['source'],'benchmark_solver','exec'),module.__dict__)
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
  const repeats = Math.max(1, Math.min(3, Number(payload.repeats) || 2));
  const branches: string[] = payload.branches || ["02", "06", "07", "08", "11", "16", "18"];
  if (!branches.every(branch => /^\d{2}$/.test(branch))) throw new Error("BENCHMARK_BRANCH_FAILED");
  const image = JSON.parse(capture(["image", "inspect", "web-escalas-solver:latest"]))[0].Id as string;
  const sources = {
    baseline: spawnSync("git", ["show", "43e28c5:web/ops/escalas/solver.py"], { encoding: "utf8" }).stdout,
    corrected: readFileSync("ops/escalas/solver.py", "utf8"),
  };
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
    input.employees = input.employees.map((person, index) => ({ ...person, name: "Person " + index, registration: String(index) }));
    for (let repetition = 0; repetition < repeats; repetition++) for (const variant of Object.keys(sources) as (keyof typeof sources)[]) {
      activeContainer = "escalas-benchmark-" + randomUUID();
      const output = capture(["run", "--rm", "--name", activeContainer, "--read-only", "--network", "none", "--cpus", "2", "--memory", "1g", "--pids-limit", "96",
        "--env", "PYTHONDONTWRITEBYTECODE=1", "--volume", root + "/ops/escalas:/model:ro", "--workdir", "/model", "--entrypoint", "python", "-i", image, "-B", "-c", python],
        JSON.stringify({ source: sources[variant], input }));
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
      console.log(JSON.stringify({ branch, variant, repetition, ...facts, status: solved.result.status, seconds: solved.result.wallTimeSeconds,
        calls: solved.calls.length, firstSolveAt: solved.calls[0]?.at, phases: solved.result.optimization?.phases,
        shortagePersonMinutes: feasible ? independentShortage(candidate) : null, ...(feasible ? weekendMetrics(candidate) : {}),
        changedDays: changed.length, changedPeople: new Set(changed.map(item => item.employeeId)).size, preferencePenalty: preferences,
        partialWeekPending: checked?.issues.filter(issue => issue.code === "PARTIAL_WEEK_PENDING").length || 0,
        preservedAbsences: input.assignments.filter(item => item.kind === "ABSENCE").every(old => candidate.assignments.some(item => item.employeeId === old.employeeId && item.date === old.date && item.kind === "ABSENCE")),
        errors: [...new Set(errors)] }));
    }
  }
}
main().catch(() => { cleanup(); console.error("Benchmark failed without exposing private input. Check the environment and input contract."); process.exitCode = 1; });
