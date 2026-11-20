import type { AppSession } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canonicalBranchCode } from "./branch-code";

import { EscalaError } from "./errors";
export { EscalaError } from "./errors";

export type EscalaActor = { userId: string | null; tenantId: string; admin: boolean; moduleSessionId?: string; accountSessionId?: string };
export type EscalaPermission = { canEdit: boolean; canPublish: boolean };

export function escalaActor(session: AppSession): EscalaActor {
  if (session.user.status !== "ACTIVE" || !session.user.tenantId) {
    throw new EscalaError(403, "ESCALA_TENANT_REQUIRED", "É necessário um usuário ativo vinculado a uma empresa para acessar Escalas.");
  }
  return { userId: session.user.id, tenantId: session.user.tenantId, admin: session.user.role === "ADMIN", ...(session.escalaSessionId ? { accountSessionId: session.escalaSessionId } : {}) };
}

export async function branchPermission(actor: EscalaActor, branchCode: string): Promise<EscalaPermission> {
  if (actor.moduleSessionId) return { canEdit: true, canPublish: false };
  if (actor.admin) return { canEdit: true, canPublish: true };
  if (!actor.userId) throw new EscalaError(403, "ESCALA_BRANCH_FORBIDDEN", "Este acesso não permite consultar a filial.");
  const access = await prisma.escalaBranchAccess.findUnique({
    where: { tenantId_userId_branchCode: { tenantId: actor.tenantId, userId: actor.userId, branchCode: canonicalBranchCode(branchCode) } },
    select: { role: true },
  });
  if (!access || !["VIEWER", "PLANNER", "APPROVER"].includes(access.role)) {
    throw new EscalaError(403, "ESCALA_BRANCH_FORBIDDEN", "Você não possui acesso a esta filial.");
  }
  return { canEdit: access.role !== "VIEWER", canPublish: access.role === "APPROVER" };
}

export async function allowedBranches(actor: EscalaActor): Promise<string[] | null> {
  if (actor.moduleSessionId || actor.admin) return null;
  if (!actor.userId) return [];
  const grants = await prisma.escalaBranchAccess.findMany({
    where: { tenantId: actor.tenantId, userId: actor.userId, role: { in: ["VIEWER", "PLANNER", "APPROVER"] } },
    select: { branchCode: true },
  });
  return [...new Set(grants.map((grant) => canonicalBranchCode(grant.branchCode)))];
}

/** Capability discovery only; CREATE still checks the requested branch independently. */
export async function canCreateEscala(actor: EscalaActor): Promise<boolean> {
  if (actor.moduleSessionId || actor.admin) return true;
  if (!actor.userId) return false;
  return Boolean(await prisma.escalaBranchAccess.findFirst({
    where: { tenantId: actor.tenantId, userId: actor.userId, role: { in: ["PLANNER", "APPROVER"] } },
    select: { branchCode: true },
  }));
}

export function requireEscalaPermission(permission: EscalaPermission, action: "edit" | "publish") {
  if (!(action === "publish" ? permission.canPublish : permission.canEdit)) {
    throw new EscalaError(403, "ESCALA_ACTION_FORBIDDEN", action === "publish"
      ? "Você não possui permissão para publicar escalas desta filial."
      : "Você não possui permissão para alterar escalas desta filial.");
  }
}
