/** Cold, disposable kernel adapter. No socket mount, no Compose, no external network. */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Adapter, WireReply } from "./core";
import { inputDiagnosticFields, verifyReply } from "./core";

export const baselineRevision = "f78c691edbeaf16283f534bcacd8db1b4b7d5e66";
export const resources = { cpus: 1, memoryMiB: 1536, pids: 64 } as const;
const python = String.raw`import json, resource, sys
from pathlib import Path
from model_input import ModelInputError, validate_model_input
from runtime_settings import REST_PAIR_PROCESS_TIMEOUT_SECONDS
from service_operations import Operations, PROCESS_TIMEOUT_SECONDS, run_operation
def sample_cgroup():
    root = Path("/sys/fs/cgroup")
    try:
        usage = next(int(line.split()[1]) for line in (root / "cpu.stat").read_text().splitlines()
                     if line.split() and line.split()[0] == "usage_usec")
        quota, period = map(int, (root / "cpu.max").read_text().split())
        peak = int((root / "memory.peak").read_text())
        memory = int((root / "memory.max").read_text())
        pids = int((root / "pids.max").read_text())
        if usage < 0 or min(quota, period, peak, memory, pids) <= 0:
            return None
        return {"version": 2, "scope": "container-before-response", "cpuUsageUsec": usage,
                "memoryPeakBytes": peak, "memoryLimitBytes": memory, "cpuQuotaUsec": quota,
                "cpuPeriodUsec": period, "pidsLimit": pids}
    except (OSError, ValueError, IndexError, StopIteration):
        return None

if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)["input"]
        validate_model_input(data)
    except ModelInputError as error:
        print(json.dumps({"httpStatus": 400, "body": {"error": "INVALID_MODEL_INPUT", "fields": error.fields}, "maxRssKiB": None}))
        sys.exit(0)
    except (ValueError, KeyError, TypeError, OverflowError):
        print(json.dumps({"httpStatus": 400, "body": {"error": "INVALID_MODEL_INPUT"}, "maxRssKiB": None}))
        sys.exit(0)
    ops = Operations()
    op = ops.start("synthetic-benchmark", b"x"*32)
    timeout = REST_PAIR_PROCESS_TIMEOUT_SECONDS if "_restPairTarget" in data else PROCESS_TIMEOUT_SECONDS
    outcome = run_operation(data, op, timeout)
    state = ops.finish(op, outcome["state"])
    if state == "COMPLETED":
        status, body = 200, outcome["result"]
    elif state == "TIMED_OUT":
        status, body = 504, {"error": "SOLVER_TIMED_OUT"}
    elif state == "CANCELLED":
        status, body = 409, {"error": "SOLVER_CANCELLED"}
    else:
        status, body = (400 if outcome.get("error") == "INVALID_MODEL_INPUT" else 500), {"error": "SOLVER_FAILED"}
    print(json.dumps({"httpStatus": status, "body": body, "maxRssKiB": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss, "cgroup": sample_cgroup()}))
`;

const validationPython = String.raw`import json, sys
from model_input import ModelInputError, validate_model_input
try:
    validate_model_input(json.load(sys.stdin)["input"])
except ModelInputError as error:
    print(json.dumps({"valid": False, "fields": error.fields}))
except (ValueError, KeyError, TypeError, OverflowError):
    print(json.dumps({"valid": False}))
else:
    print(json.dumps({"valid": True}))
`;

type Engine = "ortools" | "timefold" | "solverforge";
const historicalTimefold = new Set([
  "a6216755306335f0aae2c86bacaee0a70bd46007",
  "217427e0032b9d187c9e740a8708ffd551424f85",
  "335efcc09f1410266f70c6e5fb5be03a1294e33f",
]);
export function inspectImage(image: string, engine: Engine) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("CROSS_ENGINE_IMMUTABLE_IMAGE_REQUIRED");
  const output = spawnSync("docker", ["image", "inspect", image, "--format", "{{json .}}"], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024 });
  if (output.status !== 0 || output.error) throw new Error("CROSS_ENGINE_IMAGE_MISSING");
  const value = JSON.parse(output.stdout);
  const revision = value.Config?.Labels?.["org.opencontainers.image.revision"];
  if (value.Id !== image || typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision)
    || (engine === "ortools" && revision !== baselineRevision)) throw new Error("CROSS_ENGINE_IMAGE_REVISION_MISMATCH");
  if (engine === "solverforge" && (value.Config?.Labels?.["perfectutilitares.solverforge.revision"] !== "78889c3ff9fda158c70e6a1f67f8c7f0fdae922e"
    || value.Config?.Labels?.["perfectutilitares.escalas.experimental"] !== "SOLVERFORGE_PARTIAL_MODEL"))
    throw new Error("CROSS_ENGINE_SOLVERFORGE_IDENTITY");
  return { image, revision, architecture: value.Architecture as string };
}

