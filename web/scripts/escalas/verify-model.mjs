/** Run with node --import tsx scripts/escalas/verify-model.mjs <python-executable>. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateEscala } from "../../src/lib/escalas/validation.ts";

const python = process.argv[2];
if (!python) throw new Error("Informe o Python com OR-Tools instalado.");
const result = spawnSync(python, ["test_solver.py", "--fixture"], {
  cwd: fileURLToPath(new URL("../../ops/escalas/", import.meta.url)),
  encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
});
if (result.error || result.status !== 0) throw new Error("A execução do cenário de referência falhou.");
const { input, result: solved } = JSON.parse(result.stdout);
if (!["FEASIBLE", "OPTIMAL"].includes(solved.status)) throw new Error(`Resultado inesperado: ${solved.status}`);
const validation = validateEscala({ ...input, assignments: solved.assignments });
if (!validation.readyToPublish) {
  console.error(JSON.stringify({ ready: false, issues: validation.issues.map(({ code, date }) => ({ code, date })) }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ready: true, status: solved.status, employees: validation.summaries.length,
    assignments: solved.assignments.length, minimumCoverageMargin: validation.minimumCoverageMargin,
    totalMinutes: validation.summaries.reduce((sum, person) => sum + person.workedMinutes, 0) }));
}
