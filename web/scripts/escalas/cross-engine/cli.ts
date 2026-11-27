/** E1 exploratory baseline/cross-engine harness. Run from web/ on an isolated runner. */
import { arch } from "node:os";
import { isHoursReferenceOnly } from "../../../src/lib/escalas/hours-reference";
import { compareRosterCoverage } from "../../../src/lib/escalas/roster-quality";
import { makeScenario, scenarioIds, type ScenarioId } from "./fixtures";
import { captureEnvelope, digest, envelopeProfile, measureReferences, pairOrder, runTrial } from "./core";
import { baselineRevision, dockerAdapter, inspectImage, resources, validateBaselineEnvelope } from "./docker";
import { currentBenchmarkSource } from "./solverforge-source";
import { quantile } from "../benchmark-runtime";

function checkSource() {
  return currentBenchmarkSource(baselineRevision);
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
    console.log(JSON.stringify({ kind: "summary", ...metadata, engine, samples: trials.length,
      engineNew: successes.length, acceptedNew: trials.filter(row => row.acceptedNew).length,
      validTimely: trials.filter(row => row.timely && row.finalAssessment?.valid && !row.errorCode && row.finalAssessment.comparison?.regressed !== true).length,
      notEngineNew: trials.length - successes.length, rejectedRawFeasible: trials.filter(row => row.rawStatus === "FEASIBLE" || row.rawStatus === "OPTIMAL").filter(row => !row.rawAssessment?.valid).length,
      maxProductSeconds: Math.max(...trials.map(row => row.productSeconds)),
      medianEstimatedShortage: quantile(successes.flatMap(row => row.finalAssessment?.metrics?.shortagePersonMinutes ?? []), .5),
      successP50Seconds: quantile(seconds, .5), successP95Seconds: seconds.length >= 30 ? quantile(seconds, .95) : null,
      tailSampleSufficient: seconds.length >= 30, decision: "EXPLORATORY_NOT_CERTIFIED" }));
    // A known negative fixture must not be judged by a positive-generation gate.
    // The maximum-load stress case records failures; it does not authorize release.
    const observationOnly = id === "december-protected" || id === "december-presence-recovery" || id === "stress-250-six-weeks";
    if (!observationOnly && !trials.some(row => row.timely && row.finalAssessment?.valid && !row.errorCode && row.finalAssessment.comparison?.regressed !== true)) process.exitCode = 1;
  }
}
main().catch((error: unknown) => {
  const code = error instanceof Error && /^(CROSS_ENGINE|FORGE)_[A-Z_]+$/.test(error.message) ? error.message : "CROSS_ENGINE_FAILED";
  console.error("Cross-engine benchmark stopped: " + code + "; no production service was targeted.");
  process.exitCode = 1;
});
