import type { Prisma } from "@/generated/prisma/client";
import { EscalaError } from "./errors";

type DraftOrigin = { id: string; status: string; branchCode: string; startDate: string; endDate: string };
function retainedHistory() {
  return new EscalaError(409, "ESCALA_DELETE_DEPENDENCY", "A aprovação está ativa ou o histórico ainda é necessário para outro planejamento. Nenhum dado foi removido.");
}

/** Run only inside the locked administrator deletion transaction. */
export async function removeReplacedDraftApprovals(tx: Prisma.TransactionClient, tenantId: string, draft: DraftOrigin) {
  if (draft.status !== "DRAFT" || draft.startDate !== "2026-11-30" || draft.endDate !== "2027-01-03") throw retainedHistory();
  const scope = { tenantId, branchCode: draft.branchCode };
  const replacement = await tx.escalaWorkspace.findFirst({
    where: { ...scope, startDate: "2026-12-01", endDate: "2026-12-31" }, select: { id: true },
  });
  if (!replacement) throw retainedHistory();

  const origins = { tenantId, originWorkspaceId: draft.id };
  const policies = await tx.escalaBranchPolicyVersion.findMany({
    where: origins, select: { id: true, revokedAt: true, branchCode: true, startDate: true, endDate: true },
  });
  if (!policies.length || policies.some(p => !p.revokedAt || p.branchCode !== draft.branchCode
    || p.startDate !== draft.startDate || p.endDate !== draft.endDate)) throw retainedHistory();
  const approvalIds = policies.map(p => p.id);
  const activePolicy = await tx.escalaBranchPolicyVersion.findFirst({
    where: { ...scope, startDate: draft.startDate, endDate: draft.endDate, revokedAt: null },
    select: { id: true },
  });
  const activeCalc = await tx.escalaSolveOperation.findFirst({
    where: { tenantId, workspaceId: draft.id, state: { in: ["CREATED", "RUNNING", "CANCEL_REQUESTED"] }, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  const reference = await tx.escalaRevision.findFirst({
    where: { tenantId, workspaceId: { not: draft.id }, OR: [
      { approvedPolicyVersionId: { in: approvalIds } },
      { input: { path: ["planningCalendarSource", "workspaceId"], equals: draft.id } },
    ] }, select: { id: true },
  });
  const team = await tx.escalaImportedTeam.findUnique({
    where: { tenantId_branchCode: scope }, select: { sourceWorkspaceId: true },
  });
  if (activePolicy || activeCalc || reference || team?.sourceWorkspaceId === draft.id) throw retainedHistory();

  // Break only the internal FK cycle. The caller removes these same revisions
  // in this transaction; no surviving revision loses its approval.
  await tx.escalaRevision.updateMany({
    where: { tenantId, workspaceId: draft.id, status: "DRAFT", approvedPolicyVersionId: { in: approvalIds } },
    data: { approvedPolicyVersionId: null },
  });
  const removed = await tx.escalaBranchPolicyVersion.deleteMany({
    where: { ...origins, id: { in: approvalIds }, revokedAt: { not: null } },
  });
  if (removed.count !== policies.length) throw retainedHistory();
}
