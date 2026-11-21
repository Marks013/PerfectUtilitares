import type { AppSession } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { EscalaClientAccess } from "./access-view";
import { canonicalBranchCode } from "./branch-code";
import { decideEscalaPermission, ESCALA_CAPABILITIES, type EscalaPrincipal } from "./permissions";

/** Display projection only. Endpoints must authorize each resource and operation independently. */
export async function getEscalaAccountClientAccess(session: AppSession | null): Promise<EscalaClientAccess | null> {
  const user = session?.user;
  if (!user?.id || user.status !== "ACTIVE" || !user.tenantId?.trim()) return null;
  const tenantId = user.tenantId;
  if (user.role === "ADMIN") {
    return { channel: "ACCOUNT", roleLabel: "Administrador", administrator: true, allBranches: true, branches: [] };
  }
  if (user.role !== "OPERATOR") return null;
  const accessPolicy = await prisma.escalaModuleAccessPolicy.findUnique({ where: { tenantId }, select: { mode: true } });
  const rows = await prisma.escalaBranchAccess.findMany({
    where: { tenantId, userId: user.id },
    select: { tenantId: true, userId: true, branchCode: true, role: true },
  });
  // Recheck ownership even after the database filter; duplicate canonical codes deny the whole branch.
  const branchGrants = rows.filter(row => row.tenantId === tenantId && row.userId === user.id);
  const principal: EscalaPrincipal = { kind: "account", id: user.id, tenantId, status: user.status, role: user.role, branchGrants };
  const codes = [...new Set(branchGrants.map(row => canonicalBranchCode(row.branchCode)).filter(Boolean))].sort();
  const branches = codes.flatMap(code => {
    const capabilities = ESCALA_CAPABILITIES.filter(capability => decideEscalaPermission({ principal, tenantId, branchCode: code, mode: accessPolicy?.mode ?? "ADMIN_ONLY" }, capability).allowed);
    return capabilities.length ? [{ code, label: `Filial ${code}`, capabilities }] : [];
  });
  return { channel: "ACCOUNT", roleLabel: "Operador", administrator: false, allBranches: false, branches };
}
