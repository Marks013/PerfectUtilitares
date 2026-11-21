import type { EscalaOperatorBranchGrant, EscalaPrincipal } from "./permissions";

/** Future server-side projections, not a schema migration or a browser payload contract. */
export type EscalaOperatorRecord = Readonly<{
  id: string; tenantId: string; active: boolean; permissionVersion: number;
  branchGrants: readonly EscalaOperatorBranchGrant[];
}>;
export type EscalaOperatorSessionRecord = Readonly<{
  id: string; tenantId: string; operatorId: string | null;
  permissionVersion: number | null; accessPolicyVersion: number | null;
  createdAt: Date; expiresAt: Date; revokedAt: Date | null;
}>;
export type EscalaAccessPolicyRecord = Readonly<{ tenantId: string; mode: string; version: number }>;
type Denial = "INVALID_CONTEXT" | "SCOPED_ACCESS_REQUIRED" | "SESSION_REQUIRED" | "INVALID_SESSION"
  | "SESSION_REVOKED" | "SESSION_EXPIRED" | "IDENTITY_REQUIRED" | "INACTIVE_IDENTITY"
  | "TENANT_FORBIDDEN" | "VERSION_MISMATCH";
export type EscalaOperatorSessionResolution = Readonly<{
  kind: "resolved"; principal: Extract<EscalaPrincipal, { kind: "operator" }>;
  sessionId: string; permissionVersion: number; accessPolicyVersion: number; expiresAtMs: number;
}> | Readonly<{ kind: "denied"; reason: Denial }>;

const deny = (reason: Denial): EscalaOperatorSessionResolution => Object.freeze({ kind: "denied", reason });
const validVersion = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const validId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.trim() === value;
const dateMs = (value: Date): number => value instanceof Date ? value.getTime() : Number.NaN;

/**
 * Checks current persisted records AFTER cookie integrity and token-hash lookup by the server.
 * Does not authenticate a name/token, fetch state, authorize a branch or override account precedence.
 * Call again with current records before exposing/applying a job result; do not cache this resolution.
 */
export function resolveEscalaOperatorSession(input: Readonly<{
  tenantId: string; now: Date; policy: EscalaAccessPolicyRecord | null;
  session: EscalaOperatorSessionRecord | null; operator: EscalaOperatorRecord | null;
}>): EscalaOperatorSessionResolution {
  const { tenantId, policy, session, operator } = input;
  const now = dateMs(input.now);
  if (!validId(tenantId) || !Number.isFinite(now) || !policy || !validVersion(policy.version)) return deny("INVALID_CONTEXT");
  if (policy.tenantId !== tenantId) return deny("TENANT_FORBIDDEN");
  if (policy.mode !== "SCOPED") return deny("SCOPED_ACCESS_REQUIRED");
  if (!session) return deny("SESSION_REQUIRED");
  if (!validId(session.id) || !validId(session.operatorId)) return deny("INVALID_SESSION");
  if (session.tenantId !== tenantId) return deny("TENANT_FORBIDDEN");
  if (session.revokedAt !== null) return deny("SESSION_REVOKED");
  const created = dateMs(session.createdAt), expires = dateMs(session.expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires) || created > now || expires <= created) return deny("INVALID_SESSION");
  if (expires <= now) return deny("SESSION_EXPIRED");
  if (!operator || !validId(operator.id) || operator.id !== session.operatorId) return deny("IDENTITY_REQUIRED");
  if (operator.tenantId !== tenantId) return deny("TENANT_FORBIDDEN");
  if (operator.active !== true) return deny("INACTIVE_IDENTITY");
  if (!validVersion(operator.permissionVersion) || !validVersion(session.permissionVersion)
    || !validVersion(session.accessPolicyVersion) || session.permissionVersion !== operator.permissionVersion
    || session.accessPolicyVersion !== policy.version) return deny("VERSION_MISMATCH");

  const principal: Extract<EscalaPrincipal, { kind: "operator" }> = Object.freeze({
    kind: "operator", id: operator.id, tenantId, active: true,
    branchGrants: Object.freeze(operator.branchGrants.map(grant => Object.freeze({
      tenantId: grant.tenantId, operatorId: grant.operatorId, branchCode: grant.branchCode, active: grant.active,
      capabilities: Object.freeze([...grant.capabilities]),
    }))),
  });
  return Object.freeze({ kind: "resolved", principal, sessionId: session.id,
    permissionVersion: operator.permissionVersion, accessPolicyVersion: policy.version, expiresAtMs: expires });
}
