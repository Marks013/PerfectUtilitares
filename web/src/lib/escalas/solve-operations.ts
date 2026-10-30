import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { EscalaError, requireEscalaPermission, type EscalaActor } from "./access";
import { getEscala, generateEscala } from "./service";
import { EscalaSolverError } from "./solver-errors";
import { cancelSolverOperation, solverCapability } from "./solver-transport";

const active = ["CREATED", "RUNNING", "CANCEL_REQUESTED"] as const;
const final = ["CANCELLED", "COMPLETED", "FAILED", "TIMED_OUT"] as const;
type Operation = Awaited<ReturnType<typeof prisma.escalaSolveOperation.findUniqueOrThrow>>;

/** A stable authenticated-session identity is hashed; JWT re-encoding does not change ownership. */
export function solveOwner(_request: Request, actor: EscalaActor): string {
  let identity: string;
  if (actor.moduleSessionId) identity = "module:" + actor.moduleSessionId;
  else {
    if (!actor.userId || !actor.accountSessionId) throw new EscalaError(401, "ESCALA_ACCESS_REQUIRED", "Seu acesso precisa ser renovado. Entre novamente sem descartar o rascunho.");
    identity = "account:" + actor.userId + ":" + actor.accountSessionId;
  }
  return createHash("sha256").update(actor.tenantId + "\0" + identity).digest("hex");
}

function publicState(operation: Operation) {
  return { operationId: operation.id, state: operation.state, expiresAt: operation.expiresAt.toISOString() };
}

async function owned(actor: EscalaActor, ownerKey: string, operationId: string) {
  const operation = await prisma.escalaSolveOperation.findFirst({ where: { id: operationId, tenantId: actor.tenantId, ownerKey } });
  if (!operation) throw new EscalaError(404, "ESCALA_OPERATION_NOT_FOUND", "Este cálculo não está disponível neste acesso.");
  const workspace = await getEscala(actor, operation.workspaceId);
  requireEscalaPermission(workspace, "edit");
  return operation;
}

async function cleanup(ownerKey: string, tenantId: string) {
  const now = new Date();
  // Expiry is much longer than the Python process deadline. A late result still loses its CAS below.
  await prisma.escalaSolveOperation.updateMany({ where: { tenantId, ownerKey, state: { in: [...active] }, expiresAt: { lt: now } }, data: { state: "TIMED_OUT", finishedAt: now } });
  const expired = await prisma.escalaSolveOperation.findMany({ where: { tenantId, state: { in: [...final] }, expiresAt: { lt: new Date(Date.now() - 86_400_000) } }, select: { id: true }, take: 50 });
  if (expired.length) await prisma.escalaSolveOperation.deleteMany({ where: { id: { in: expired.map(value => value.id) }, state: { in: [...final] } } });
}

export async function startGenerationOperation(actor: EscalaActor, ownerKey: string, workspaceId: string, expectedRevision: number) {
  const workspace = await getEscala(actor, workspaceId);
  requireEscalaPermission(workspace, "edit");
  if (workspace.revision !== expectedRevision) throw new EscalaError(409, "ESCALA_REVISION_CONFLICT", "A escala mudou. Atualize a proposta antes de calcular novamente.");
  await cleanup(ownerKey, actor.tenantId);
  const existing = await prisma.escalaSolveOperation.count({ where: { tenantId: actor.tenantId, ownerKey, state: { in: [...active] }, expiresAt: { gt: new Date() } } });
  if (existing) throw new EscalaSolverError("SOLVER_BUSY");
  try {
    const operation = await prisma.escalaSolveOperation.create({ data: { tenantId: actor.tenantId, workspaceId, expectedRevision, ownerKey, expiresAt: new Date(Date.now() + 120_000) } });
    return publicState(operation);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new EscalaSolverError("SOLVER_BUSY");
    throw error;
  }
}

function capability(operation: Operation) {
  return { operationId: operation.id, cancelToken: solverCapability(operation.id, operation.ownerKey) };
}

