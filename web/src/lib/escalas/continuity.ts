import { createHash } from "node:crypto";
import { EscalaError } from "./access";
import { fixedBoundaryReservations } from "./boundary";
import { addDays } from "./dates";
import type { EscalaAssignment, EscalaEmployee, EscalaInput, EscalaShift } from "./types";

function active(person: EscalaEmployee, date: string) {
  return person.planningEnabled !== false && person.activeFrom <= date && (!person.activeUntil || person.activeUntil >= date);
}

function shiftSignature(shift: EscalaShift) {
  return JSON.stringify(shift.segments.map((segment) => [segment.start, segment.end, segment.kind]));
}

/** Published plans provide planning context only; actual attendance always remains separate. */
export function publishedPlanningContext(input: EscalaInput, published: EscalaInput[]): EscalaInput {
  const firstDate = addDays(input.startDate, -21);
  const referenced = new Set([...input.assignments, ...input.employees.flatMap((person) => person.history)].flatMap((item) => item.shiftId ? [item.shiftId] : []));
  input.employees.forEach((person) => { person.shiftIds.forEach((id) => { referenced.add(id); }); });
  const retained = input.shifts.filter((shift) => !shift.id.startsWith("plan-") || referenced.has(shift.id));
  const shifts = new Map(retained.map((shift) => [shift.id, shift]));
  const bySegments = new Map(retained.map((shift) => [shiftSignature(shift), shift.id]));
  const copied = new Map<string, EscalaShift>();
  const employees = input.employees.map((person) => {
    const { planningHistory: _untrusted, ...clean } = person;
    const records = new Map<string, EscalaAssignment>();
    const signatures = new Map<string, string>();
    if (person.planningEnabled === false) return clean;
    for (const peer of published) {
      if (peer.branchCode !== input.branchCode) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "A versão publicada não corresponde à filial desta proposta.");
      const sources = peer.employees.filter((source) => source.registration === person.registration);
      for (const assignment of [...peer.assignments, ...fixedBoundaryReservations(peer)]) {
        const source = sources.find((candidate) => candidate.id === assignment.employeeId && active(candidate, assignment.date));
        if (!source || !active(person, assignment.date) || assignment.date < firstDate || assignment.date >= input.startDate) continue;
        const sourceShift = assignment.kind === "WORK" ? peer.shifts.find((shift) => shift.id === assignment.shiftId) : undefined;
        if (assignment.kind === "WORK" && !sourceShift) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "Um horário publicado não pôde ser conferido.");
        const segments = sourceShift ? shiftSignature(sourceShift) : "";
        const signature = JSON.stringify([assignment.kind, segments]);
        if (signatures.has(assignment.date) && signatures.get(assignment.date) !== signature) throw new EscalaError(409, "ESCALA_PUBLISHED_OVERLAP", `Há versões publicadas divergentes para a mesma matrícula em ${assignment.date}.`);
        signatures.set(assignment.date, signature);
        let shiftId: string | undefined;
        if (sourceShift) {
          shiftId = bySegments.get(segments) ?? `plan-${createHash("sha256").update(segments).digest("hex").slice(0, 32)}`;
          const existing = shifts.get(shiftId) ?? copied.get(shiftId);
          if (existing && shiftSignature(existing) !== segments) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "Identificador de horário de continuidade conflitante.");
          if (!existing) copied.set(shiftId, { id: shiftId, name: "Horário de proposta publicada", segments: sourceShift.segments.map((segment) => ({ ...segment })) });
          bySegments.set(segments, shiftId);
        }
        records.set(assignment.date, { employeeId: person.id, date: assignment.date, kind: assignment.kind, ...(shiftId ? { shiftId } : {}) });
      }
    }
    return { ...clean, ...(records.size ? { planningHistory: [...records.values()].sort((a, b) => a.date.localeCompare(b.date)) } : {}) };
  });
  if (shifts.size + copied.size > 120) throw new EscalaError(422, "ESCALA_CONTINUITY_SHIFT_LIMIT", "A continuidade excede 120 horários distintos. Revise os horários antes de gerar ou publicar.");
  return { ...input, employees, shifts: [...shifts.values(), ...copied.values()] };
}
