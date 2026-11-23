import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { EscalaError, lockEscalaAccess, requireEscalaCapability, type EscalaActor } from "./access";
import { loadEscalaApproval } from "./approved-policy-service";
import { projectWorkforceForDraft, readWorkforceForDraft } from "./global-workforce-draft";
import { planningContext } from "./planning-context.server";
import { getEscalaForRead, parseEscalaInput } from "./service";

const stale = () => new EscalaError(409, "ESCALA_STALE_REVISION", "O rascunho mudou. Reabra a revisão atual para sincronizar a equipe.");

export async function syncEscalaWorkforceDraft(actor: EscalaActor, id: string, expectedRevision: number) {
  const workspace = await getEscalaForRead(actor, id);
  if (workspace.revision !== expectedRevision) throw stale();
  if (workspace.status !== "DRAFT") throw new EscalaError(409, "ESCALA_REOPEN_REQUIRED", "Reabra a publicação antes de atualizar a equipe.");
  const branch = workspace.input.branchCode;
  await prisma.$transaction(async tx => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, "workspace.save", branch, tx);
    const row = await tx.escalaWorkspace.findFirst({
      where: { id, tenantId: actor.tenantId, branchCode: branch, revision: expectedRevision, status: "DRAFT" },
      select: { workforceState: true },
    });
    if (!row) throw stale();
    const source = await tx.escalaRevision.findUnique({
      where: { tenantId_workspaceId_revision: { tenantId: actor.tenantId, workspaceId: id, revision: expectedRevision } },
    });
    if (source?.status !== "DRAFT") throw stale();
    const input = parseEscalaInput(source.input);
    if (!actor.admin) {
      if (!source.approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "O rascunho precisa de aprovação administrativa.");
      await loadEscalaApproval(actor, source.approvedPolicyVersionId, tx, input);
    }
    const base = await readWorkforceForDraft(tx, actor.tenantId, branch);
    if (!base) return;
    // Read neighbouring publications first so overlapping days enter the projection protected.
    const contextual = await planningContext(actor, id, input, tx);
    const projected = projectWorkforceForDraft(contextual, row.workforceState, base);
    if (!projected.changed) return;
    const next = parseEscalaInput(await planningContext(actor, id, projected.input, tx));
    const revision = expectedRevision + 1;
    const updated = await tx.escalaWorkspace.updateMany({
      where: { id, tenantId: actor.tenantId, branchCode: branch, revision: expectedRevision, status: "DRAFT" },
      data: { revision, workforceState: projected.state },
    });
    if (updated.count !== 1) throw stale();
    const access = actor.moduleSessionId ? { accessChannel: "ESCALAS_USERNAME_ONLY", moduleSessionId: actor.moduleSessionId } : {};
    await tx.escalaRevision.create({ data: { tenantId: actor.tenantId, workspaceId: id, revision, status: "DRAFT",
      input: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue, createdById: actor.userId,
      approvedPolicyVersionId: source.approvedPolicyVersionId, ...access } });
    await tx.auditLog.create({ data: { userId: actor.userId, entity: "EscalaWorkspace", entityId: id, action: "SYNC_WORKFORCE",
      metadata: { tenantId: actor.tenantId, revision, previousRevision: expectedRevision, workforceRevision: base.revision, ...access } } });
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
  return getEscalaForRead(actor, id);
}
