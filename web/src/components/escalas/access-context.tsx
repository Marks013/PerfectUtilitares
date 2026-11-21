"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EscalaClientAccess } from "@/lib/escalas/access-view";
import { ESCALA_OPERATOR_CAPABILITIES, type EscalaCapability } from "@/lib/escalas/permissions";
import { canonicalBranchCode } from "@/lib/escalas/branch-code";

const AccessContext = createContext<EscalaClientAccess | null>(null);

/** Display policy only: every operation still requires server authorization. */
export function EscalaAccessProvider({ value, children }: { value: EscalaClientAccess | null; children: ReactNode }) {
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useEscalaClientAccess() { return useContext(AccessContext); }

export function canDisplayEscalaAction(access: EscalaClientAccess | null, capability: EscalaCapability, branchCode?: string): boolean {
  if (!access) return false;
  if (access.channel === "ACCOUNT" && access.administrator && access.allBranches) return true;
  if (access.channel === "USERNAME" && !(ESCALA_OPERATOR_CAPABILITIES as readonly string[]).includes(capability)) return false;
  const code = canonicalBranchCode(branchCode ?? "");
  const branches = access.branches.filter(branch => canonicalBranchCode(branch.code) === code);
  return branches.length === 1 && branches[0].capabilities.includes(capability);
}
