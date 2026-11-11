/** Real importer benchmark. Private CSV contents and rosters never leave process memory. */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { loadavg } from "node:os";
import { pathToFileURL } from "node:url";
import { BASELINE_REVISION, benchmarkPython as python, sourceSnapshot } from "./benchmark-runtime";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { previewEscalaImport } from "../../src/lib/escalas/import";
import { previewFphi105Import } from "../../src/lib/escalas/fphi105";
import { prepareGeneration } from "../../src/lib/escalas/generation";
import { escalaInputSchema } from "../../src/lib/escalas/schema";
import { validateEscala } from "../../src/lib/escalas/validation";
import { newInput, changeBranchWeeklyHours } from "../../src/components/escalas/workspace-model";
import type { EscalaInput, EscalaSolveResult } from "../../src/lib/escalas/types";

import { independentShortage, weekendMetrics } from "./benchmark-metrics";

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


async function main() {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const buffer = Buffer.from(payload.fpreBase64, "base64");
  const absences = payload.fphiBase64 ? Buffer.from(payload.fphiBase64, "base64") : undefined;
  const repeats = Math.max(5, Math.min(20, Number(payload.repeats) || 5));
  const branches: string[] = payload.branches || ["02", "06", "07", "08", "11", "16", "18"];
  if (!branches.every(branch => /^\d{2}$/.test(branch))) throw new Error("BENCHMARK_BRANCH_FAILED");
  const image = JSON.parse(capture(["image", "inspect", "web-escalas-solver:latest"]))[0].Id as string;
  const sources = {
    baseline: sourceSnapshot(BASELINE_REVISION),
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
    for (let repetition = -1; repetition < repeats; repetition++) {
      const order: (keyof typeof sources)[] = (Number(branch) + repetition) % 2 ? ["corrected", "baseline"] : ["baseline", "corrected"];
      for (const variant of order) {
      activeContainer = "escalas-benchmark-" + randomUUID();
      const output = capture(["run", "--rm", "--name", activeContainer, "--read-only", "--network", "none", "--cpus", "1", "--memory", "1536m", "--pids-limit", "64",
        "--env", "PYTHONDONTWRITEBYTECODE=1", "--workdir", "/app", "--entrypoint", "python", "-i", image, "-B", "-c", python],
        JSON.stringify({ ...sources[variant], input }));
      activeContainer = undefined;
      const solved = JSON.parse(output) as { result: EscalaSolveResult; calls: { at: number; status: string; seconds: number }[] };
      if (repetition < 0) continue; // One warmup per implementation and scenario, never included in statistics.
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
      console.log(JSON.stringify({ branch, variant, repetition, runOrdinal: runOrdinal++, baselineRevision: BASELINE_REVISION, sourceHash: sources[variant].hash, sourceHashes: sources[variant].hashes,
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { cleanup(); console.error("Benchmark failed without exposing private input. Check the environment and input contract."); process.exitCode = 1; });
}
