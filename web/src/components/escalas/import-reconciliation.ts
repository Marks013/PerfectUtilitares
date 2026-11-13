import type { EscalaEmployee, EscalaInput, EscalaShift } from "@/lib/escalas/types";
import { canonicalBranchCode } from "@/lib/escalas/branch-code";
import { inferLeadership } from "@/lib/escalas/leadership";

import { materializeManualShiftOverrides } from "@/lib/escalas/shift-catalog/manual-override";
export type ImportChoices = { updateRegistrations: string[]; scheduleRegistrations?: string[]; branchCode?: string };
export type ReconciliationEntry = { employee: EscalaEmployee; status: "NEW" | "UNCHANGED" | "CHANGED" | "CONFLICT"; changes: string[]; scheduleChanged: boolean; scheduleBlocked: boolean; message?: string };

function clocks(person: EscalaEmployee, shifts: EscalaShift[]) {
  return JSON.stringify({ mode: person.scheduleMode ?? "TIMED", source: person.sourceSchedule,
    shifts: person.sourceSchedule ? undefined : person.shiftIds.map(id => shifts.find(shift => shift.id === id)?.segments ?? id) });
}

/** A preview never mutates the proposal, and ambiguous historical registrations are not matched by name. */
export function previewImportReconciliation(input: EscalaInput, employees: EscalaEmployee[], shifts: EscalaShift[]): ReconciliationEntry[] {
  const incomingRegistrations = new Set<string>();
  return employees.map(employee => {
    const matches = input.employees.filter(current => current.registration === employee.registration);
    if (incomingRegistrations.has(employee.registration) || matches.length > 1) {
      incomingRegistrations.add(employee.registration);
      return { employee, status: "CONFLICT", changes: [], scheduleChanged: false, scheduleBlocked: true,
        message: "Matrícula repetida ou com mais de um vínculo. Confira os registros; nenhum vínculo será unido automaticamente." };
    }
    incomingRegistrations.add(employee.registration);
    const current = matches[0];
    if (!current) return { employee, status: "NEW", changes: [], scheduleChanged: false, scheduleBlocked: false };
    const changes = ([ ["name", "nome"], ["sector", "setor"], ["role", "cargo"] ] as const)
      .filter(([field]) => current[field] !== employee[field]).map(([, label]) => label as string);
    const scheduleChanged = clocks(current, input.shifts) !== clocks(employee, shifts);
    const scheduleBlocked = input.assignments.some(entry => entry.employeeId === current.id && entry.locked && entry.kind === "WORK")
      && (employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING");
    if (scheduleChanged) changes.push("referência de horário");
    return { employee, status: changes.length ? "CHANGED" : "UNCHANGED", changes, scheduleChanged, scheduleBlocked,
      ...(scheduleBlocked ? { message: "Há trabalho com horário bloqueado. A referência atual será mantida; revise o bloqueio antes de trocar para presença sem horário." } : {}) };
  });
}

export function reconcileImport(input: EscalaInput, employees: EscalaEmployee[], shifts: EscalaShift[], choices?: ImportChoices): EscalaInput {
  if (choices?.branchCode && canonicalBranchCode(choices.branchCode) !== canonicalBranchCode(input.branchCode))
    throw new Error("A prévia pertence a outra filial. Confira o arquivo novamente; nenhum dado foi alterado.");
  if (new Set(employees.map(person => person.registration)).size !== employees.length)
    throw new Error("A prévia contém matrícula já cadastrada mais de uma vez. Confira os registros antes de importar.");
  const preview = previewImportReconciliation(input, employees, shifts);
  if (!choices && preview.some(entry => entry.status !== "NEW"))
    throw new Error("A prévia contém matrícula já cadastrada. Confira as mudanças e escolha explicitamente o que deseja atualizar.");
  const approved = new Set(choices?.updateRegistrations ?? []), schedules = new Set(choices?.scheduleRegistrations ?? []);
  if ([...schedules].some(registration => !approved.has(registration))) throw new Error("Confirme a atualização da pessoa antes de trocar sua referência de horário.");
  if (preview.some(entry => entry.status === "CONFLICT")) throw new Error("Há matrículas com correspondência ambígua. Confira os vínculos antes de importar.");
  if (preview.some(entry => entry.scheduleBlocked && schedules.has(entry.employee.registration))) throw new Error("A troca de horário conflita com trabalho bloqueado. Preserve a referência atual ou revise o bloqueio primeiro.");
  const added = preview.filter(entry => entry.status === "NEW").map(entry => entry.employee);
  if (input.employees.length + added.length > 250) throw new Error("A filial comporta até 250 colaboradores por proposta. Reduza os registros da importação.");
  const knownIds = new Set(input.employees.map(person => person.id));
  if (added.some(person => knownIds.has(person.id)) || new Set(added.map(person => person.id)).size !== added.length)
    throw new Error("Um identificador de colaborador já existe. Confira o arquivo antes de importar.");
  const byId = new Map(input.shifts.map(shift => [shift.id, shift]));
  for (const shift of shifts) {
    if (byId.has(shift.id) && JSON.stringify(byId.get(shift.id)) !== JSON.stringify(shift))
      throw new Error("Um identificador de horário já existe com configuração diferente. Revise a importação.");
  }
  let changed = added.length > 0;
  const nextEmployees = input.employees.map(current => {
    const entry = preview.find(item => item.employee.registration === current.registration);
    if (entry?.status !== "CHANGED" || !approved.has(current.registration)) return current;
    const source = entry.employee;
    if (schedules.has(current.registration) && current.manualShiftOverrides?.length && (source.scheduleMode === "MISSING" || source.scheduleMode === "UNTIMED")) {
      throw new Error("Há uma seleção manual de turno vigente. Revise essa seleção antes de substituir a referência por ENC ou cadastro sem horário; os dados foram preservados.");
    }
    const replaceClock = schedules.has(current.registration);
    const next: EscalaEmployee = { ...current, name: source.name, sector: source.sector, role: source.role,
      ...(current.leadership?.source !== "MANUAL" ? { leadership: inferLeadership(source) } : {}),
      ...(replaceClock ? { sourceSchedule: source.sourceSchedule, scheduleMode: source.scheduleMode, shiftIds: [...source.shiftIds],
        originalShiftIds: current.manualShiftOverrides?.length ? current.originalShiftIds : undefined,
        ...(current.manualShiftOverrides?.length ? { manualShiftBaseIds: [...source.shiftIds], manualShiftByDate: undefined } : {}),
        fixedImportedShiftId: undefined, simulationDailyMinutes: undefined } : {}) };
    if (JSON.stringify(next) !== JSON.stringify(current)) changed = true;
    return next;
  });
  const usedShifts = new Set([...nextEmployees, ...added].flatMap(person => person.shiftIds));
  for (const shift of shifts) if (!choices || usedShifts.has(shift.id)) byId.set(shift.id, shift);
  return materializeManualShiftOverrides({ ...input, employees: [...nextEmployees, ...added], shifts: [...byId.values()],
    ...(changed ? { needsRegeneration: true, generationBasis: undefined } : {}) });
}
