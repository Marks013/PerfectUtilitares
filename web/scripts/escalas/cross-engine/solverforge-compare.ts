/** Three engines, one frozen envelope and original product evaluator.
 * A separate Rust PR, never import the Timefold implementation into its source.
 */
import { spawnSync } from "node:child_process";
import { arch } from "node:os";
import { makeScenario, type ScenarioId } from "./fixtures";
import { captureEnvelope, digest, envelopeProfile, runTrial, type Adapter } from "./core";
import { baselineRevision, dockerAdapter, inspectImage, resources, solverforgeAdapter, validateBaselineEnvelope, type ForgeTelemetry } from "./docker";
import { compareRosterCoverage, selectVerifiedRoster, type RosterSelectionReason } from "../../../src/lib/escalas/roster-quality";

const CONTROL = "71945cd6e73c48b424dab1297fbc3bf8a15ae585";
const CASES = ["team-10-week", "branch-50-four-weeks", "team-10-week-repair"] as const;
const ORDERS = [
  ["ortools","timefold","solverforge"], ["ortools","solverforge","timefold"],
  ["timefold","ortools","solverforge"], ["timefold","solverforge","ortools"],
  ["solverforge","ortools","timefold"], ["solverforge","timefold","ortools"],
] as const;
type Engine = typeof ORDERS[number][number];
type Trial = Awaited<ReturnType<typeof runTrial>>;

function git(args: string[]) {
  const result = spawnSync("git", ["-C", "..", ...args], {encoding:"utf8", timeout:5000, killSignal:"SIGKILL"});
  if (result.error || result.status !== 0) throw Error("FORGE_GIT_IDENTITY");
  return result.stdout.trim();
}
function source() {
  if (git(["status","--porcelain","--untracked-files=normal"])) throw Error("FORGE_DIRTY_SOURCE");
  git(["diff","--quiet",baselineRevision,"--","web/src","web/ops/escalas","web/package-lock.json",
    "web/scripts/escalas/benchmark-metrics.ts","web/scripts/escalas/benchmark-synthetic.ts",
    ":(exclude)web/src/lib/escalas/cross-engine.test.ts"]);
  git(["diff","--quiet",CONTROL,"--","web/scripts/escalas/cross-engine/core.ts","web/scripts/escalas/cross-engine/fixtures.ts"]);
  return {revision:git(["rev-parse","HEAD"]),evaluatorTree:git(["rev-parse",baselineRevision+":web/src/lib/escalas"]),
    comparatorBlob:git(["rev-parse",CONTROL+":web/scripts/escalas/cross-engine/core.ts"])};
}
function valid(trial: Trial) {
  return trial.engineNew && trial.timely && trial.rawAssessment?.valid === true && trial.rawAssessment.complete
    && trial.finalAssessment?.valid === true && trial.finalAssessment.complete && trial.proposal !== undefined
    && trial.processSeconds !== null && trial.processSeconds <= 12.1 && trial.cgroup !== null;
}
function compare(before:Trial,after:Trial) {
  if (!valid(before)||!valid(after)||!before.proposal||!after.proposal)
    return {comparable:false,regressed:null,improved:null,retained:null,reason:"NOT_COMPARABLE",productReason:null};
  const coverage=compareRosterCoverage(before.proposal,after.proposal,before.proposal);
  let reason:RosterSelectionReason|undefined;
  const selected=selectVerifiedRoster(before.proposal,after.proposal,r=>{reason=r;});
  if (!reason) throw Error("FORGE_SELECTION_MISSING");
  const loss=coverage.regression;
  return {comparable:coverage.comparable,regressed:coverage.regressed,improved:coverage.improved,
    retained:selected.retainedReference,reason:coverage.reason,productReason:reason,
    ...(loss?{regression:{metric:loss.metric,scope:loss.scope,before:loss.before,after:loss.after,delta:loss.delta}}:{})};
}