function cleanup(name: string) {
  // The unique generated name is the only object this adapter may stop/remove.
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore", timeout: 5000, killSignal: "SIGKILL" });
  const check = spawnSync("docker", ["ps", "-aq", "--filter", "name=^/" + name + "$"], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  if (check.error || check.status !== 0 || check.stdout.trim()) throw new Error("CROSS_ENGINE_CLEANUP_FAILED");
}

/** Same immutable image, quota and cleanup for preflight and measured runs. */
function runIsolated(image: string, engine: Engine, body: string, validateOnly = false, patternSeed = false, seedOnly = false, budgetSeconds = 12, adaptive = false, temporal = false) {
  if (temporal && (engine !== "solverforge" || adaptive || seedOnly || validateOnly || budgetSeconds !== 12)) throw Error("FORGE_TEMPORAL_MODE");
  if (adaptive && (engine !== "solverforge" || seedOnly || budgetSeconds !== 12 || validateOnly)) throw Error("FORGE_ADAPTIVE_MODE");
  if (seedOnly && engine !== "solverforge") throw new Error("CROSS_ENGINE_SEED_MODE");
  if (![2,4,8,12].includes(budgetSeconds) || budgetSeconds !== 12 && (engine !== "solverforge" || seedOnly))
    throw new Error("CROSS_ENGINE_BUDGET");
  if (process.env.ESCALAS_CROSS_ENGINE_ISOLATED !== "1") throw new Error("CROSS_ENGINE_ISOLATED_RUNNER_REQUIRED");
  const name = "escalas-cross-engine-" + randomUUID();
  const special = JSON.parse(body).input._restPairTarget === 20;
  const timeout = validateOnly ? 10_000 : special ? 32_000 : 20_000;
  const args = ["run", "--rm", "--pull=never", "--name", name, "--label", "perfectutilitares.cross-engine=synthetic",
    "--network", "none", "--cgroupns=private", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--cpus", "1", "--memory", "1536m", "--memory-swap", "1536m", "--pids-limit", "64",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m", "--user", "1001:1001", "--workdir", "/app",
    "--env", "PYTHONDONTWRITEBYTECODE=1", "--env", "ESCALAS_SOLVER_WORKERS=1",
    "--env", "ESCALAS_SOLVER_LINEARIZATION=0", "--env", "ESCALAS_SOLVER_SYMMETRY=0", "-i"];
  if (engine === "ortools") args.push("--entrypoint", "python", image, "-B", "-c", validateOnly ? validationPython : python);
  else if (engine === "solverforge") {
    args.push("--env", "RAYON_NUM_THREADS=1", image);
    if (temporal) args.push("--temporal");
    else if (seedOnly) args.push("--seed-only");
    else if (adaptive) args.push("--adaptive");
    else if (budgetSeconds !== 12) args.push("--budget-seconds=" + budgetSeconds);
  } else {
    args.push(image);
    if (patternSeed) args.push("--pattern-seed");
  }
  try {
    return spawnSync("docker", args, { input: body, encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: 9 * 1024 * 1024 });
  } finally { cleanup(name); }
}

/** Reject an invalid wire envelope before any timed solve; never log its values. */
export function validateBaselineEnvelope(image: string, body: string) {
  inspectImage(image, "ortools");
  const child = runIsolated(image, "ortools", body, true);
  if (child.error || child.status !== 0) throw new Error("CROSS_ENGINE_PREFLIGHT_PROCESS_FAILED");
  let result: { valid?: unknown; fields?: unknown };
  try { result = JSON.parse(child.stdout); }
  catch { throw new Error("CROSS_ENGINE_PREFLIGHT_OUTPUT_INVALID"); }
  if (!result || result.valid !== true) {
    console.error(JSON.stringify({ event: "cross-engine-preflight-rejected", fields: inputDiagnosticFields(result?.fields) }));
    throw new Error("CROSS_ENGINE_PREFLIGHT_INVALID_INPUT");
  }
}

export function dockerAdapter(image: string, engine: Engine, patternSeed = false, historical = false): Adapter {
  if (patternSeed && engine !== "timefold") throw new Error("CROSS_ENGINE_SEED_MODE");
  const identity = inspectImage(image, engine);
  if (historical && (engine !== "timefold" || !historicalTimefold.has(identity.revision)
      || (patternSeed && identity.revision !== "335efcc09f1410266f70c6e5fb5be03a1294e33f")))
    throw new Error("CROSS_ENGINE_HISTORICAL_REVISION");
  return body => {
    const child = runIsolated(image, engine, body, false, patternSeed);
    let reply: WireReply;
    // GNU timeout 124 is a known Timefold supervisor deadline. 137 is ambiguous
    // (OOM or forced termination); do not misreport it as a normal timeout.
    if ((child.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT"
      || engine === "timefold" && !child.error && child.status === 124)
      reply = { httpStatus: 504, body: { error: "SOLVER_TIMED_OUT" }, maxRssKiB: null };
    else if (child.error || child.status !== 0)
      reply = { httpStatus: 500, body: { error: "BENCHMARK_CONTAINER_FAILED" }, maxRssKiB: null };
    else {
      try {
        const value = JSON.parse(child.stdout);
        // Historical schema lacks newer counters. Do not invent them or weaken
        // the current validator. Only pinned controls can omit their old spike.
        if (historical && value && typeof value === "object") delete value.spike;
        reply = verifyReply(value);
        if (engine === "timefold" && reply.httpStatus === 200 && ["OPTIMAL", "INFEASIBLE"].includes((reply.body as { status: string }).status))
          throw new Error("CROSS_ENGINE_UNSUPPORTED_PROOF");
      }
      catch { reply = { httpStatus: 500, body: { error: "BENCHMARK_OUTPUT_INVALID" }, maxRssKiB: null }; }
    }
    return reply;
  };
}


/** SolverForge-specific adapter: common reply and cgroup validators remain
 * byte-identical to the approved Timefold comparator. Native telemetry is
 * validated separately, not disguised as a Timefold score or event.
 */
export type ForgeTelemetry = {
  version: "0.31.2"; mode: "NATIVE" | "SEED_ONLY" | "ADAPTIVE"; nativeSearch: boolean; seedComplete: boolean;
  resultSource: "NATIVE" | "CONSTRUCTOR_ONLY" | "SEED_RETAINED"; nativeCost: number[] | null; stagnationApplied: boolean;
  mapSeconds: number; seedSeconds: number; searchSeconds: number; entities: number;
  positions: number; initialized: number; allowedPatterns: number; initialCost: number[]; finalCost: number[];
  partialModel: true; budgetSeconds: number;
  domainMode: "EXACT" | "BOUNDED_42"; fullDomainPatterns: number;
};
export function solverforgeAdapter(image: string, seedOnly = false, budgetSeconds = 12, adaptive = false) {
  inspectImage(image, "solverforge");
  let telemetry: ForgeTelemetry | null = null;
  const adapter: Adapter = body => {
    telemetry = null;
    const child = runIsolated(image, "solverforge", body, false, false, seedOnly, budgetSeconds, adaptive);
    if ((child.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" || !child.error && child.status === 124)
      return { httpStatus: 504, body: { error: "SOLVER_TIMED_OUT" }, maxRssKiB: null };
    if (child.error || child.status !== 0)
      return { httpStatus: 500, body: { error: "BENCHMARK_CONTAINER_FAILED" }, maxRssKiB: null };
    try {
      const value = JSON.parse(child.stdout);
      const reply = verifyReply(value);
      const status = (reply.body as {status?: string}).status;
      if (reply.httpStatus === 200 && status !== "FEASIBLE" && status !== "UNKNOWN") throw Error("UNSUPPORTED_PROOF");
      if (reply.httpStatus === 200 && status === "FEASIBLE") {
        const t = value.solverforge;
        const integer = (x: unknown) => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
        const duration = (x: unknown) => typeof x === "number" && Number.isFinite(x) && x >= 0;
        const vector = (x: unknown) => Array.isArray(x) && x.length === 13 && x.every(integer);
        if (!t || t.version !== "0.31.2" || t.mode !== (seedOnly ? "SEED_ONLY" : adaptive ? "ADAPTIVE" : "NATIVE")
          || t.partialModel !== true || t.budgetSeconds !== budgetSeconds || typeof t.nativeSearch !== "boolean" || typeof t.seedComplete !== "boolean"
          || typeof t.stagnationApplied !== "boolean" || t.stagnationApplied && (!adaptive || !t.nativeSearch)
          || (!adaptive && t.nativeSearch !== !seedOnly)
          || (t.nativeSearch ? !vector(t.nativeCost) : t.nativeCost !== null)
          || !duration(t.mapSeconds) || !duration(t.seedSeconds) || !duration(t.searchSeconds)
          || !integer(t.entities) || t.entities < 1 || t.entities > 250 || !integer(t.positions)
          || !["EXACT","BOUNDED_42"].includes(t.domainMode) || !integer(t.fullDomainPatterns)
          || t.fullDomainPatterns < t.allowedPatterns
          || (t.domainMode === "EXACT" ? t.entities > 50 || t.fullDomainPatterns !== t.allowedPatterns
              : t.positions !== t.entities * 42 || t.allowedPatterns > t.entities * 2049)
          || !integer(t.initialized) || t.initialized > t.entities || !integer(t.allowedPatterns)
          || t.allowedPatterns < t.entities || t.allowedPatterns > t.entities * 50625
          || !vector(t.initialCost) || !vector(t.finalCost) || t.finalCost[0] !== 0
          || seedOnly && (t.searchSeconds !== 0 || !t.seedComplete || t.initialized !== t.entities
              || JSON.stringify(t.initialCost) !== JSON.stringify(t.finalCost))
          || (t.nativeSearch ? t.searchSeconds <= 0 : t.searchSeconds !== 0)
          || (seedOnly ? t.resultSource !== "CONSTRUCTOR_ONLY" : t.resultSource !== "NATIVE" && (!adaptive || t.resultSource !== "SEED_RETAINED"))
          || t.resultSource === "NATIVE" && (!t.nativeSearch || JSON.stringify(t.nativeCost) !== JSON.stringify(t.finalCost))
          || t.resultSource === "SEED_RETAINED" && (!t.seedComplete || t.initialized !== t.entities || JSON.stringify(t.initialCost) !== JSON.stringify(t.finalCost))
          || !reply.cgroup)
          throw Error("SOLVERFORGE_TELEMETRY");
        telemetry = t as ForgeTelemetry;
      }
      return reply;
    } catch {
      return { httpStatus: 500, body: { error: "BENCHMARK_OUTPUT_INVALID" }, maxRssKiB: null };
    }
  };
  return { adapter, telemetry: () => telemetry };
}


type TemporalTelemetry = {
  version: 2; scope: "SYNTHETIC_TEMPORAL"; partialModel: true;
  days: number; untimed: number; domainMode: "EXACT_WEEK" | "BOUNDED_PATHS"; pathLimit: number;
  mapSeconds: number; seedSeconds: number; searchSeconds: number; nativeSearch: boolean;
  entities: number; patterns: number; initialCost: number[]; finalCost: number[];
  objectives: {name: string; status: string; cost: number | null}[];
};
export function temporalForgeAdapter(image: string) {
  inspectImage(image,"solverforge");
  let telemetry:TemporalTelemetry|null=null;
  const adapter:Adapter=body=>{
    telemetry=null;
    const child=runIsolated(image,"solverforge",body,false,false,false,12,false,true);
    if((child.error as NodeJS.ErrnoException|undefined)?.code==="ETIMEDOUT"||!child.error&&child.status===124)
      return {httpStatus:504,body:{error:"SOLVER_TIMED_OUT"},maxRssKiB:null};
    if(child.error||child.status!==0)return {httpStatus:500,body:{error:"BENCHMARK_CONTAINER_FAILED"},maxRssKiB:null};
    try{
      const value=JSON.parse(child.stdout),reply=verifyReply(value);
      const status=(reply.body as {status?:string}).status;
      if(reply.httpStatus===200&&status!=="UNKNOWN"&&status!=="FEASIBLE")throw Error("UNSUPPORTED_PROOF");
      if(reply.httpStatus===200&&status==="FEASIBLE"){
        const t=value.temporal,integer=(x:unknown)=>typeof x==="number"&&Number.isSafeInteger(x)&&x>=0;
        const vector=(x:unknown)=>Array.isArray(x)&&x.length===17&&x.every(integer);
        if(!t||t.version!==2||t.scope!=="SYNTHETIC_TEMPORAL"||t.partialModel!==true
          ||![7,14,21,28,35,42].includes(t.days)||!integer(t.entities)||t.entities<1||t.entities>(t.days===7?12:250)
          ||!integer(t.untimed)||t.untimed>t.entities
          ||t.domainMode!==(t.days===7?"EXACT_WEEK":"BOUNDED_PATHS")||t.pathLimit!==(t.days===7?30000:384)
          ||!integer(t.patterns)||t.patterns<t.entities||t.patterns>t.entities*t.pathLimit
          ||typeof t.seedSeconds!=="number"||!Number.isFinite(t.seedSeconds)||t.seedSeconds<0
          ||!vector(t.initialCost)||!vector(t.finalCost)||t.finalCost[0]!==0
          ||typeof t.nativeSearch!=="boolean"||typeof t.mapSeconds!=="number"||!Number.isFinite(t.mapSeconds)||t.mapSeconds<0
          ||typeof t.searchSeconds!=="number"||!Number.isFinite(t.searchSeconds)||t.searchSeconds<0
          ||!Array.isArray(t.objectives)||t.objectives.length!==16||!reply.cgroup)
          throw Error("FORGE_TEMPORAL_TELEMETRY");
        telemetry=t as TemporalTelemetry;
      }
      return reply;
    }catch{return {httpStatus:500,body:{error:"BENCHMARK_OUTPUT_INVALID"},maxRssKiB:null};}
  };
  return {adapter,telemetry:()=>telemetry};
}
