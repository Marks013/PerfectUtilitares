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
  const lastDate = addDays(input.endDate, 21);
  const referenced = new Set([...input.assignments, ...input.employees.flatMap((person) => person.history)].flatMap((item) => item.shiftId ? [item.shiftId] : []));
  input.employees.forEach((person) => { person.shiftIds.forEach((id) => { referenced.add(id); }); });
  const retained = input.shifts.filter((shift) => !shift.id.startsWith("plan-") || referenced.has(shift.id));
  const shifts = new Map(retained.map((shift) => [shift.id, shift]));
  const bySegments = new Map(retained.map((shift) => [shiftSignature(shift), shift.id]));
  const copied = new Map<string, EscalaShift>();
  const employees = input.employees.map((person) => {
    const { planningHistory: _untrusted, planningFuture: _untrustedFuture, ...clean } = person;
    const records = new Map<string, EscalaAssignment>();
    const signatures = new Map<string, string>();
    if (person.planningEnabled === false) return clean;
    for (const peer of published) {
      if (peer.branchCode !== input.branchCode) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "A versão publicada não corresponde à filial desta proposta.");
      const sources = peer.employees.filter((source) => source.registration === person.registration);
      for (const assignment of [...peer.assignments, ...fixedBoundaryReservations(peer)]) {
        const source = sources.find((candidate) => candidate.id === assignment.employeeId && active(candidate, assignment.date));
        if (!source || !active(person, assignment.date) || assignment.date < firstDate || assignment.date > lastDate
          || (assignment.date >= input.startDate && assignment.date <= input.endDate)) continue;
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
    const sorted = [...records.values()].sort((a, b) => a.date.localeCompare(b.date));
    const history = sorted.filter(item => item.date < input.startDate);
    const future = sorted.filter(item => item.date > input.endDate);
    return { ...clean, ...(history.length ? { planningHistory: history } : {}), ...(future.length ? { planningFuture: future } : {}) };
  });
  if (shifts.size + copied.size > 120) throw new EscalaError(422, "ESCALA_CONTINUITY_SHIFT_LIMIT", "A continuidade excede 120 horários distintos. Revise os horários antes de gerar ou publicar.");
  return { ...input, employees, shifts: [...shifts.values(), ...copied.values()] };
}

/** Shared technical days already published are commitments, not new opportunities to reschedule. */
export function preservePublishedDays(input: EscalaInput, published: EscalaInput[]): EscalaInput {
  const shifts = [...input.shifts];
  const signatures = new Map(shifts.map(shift => [shiftSignature(shift), shift.id]));
  const assignments = new Map(input.assignments.map(item => [JSON.stringify([item.employeeId, item.date]), item]));
  const commitments = new Map<string, string>();
  const employees = input.employees.map(person => {
    const allowed = new Set(person.shiftIds);
    for (const peer of published) {
      if (peer.branchCode !== input.branchCode) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "A referência publicada pertence a outra filial.");
      const sources = peer.employees.filter(source => source.registration === person.registration);
      for (const item of [...peer.assignments, ...fixedBoundaryReservations(peer)]) {
        if (item.date < input.startDate || item.date > input.endDate) continue;
        const source = sources.find(candidate => candidate.id === item.employeeId && active(candidate, item.date));
        if (!source) continue;
        if (!active(person, item.date)) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "Há um dia já publicado para uma pessoa não incluída ou fora do vínculo nesta proposta. Confira a equipe e o período antes de gerar.");
        const sourceShift = item.shiftId ? peer.shifts.find(shift => shift.id === item.shiftId) : undefined;
        if (item.kind === "WORK" && !sourceShift) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "Um horário publicado não foi encontrado; a escala anterior foi preservada.");
        const signature = JSON.stringify([item.kind, sourceShift ? shiftSignature(sourceShift) : ""]);
        const key = JSON.stringify([person.id, item.date]);
        if (commitments.has(key) && commitments.get(key) !== signature) throw new EscalaError(409, "ESCALA_PUBLISHED_OVERLAP", "Há propostas publicadas divergentes em um dia compartilhado. Compatibilize as revisões antes de gerar.");
        commitments.set(key, signature);
        const existing = assignments.get(key);
        if (existing) {
          const existingShift = shifts.find(shift => shift.id === existing.shiftId);
          if (JSON.stringify([existing.kind, existingShift ? shiftSignature(existingShift) : ""]) !== signature)
            throw new EscalaError(409, "ESCALA_PUBLISHED_OVERLAP", "Uma alteração nesta proposta diverge de um dia já publicado em " + item.date + ". Confira a continuidade; nenhum planejamento foi sobrescrito.");
        }
        let shiftId: string | undefined;
        if (sourceShift) {
          if (person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED") throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "Há horários publicados para uma pessoa sem jornada definida nesta proposta. Confira a referência importada antes de gerar.");
          const segments = shiftSignature(sourceShift);
          shiftId = signatures.get(segments);
          if (!shiftId) {
            shiftId = "plan-" + createHash("sha256").update(segments).digest("hex").slice(0, 32);
            const collision = shifts.find(shift => shift.id === shiftId);
            if (collision && shiftSignature(collision) !== segments) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "Identificador de horário publicado conflitante.");
            if (!collision) shifts.push({ ...sourceShift, id: shiftId, segments: sourceShift.segments.map(segment => ({ ...segment })) });
            signatures.set(segments, shiftId);
          }
          allowed.add(shiftId);
        }
        assignments.set(key, { employeeId: person.id, date: item.date, kind: item.kind, ...(shiftId ? { shiftId } : {}), locked: true });
      }
    }
    if (allowed.size > 12) throw new EscalaError(422, "ESCALA_CONTINUITY_SHIFT_LIMIT", "Os dias já publicados excedem 12 horários por pessoa. Confira os períodos antes de gerar.");
    return { ...person, shiftIds: [...allowed] };
  });
  if (shifts.length > 120) throw new EscalaError(422, "ESCALA_CONTINUITY_SHIFT_LIMIT", "A continuidade excede 120 horários distintos.");
  return { ...input, employees, shifts, assignments: [...assignments.values()] };
}
