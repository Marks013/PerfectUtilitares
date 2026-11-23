import type { Prisma } from "@/generated/prisma/client";
import { fixedBoundaryReservations } from "./boundary";
import { canonicalBranchCode } from "./branch-code";
import { addDays } from "./dates";
import { EscalaError } from "./errors";
import { escalaInputSchema } from "./schema";
import type { EscalaEmployee, EscalaInput } from "./types";

function protectedRemoval(message: string) {
  return new EscalaError(409, "ESCALA_EMPLOYEE_REMOVAL_PROTECTED", message);
}

function activeOn(person: EscalaEmployee, date: string) {
  return person.activeFrom <= date && (!person.activeUntil || date <= person.activeUntil);
}

export function inputWithoutEscalaEmployee(input: EscalaInput, employeeId: string): EscalaInput {
  if (!input.employees.some(person => person.id === employeeId)) {
    throw new EscalaError(404, "ESCALA_EMPLOYEE_NOT_FOUND", "Colaborador não encontrado nesta revisão da escala.");
  }
  if (input.assignments.some(day => day.employeeId === employeeId && (day.locked !== false || day.kind === "ABSENCE" || day.kind === "HOLIDAY"))) {
    throw protectedRemoval("Este colaborador tem dias protegidos. Preserve os registros e ajuste o vínculo com o administrador.");
  }
  return {
    ...input,
    employees: input.employees.filter(person => person.id !== employeeId),
    assignments: input.assignments.filter(day => day.employeeId !== employeeId),
  };
}

/** Check commitments against the stored team under the caller's access lock. */
export async function assertEscalaEmployeeRemovalAllowed(db: Prisma.TransactionClient, tenantId: string, workspaceId: string,
  expectedRevision: number, baseline: EscalaInput, employeeId: string) {
  const latest = await db.escalaWorkspace.findFirst({
    where: { id: workspaceId, tenantId, revision: expectedRevision }, select: { revision: true },
  });
  if (latest?.revision !== expectedRevision) {
    throw new EscalaError(409, "ESCALA_STALE_REVISION", "A proposta mudou. Recarregue a escala antes de remover o colaborador.");
  }
  const target = baseline.employees.find(person => person.id === employeeId);
  const invalid = () => protectedRemoval("A equipe da versão publicada não pôde ser conferida. Consulte o administrador.");
  if (!target) throw invalid();

  const branchCode = canonicalBranchCode(baseline.branchCode);
  const published = await db.escalaRevision.findFirst({
    where: { tenantId, workspaceId, status: "PUBLISHED" }, orderBy: { revision: "desc" }, select: { input: true },
  });
  if (published) {
    const snapshot = escalaInputSchema.safeParse(published.input);
    if (!snapshot.success || canonicalBranchCode(snapshot.data.branchCode) !== branchCode
      || snapshot.data.startDate !== baseline.startDate || snapshot.data.endDate !== baseline.endDate) throw invalid();
    const matchingIds = new Set(snapshot.data.employees.filter(person => person.registration === target.registration).map(person => person.id));
    if (snapshot.data.assignments.some(day => day.employeeId === target.id || (matchingIds.has(day.employeeId) && activeOn(target, day.date)))) {
      throw protectedRemoval("Este colaborador tem dias em uma versão publicada. Preserve a escala publicada e ajuste o vínculo com o administrador.");
    }
  }

  const peers = await db.escalaWorkspace.findMany({
    where: { tenantId, branchCode, id: { not: workspaceId }, startDate: { lte: baseline.endDate },
      endDate: { gte: addDays(baseline.startDate, -1) }, revisions: { some: { tenantId, status: "PUBLISHED" } } },
    select: { revisions: { where: { tenantId, status: "PUBLISHED" },
      orderBy: { revision: "desc" }, take: 1, select: { input: true } } },
  });
  for (const peer of peers) {
    const snapshot = escalaInputSchema.safeParse(peer.revisions[0]?.input);
    if (!snapshot.success || canonicalBranchCode(snapshot.data.branchCode) !== branchCode) throw invalid();
    const people = new Map(snapshot.data.employees.filter(person => person.registration === target.registration).map(person => [person.id, person]));
    for (const day of [...snapshot.data.assignments, ...fixedBoundaryReservations(snapshot.data)]) {
      if (day.date < baseline.startDate || day.date > baseline.endDate || !activeOn(target, day.date)) continue;
      const person = people.get(day.employeeId);
      if (person && activeOn(person, day.date)) {
        throw protectedRemoval("Este colaborador tem dias compartilhados com uma escala publicada da filial. Preserve esses registros e ajuste o vínculo com o administrador.");
      }
    }
  }
}
