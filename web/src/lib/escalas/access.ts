import type { AppSession } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canonicalBranchCode } from "./branch-code";

export class EscalaError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "EscalaError";
  }
}

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

export function requireEscalaPermission(permission: EscalaPermission, action: "edit" | "publish") {
  if (!(action === "publish" ? permission.canPublish : permission.canEdit)) {
    throw new EscalaError(403, "ESCALA_ACTION_FORBIDDEN", action === "publish"
      ? "Você não possui permissão para publicar escalas desta filial."
      : "Você não possui permissão para alterar escalas desta filial.");
  }
}
