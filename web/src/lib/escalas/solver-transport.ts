import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { z } from "zod";
import { EscalaSolverError } from "./solver-errors";

type SolverOperation = { operationId: string; cancelToken: string };
export type SolverOptions = Partial<SolverOperation> & { signal?: AbortSignal };
const terminal = z.enum(["CANCELLED", "CANCEL_REQUESTED", "COMPLETED", "FAILED", "TIMED_OUT"]);

function secret(): string {
  const path = process.env.ESCALAS_SOLVER_SECRET_FILE || "/run/secrets/escalas_solver_secret";
  let descriptor: number | undefined;
  try {
    // This protected file is mounted at runtime, not a project asset to bundle.
    descriptor = openSync(/* turbopackIgnore: true */ path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(descriptor);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size < 43 || info.size > 129) throw new Error("Invalid secret file");
    const value = readFileSync(/* turbopackIgnore: true */ descriptor, "utf8").trim();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new Error("Invalid secret");
    return value;
  } catch {
    throw new EscalaSolverError("SOLVER_AUTH_FAILED");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/** Capability is derived only on the server; never stored in browser or operation rows. */
export function solverCapability(operationId: string, ownerKey: string): string {
  return createHmac("sha256", secret()).update("escalas-solve\0" + operationId + "\0" + ownerKey).digest("hex");
}

function endpoint(path: "/solve" | "/cancel"): URL {
  const base = process.env.ESCALAS_SOLVER_URL;
  if (!base) throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  try {
    const url = new URL(path, base);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
    return url;
  } catch { throw new EscalaSolverError("SOLVER_UNAVAILABLE"); }
}

async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new EscalaSolverError("SOLVER_INVALID_RESPONSE"); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new EscalaSolverError("SOLVER_INVALID_RESPONSE"); }
  } finally { reader.releaseLock(); }
}

export async function cancelSolverOperation(operation: SolverOperation) {
  let response: Response;
  try {
    response = await fetch(endpoint("/cancel"), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret() },
      body: JSON.stringify({ requestId: operation.operationId, cancelToken: operation.cancelToken }),
      signal: AbortSignal.timeout(3500), cache: "no-store",
    });
  } catch (error) {
    if (error instanceof EscalaSolverError) throw error;
    throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  }
  if ([401, 403].includes(response.status)) throw new EscalaSolverError("SOLVER_AUTH_FAILED");
  if (!response.ok) throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  try {
    const parsed = z.object({ state: terminal }).safeParse(await boundedJson(response, 2048));
    if (!parsed.success) throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
    return parsed.data.state;
  } catch (error) {
    if (error instanceof EscalaSolverError) throw error;
    throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  }
}

export async function requestSolver(input: unknown, options: SolverOptions = {}) {
  if (options.signal?.aborted) throw new EscalaSolverError("SOLVER_CANCELLED");
  const operation = { operationId: options.operationId || randomUUID(), cancelToken: options.cancelToken || randomBytes(32).toString("hex") };
  const timeout = AbortSignal.timeout(20_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(endpoint("/solve"), {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + secret(),
        "X-Request-ID": operation.operationId, "X-Cancel-Token": operation.cancelToken },
      body: JSON.stringify({ input }), signal, cache: "no-store",
    });
    if (response.ok) {
      const result = await boundedJson(response, 8 * 1024 * 1024);
      if (signal.aborted) throw signal.reason;
      return result;
    }
  } catch (error) {
    if (error instanceof EscalaSolverError) throw error;
    if (signal.aborted) {
      // Cancellation has its own transport; it must not inherit the aborted signal.
      await cancelSolverOperation(operation).catch(() => undefined);
      throw new EscalaSolverError(options.signal?.aborted ? "SOLVER_CANCELLED" : "SOLVER_TIMED_OUT");
    }
    throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  }
  if ([401, 403].includes(response.status)) throw new EscalaSolverError("SOLVER_AUTH_FAILED");
  if (response.status === 429) throw new EscalaSolverError("SOLVER_BUSY");
  if (response.status === 504) throw new EscalaSolverError("SOLVER_TIMED_OUT");
  if (response.status === 409) {
    const body = await response.json().catch(() => null);
    if (body?.error === "SOLVER_CANCELLED") throw new EscalaSolverError("SOLVER_CANCELLED");
  }
  if (!response.ok) throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  if (options.signal?.aborted) throw new EscalaSolverError("SOLVER_CANCELLED");
  throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
}
