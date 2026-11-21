import { canonicalBranchCode } from "./branch-code";

/** Initial operator grant. An absent/empty stored grant never receives these defaults implicitly. */
export const ESCALA_OPERATOR_CAPABILITIES = Object.freeze([
  "workspace.read", "workspace.create", "workspace.save", "schedule.generate", "schedule.apply",
  "employee.manage", "shift.manage", "export.schedule.pdf", "export.schedule.xlsx",
] as const);

export const ESCALA_CAPABILITIES = Object.freeze([
  ...ESCALA_OPERATOR_CAPABILITIES,
  "workspace.publish", "workspace.delete", "import.manage", "export.integration",
  "report.analytics", "settings.manage", "access.manage",
] as const);

export type EscalaCapability = typeof ESCALA_CAPABILITIES[number];
export type EscalaExportProjection = "BASIC_SCHEDULE" | "ADMIN_FULL";

export type EscalaAccountBranchGrant = Readonly<{
  tenantId: string; userId: string; branchCode: string; role: string;
}>;

export type EscalaOperatorBranchGrant = Readonly<{
  tenantId: string; operatorId: string; branchCode: string; active: boolean;
  capabilities: readonly string[];
}>;

/** Trusted identities resolved by the server. This module does not authenticate a username or cookie. */
export type EscalaPrincipal = Readonly<{
  kind: "account"; id: string; tenantId: string; status: string; role: string;
  branchGrants: readonly EscalaAccountBranchGrant[];
}> | Readonly<{
  kind: "operator"; id: string; tenantId: string; active: boolean;
  branchGrants: readonly EscalaOperatorBranchGrant[];
}>;

export type EscalaPermissionContext = Readonly<{
  principal: EscalaPrincipal | null;
  tenantId: string;
  branchCode?: string;
  /** LEGACY intentionally has no fallback here; activating this resolver requires an explicit new mode. */
  mode: string;
}>;

export type EscalaPermissionDenial = "UNKNOWN_CAPABILITY" | "UNSUPPORTED_MODE" | "IDENTITY_REQUIRED"
  | "INACTIVE_IDENTITY" | "TENANT_FORBIDDEN" | "ADMIN_REQUIRED" | "BRANCH_REQUIRED"
  | "BRANCH_FORBIDDEN" | "AMBIGUOUS_GRANT" | "CAPABILITY_FORBIDDEN";

export type EscalaPermissionDecision = { allowed: true } | { allowed: false; reason: EscalaPermissionDenial };

const capabilities = new Set<string>(ESCALA_CAPABILITIES);
const operatorCapabilities = new Set<string>(ESCALA_OPERATOR_CAPABILITIES);
const viewerCapabilities = new Set<string>(["workspace.read", "export.schedule.pdf", "export.schedule.xlsx"]);
const deny = (reason: EscalaPermissionDenial): EscalaPermissionDecision => ({ allowed: false, reason });

/** Account precedence is explicit, including blocked/unknown accounts; cookies never union privileges. */
export function selectEscalaPrincipal(
  account: Extract<EscalaPrincipal, { kind: "account" }> | null,
  operator: Extract<EscalaPrincipal, { kind: "operator" }> | null,
): EscalaPrincipal | null {
  return account ?? operator;
}

/** Pure action policy only. Resource existence, field diffs, session revocation and solver rules remain separate gates. */
export function decideEscalaPermission(context: EscalaPermissionContext, capability: string): EscalaPermissionDecision {
  if (!capabilities.has(capability)) return deny("UNKNOWN_CAPABILITY");
  if (context.mode !== "SCOPED" && context.mode !== "ADMIN_ONLY") return deny("UNSUPPORTED_MODE");
  const principal = context.principal;
  if (!principal?.id || !principal.tenantId) return deny("IDENTITY_REQUIRED");
  if (!context.tenantId || principal.tenantId !== context.tenantId) return deny("TENANT_FORBIDDEN");
  if (principal.kind === "account") {
    if (principal.status !== "ACTIVE") return deny("INACTIVE_IDENTITY");
    if (principal.role === "ADMIN") return { allowed: true };
    if (principal.role !== "OPERATOR") return deny("IDENTITY_REQUIRED");
  } else if (principal.kind === "operator") {
    if (principal.active !== true) return deny("INACTIVE_IDENTITY");
  } else {
    return deny("IDENTITY_REQUIRED");
  }
  if (context.mode === "ADMIN_ONLY") return deny("ADMIN_REQUIRED");
  const branchCode = canonicalBranchCode(context.branchCode ?? "");
  if (!branchCode) return deny("BRANCH_REQUIRED");

  if (principal.kind === "account") {
    const grants = principal.branchGrants.filter(grant => grant.tenantId === context.tenantId
      && grant.userId === principal.id && canonicalBranchCode(grant.branchCode) === branchCode);
    if (grants.length > 1) return deny("AMBIGUOUS_GRANT");
    const grant = grants[0];
    if (!grant) return deny("BRANCH_FORBIDDEN");
    if (grant.role === "VIEWER") return viewerCapabilities.has(capability) ? { allowed: true } : deny("CAPABILITY_FORBIDDEN");
    if (grant.role !== "PLANNER" && grant.role !== "APPROVER") return deny("CAPABILITY_FORBIDDEN");
    // APPROVER is a per-branch legacy grant, never a role granted by username entry.
    if (grant.role === "APPROVER" && capability === "workspace.publish") return { allowed: true };
    return operatorCapabilities.has(capability) ? { allowed: true } : deny("CAPABILITY_FORBIDDEN");
  }

  const grants = principal.branchGrants.filter(grant => grant.tenantId === context.tenantId
    && grant.operatorId === principal.id && canonicalBranchCode(grant.branchCode) === branchCode);
  if (grants.length > 1) return deny("AMBIGUOUS_GRANT");
  const grant = grants[0];
  if (grant?.active !== true) return deny("BRANCH_FORBIDDEN");
  // A forged/stale grant cannot delegate import, analytics, configuration, publication or administration.
  return operatorCapabilities.has(capability) && grant.capabilities.includes(capability)
    ? { allowed: true } : deny("CAPABILITY_FORBIDDEN");
}

/** The renderer/cache must consume this effective projection after authorization, never a client profile alone. */
export function resolveEscalaExportProjection(
  context: EscalaPermissionContext,
  format: string,
  requestedProjection: string = "BASIC_SCHEDULE",
): EscalaExportProjection | null {
  if (format !== "pdf" && format !== "xlsx") return null;
  if (requestedProjection !== "BASIC_SCHEDULE" && requestedProjection !== "ADMIN_FULL") return null;
  if (!decideEscalaPermission(context, `export.schedule.${format}`).allowed) return null;
  if (requestedProjection === "ADMIN_FULL" && !decideEscalaPermission(context, "report.analytics").allowed) return null;
  return requestedProjection;
}
