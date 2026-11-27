import type { EscalaAssignment, EscalaEmployee } from "@/lib/escalas/types";

/** Local form state only; never persists employee data in browser storage. */
export function hasEmployeeDraftChanges(baseline: EscalaEmployee, draft: EscalaEmployee, history: EscalaAssignment[]): boolean {
  return JSON.stringify(baseline) !== JSON.stringify({ ...draft, history });
}
