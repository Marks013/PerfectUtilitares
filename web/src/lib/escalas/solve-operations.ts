import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { branchPermission, EscalaError, lockEscalaAccess, requireEscalaCapability, type EscalaActor } from "./access";
import { getEscala, generateEscala, recheckEscalaGeneration } from "./service";
import { EscalaSolverError } from "./solver-errors";
import { cancelSolverOperation, solverCapability } from "./solver-transport";

const running = ["RUNNING", "CANCEL_REQUESTED"] as const;
const active = ["CREATED", ...running] as const;
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
  // Control requests authorize metadata only; they must not parse or validate
  // a potentially large or legacy revision before stopping its calculation.
  const workspace = await prisma.escalaWorkspace.findFirst({
    where: { id: operation.workspaceId, tenantId: actor.tenantId },
    select: { branchCode: true },
  });
  if (!workspace) throw new EscalaError(404, "ESCALA_NOT_FOUND", "Escala não encontrada.");
  await branchPermission(actor, workspace.branchCode);
  await requireEscalaCapability(actor, "schedule.generate", workspace.branchCode);
  return operation;
}

async function cleanup(ownerKey: string, tenantId: string) {
  const now = new Date();
  // Expiry is much longer than the Python process deadline. A late result still loses its CAS below.
  await prisma.escalaSolveOperation.updateMany({ where: { tenantId, ownerKey, state: { in: [...active] }, expiresAt: { lt: now } }, data: { state: "TIMED_OUT", finishedAt: now } });
  const expired = await prisma.escalaSolveOperation.findMany({ where: { tenantId, ownerKey, state: { in: [...final] }, expiresAt: { lt: new Date(Date.now() - 86_400_000) } }, select: { id: true }, take: 50 });
  if (expired.length) await prisma.escalaSolveOperation.deleteMany({ where: { id: { in: expired.map(value => value.id) }, state: { in: [...final] } } });
}

