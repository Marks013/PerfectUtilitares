import type { AppSession } from "@/auth";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalBranchCode } from "./branch-code";

import { EscalaError } from "./errors";
import { decideEscalaPermission, type EscalaCapability, type EscalaPermissionContext } from "./permissions";
import { resolveEscalaPermissionScope } from "./permission-scope";
import { resolveEscalaOperatorSession } from "./operator-session-policy";
export { EscalaError } from "./errors";

export type EscalaActor = { userId: string | null; tenantId: string; admin: boolean; moduleSessionId?: string; accountSessionId?: string; accountSecurityVersion?: number };
export type EscalaPermission = { canEdit: boolean; canPublish: boolean };

/** Serializes module policy/grant/session changes and final writes in the same tenant. */
export async function lockEscalaAccess(tx: Prisma.TransactionClient, tenantId: string) {
  const key = `escala-access:${tenantId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

export async function currentEscalaPermissionContext(actor: EscalaActor,
  db: Prisma.TransactionClient = prisma): Promise<EscalaPermissionContext> {
  const policy = await db.escalaModuleAccessPolicy.findUnique({ where: { tenantId: actor.tenantId } });
  if (actor.userId) {
    if (db !== prisma) await db.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} AND "tenantId" = ${actor.tenantId} FOR SHARE`;
    const user = await db.user.findFirst({ where: { id: actor.userId, tenantId: actor.tenantId },
      select: { id: true, tenantId: true, status: true, role: true, securityVersion: true } });
    if (!user || user.id !== actor.userId || user.tenantId !== actor.tenantId || user.status !== "ACTIVE" || (actor.admin && user.role !== "ADMIN")
      || (actor.accountSecurityVersion !== undefined && actor.accountSecurityVersion !== user.securityVersion)) {
      throw new EscalaError(403, "ESCALA_ACCESS_REQUIRED", "O acesso da conta mudou. Entre novamente.");
    }
    actor.accountSecurityVersion = user.securityVersion;
    const grants = user.role === "ADMIN" ? [] : await db.escalaBranchAccess.findMany({
      where: { tenantId: actor.tenantId, userId: user.id },
      select: { tenantId: true, userId: true, branchCode: true, role: true },
    });
    return { tenantId: actor.tenantId, mode: policy?.mode ?? "ADMIN_ONLY",
      principal: { kind: "account", id: user.id, tenantId: actor.tenantId, status: user.status, role: user.role, branchGrants: grants } };
  }
  if (actor.moduleSessionId) {
    const session = await db.escalaModuleSession.findFirst({ where: { id: actor.moduleSessionId, tenantId: actor.tenantId },
      include: { operator: { include: { branchGrants: true } } } });
    const resolved = resolveEscalaOperatorSession({ tenantId: actor.tenantId, now: new Date(), policy,
      session, operator: session?.operator ?? null });
    if (resolved.kind === "resolved") return { tenantId: actor.tenantId, mode: "SCOPED", principal: resolved.principal };
  }
  throw new EscalaError(401, "ESCALA_ACCESS_REQUIRED", "O acesso expirou ou foi revogado. Entre novamente.");
}

export async function requireEscalaCapability(actor: EscalaActor, capability: EscalaCapability,
  branchCode?: string, db: Prisma.TransactionClient = prisma) {
  const context = { ...await currentEscalaPermissionContext(actor, db), branchCode };
  if (!decideEscalaPermission(context, capability).allowed) throw new EscalaError(403,
    "ESCALA_ACTION_FORBIDDEN", "Este acesso não permite realizar esta ação nesta filial.");
  return context;
}

export function escalaActor(session: AppSession): EscalaActor {
  if (session.user.status !== "ACTIVE" || !session.user.tenantId) {
    throw new EscalaError(403, "ESCALA_TENANT_REQUIRED", "É necessário um usuário ativo vinculado a uma empresa para acessar Escalas.");
  }
  return { userId: session.user.id, tenantId: session.user.tenantId, admin: session.user.role === "ADMIN", ...(session.escalaSessionId ? { accountSessionId: session.escalaSessionId } : {}) };
}

export async function branchPermission(actor: EscalaActor, branchCode: string): Promise<EscalaPermission> {
  const context = { ...await currentEscalaPermissionContext(actor), branchCode: canonicalBranchCode(branchCode) };
  if (!decideEscalaPermission(context, "workspace.read").allowed) throw new EscalaError(403, "ESCALA_BRANCH_FORBIDDEN", "Você não possui acesso a esta filial.");
  return { canEdit: decideEscalaPermission(context, "workspace.save").allowed,
    canPublish: decideEscalaPermission(context, "workspace.publish").allowed };
}

export async function allowedBranches(actor: EscalaActor, capability: EscalaCapability = "workspace.read"): Promise<string[] | null> {
  const scope = resolveEscalaPermissionScope(await currentEscalaPermissionContext(actor), capability);
  return scope.kind === "all" ? null : scope.kind === "branches" ? [...scope.branchCodes] : [];
}

/** Discovery only; creating a workspace still authorizes its requested branch. */
export async function canCreateEscala(actor: EscalaActor): Promise<boolean> {
  const branches = await allowedBranches(actor, "workspace.create");
  return branches === null || branches.length > 0;
}

export function requireEscalaPermission(permission: EscalaPermission, action: "edit" | "publish") {
  if (!(action === "publish" ? permission.canPublish : permission.canEdit)) {
    throw new EscalaError(403, "ESCALA_ACTION_FORBIDDEN", action === "publish"
      ? "Você não possui permissão para publicar escalas desta filial."
      : "Você não possui permissão para alterar escalas desta filial.");
  }
}
