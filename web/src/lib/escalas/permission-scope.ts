import { canonicalBranchCode } from "./branch-code";
import { decideEscalaPermission, type EscalaPermissionContext, type EscalaPrincipal } from "./permissions";

export type EscalaPermissionScope = Readonly<{ kind: "all"; tenantId: string }>
  | Readonly<{ kind: "branches"; tenantId: string; branchCodes: readonly string[] }>
  | Readonly<{ kind: "none" }>;

/** Explicit collection scope. Empty/revoked grants never mean every branch. */
export function resolveEscalaPermissionScope(
  context: Omit<EscalaPermissionContext, "branchCode">,
  capability: string,
): EscalaPermissionScope {
  const initial = decideEscalaPermission({ ...context, branchCode: undefined }, capability);
  if (initial.allowed) {
    return Object.freeze({ kind: "all", tenantId: context.tenantId });
  }
  if (initial.reason !== "BRANCH_REQUIRED") return Object.freeze({ kind: "none" });
  const principal = context.principal;
  if (!principal) return Object.freeze({ kind: "none" });

  // Group once; a second matching grant permanently marks that branch ambiguous.
  // Unique branches use the same action policy without rescanning all grants per candidate.
  const groups = new Map<string, EscalaPrincipal | null>();
  if (principal.kind === "account") {
    for (const grant of principal.branchGrants) {
      if (grant.tenantId !== context.tenantId || grant.userId !== principal.id) continue;
      const branch = canonicalBranchCode(grant.branchCode);
      if (groups.has(branch)) groups.set(branch, null);
      else groups.set(branch, { ...principal, branchGrants: [grant] });
    }
  } else if (principal.kind === "operator") {
    for (const grant of principal.branchGrants) {
      if (grant.tenantId !== context.tenantId || grant.operatorId !== principal.id) continue;
      const branch = canonicalBranchCode(grant.branchCode);
      if (groups.has(branch)) groups.set(branch, null);
      else groups.set(branch, { ...principal, branchGrants: [grant] });
    }
  }
  const branchCodes = [...groups].filter(([branchCode, scopedPrincipal]) =>
    scopedPrincipal !== null && decideEscalaPermission({ ...context, principal: scopedPrincipal, branchCode }, capability).allowed)
    .map(([branchCode]) => branchCode).sort();
  return branchCodes.length
    ? Object.freeze({ kind: "branches", tenantId: context.tenantId, branchCodes: Object.freeze(branchCodes) })
    : Object.freeze({ kind: "none" });
}
