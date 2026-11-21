import { cookies } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decodeEscalaSessionCookie, ESCALA_ACCESS_COOKIE, escalaModuleTenantSlug, EscalaSessionConfigurationError, hashEscalaSessionToken } from "./module-session";
import { resolveEscalaOperatorSession, type EscalaOperatorSessionResolution } from "./operator-session-policy";
import { decideEscalaPermission, ESCALA_CAPABILITIES } from "./permissions";
import { canonicalBranchCode } from "./branch-code";
import type { EscalaClientAccess } from "./access-view";

export type EscalaScopedSessionContext = Extract<EscalaOperatorSessionResolution, { kind: "resolved" }>;

export function escalaScopedClientAccess(session: EscalaScopedSessionContext): EscalaClientAccess {
  const principal = session.principal;
  const codes = [...new Set(principal.branchGrants.map(grant => canonicalBranchCode(grant.branchCode)))].sort();
  return { channel: "USERNAME", roleLabel: "Operador", administrator: false, allBranches: false,
    expiresAt: new Date(session.expiresAtMs).toISOString(), branches: codes.flatMap(code => {
      const capabilities = ESCALA_CAPABILITIES.filter(capability => decideEscalaPermission({ principal,
        tenantId: principal.tenantId, mode: "SCOPED", branchCode: code }, capability).allowed);
      return capabilities.length ? [{ code, label: `Filial ${code}`, capabilities }] : [];
    }) };
}

const sessionSelect = {
  id: true, tenantId: true, operatorId: true, permissionVersion: true, accessPolicyVersion: true,
  createdAt: true, expiresAt: true, revokedAt: true,
  tenant: { select: { id: true, escalaModuleAccessPolicy: { select: { tenantId: true, mode: true, version: true } } } },
  operator: { select: {
    id: true, tenantId: true, active: true, permissionVersion: true,
    branchGrants: { select: { tenantId: true, operatorId: true, branchCode: true, active: true, capabilities: true } },
  } },
} satisfies Prisma.EscalaModuleSessionSelect;

/**
 * Candidate persisted-session adapter. No password-session fallback or permission cache.
 * Account precedence and branch/action authorization belong to the caller; this reader must
 * be called again before exposing the result of a long-running operation.
 * Database failures propagate so the HTTP guard can report unavailability, not successful access.
 */
export async function verifyEscalaScopedSessionCookie(value: string | null | undefined): Promise<EscalaScopedSessionContext | null> {
  let token: string | null;
  try { token = decodeEscalaSessionCookie(value); }
  catch (error) {
    if (error instanceof EscalaSessionConfigurationError) throw error;
    return null;
  }
  if (!token) return null;
  const tenantSlug = escalaModuleTenantSlug();
  const tokenHash = hashEscalaSessionToken(token);
  return prisma.$transaction(async tx => {
    // A repeatable snapshot keeps policy, operator version and grants coherent even if the ORM
    // loads relations with multiple queries. It does not replace reauthorization before delivery.
    const stored = await tx.escalaModuleSession.findFirst({
      where: { tokenHash, tenant: { slug: tenantSlug } }, select: sessionSelect,
    });
    if (!stored) return null;
    const operator = stored.operator;
    if (operator?.branchGrants.some(grant => grant.tenantId !== stored.tenant.id || grant.operatorId !== operator.id)) return null;
    const resolved = resolveEscalaOperatorSession({
      tenantId: stored.tenant.id,
      now: new Date(), // Check expiry after the database read, not before a potentially slow query.
      policy: stored.tenant.escalaModuleAccessPolicy,
      session: stored,
      operator,
    });
    return resolved.kind === "resolved" ? resolved : null;
  }, { isolationLevel: "RepeatableRead", maxWait: 5_000, timeout: 5_000 });
}

export async function getEscalaScopedModuleSession(): Promise<EscalaScopedSessionContext | null> {
  const jar = await cookies();
  return verifyEscalaScopedSessionCookie(jar.get(ESCALA_ACCESS_COOKIE)?.value);
}
