import type { EscalaEmployee } from "./types";

const portuguese = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const exact = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "variant" });

export function compareBranches(
  left: { branchCode: string; branchName?: string },
  right: { branchCode: string; branchName?: string },
): number {
  return portuguese.compare(left.branchCode, right.branchCode)
    || exact.compare(left.branchCode, right.branchCode)
    || portuguese.compare(left.branchName ?? "", right.branchName ?? "");
}

/** Canonical presentation order only; never use names as an allocation priority. */
export function sortEmployees<T extends Pick<EscalaEmployee, "id" | "name" | "registration" | "sector" | "role">>(employees: readonly T[]): T[] {
  return [...employees].sort((left, right) => portuguese.compare(left.sector, right.sector)
    || portuguese.compare(left.role, right.role)
    || portuguese.compare(left.name, right.name)
    || portuguese.compare(left.registration, right.registration)
    || exact.compare(left.registration, right.registration)
    || exact.compare(left.id, right.id));
}
