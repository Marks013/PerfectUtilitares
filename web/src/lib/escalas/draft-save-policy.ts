import type { Prisma } from "@/generated/prisma/client";
import { EscalaError } from "./errors";
import { assignmentKey } from "./manual-absence";
import type { EscalaInput, EscalaWorkspace } from "./types";

/** Server-created intent only; no HTTP SAVE command accepts this object or its callback. */
export type AdminImportSaveIntent = {
  removedAbsenceKeys: readonly string[]; invalidatesApproval: boolean;
  verify: (tx: Prisma.TransactionClient, current: EscalaWorkspace & { approvedPolicyVersionId: string | null }, rawInput: EscalaInput) => Promise<void>;
  audit: { purpose: "EMPLOYEES" | "ABSENCES"; fileHash: string; impactHash: string; startDate: string; endDate: string;
    addedPeople: number; removedPeople: number; addedAbsenceDays: number; removedAbsenceDays: number };
};

export function preserveLockedAssignments(previous: EscalaInput, next: EscalaInput, canUnlock = false) {
  const assignments = new Map(next.assignments.map(item => [assignmentKey(item), item]));
  const previousShifts = new Map(previous.shifts.map(shift => [shift.id, shift]));
  const nextShifts = new Map(next.shifts.map(shift => [shift.id, shift]));
  for (const item of previous.assignments.filter(assignment => assignment.locked)) {
    const proposed = assignments.get(assignmentKey(item));
    const sameAssignment = proposed?.kind === item.kind && proposed.shiftId === item.shiftId && Boolean(proposed.locked) === Boolean(item.locked);
    const explicitUnlock = canUnlock && proposed?.locked === false && proposed.kind === item.kind && proposed.shiftId === item.shiftId;
    if ((!sameAssignment && !explicitUnlock) || (item.shiftId && JSON.stringify(previousShifts.get(item.shiftId)) !== JSON.stringify(nextShifts.get(item.shiftId)))) {
      throw new EscalaError(409, "ESCALA_LOCKED_ASSIGNMENT", "A proposta altera um dia bloqueado ou seu horário. Um aprovador pode desmarcar o bloqueio e salvar, preservando a atribuição; depois poderá editá-la.");
    }
  }
}

export function excludeConfirmedImportAbsences(current: EscalaInput, next: EscalaInput, intent?: AdminImportSaveIntent) {
  const removed = new Set(intent?.removedAbsenceKeys ?? []);
  if (!removed.size) return current;
  const nextKeys = new Set(next.assignments.map(assignmentKey));
  if (intent?.audit.purpose !== "ABSENCES" || [...removed].some(key => nextKeys.has(key) || !current.assignments.some(day =>
    assignmentKey(day) === key && day.kind === "ABSENCE" && day.date >= intent.audit.startDate && day.date <= intent.audit.endDate))) {
    throw new EscalaError(403, "ESCALA_IMPORT_INTENT_INVALID", "O delta de afastamentos não corresponde à confirmação.");
  }
  return { ...current, assignments: current.assignments.filter(day => !removed.has(assignmentKey(day))) };
}

/** Source ownership alone does not change an approved day in a confirmed absence import. */
export function importAbsenceApprovalView(previous: EscalaInput, next: EscalaInput, startDate: string, endDate: string): EscalaInput {
  const manual = new Map(previous.assignments.filter(day => day.kind === "ABSENCE" && day.absenceSource === "MANUAL"
    && day.date >= startDate && day.date <= endDate).map(day => [assignmentKey(day), day]));
  if (!manual.size) return next;
  return { ...next, assignments: next.assignments.map(day => {
    const old = manual.get(assignmentKey(day));
    return old && day.kind === "ABSENCE" && day.absenceSource === undefined && day.locked === old.locked && day.shiftId === old.shiftId
      ? old : day;
  }) };
}
