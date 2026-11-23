import type { Prisma } from "@/generated/prisma/client";
import { addDays, visibleDates } from "./dates";
import { operationalEscalaInput } from "./eligibility";
import { EscalaError } from "./errors";
import type { EscalaWorkforceSnapshot } from "./global-workforce-domain";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";

function workdays(rawInput: EscalaInput, registrations: ReadonlySet<string>) {
  const input = operationalEscalaInput(rawInput);
  const visible = new Set(visibleDates(input));
  const people = new Map(input.employees.filter(person => registrations.has(person.registration)).map(person => [person.id, person]));
  const nightShifts = new Set(input.shifts.filter(shift => shift.segments.some(segment => segment.kind !== "BREAK" && segment.end > 1440)).map(shift => shift.id));
  return input.assignments.flatMap(day => {
    const person = people.get(day.employeeId);
    if (!person || !visible.has(day.date) || day.date < person.activeFrom || person.activeUntil && day.date > person.activeUntil ||
      day.kind !== "WORK" && day.kind !== "DUTY") return [];
    return [day.date, ...(day.kind === "WORK" && nightShifts.has(day.shiftId ?? "") ? [addDays(day.date, 1)] : [])]
      .map(date => ({ registration: person.registration, date }));
  });
}

/** This read runs under the tenant-wide write/admission lock of the publication transaction. */
export async function assertTransferredWorkDoesNotOverlap(tx: Prisma.TransactionClient, tenantId: string, input: EscalaInput,
  snapshot: EscalaWorkforceSnapshot) {
  const inDraft = new Set(input.employees.map(person => person.registration));
  // An initial import can already contain a transfer without prior branch metadata.
  const registrations = new Set(snapshot.people.filter(person => person.branchCode === input.branchCode &&
    inDraft.has(person.employee.registration)).map(person => person.employee.registration));
  if (!registrations.size) return;
  const current = workdays(input, registrations);
  const dates = current.map(day => day.date).sort();
  const first = dates[0], last = dates.at(-1);
  if (!first || !last) return;
  const rows = await tx.escalaWorkspace.findMany({
    where: { tenantId, branchCode: { not: input.branchCode }, startDate: { lte: last }, endDate: { gte: addDays(first, -1) },
      revisions: { some: { tenantId, status: "PUBLISHED" } } },
    select: { branchCode: true, revisions: { where: { tenantId, status: "PUBLISHED" }, orderBy: { revision: "desc" }, take: 1, select: { input: true } } },
  });
  const currentDays = new Set(current.map(day => JSON.stringify([day.registration, day.date])));
  for (const row of rows) {
    const previous = escalaInputSchema.safeParse(row.revisions[0]?.input);
    if (!previous.success || previous.data.branchCode !== row.branchCode) {
      throw new EscalaError(409, "ESCALA_TRANSFER_CONTINUITY", "A continuidade da escala de uma pessoa transferida não pôde ser conferida.");
    }
    const conflict = workdays(previous.data, registrations).find(day => currentDays.has(JSON.stringify([day.registration, day.date])));
    if (conflict) throw new EscalaError(409, "ESCALA_TRANSFER_PUBLISHED_OVERLAP",
      `Já existe trabalho publicado para a mesma matrícula em outra filial em ${conflict.date}. Confira a vigência da equipe antes de publicar.`);
  }
}
