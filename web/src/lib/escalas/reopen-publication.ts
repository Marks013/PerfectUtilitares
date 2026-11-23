import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { EscalaError, lockEscalaAccess, requireEscalaCapability, type EscalaActor } from "./access";
import { loadEscalaApproval } from "./approved-policy-service";
import { workforceDraftInfo } from "./global-workforce-binding";
import { getEscala } from "./service";
import { validateEscala } from "./validation";

const stale = () => new EscalaError(409, "ESCALA_STALE_REVISION", "A versão da proposta mudou. Recarregue a escala antes de reabrir.");

export async function reopenEscalaPublication(actor: EscalaActor, id: string, expectedRevision: number) {
  const current = await getEscala(actor, id);
  const branchCode = current.input.branchCode;
  await requireEscalaCapability(actor, "workspace.publish", branchCode);
  if (current.revision !== expectedRevision) throw stale();
  if (current.status !== "PUBLISHED") throw new EscalaError(409, "ESCALA_NOT_PUBLISHED", "Somente a publicação atual pode ser reaberta.");

  const revision = expectedRevision + 1, updatedAt = new Date();
  const validation = validateEscala(current.input);
  const provenance = actor.moduleSessionId ? { accessChannel: "ESCALAS_USERNAME_ONLY", moduleSessionId: actor.moduleSessionId } : {};
  const workforce = await prisma.$transaction(async (tx) => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, "workspace.publish", branchCode, tx);
    const source = await tx.escalaRevision.findUnique({
      where: { tenantId_workspaceId_revision: { tenantId: actor.tenantId, workspaceId: id, revision: expectedRevision } },
      select: { status: true, input: true, approvedPolicyVersionId: true },
    });
    if (source?.status !== "PUBLISHED") throw stale();
    if (!actor.admin) {
      if (!source.approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "O planejamento precisa de aprovação administrativa antes do acesso operacional.");
      await loadEscalaApproval(actor, source.approvedPolicyVersionId, tx, current.input);
    }
    const updated = await tx.escalaWorkspace.updateMany({
      where: { id, tenantId: actor.tenantId, branchCode, revision: expectedRevision, status: "PUBLISHED" },
      data: { revision, status: "DRAFT", updatedAt },
    });
    if (updated.count !== 1) throw stale();
    await tx.escalaRevision.create({ data: {
      tenantId: actor.tenantId, workspaceId: id, revision, status: "DRAFT", input: source.input as Prisma.InputJsonValue,
      createdById: actor.userId, approvedPolicyVersionId: source.approvedPolicyVersionId, ...provenance,
    } });
    await tx.auditLog.create({ data: {
      userId: actor.userId, action: "REOPEN_PUBLICATION", entity: "EscalaWorkspace", entityId: id,
      metadata: { ...provenance, tenantId: actor.tenantId, revision, previousRevision: expectedRevision, approvedPolicyVersionId: source.approvedPolicyVersionId },
    } });
    const saved = await tx.escalaWorkspace.findFirst({ where: { tenantId: actor.tenantId, id, revision }, select: { workforceState: true } });
    return workforceDraftInfo(tx, actor.tenantId, branchCode, saved?.workforceState);
  });

  return { ...current, revision, status: "DRAFT" as const, validation, updatedAt: updatedAt.toISOString(), ...(workforce ? { workforce } : {}) };
}
