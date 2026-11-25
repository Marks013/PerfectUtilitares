/** E1 exploratory baseline/cross-engine harness. Run from web/ on an isolated runner. */
import { spawnSync } from "node:child_process";
import { arch } from "node:os";
import { isHoursReferenceOnly } from "../../../src/lib/escalas/hours-reference";
import { compareRosterCoverage } from "../../../src/lib/escalas/roster-quality";
import { makeScenario, scenarioIds, type ScenarioId } from "./fixtures";
import { captureEnvelope, digest, envelopeProfile, measureReferences, pairOrder, runTrial } from "./core";
import { baselineRevision, dockerAdapter, inspectImage, resources, validateBaselineEnvelope } from "./docker";
import { quantile } from "../benchmark-runtime";

function git(args: string[]) {
  const value = spawnSync("git", ["-C", "..", ...args], { encoding: "utf8", timeout: 5000 });
  if (value.status !== 0 || value.error) throw new Error("CROSS_ENGINE_GIT_FAILED");
  return value.stdout.trim();
}
function checkSource() {
  if (git(["status", "--porcelain", "--untracked-files=normal"])) throw new Error("CROSS_ENGINE_DIRTY_SOURCE");
  // The new test file is the sole permitted source-side change in the experimental PR.
  git(["diff", "--quiet", baselineRevision, "--", "web/src", "web/ops/escalas", "web/package-lock.json",
    "web/scripts/escalas/benchmark-metrics.ts", "web/scripts/escalas/benchmark-synthetic.ts",
    ":(exclude)web/src/lib/escalas/cross-engine.test.ts"]);
  return { revision: git(["rev-parse", "HEAD"]), evaluatorTree: git(["rev-parse", baselineRevision + ":web/src/lib/escalas"]) };
}
async function main() {
  if (process.env.ESCALAS_CROSS_ENGINE_ISOLATED !== "1") throw new Error("CROSS_ENGINE_ISOLATED_RUNNER_REQUIRED");
  const [id, repetitionText, baselineImage, candidateImage, ...rest] = process.argv.slice(2);
  const preflightOnly = repetitionText === "preflight";
  const repeats = Number(repetitionText);
  if (rest.length || !scenarioIds.includes(id as ScenarioId) || (preflightOnly ? !!candidateImage : !Number.isInteger(repeats) || repeats < 1 || repeats > 100))
    throw new Error("CROSS_ENGINE_ARGUMENTS");
  const source = checkSource();
  const scenario = makeScenario(id as ScenarioId);
  if (isHoursReferenceOnly(scenario.prepared)) {
    const result = measureReferences(scenario);
    console.log(JSON.stringify({ kind: "reference-only", scenario: id, ...source, ...result }));
    if (!result.valid || result.assignments !== 0) process.exitCode = 1;
    return;
  }
  if (!baselineImage) throw new Error("CROSS_ENGINE_BASELINE_REQUIRED");
  const identities = { ortools: inspectImage(baselineImage, "ortools"),
    timefold: candidateImage ? inspectImage(candidateImage, "timefold") : undefined };
  if (identities.timefold && identities.timefold.architecture !== identities.ortools.architecture) throw new Error("CROSS_ENGINE_ARCH_MISMATCH");
  const frozen = await captureEnvelope(scenario);
  validateBaselineEnvelope(baselineImage, frozen);
  const profile = envelopeProfile(frozen);
  if (preflightOnly) {
    console.log(JSON.stringify({ kind: "preflight", scenario: id, valid: true, inputHash: digest(frozen), profile }));
    return;
  }
  const adapters = { ortools: dockerAdapter(baselineImage, "ortools"), timefold: candidateImage ? dockerAdapter(candidateImage, "timefold") : undefined };
  const metadata = { scenario: id, baselineRevision, ...source, inputHash: digest(frozen), arch: arch(), resources, profile,
    sampleKind: "cold-container", hostCapacityMeasured: false, liveHttpMeasured: false };
  type Trial = Awaited<ReturnType<typeof runTrial>>;
  const rows: Record<"ortools" | "timefold", Trial[]> = { ortools: [], timefold: [] };
  for (let repetition = 0; repetition < repeats; repetition++) {
    const pair: Partial<Record<"ortools" | "timefold", Trial>> = {};
    for (const engine of pairOrder(repetition, Boolean(candidateImage))) {
      const adapter = adapters[engine];
      if (!adapter) throw new Error("CROSS_ENGINE_ADAPTER_MISSING");
      const trial = await runTrial(scenario, frozen, adapter);
      pair[engine] = trial;
      rows[engine].push(trial);
      const { proposal: _proposal, ...record } = trial;
      console.log(JSON.stringify({ kind: "measurement", ...metadata, engine, identity: identities[engine], repetition, ...record }));
    }
    // Same original demand ruler. Only actual complete valid proposals are comparable.
    if (pair.ortools?.proposal && pair.timefold?.proposal && pair.ortools.engineNew && pair.timefold.engineNew) {
      const comparison = compareRosterCoverage(pair.ortools.proposal, pair.timefold.proposal, pair.ortools.proposal);
      console.log(JSON.stringify({ kind: "paired-coverage", ...metadata, repetition,
        comparable: comparison.comparable, regressed: comparison.regressed, improved: comparison.improved, reason: comparison.reason }));
    } else if (candidateImage) console.log(JSON.stringify({ kind: "paired-coverage", ...metadata, repetition, comparable: false }));
  }
  if (checkSource().revision !== source.revision) throw new Error("CROSS_ENGINE_SOURCE_CHANGED");
  for (const engine of ["ortools", "timefold"] as const) {
    const trials = rows[engine];
    if (!trials.length) continue;
    const successes = trials.filter(row => row.engineNew);
    const seconds = successes.flatMap(row => row.productSeconds);
    const samples = trials.flatMap(row => row.cgroup ? [row.cgroup] : []);
    console.log(JSON.stringify({ kind: "summary", ...metadata, engine, samples: trials.length,
      engineNew: successes.length, acceptedNew: trials.filter(row => row.acceptedNew).length,
      validTimely: trials.filter(row => row.timely && row.finalAssessment?.valid && !row.errorCode && row.finalAssessment.comparison?.regressed !== true).length,
      notEngineNew: trials.length - successes.length, rejectedRawFeasible: trials.filter(row => row.rawStatus === "FEASIBLE" || row.rawStatus === "OPTIMAL").filter(row => !row.rawAssessment?.valid).length,
      maxProductSeconds: Math.max(...trials.map(row => row.productSeconds)),
      cgroupSamples: samples.length,
      medianContainerCpuSeconds: quantile(samples.map(s => s.cpuUsageUsec / 1_000_000), .5),
      maxContainerMemoryPeakBytes: samples.length ? Math.max(...samples.map(s => s.memoryPeakBytes)) : null,
      medianEstimatedShortage: quantile(successes.flatMap(row => row.finalAssessment?.metrics?.shortagePersonMinutes ?? []), .5),
      medianNormalizedEstimatedShortage: quantile(successes.flatMap(row => row.finalAssessment?.metrics?.normalizedEstimatedShortage ?? []), .5),
      successP50Seconds: quantile(seconds, .5), successP95Seconds: seconds.length >= 30 ? quantile(seconds, .95) : null,
      tailSampleSufficient: seconds.length >= 30, decision: "EXPLORATORY_NOT_CERTIFIED" }));
    // A known negative fixture must not be judged by a positive-generation gate.
    // The maximum-load stress case records failures; it does not authorize release.
    const observationOnly = id === "december-protected" || id === "december-presence-recovery" || id === "stress-250-six-weeks";
    if (!observationOnly && !trials.some(row => row.timely && row.finalAssessment?.valid && !row.errorCode && row.finalAssessment.comparison?.regressed !== true)) process.exitCode = 1;
  }
}
main().catch((error: unknown) => {
  const code = error instanceof Error && /^CROSS_ENGINE_[A-Z_]+$/.test(error.message) ? error.message : "CROSS_ENGINE_FAILED";
  console.error("Cross-engine benchmark stopped: " + code + "; no production service was targeted.");
  process.exitCode = 1;
});
