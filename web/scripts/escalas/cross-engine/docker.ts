/** Cold, disposable kernel adapter. No socket mount, no Compose, no external network. */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { Adapter, WireReply } from "./core";
import { verifyReply } from "./core";

export const baselineRevision = "f78c691edbeaf16283f534bcacd8db1b4b7d5e66";
export const resources = { cpus: 1, memoryMiB: 1536, pids: 64 } as const;
const python = String.raw`import json, resource, sys
from model_input import validate_model_input
from runtime_settings import REST_PAIR_PROCESS_TIMEOUT_SECONDS
from service_operations import Operations, PROCESS_TIMEOUT_SECONDS, run_operation
if __name__ == "__main__":
    try:
        data = json.load(sys.stdin)["input"]
        validate_model_input(data)
    except Exception:
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
    print(json.dumps({"httpStatus": status, "body": body, "maxRssKiB": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss}))
`;

type Engine = "ortools" | "timefold";
export function inspectImage(image: string, engine: Engine) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("CROSS_ENGINE_IMMUTABLE_IMAGE_REQUIRED");
  const output = spawnSync("docker", ["image", "inspect", image, "--format", "{{json .}}"], { encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 });
  if (output.status !== 0 || output.error) throw new Error("CROSS_ENGINE_IMAGE_MISSING");
  const value = JSON.parse(output.stdout);
  const revision = value.Config?.Labels?.["org.opencontainers.image.revision"];
  if (value.Id !== image || typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision)
    || (engine === "ortools" && revision !== baselineRevision)) throw new Error("CROSS_ENGINE_IMAGE_REVISION_MISMATCH");
  return { image, revision, architecture: value.Architecture as string };
}

function cleanup(name: string) {
  // The unique generated name is the only object this adapter may stop/remove.
  spawnSync("docker", ["rm", "-f", name], { stdio: "ignore", timeout: 5000 });
  const check = spawnSync("docker", ["ps", "-aq", "--filter", "name=^/" + name + "$"], { encoding: "utf8", timeout: 5000 });
  if (check.error || check.status !== 0 || check.stdout.trim()) throw new Error("CROSS_ENGINE_CLEANUP_FAILED");
}

export function dockerAdapter(image: string, engine: Engine): Adapter {
  inspectImage(image, engine);
  return body => {
    if (process.env.ESCALAS_CROSS_ENGINE_ISOLATED !== "1") throw new Error("CROSS_ENGINE_ISOLATED_RUNNER_REQUIRED");
    const name = "escalas-cross-engine-" + randomUUID();
    const special = JSON.parse(body).input._restPairTarget === 20;
    const timeout = special ? 32_000 : 20_000;
    const args = ["run", "--rm", "--pull=never", "--name", name, "--label", "perfectutilitares.cross-engine=synthetic",
      "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--cpus", "1", "--memory", "1536m", "--memory-swap", "1536m", "--pids-limit", "64",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m", "--user", "1001:1001", "--workdir", "/app",
      "--env", "PYTHONDONTWRITEBYTECODE=1", "--env", "ESCALAS_SOLVER_WORKERS=1",
      "--env", "ESCALAS_SOLVER_LINEARIZATION=0", "--env", "ESCALAS_SOLVER_SYMMETRY=0", "-i"];
    if (engine === "ortools") args.push("--entrypoint", "python", image, "-B", "-c", python);
    else args.push(image); // Future candidate image must implement the documented stdin/stdout adapter.
    let reply: WireReply;
    try {
      const child = spawnSync("docker", args, { input: body, encoding: "utf8", timeout, maxBuffer: 9 * 1024 * 1024 });
      if ((child.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT")
        reply = { httpStatus: 504, body: { error: "SOLVER_TIMED_OUT" }, maxRssKiB: null };
      else if (child.error || child.status !== 0)
        reply = { httpStatus: 500, body: { error: "BENCHMARK_CONTAINER_FAILED" }, maxRssKiB: null };
      else {
        try { reply = verifyReply(JSON.parse(child.stdout)); }
        catch { reply = { httpStatus: 500, body: { error: "BENCHMARK_OUTPUT_INVALID" }, maxRssKiB: null }; }
      }
    } finally { cleanup(name); }
    return reply;
  };
}
