import type { Prisma } from "@/generated/prisma/client";
import type { EscalaAbsenceCommand } from "./access-contracts";
import { fixedBoundaryReservations } from "./boundary";
import { applyLocalHolidayCalendar } from "./calendar";
import { addDays, dateRange, isDate, visibleDates } from "./dates";
import { EscalaError } from "./errors";
import { stableEscalaJson } from "./operational-input-policy";
import { escalaInputSchema } from "./schema";
import type { EscalaAssignment, EscalaInput } from "./types";

export function assignmentKey(item: EscalaAssignment) { return `${item.employeeId}\0${item.date}`; }

function conflict(date: string) {
  return new EscalaError(409, "ESCALA_ABSENCE_CONFLICT", `O dia ${date} tem feriado, fechamento, bloqueio ou ajuste protegido. Nenhum afastamento foi alterado.`);
}

export function editDraftAbsences(input: EscalaInput, command: EscalaAbsenceCommand, administrator: boolean) {
  const { action, employeeId, startDate, endDate } = command;
  const visible = visibleDates(input);
  const first = visible[0], last = visible.at(-1);
  if (!first || !last || !isDate(startDate) || !isDate(endDate) || startDate > endDate || startDate < first || endDate > last) {
    throw new EscalaError(422, "ESCALA_ABSENCE_PERIOD", "Informe um intervalo dentro das datas exibidas no rascunho.");
  }
  const person = input.employees.find(person => person.id === employeeId);
  if (!person || (action === "ADD_ABSENCE" && (startDate < person.activeFrom || (person.activeUntil && endDate > person.activeUntil)))) {
    throw new EscalaError(422, "ESCALA_ABSENCE_EMPLOYEE", "O colaborador não pertence à equipe atual durante todo o período.");
  }
  const selected = input.assignments.filter(day => day.employeeId === employeeId && day.date >= startDate && day.date <= endDate);
  const before = new Map(selected.map(day => [day.date, day]));
  const changedDates = new Set<string>();
  if (action === "ADD_ABSENCE") {
    const calendar = applyLocalHolidayCalendar(input).policy;
    const closed = new Set(calendar.closedDates);
    for (const date of dateRange(startDate, endDate)) {
      const existing = before.get(date);
      if (existing?.kind === "ABSENCE") continue;
      if (closed.has(date) || existing?.kind === "HOLIDAY" || (existing && existing.locked !== false)
        || person.manualShiftByDate?.[date]) throw conflict(date);
      changedDates.add(date);
    }
  } else {
    for (const day of selected) if (day.kind === "ABSENCE") {
      if (day.locked === true) throw conflict(day.date);
      if (!administrator && day.absenceSource !== "MANUAL") {
        throw new EscalaError(403, "ESCALA_ABSENCE_IMPORT_PROTECTED", "Somente a administração pode excluir afastamentos importados ou históricos.");
      }
      changedDates.add(day.date);
    }
  }
  if (!changedDates.size) return { input, changedDates, registration: person.registration };
  const assignments = input.assignments.filter(day => day.employeeId !== employeeId || !changedDates.has(day.date));
  if (action === "ADD_ABSENCE") for (const date of changedDates) {
    assignments.push({ employeeId, date, kind: "ABSENCE", absenceSource: "MANUAL" });
  }
  return { input: { ...input, assignments, needsRegeneration: true, generationBasis: undefined, coverageBasis: undefined }, changedDates, registration: person.registration };
}

/** Only the server-calculated mutation and the confirmed import may change manually recorded days. */
export function preserveManualAbsences(previous: EscalaInput, next: EscalaInput) {
  const manual = (input: EscalaInput) => input.assignments.filter(day => day.absenceSource === "MANUAL")
    .sort((a, b) => assignmentKey(a).localeCompare(assignmentKey(b)));
  if (stableEscalaJson(manual(previous)) !== stableEscalaJson(manual(next))) {
    throw new EscalaError(403, "ESCALA_PROTECTED_INPUT", "Use o lançamento dedicado para alterar os afastamentos manuais.");
  }
}

export async function assertNoPublishedAbsenceChanges(tx: Prisma.TransactionClient, tenantId: string, workspaceId: string, input: EscalaInput,
  edit: ReturnType<typeof editDraftAbsences>) {
  const dates = [...edit.changedDates].sort();
  const first = dates[0], last = dates.at(-1);
  if (!first || !last) return;
  const lockKey = `escalas-publication:${JSON.stringify([tenantId, input.branchCode])}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  const peers = await tx.escalaWorkspace.findMany({
    // Reopening keeps our publication immutable; only other workspaces constrain this new draft.
    where: { tenantId, branchCode: input.branchCode, id: { not: workspaceId }, startDate: { lte: last },
      endDate: { gte: addDays(first, -1) }, revisions: { some: { tenantId, status: "PUBLISHED" } } },
    select: { revisions: { where: { tenantId, status: "PUBLISHED" }, orderBy: { revision: "desc" }, take: 1, select: { input: true } } },
  });
  for (const peer of peers) {
    const parsed = escalaInputSchema.safeParse(peer.revisions[0]?.input);
    if (!parsed.success || parsed.data.branchCode !== input.branchCode) throw conflict(first);
    const ids = new Set(parsed.data.employees.filter(person => person.registration === edit.registration).map(person => person.id));
    for (const day of [...parsed.data.assignments, ...fixedBoundaryReservations(parsed.data)]) {
      if (ids.has(day.employeeId) && edit.changedDates.has(day.date)) throw conflict(day.date);
    }
  }
}
