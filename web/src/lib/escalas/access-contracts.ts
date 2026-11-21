import type { EscalaClientAccess } from "./access-view";
import { canonicalBranchCode } from "./branch-code";
import type { EscalaApprovedPolicySnapshot } from "./approved-policy";
import type { EscalaOperatorAdminCommand } from "./operator-admin-input";
import type { EscalaCapability } from "./permissions";
import type { EscalaInput, EscalaWorkspace } from "./types";

/** Stable HTTP v1 contract. This module is safe for type-only frontend imports. */
export const ESCALA_ACCESS_API_VERSION = 1;
export const ESCALA_ACCESS_ENDPOINTS = Object.freeze({
  session: "/api/escalas/access/session", administration: "/api/escalas/access/admin",
  approvedPolicies: "/api/escalas/approved-policy", workspaces: "/api/escalas",
  scheduleExport: "/api/escalas/export",
} as const);
export type EscalaLoginCommand = { username: string };
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
export type EscalaVersionTarget = { id: string; expectedRevision: number };
export type EscalaOperationalCommand =
  | { action: "CREATE_APPROVED"; approvedPolicyVersionId: string }
  | ({ action: "APPLY_PROPOSAL"; input: EscalaInput; proposalProof: string } & EscalaVersionTarget)
  | ({ action: "ADD_EMPLOYEE"; regimeModelId: string; name: string; registration: string } & EscalaVersionTarget)
  | ({ action: "ADMIN_REBASE"; approvedPolicyVersionId: string } & EscalaVersionTarget)
  | ({ action: "VALIDATE" | "SAVE"; input: EscalaInput } & EscalaVersionTarget);
export type EscalaGeneratedProposal = {
  proposalInput: EscalaInput; proposalProof?: string;
};
export type EscalaWorkspaceAccessMetadata = { approvedPolicyVersionId: string | null };
export type EscalaApprovedWorkspace = EscalaWorkspace & EscalaWorkspaceAccessMetadata;
export type EscalaScheduleExportQuery = {
  id: string; revision?: number; format: "pdf" | "xlsx"; mode?: "rest" | "hours" | "both";
  separateSectors?: "true" | "false";
  projection?: "BASIC_SCHEDULE" | "ADMIN_FULL";
};
export type EscalaAccessApiError = { error: { code: string; message: string } };
export type EscalaApprovalSnapshot = EscalaApprovedPolicySnapshot;

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
