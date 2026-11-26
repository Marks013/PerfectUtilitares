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

type Engine = "ortools" | "timefold";
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
  return { image, revision, architecture: value.Architecture as string };
}

function cleanup(name: string) {
  // The unique generated name is the only object this adapter may stop/remove.
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore", timeout: 5000, killSignal: "SIGKILL" });
  const check = spawnSync("docker", ["ps", "-aq", "--filter", "name=^/" + name + "$"], { encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  if (check.error || check.status !== 0 || check.stdout.trim()) throw new Error("CROSS_ENGINE_CLEANUP_FAILED");
}

/** Same immutable image, quota and cleanup for preflight and measured runs. */
function runIsolated(image: string, engine: Engine, body: string, validateOnly = false, patternSeed = false, warm = false, seedOnly = false) {
  if (seedOnly && (engine !== "timefold" || validateOnly || warm || !patternSeed)) throw new Error("CROSS_ENGINE_SEED_ONLY_MODE");
  if (warm && (engine !== "timefold" || validateOnly || !patternSeed)) throw new Error("CROSS_ENGINE_WARM_MODE");
  if (process.env.ESCALAS_CROSS_ENGINE_ISOLATED !== "1") throw new Error("CROSS_ENGINE_ISOLATED_RUNNER_REQUIRED");
  const name = "escalas-cross-engine-" + randomUUID();
  const special = JSON.parse(body).input._restPairTarget === 20;
  const timeout = warm ? 56_000 : validateOnly ? 10_000 : special ? 32_000 : 20_000;
  const args = ["run", "--rm", "--pull=never", "--name", name, "--label", "perfectutilitares.cross-engine=synthetic",
    "--network", "none", "--cgroupns=private", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--cpus", "1", "--memory", "1536m", "--memory-swap", "1536m", "--pids-limit", "64",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m", "--user", "1001:1001", "--workdir", "/app",
    "--env", "PYTHONDONTWRITEBYTECODE=1", "--env", "ESCALAS_SOLVER_WORKERS=1",
    "--env", "ESCALAS_SOLVER_LINEARIZATION=0", "--env", "ESCALAS_SOLVER_SYMMETRY=0", "-i"];
  if (engine === "ortools") args.push("--entrypoint", "python", image, "-B", "-c", validateOnly ? validationPython : python);
  else if (warm) {
    // Same image and JVM settings. Only batch-level supervisor differs; each
    // solve retains its own 12s deadline and there are exactly 3 invocations.
    args.push("--entrypoint", "/usr/bin/timeout", image, "--signal=TERM", "--kill-after=1s", "53s",
      "java", "-XX:ActiveProcessorCount=1", "-XX:MaxRAMPercentage=55", "-XX:+ExitOnOutOfMemoryError",
      "-Djava.io.tmpdir=/tmp", "-cp", "/app/spike.jar:/app/lib/*",
      "br.perfectutilitares.escalas.spike.SpikeMain", "--pattern-seed", "--warm-batch");
  } else {
    args.push(image);
    if (patternSeed) args.push("--pattern-seed");
    if (seedOnly) args.push("--seed-only");
  }
  try {
    return spawnSync("docker", args, { input: body, encoding: "utf8", timeout, killSignal: "SIGKILL", maxBuffer: (warm ? 27 : 9) * 1024 * 1024 });
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

export function dockerAdapter(image: string, engine: Engine, patternSeed = false, historical = false, seedOnly = false): Adapter {
  if (seedOnly && (historical || !patternSeed || engine !== "timefold")) throw new Error("CROSS_ENGINE_SEED_ONLY_MODE");
  if (patternSeed && engine !== "timefold") throw new Error("CROSS_ENGINE_SEED_MODE");
  const identity = inspectImage(image, engine);
  if (historical && (engine !== "timefold" || !historicalTimefold.has(identity.revision)
      || (patternSeed && identity.revision !== "335efcc09f1410266f70c6e5fb5be03a1294e33f")))
    throw new Error("CROSS_ENGINE_HISTORICAL_REVISION");
  return body => {
    const child = runIsolated(image, engine, body, false, patternSeed, false, seedOnly);
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

export function warmTimefoldBatch(image: string, body: string) {
  const identity = inspectImage(image, "timefold");
  if (historicalTimefold.has(identity.revision)) throw new Error("CROSS_ENGINE_HISTORICAL_REVISION");
  const start = performance.now();
  const child = runIsolated(image, "timefold", body, false, true, true);
  const batchWallSeconds = (performance.now() - start) / 1000;
  if (child.error || child.status !== 0) throw new Error("CROSS_ENGINE_WARM_BATCH_FAILED");
  const lines = child.stdout.trim().split("\n");
  if (lines.length !== 3) throw new Error("CROSS_ENGINE_WARM_BATCH_COUNT");
  return { batchWallSeconds, replies: lines.map(line => verifyReply(JSON.parse(line))) };
}
