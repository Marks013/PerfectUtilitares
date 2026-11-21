import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { encodeEscalaSessionCookie, escalaModuleTenantSlug, escalaSessionTtlMinutes, hashEscalaSessionToken } from "./module-session";
import { normalizeEscalaOperatorUsername } from "./operator-username";
import { resolveEscalaPermissionScope } from "./permission-scope";
import { lockEscalaAccess } from "./access";

const MAX_ACTIVE_SESSIONS = 20;
const validVersion = (version: number) => Number.isInteger(version) && version > 0 && version <= 2_147_483_647;

/**
 * Candidate username-only admission: identifies an existing operator, never creates an account.
 * The HTTP caller must enforce origin/rate limits and preserve authenticated-account precedence.
 * Admin changes must increment the operator/policy version in their transaction. Current readers
 * reject any session made obsolete by a change after this transaction's admission checks.
 */
export async function createEscalaScopedModuleSession(username: unknown) {
  const usernameNormalized = normalizeEscalaOperatorUsername(username);
  if (!usernameNormalized) return null;
  return prisma.$transaction(async tx => {
    const tenant = await tx.tenant.findUnique({ where: { slug: escalaModuleTenantSlug() }, select: { id: true } });
    if (!tenant) return null;
    await lockEscalaAccess(tx, tenant.id);

    // Serializes admissions for this operator only. ReadCommitted lets a waiter see sessions
    // committed by its predecessor before it chooses which 19 existing sessions to retain.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "EscalaOperator"
      WHERE "tenantId" = ${tenant.id} AND "usernameNormalized" = ${usernameNormalized}
      FOR UPDATE
    `;
    if (locked.length !== 1) return null;
    const operator = await tx.escalaOperator.findUnique({
      where: { tenantId_id: { tenantId: tenant.id, id: locked[0].id } },
      select: {
        id: true, tenantId: true, usernameNormalized: true, active: true, permissionVersion: true,
        branchGrants: { select: { tenantId: true, operatorId: true, branchCode: true, active: true, capabilities: true } },
      },
    });
    if (!operator || operator.id !== locked[0].id || operator.tenantId !== tenant.id
      || operator.usernameNormalized !== usernameNormalized || !operator.active || !validVersion(operator.permissionVersion)
      || operator.branchGrants.some(grant => grant.tenantId !== tenant.id || grant.operatorId !== operator.id)) return null;
    const policy = await tx.escalaModuleAccessPolicy.findUnique({
      where: { tenantId: tenant.id }, select: { tenantId: true, mode: true, version: true },
    });
    if (!policy || policy.tenantId !== tenant.id || policy.mode !== "SCOPED" || !validVersion(policy.version)) return null;
    const scope = resolveEscalaPermissionScope({
      tenantId: tenant.id, mode: policy.mode,
      principal: { kind: "operator", id: operator.id, tenantId: tenant.id, active: operator.active, branchGrants: operator.branchGrants },
    }, "workspace.read");
    if (scope.kind !== "branches" || scope.branchCodes.length === 0) return null;

    const now = new Date(), ttl = escalaSessionTtlMinutes(), expiresAt = new Date(now.getTime() + ttl * 60_000);
    const token = randomBytes(32).toString("base64url");
    const value = encodeEscalaSessionCookie(token); // Configuration failure precedes every write.
    const activeSessions = { tenantId: tenant.id, operatorId: operator.id, revokedAt: null, expiresAt: { gt: now } };
    const retained = await tx.escalaModuleSession.findMany({
      where: activeSessions, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_ACTIVE_SESSIONS - 1, select: { id: true },
    });
    await tx.escalaModuleSession.updateMany({
      where: { ...activeSessions, id: { notIn: retained.map(session => session.id) } }, data: { revokedAt: now },
    });
    const session = await tx.escalaModuleSession.create({
      data: {
        tenantId: tenant.id, operatorId: operator.id, tokenHash: hashEscalaSessionToken(token),
        permissionVersion: operator.permissionVersion, accessPolicyVersion: policy.version, createdAt: now, expiresAt,
      },
      select: { id: true },
    });
    await tx.auditLog.create({ data: {
      action: "LOGIN", entity: "EscalaModuleSession", entityId: session.id,
      metadata: { accessChannel: "ESCALAS_USERNAME_ONLY", tenantId: tenant.id, operatorId: operator.id,
        permissionVersion: operator.permissionVersion, accessPolicyVersion: policy.version },
    } });
    return { id: session.id, value, expiresAt, maxAgeSeconds: ttl * 60 };
  }, { isolationLevel: "ReadCommitted", maxWait: 5_000, timeout: 5_000 });
}
