import type { EscalaClientAccess } from "./access-view";
import { canonicalBranchCode } from "./branch-code";
import type { EscalaOperatorAdminCommand } from "./operator-admin-input";
import type { EscalaCapability } from "./permissions";
import type { EscalaInput } from "./types";

/** Stable HTTP v1 contract. This module is safe for type-only frontend imports. */
export type EscalaSessionResponse = {
  access: { role: "ACCOUNT" | "OPERATIONAL"; expiresAt?: string };
  context: EscalaClientAccess;
};
export type EscalaOperatorView = {
  id: string; username: string; displayName: string; active: boolean; permissionVersion: number;
  branchGrants: { branchCode: string; active: boolean; capabilities: readonly EscalaCapability[] }[];
};
export type EscalaAdministrationView = {
  policy: { mode: "ADMIN_ONLY" | "SCOPED"; version: number };
  operators: EscalaOperatorView[];
};
// HTTP uses username, not the parser's internal usernameNormalized field.
export type EscalaOperatorAdminHttpCommand =
  | { action: "CREATE_OPERATOR"; username: string; displayName: string; active: boolean;
      branchGrants: EscalaOperatorView["branchGrants"] }
  | { action: "UPDATE_OPERATOR"; operatorId: string; expectedPermissionVersion: number;
      username: string; displayName: string; active: boolean }
  | Extract<EscalaOperatorAdminCommand, { action: "REPLACE_BRANCH_GRANTS" | "REVOKE_SESSIONS" }>
  | { action: "SET_ACCESS_MODE"; mode: "ADMIN_ONLY" | "SCOPED"; expectedVersion: number };
export type EscalaApprovedPolicyView = {
  id: string; branchCode: string; startDate: string; endDate: string; visibleMonth: string | null;
  version: number; approvedAt: string; revokedAt: string | null;
  regimeModels: { id: string; label: string }[];
};
export type EscalaApprovePolicyCommand = {
  action: "APPROVE"; input: EscalaInput;
  origin: null | { workspaceId: string; revision: number };
  selectedSeedAssignments: { employeeId: string; date: string; kind: "ABSENCE" | "HOLIDAY" }[];
  regimeModelSelections: { id: string; label: string; employeeId: string }[];
};
export type EscalaPolicyCommand = EscalaApprovePolicyCommand | { action: "REVOKE"; id: string };
type EscalaVersionTarget = { id: string; expectedRevision: number };
export type EscalaAbsenceCommand = {
  action: "ADD_ABSENCE" | "REMOVE_ABSENCE"; employeeId: string; startDate: string; endDate: string;
};
export type EscalaOperationalCommand =
  | { action: "CREATE_APPROVED"; approvedPolicyVersionId: string }
  | { action: "CREATE_MONTH"; branchCode: string; month: string }
  | ({ action: "APPLY_PROPOSAL"; input: EscalaInput; proposalProof: string } & EscalaVersionTarget)
  | ({ action: "ADD_EMPLOYEE"; regimeModelId: string; name: string; registration: string } & EscalaVersionTarget)
  | ({ action: "REMOVE_EMPLOYEE"; employeeId: string } & EscalaVersionTarget)
  | (EscalaAbsenceCommand & EscalaVersionTarget)
  | ({ action: "ADMIN_REBASE"; approvedPolicyVersionId: string } & EscalaVersionTarget)
  | ({ action: "VALIDATE" | "SAVE"; input: EscalaInput } & EscalaVersionTarget);
export type EscalaWorkspaceAccessMetadata = { approvedPolicyVersionId: string | null; approvedPolicyRevoked?: true };
export type EscalaApprovedCreationMetadata = { teamSeed?: "LATEST_IMPORT" | "APPROVED_CONFIGURATION" };

/** UI distinction only; the server independently authorizes definition and assignment. */
export function escalaCatalogActions(context: EscalaClientAccess, branchCode: string) {
  const administrator = context.channel === "ACCOUNT" && context.administrator && context.allBranches;
  const code = canonicalBranchCode(branchCode);
  const grants = context.branches.filter(branch => canonicalBranchCode(branch.code) === code);
  return {
    canDefine: administrator,
    canAssign: administrator || (Boolean(code) && grants.length === 1 && grants[0].capabilities.includes("shift.manage")),
  };
}
