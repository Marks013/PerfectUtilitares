/** Historical model ablation and same-JVM diagnostic. Synthetic only. */
import { spawnSync } from "node:child_process";
import { arch } from "node:os";
import { makeScenario } from "./fixtures";
import { captureEnvelope, digest, envelopeProfile, runTrial } from "./core";
import { baselineRevision, dockerAdapter, inspectImage, resources, validateBaselineEnvelope, warmTimefoldBatch } from "./docker";
import { compareRosterCoverage, selectVerifiedRoster, type RosterSelectionReason } from "../../../src/lib/escalas/roster-quality";
import { quantile } from "../benchmark-runtime";

const controls = [
  "a6216755306335f0aae2c86bacaee0a70bd46007",
  "217427e0032b9d187c9e740a8708ffd551424f85",
  "335efcc09f1410266f70c6e5fb5be03a1294e33f",
] as const;

function git(args: string[]) {
  const value = spawnSync("git", ["-C", "..", ...args], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  if (value.error || value.status !== 0) throw new Error("DIAGNOSTIC_GIT_FAILED");
  return value.stdout.trim();
}
function source() {
  if (git(["status", "--porcelain", "--untracked-files=normal"])) throw new Error("DIAGNOSTIC_DIRTY_SOURCE");
  git(["diff", "--quiet", baselineRevision, "--", "web/src", "web/ops/escalas", "web/package-lock.json",
    "web/scripts/escalas/benchmark-metrics.ts", "web/scripts/escalas/benchmark-synthetic.ts",
    ":(exclude)web/src/lib/escalas/cross-engine.test.ts"]);
  return { revision: git(["rev-parse", "HEAD"]), evaluatorTree: git(["rev-parse", baselineRevision + ":web/src/lib/escalas"]) };
}

type Trial = Awaited<ReturnType<typeof runTrial>>;
function valid(trial: Trial) {
  return trial.engineNew && trial.rawAssessment?.valid === true && trial.finalAssessment?.valid === true
    && trial.proposal !== undefined && trial.processSeconds !== null && trial.processSeconds <= 12.1;
}
function comparison(reference: Trial, proposal: Trial) {
  if (!valid(reference) || !valid(proposal) || !reference.proposal || !proposal.proposal)
    return { comparable: false, regressed: null, improved: null, productRetained: null, reason: "NOT_COMPARABLE" };
  const coverage = compareRosterCoverage(reference.proposal, proposal.proposal, reference.proposal);
  let reason: RosterSelectionReason | undefined;
  const selected = selectVerifiedRoster(reference.proposal, proposal.proposal, value => { reason = value; });
  if (!reason) throw new Error("DIAGNOSTIC_SELECTION_MISSING");
  return { comparable: coverage.comparable, regressed: coverage.regressed, improved: coverage.improved,
    productRetained: selected.retainedReference, reason: coverage.reason, productReason: reason };
}

async function main() {
  if (process.env.ESCALAS_CROSS_ENGINE_ISOLATED !== "1" || arch() !== "arm64")
    throw new Error("DIAGNOSTIC_ISOLATED_ARM64_REQUIRED");
  const [baseline, v72, v73, v74, candidate, ...extra] = process.argv.slice(2);
  if (extra.length || !baseline || !v72 || !v73 || !v74 || !candidate) throw new Error("DIAGNOSTIC_ARGS");
  const snapshot = source();
  const scenario = makeScenario("branch-50-four-weeks");
  const frozen = await captureEnvelope(scenario);
  validateBaselineEnvelope(baseline, frozen);
  const metadata = { ...snapshot, baselineRevision, inputHash: digest(frozen), profile: envelopeProfile(frozen),
    arch: arch(), resources, hostCapacityMeasured: false, liveHttpMeasured: false };
  const variants = [
    { name: "ORTOOLS", image: baseline, engine: "ortools" as const, pattern: false, historical: false, revision: baselineRevision },
    { name: "E2_1", image: v72, engine: "timefold" as const, pattern: false, historical: true, revision: controls[0] },
    { name: "E2_2", image: v73, engine: "timefold" as const, pattern: false, historical: true, revision: controls[1] },
    { name: "E2_3_DEFAULT", image: v74, engine: "timefold" as const, pattern: false, historical: true, revision: controls[2] },
    { name: "E2_3_PATTERN", image: v74, engine: "timefold" as const, pattern: true, historical: true, revision: controls[2] },
    { name: "CONSOLIDATED_PATTERN", image: candidate, engine: "timefold" as const, pattern: true, historical: false, revision: snapshot.revision },
    { name: "CONSTRUCTOR_ONLY", image: candidate, engine: "timefold" as const, pattern: true, historical: false, revision: snapshot.revision },
  ].map(variant => {
    const identity = inspectImage(variant.image, variant.engine);
    if (identity.revision !== variant.revision || identity.architecture !== "arm64") throw new Error("DIAGNOSTIC_IMAGE_IDENTITY");
    return { ...variant, identity, adapter: dockerAdapter(variant.image, variant.engine, variant.pattern, variant.historical, variant.name === "CONSTRUCTOR_ONLY") };
  });
  const measured = new Map<string, Trial[]>();
  const comparisons = new Map<string, ReturnType<typeof comparison>[]>();
  // Cyclic orders give each variant each position exactly once; one
  // container at a time, same exact bytes and hardware. No warm/cold mixing.
  for (let repetition = 0; repetition < variants.length; repetition++) {
    const order = [...variants.slice(repetition), ...variants.slice(0, repetition)];
    const round = new Map<string, Trial>();
    for (const [position, variant] of order.entries()) {
      const trial = await runTrial(scenario, frozen, variant.adapter);
      if (trial.inputHash !== metadata.inputHash) throw new Error("DIAGNOSTIC_INPUT_DRIFT");
      if (variant.name === "CONSTRUCTOR_ONLY" && trial.spike?.seedOnly !== true) throw new Error("DIAGNOSTIC_SEED_ONLY_IDENTITY");
      if (variant.name === "CONSOLIDATED_PATTERN" && trial.spike?.seedOnly !== false) throw new Error("DIAGNOSTIC_SEED_ONLY_IDENTITY");
      round.set(variant.name, trial);
      const list = measured.get(variant.name) ?? [];
      list.push(trial); measured.set(variant.name, list);
      const { proposal: _proposal, ...record } = trial;
      console.log(JSON.stringify({ kind: "version-measurement", ...metadata, variant: variant.name, repetition, position,
        identity: variant.identity, historicalInternalTelemetryOmitted: variant.historical, ...record }));
    }
    const baselineTrial = round.get("ORTOOLS");
    if (!baselineTrial) throw new Error("DIAGNOSTIC_BASELINE_MISSING");
    for (const variant of variants.filter(item => item.name !== "ORTOOLS")) {
      const trial = round.get(variant.name);
      if (!trial) throw new Error("DIAGNOSTIC_TRIAL_MISSING");
      const value = comparison(baselineTrial, trial);
      const list = comparisons.get(variant.name) ?? [];
      list.push(value); comparisons.set(variant.name, list);
      console.log(JSON.stringify({ kind: "version-comparison", ...metadata, variant: variant.name, repetition, ...value }));
    }
  }
  for (const variant of variants) {
    const rows = measured.get(variant.name) ?? [];
    const good = rows.filter(valid);
    const samples = good.flatMap(row => row.cgroup ? [row.cgroup] : []);
    const paired = comparisons.get(variant.name) ?? [];
    console.log(JSON.stringify({ kind: "version-summary", ...metadata, variant: variant.name, identity: variant.identity,
      samples: rows.length, validNew: good.length,
      shortageP50: quantile(good.flatMap(row => row.finalAssessment?.metrics?.normalizedEstimatedShortage ?? []), .5),
      productP50Seconds: quantile(good.map(row => row.productSeconds), .5),
      cgroupSamples: samples.length, cpuP50Seconds: quantile(samples.map(sample => sample.cpuUsageUsec / 1_000_000), .5),
      peakBytes: samples.length ? Math.max(...samples.map(sample => sample.memoryPeakBytes)) : null,
      comparablePairs: paired.filter(row => row.comparable).length,
      coverageRegressions: paired.filter(row => row.regressed === true).length,
      productRetentions: paired.filter(row => row.productRetained === true).length,
      decision: "EXPLORATORY_NOT_CERTIFIED" }));
    if (rows.length !== variants.length || good.length !== variants.length) process.exitCode = 1;
  }

  const seedTrials = measured.get("CONSTRUCTOR_ONLY") ?? [];
  const searchedTrials = measured.get("CONSOLIDATED_PATTERN") ?? [];
  if (seedTrials.length !== variants.length || searchedTrials.length !== variants.length)
    throw new Error("DIAGNOSTIC_SEARCH_ABLATION_COUNT");
  for (const [repetition, seed] of seedTrials.entries()) {
    const searched = searchedTrials[repetition];
    const quality = comparison(seed, searched);
    console.log(JSON.stringify({ kind: "search-contribution", ...metadata, repetition,
      constructorValid: valid(seed), searchedValid: valid(searched),
      constructorShortage: seed.finalAssessment?.metrics?.normalizedEstimatedShortage ?? null,
      searchedShortage: searched.finalAssessment?.metrics?.normalizedEstimatedShortage ?? null,
      constructorProductSeconds: seed.productSeconds, searchedProductSeconds: searched.productSeconds,
      searchedMoves: searched.spike?.moveEvaluations ?? null,
      ...quality, decision: "EXPLORATORY_ATTRIBUTION_ONLY" }));
  }

  // Diagnostic-only shorter budgets and opt-in stagnation. Each variant
  // appears once in every position, preserving the same envelope and quotas.
  const curve = [
    { name: "CONSTRUCTOR", budget: 12, seed: true, stagnation: false },
    ...[2,4,8,12].map(budget => ({ name: "NATIVE_" + budget, budget, seed: false, stagnation: false })),
    { name: "STAGNATION_1S", budget: 12, seed: false, stagnation: true },
  ];
  const curveRows = new Map<string, Trial[]>();
  for (let repetition=0;repetition<curve.length;repetition++) {
    const round = new Map<string, Trial>();
    for (let position=0;position<curve.length;position++) {
      const v=curve[(repetition+position)%curve.length];
      const adapter=dockerAdapter(candidate,"timefold",true,false,v.seed,v.seed ? undefined : v.budget,v.stagnation);
      const trial=await runTrial(scenario,frozen,adapter);
      if(trial.inputHash!==metadata.inputHash) throw new Error("DIAGNOSTIC_INPUT_DRIFT");
      if(valid(trial) && (!trial.cgroup || trial.processSeconds! > v.budget+.1 || trial.spike?.seedOnly!==v.seed))
        throw new Error("DIAGNOSTIC_CURVE_IDENTITY");
      round.set(v.name,trial);
      const rows=curveRows.get(v.name)??[];rows.push(trial);curveRows.set(v.name,rows);
      const {proposal:_proposal,...record}=trial;
      console.log(JSON.stringify({kind:"curve-measurement",...metadata,variant:v.name,repetition,position,
        requestedBudgetSeconds:v.budget,stagnation:v.stagnation,identity:inspectImage(candidate,"timefold"),...record}));
    }
    const seed=round.get("CONSTRUCTOR")!;
    for (const v of curve.filter(x=>!x.seed)) {
      console.log(JSON.stringify({kind:"curve-comparison",...metadata,repetition,variant:v.name,
        ...comparison(seed,round.get(v.name)!),decision:"EXPLORATORY_ATTRIBUTION_ONLY"}));
    }
  }
  for (const v of curve) {
    const rows=curveRows.get(v.name)??[], good=rows.filter(valid);
    if(rows.length!==curve.length) throw new Error("DIAGNOSTIC_CURVE_COUNT");
    console.log(JSON.stringify({kind:"curve-summary",...metadata,variant:v.name,requestedBudgetSeconds:v.budget,
      samples:rows.length,validNew:good.length,shortageP50:quantile(good.flatMap(r=>r.finalAssessment?.metrics?.normalizedEstimatedShortage??[]),.5),
      productP50Seconds:quantile(good.map(r=>r.productSeconds),.5),peakBytes:good.length?Math.max(...good.map(r=>r.cgroup!.memoryPeakBytes)):null,
      decision:"EXPLORATORY_NOT_CERTIFIED"}));
  }

  // Repeat the identical payload three times in the same JVM, with fresh
  // domain and manager each time. Replay replies through the real client;
  // never report the replay latency as actual warm service time.
  const warm = warmTimefoldBatch(candidate, frozen);
  let previousCpu = 0;
  const reference = measured.get("ORTOOLS")?.[0];
  if (!reference) throw new Error("DIAGNOSTIC_BASELINE_MISSING");
  for (const [index, reply] of warm.replies.entries()) {
    const trial = await runTrial(scenario, frozen, () => reply);
    if (!valid(trial) || !trial.spike?.guardedSeed || !trial.cgroup
      || trial.cgroup.cpuUsageUsec < previousCpu) throw new Error("DIAGNOSTIC_WARM_INVALID");
    const cpuUsec = trial.cgroup.cpuUsageUsec - previousCpu;
    previousCpu = trial.cgroup.cpuUsageUsec;
    console.log(JSON.stringify({ kind: "warm-measurement", ...metadata, index,
      sampleKind: index === 0 ? "first-in-jvm" : "reused-jvm", batchWallSeconds: warm.batchWallSeconds,
      perInvocationInternalSeconds: trial.processSeconds, cpuDeltaUsec: cpuUsec,
      cumulativePeakBytes: trial.cgroup.memoryPeakBytes, spike: trial.spike,
      normalizedShortage: trial.finalAssessment?.metrics?.normalizedEstimatedShortage,
      ...comparison(reference, trial), independentlyValid: true,
      scope: "fresh-domain-and-manager-same-jvm-no-http" }));
  }
  if (source().revision !== snapshot.revision) throw new Error("DIAGNOSTIC_SOURCE_DRIFT");
}

main().catch((error: unknown) => {
  const code = error instanceof Error && /^DIAGNOSTIC_[A-Z_]+$/.test(error.message) ? error.message : "DIAGNOSTIC_FAILED";
  console.error(code);
  process.exitCode = 1;
});