export async function cancelGenerationOperation(actor: EscalaActor, ownerKey: string, operationId: string) {
  const operation = await owned(actor, ownerKey, operationId);
  if (final.includes(operation.state as typeof final[number])) return publicState(operation);
  const created = await prisma.escalaSolveOperation.updateMany({ where: { id: operation.id, state: "CREATED" }, data: { state: "CANCELLED", finishedAt: new Date() } });
  if (!created.count) {
    await prisma.escalaSolveOperation.updateMany({ where: { id: operation.id, state: "RUNNING" }, data: { state: "CANCEL_REQUESTED" } });
    const current = await prisma.escalaSolveOperation.findUniqueOrThrow({ where: { id: operation.id } });
    if (current.state === "CANCEL_REQUESTED") {
      const state = await cancelSolverOperation(capability(current));
      // A completed Python calculation is stopped work, but cancellation won the app CAS.
      if (state !== "CANCEL_REQUESTED") await prisma.escalaSolveOperation.updateMany({ where: { id: operation.id, state: "CANCEL_REQUESTED" }, data: { state: state === "TIMED_OUT" ? "TIMED_OUT" : "CANCELLED", finishedAt: new Date() } });
    }
  }
  return publicState(await prisma.escalaSolveOperation.findUniqueOrThrow({ where: { id: operation.id } }));
}

export async function generationOperationStatus(actor: EscalaActor, ownerKey: string, operationId: string) {
  const operation = await owned(actor, ownerKey, operationId);
  if (operation.state === "CANCEL_REQUESTED") return cancelGenerationOperation(actor, ownerKey, operationId);
  if (active.includes(operation.state as typeof active[number]) && operation.expiresAt.getTime() < Date.now()) {
    await cancelGenerationOperation(actor, ownerKey, operationId);
    await prisma.escalaSolveOperation.updateMany({ where: { id: operationId, state: "CANCELLED" }, data: { state: "TIMED_OUT" } });
    return publicState(await prisma.escalaSolveOperation.findUniqueOrThrow({ where: { id: operationId } }));
  }
  return publicState(operation);
}

export async function runGenerationOperation(actor: EscalaActor, ownerKey: string, operationId: string, workspaceId: string, expectedRevision: number, signal: AbortSignal) {
  const operation = await owned(actor, ownerKey, operationId);
  if (operation.workspaceId !== workspaceId || operation.expectedRevision !== expectedRevision) throw new EscalaError(409, "ESCALA_OPERATION_CHANGED", "Este cálculo pertence a outra versão da escala. Gere uma nova proposta.");
  if (signal.aborted) { await cancelGenerationOperation(actor, ownerKey, operationId); throw new EscalaSolverError("SOLVER_CANCELLED"); }
  const claimed = await prisma.escalaSolveOperation.updateMany({ where: { id: operationId, state: "CREATED", expiresAt: { gt: new Date() } }, data: { state: "RUNNING", startedAt: new Date() } });
  if (!claimed.count) throw new EscalaSolverError(operation.state === "CANCELLED" || operation.state === "CANCEL_REQUESTED" ? "SOLVER_CANCELLED" : "SOLVER_TIMED_OUT");
  try {
    const proposal = await generateEscala(actor, workspaceId, expectedRevision, { ...capability(operation), signal });
    if (signal.aborted) throw new EscalaSolverError("SOLVER_CANCELLED");
    const completed = await prisma.escalaSolveOperation.updateMany({ where: { id: operationId, state: "RUNNING", expiresAt: { gt: new Date() } }, data: { state: "COMPLETED", finishedAt: new Date() } });
    if (!completed.count) throw new EscalaSolverError("SOLVER_CANCELLED");
    return proposal;
  } catch (error) {
    if (error instanceof EscalaSolverError && error.code === "SOLVER_CANCELLED") {
      await cancelGenerationOperation(actor, ownerKey, operationId).catch(() => undefined);
    } else {
      await prisma.escalaSolveOperation.updateMany({ where: { id: operationId, state: "RUNNING" }, data: { state: error instanceof EscalaSolverError && error.code === "SOLVER_TIMED_OUT" ? "TIMED_OUT" : "FAILED", finishedAt: new Date() } });
    }
    throw error;
  }
}