async function main() {
  if (arch()!=="arm64"||process.env.ESCALAS_CROSS_ENGINE_ISOLATED!=="1") throw Error("FORGE_ISOLATED_ARM64_REQUIRED");
  const [baseline,timefold,forge,mode,...extra]=process.argv.slice(2);
  if (!baseline||!timefold||!forge||extra.length||(mode!=="smoke"&&mode!=="paired"&&mode!=="curve")) throw Error("FORGE_ARGS");
  const snapshot=source();
  const images={ortools:inspectImage(baseline,"ortools"),timefold:inspectImage(timefold,"timefold"),solverforge:inspectImage(forge,"solverforge")};
  if (images.ortools.revision!==baselineRevision||images.timefold.revision!==CONTROL||images.solverforge.revision!==snapshot.revision
    ||Object.values(images).some(x=>x.architecture!=="arm64")) throw Error("FORGE_IMAGE_IDENTITY");
  if (mode === "curve") {
    const scenario = makeScenario("branch-50-four-weeks");
    const frozen = await captureEnvelope(scenario);
    validateBaselineEnvelope(baseline, frozen);
    const profile = envelopeProfile(frozen);
    const shared = {...snapshot,scenario:scenario.id,inputHash:digest(frozen),baselineRevision,timefoldRevision:CONTROL,
      arch:arch(),resources,profile,sampleKind:"cold-container",hostCapacityMeasured:false,liveHttpMeasured:false};
    const variants = [
      {id:"seed-only",seedOnly:true,budget:12,adaptive:false},
      ...[2,4,8,12].map(budget=>({id:"native-"+budget,seedOnly:false,budget,adaptive:false})),
      {id:"adaptive",seedOnly:false,budget:12,adaptive:true},
    ];
    // Every variant appears once in each position. This is an internal Rust
    // ablation, not a claim of equal-budget comparison with other engines.
    for (let repetition=0;repetition<variants.length;repetition++) {
      const round: {trial: Trial; record: Record<string,unknown>}[] = [];
      for (let position=0;position<variants.length;position++) {
        const variant=variants[(repetition+position)%variants.length];
        const adapter=solverforgeAdapter(forge,variant.seedOnly,variant.budget,variant.adaptive);
        const trial=await runTrial(scenario,frozen,adapter.adapter);
        const native=adapter.telemetry();
        if(trial.inputHash!==shared.inputHash) throw Error("FORGE_INPUT_DRIFT");
        if(valid(trial)&&(!native||native.budgetSeconds!==variant.budget||native.entities!==profile.includedOnWire
          ||native.positions!==profile.activePositions||native.finalCost[3]!==trial.finalAssessment?.metrics?.normalizedEstimatedShortage))
          throw Error("FORGE_INDEPENDENT_SCORE_DRIFT");
        const {proposal:_proposal,...record}=trial;
        round.push({trial,record:{kind:"curve",...shared,repetition,position,variant:variant.id,
          requestedBudgetSeconds:variant.budget,identity:images.solverforge,forge:native,...record}});
      }
      const seed=round.find(x=>x.record.variant==="seed-only")!.trial;
      const full=round.find(x=>x.record.variant==="native-12")!.trial;
      for (const item of round) console.log(JSON.stringify({...item.record,againstSeed:compare(seed,item.trial),againstNative12:compare(full,item.trial)}));
    }
    if(source().revision!==snapshot.revision) throw Error("FORGE_SOURCE_DRIFT");
    return;
  }
  const cases:readonly ScenarioId[]=mode==="smoke"?["team-10-week"]:CASES;
  for (const id of cases) {
    const scenario=makeScenario(id), frozen=await captureEnvelope(scenario);
    validateBaselineEnvelope(baseline,frozen);
    const profile=envelopeProfile(frozen);
    const shared={...snapshot,scenario:id,inputHash:digest(frozen),baselineRevision,timefoldRevision:CONTROL,
      arch:arch(),resources,profile,sampleKind:"cold-container",hostCapacityMeasured:false,liveHttpMeasured:false};
    const rust=solverforgeAdapter(forge), seed=solverforgeAdapter(forge,true);
    const adapters:Record<Engine,Adapter>={ortools:dockerAdapter(baseline,"ortools"),
      timefold:dockerAdapter(timefold,"timefold",id==="branch-50-four-weeks"),solverforge:rust.adapter};
    const rounds=mode==="smoke"?1:ORDERS.length;
    for(let repetition=0;repetition<rounds;repetition++) {
      const results=new Map<Engine,Trial>();
      for(const [position,engine] of ORDERS[repetition].entries()) {
        const trial=await runTrial(scenario,frozen,adapters[engine]);
        if(trial.inputHash!==shared.inputHash) throw Error("FORGE_INPUT_DRIFT");
        const native:ForgeTelemetry|null=engine==="solverforge"?rust.telemetry():null;
        if(engine==="solverforge"&&valid(trial)&&(!native||native.entities!==profile.includedOnWire
          ||native.positions!==profile.activePositions||native.finalCost[3]!==trial.finalAssessment?.metrics?.normalizedEstimatedShortage))
          throw Error("FORGE_INDEPENDENT_SCORE_DRIFT");
        const {proposal:_proposal,...record}=trial;
        console.log(JSON.stringify({kind:"measurement",...shared,engine,repetition,position,
          identity:images[engine],forge:native,...record}));
        results.set(engine,trial);
      }
      for(const [before,after] of [["ortools","timefold"],["ortools","solverforge"],["timefold","solverforge"]] as const) {
        console.log(JSON.stringify({kind:"comparison",...shared,before,after,repetition,
          ...compare(results.get(before)!,results.get(after)!)}));
      }
      if(id==="branch-50-four-weeks"&&mode==="paired") {
        const trial=await runTrial(scenario,frozen,seed.adapter);
        const native=seed.telemetry();
        if(valid(trial)&&(!native||native.entities!==profile.includedOnWire||native.positions!==profile.activePositions
          ||native.finalCost[3]!==trial.finalAssessment?.metrics?.normalizedEstimatedShortage)) throw Error("FORGE_SEED_SCORE_DRIFT");
        const {proposal:_proposal,...record}=trial;
        console.log(JSON.stringify({kind:"seed-control",...shared,repetition,identity:images.solverforge,
          forge:native,...record,againstNative:compare(trial,results.get("solverforge")!)}));
      }
    }
  }
  if(source().revision!==snapshot.revision) throw Error("FORGE_SOURCE_DRIFT");
}

main().catch((error:unknown)=>{
  console.error(error instanceof Error&&/^FORGE_[A-Z_]+$/.test(error.message)?error.message:"FORGE_COMPARISON_FAILED");
  process.exitCode=1;
});