export async function startGenerationOperation(actor: EscalaActor, ownerKey: string, workspaceId: string, expectedRevision: number) {
  const workspace = await getEscala(actor, workspaceId);
  await requireEscalaCapability(actor, "schedule.generate", workspace.input.branchCode);
  if (workspace.revision !== expectedRevision) throw new EscalaError(409, "ESCALA_REVISION_CONFLICT", "A escala mudou. Atualize a proposta antes de calcular novamente.");
  await cleanup(ownerKey, actor.tenantId);
  try {
    const operation = await prisma.$transaction(async tx => {
      await lockEscalaAccess(tx, actor.tenantId);
      await requireEscalaCapability(actor, "schedule.generate", workspace.input.branchCode, tx);
      const current = await tx.escalaWorkspace.findFirst({ where: { id: workspaceId, tenantId: actor.tenantId, revision: expectedRevision }, select: { revision: true } });
      if (!current) throw new EscalaError(409, "ESCALA_REVISION_CONFLICT", "A revisão mudou antes do início do cálculo.");
      const existing = await tx.escalaSolveOperation.count({ where: { tenantId: actor.tenantId, ownerKey, state: { in: [...active] }, expiresAt: { gt: new Date() } } });
      if (existing) throw new EscalaSolverError("SOLVER_BUSY");
      return tx.escalaSolveOperation.create({ data: { tenantId: actor.tenantId, workspaceId, expectedRevision, ownerKey, expiresAt: new Date(Date.now() + 120_000) } });
    });
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
  const now = new Date();
  if (active.includes(operation.state as typeof active[number]) && operation.expiresAt <= now) {
    const where = { id: operationId, expiresAt: { lte: now } };
    const data = { state: "TIMED_OUT" as const, finishedAt: now };
    if (operation.state === "CREATED") {
      const unclaimed = await prisma.escalaSolveOperation.updateMany({
        where: { ...where, state: "CREATED" }, data,
      });
      if (unclaimed.count) return publicState({ ...operation, ...data });
    }

    // A claim racing expiry can win before the CREATED CAS. Expire only a
    // still-active row; never replace a completion or confirmed cancellation.
    const expired = await prisma.escalaSolveOperation.updateMany({
      where: { ...where, state: { in: [...running] } }, data,
    });
    if (expired.count) {
      try { await cancelSolverOperation(capability(operation)); }
      catch { /* The solver's independent process deadline remains in force. */ }
    }
    return publicState(await prisma.escalaSolveOperation.findUniqueOrThrow({ where: { id: operationId } }));
  }
  if (operation.state === "CANCEL_REQUESTED") return cancelGenerationOperation(actor, ownerKey, operationId);
  return publicState(operation);
}

function assertOperationVersion(operation: Operation, workspaceId: string, expectedRevision: number) {
  if (operation.workspaceId !== workspaceId || operation.expectedRevision !== expectedRevision) {
    throw new EscalaError(409, "ESCALA_OPERATION_CHANGED", "Este cálculo pertence a outra versão da escala. Gere uma nova proposta.");
  }
}

function assertOperationActiveForDelivery(operation: Operation) {
  if (operation.state === "CANCELLED" || operation.state === "CANCEL_REQUESTED") throw new EscalaSolverError("SOLVER_CANCELLED");
  if (operation.state === "TIMED_OUT" || operation.expiresAt <= new Date()) throw new EscalaSolverError("SOLVER_TIMED_OUT");
}

function operationStateConflict() {
  return new EscalaError(409, "ESCALA_OPERATION_CHANGED", "O estado do cálculo mudou. Confira a revisão antes de gerar uma nova proposta.");
}

export async function runGenerationOperation(actor: EscalaActor, ownerKey: string, operationId: string, workspaceId: string, expectedRevision: number, signal: AbortSignal, comparisonReference?: unknown) {
  const operation = await owned(actor, ownerKey, operationId);
  assertOperationVersion(operation, workspaceId, expectedRevision);
  const scope = { id: operationId, tenantId: actor.tenantId, ownerKey, workspaceId, expectedRevision };
  const rejectLostTransition = async (): Promise<never> => {
    const current = await owned(actor, ownerKey, operationId);
    assertOperationVersion(current, workspaceId, expectedRevision);
    assertOperationActiveForDelivery(current);
    await recheckEscalaGeneration(actor, workspaceId, expectedRevision);
    throw operationStateConflict();
  };
  const rejectAborted = async (): Promise<never> => {
    await cancelGenerationOperation(actor, ownerKey, operationId).catch(() => undefined);
    throw new EscalaSolverError("SOLVER_CANCELLED");
  };
  if (signal.aborted) return rejectAborted();
  const startedAt = new Date();
  const claimed = await prisma.escalaSolveOperation.updateMany({
    where: { ...scope, state: "CREATED", expiresAt: { gt: startedAt } }, data: { state: "RUNNING", startedAt },
  });
  if (!claimed.count) return rejectLostTransition();

  let proposal: Awaited<ReturnType<typeof generateEscala>>;
  try {
    proposal = await generateEscala(actor, workspaceId, expectedRevision, { ...capability(operation), signal, ...(comparisonReference === undefined ? {} : { comparisonReference }) });
  } catch (error) {
    if (signal.aborted || error instanceof EscalaSolverError && error.code === "SOLVER_CANCELLED") return rejectAborted();
    const finishedAt = new Date();
    const failed = await prisma.escalaSolveOperation.updateMany({
      where: { ...scope, state: "RUNNING", expiresAt: { gt: finishedAt } },
      data: { state: error instanceof EscalaSolverError && error.code === "SOLVER_TIMED_OUT" ? "TIMED_OUT" : "FAILED", finishedAt },
    });
    if (!failed.count) return rejectLostTransition();
    throw error;
  }

  if (signal.aborted) return rejectAborted();
  const finishedAt = new Date();
  const completed = await prisma.escalaSolveOperation.updateMany({
    where: { ...scope, state: "RUNNING", expiresAt: { gt: finishedAt } }, data: { state: "COMPLETED", finishedAt },
  });
  if (!completed.count) return rejectLostTransition();
  const current = await owned(actor, ownerKey, operationId);
  assertOperationVersion(current, workspaceId, expectedRevision);
  assertOperationActiveForDelivery(current);
  if (current.state !== "COMPLETED") throw operationStateConflict();
  // COMPLETED records calculation lifecycle, not permission to deliver its result.
  await recheckEscalaGeneration(actor, workspaceId, expectedRevision);
  if (signal.aborted) return rejectAborted();
  assertOperationActiveForDelivery(current);
  return proposal;
}
