import type { Prisma } from "@/generated/prisma/client";
import { EscalaError } from "./errors";
import { parseWorkforceDraftState, readWorkforceForDraft } from "./global-workforce-draft";
import { stableEscalaJson } from "./operational-input-policy";
import type { EscalaInput, EscalaWorkspace } from "./types";

const outdated = () => new EscalaError(409, "ESCALA_WORKFORCE_SYNC_REQUIRED", "A base global mudou. Atualize a equipe do rascunho antes de continuar.");

export function checkWorkforceReady(workspace: Pick<EscalaWorkspace, "workforce">) {
  if (workspace.workforce?.needsSync) throw outdated();
}

export async function workforceDraftInfo(tx: Prisma.TransactionClient, tenantId: string, branchCode: string, stored: unknown) {
  const base = await readWorkforceForDraft(tx, tenantId, branchCode);
  if (!base) return undefined;
  return { needsSync: parseWorkforceDraftState(stored)?.baseRevision !== base.revision };
}

export function carryWorkforceState(input: EscalaInput, stored: unknown) {
  const state = parseWorkforceDraftState(stored);
  if (!state) return null;
  const people = new Set(input.employees.map(person => person.id));
  return { ...state,
    managedAbsenceKeys: state.managedAbsenceKeys.filter(([id, date]) => people.has(id) && date >= input.startDate && date <= input.endDate),
    managedEmploymentEnds: state.managedEmploymentEnds.filter(end => people.has(end.employeeId)),
  };
}

export async function checkWorkforceWrite(tx: Prisma.TransactionClient, tenantId: string,
  workspace: Pick<EscalaWorkspace, "id" | "revision" | "status" | "input">, next?: EscalaInput, legacyTeamWrite = false) {
  if (workspace.status !== "DRAFT") return;
  const base = await readWorkforceForDraft(tx, tenantId, workspace.input.branchCode);
  if (!base) return;
  const row = await tx.escalaWorkspace.findFirst({
    where: { tenantId, id: workspace.id, revision: workspace.revision, status: "DRAFT" },
    select: { workforceState: true },
  });
  const state = parseWorkforceDraftState(row?.workforceState);
  if (!state || state.baseRevision !== base.revision) throw outdated();
  if (!next) return;
  const person = (input: EscalaInput) => input.employees.map(({ id, registration, name, sector, role, activeFrom, activeUntil }) =>
    [id, registration, name, sector, role, activeFrom, activeUntil]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const absence = (input: EscalaInput) => input.assignments.filter(day => day.kind === "ABSENCE")
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId) || a.date.localeCompare(b.date));
  if (legacyTeamWrite || stableEscalaJson(person(workspace.input)) !== stableEscalaJson(person(next)) ||
    stableEscalaJson(absence(workspace.input)) !== stableEscalaJson(absence(next))) {
    throw new EscalaError(409, "ESCALA_WORKFORCE_MANAGED", "Atualize cadastros, admissões e afastamentos na base global da filial.");
  }
}
