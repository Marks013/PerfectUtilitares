import { prisma } from "@/lib/prisma";
import { isDecember2026Cutover } from "./planning-calendar";

const legacyDecember = { startDate: "2026-11-30", endDate: "2027-01-03" } as const;

type ListedDraft = { id: string; status: string; branchCode: string; startDate: string; endDate: string };

/** Hide replaced drafts only from the active list; keep all revisions and policy origins. */
export async function excludeSupersededDecemberDrafts<T extends ListedDraft>(tenantId: string, rows: T[]): Promise<T[]> {
  const replacedBranches = new Set(rows.filter(row => isDecember2026Cutover({
    ...row, planningWeekStartsOn: "SUNDAY",
  })).map(row => row.branchCode));
  const legacy = rows.filter(row => row.status === "DRAFT" && row.startDate === legacyDecember.startDate
    && row.endDate === legacyDecember.endDate && replacedBranches.has(row.branchCode));
  if (!legacy.length) return rows;

  const policies = await prisma.escalaBranchPolicyVersion.findMany({
    where: { tenantId, ...legacyDecember, branchCode: { in: [...new Set(legacy.map(row => row.branchCode))] } },
    select: { branchCode: true, originWorkspaceId: true, revokedAt: true },
  });
  const activeBranches = new Set(policies.filter(policy => policy.revokedAt === null).map(policy => policy.branchCode));
  const revokedOrigins = new Set(policies.filter(policy => policy.revokedAt !== null).map(policy => policy.originWorkspaceId));
  const candidates = legacy.filter(row => revokedOrigins.has(row.id) && !activeBranches.has(row.branchCode));
  if (!candidates.length) return rows;

  // A previously published or actively linked revision keeps the workspace visible.
  const hidden = await prisma.escalaWorkspace.findMany({
    where: {
      tenantId, id: { in: candidates.map(row => row.id) }, status: "DRAFT",
      revisions: {
        some: { policyOrigins: { some: { revokedAt: { not: null } } } },
        none: { OR: [
          { status: "PUBLISHED" },
          { policyOrigins: { some: { revokedAt: null } } },
          { approvedPolicyVersion: { is: { revokedAt: null } } },
        ] },
      },
    },
    select: { id: true },
  });
  const hiddenIds = new Set(hidden.map(row => row.id));
  return rows.filter(row => !hiddenIds.has(row.id));
}
