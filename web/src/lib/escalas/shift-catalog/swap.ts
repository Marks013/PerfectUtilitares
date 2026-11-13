import { createHash } from "node:crypto";
import type { EscalaInput, EscalaShift } from "../types";
import { getEscala, parseEscalaInput, saveEscala } from "../service";
import { EscalaError, type EscalaActor } from "../access";
import { validateEscala } from "../validation";
import { findTurnoCatalogCode, getTurnoCatalogEntry } from "./catalog";
import type { TurnoSwapPreviewDto, TurnoSwapRequest, TurnoSwapPreviewRequest, TurnoSwapApplyRequest, TurnoSwapAffectedDayDto, TurnoSwapPreservedDayDto } from "./contracts";
import { clockMinutes, markingKey, markingsFromShift } from "./domain";

import { manualAssignmentIssues, manualShiftIssues, materializeManualShiftOverrides, withManualShiftOverride } from "./manual-override";
import { generationScenarioBasis } from "../hours-reference";

type SwapComputation = {
  preview: TurnoSwapPreviewDto;
  nextInput: EscalaInput;
};

function shiftForCatalogCode(code: number, markings: TurnoSwapPreviewDto["target"]["markings"]): EscalaShift {
  const [firstIn, firstOut, secondIn, secondOut] = markings.map(value => (clockMinutes(value) as number));
  const segments: EscalaShift["segments"] = [{ start: firstIn, end: firstOut, kind: "WORK" }];
  if (secondIn !== 0 || secondOut !== 0) {
    if (firstOut < secondIn) segments.push({ start: firstOut, end: secondIn, kind: "BREAK" });
    segments.push({ start: secondIn, end: secondOut, kind: "WORK" });
  }
  return { id: `catalog-${code}`, name: markings.join(" "), segments };
}

function sameMarkings(left: ReturnType<typeof markingsFromShift>, right: TurnoSwapPreviewDto["target"]["markings"]): boolean {
  return left.ok && markingKey(left.markings) === markingKey(right);
}

async function computeSwap(actor: EscalaActor, request: TurnoSwapRequest): Promise<SwapComputation> {
  if (request.effectiveFrom > request.effectiveUntil) throw new EscalaError(400, "TURNO_INVALID_DATES", "A data inicial deve ser anterior ou igual à data final.");
  const workspace = await getEscala(actor, request.workspaceId);
  if (workspace.revision !== request.expectedRevision) throw new EscalaError(409, "TURNO_REVISION_CONFLICT", "A revisão mudou. Atualize a prévia antes de confirmar.");
  if (workspace.status !== "DRAFT") throw new EscalaError(409, "TURNO_PUBLISHED_IMMUTABLE", "A publicação não pode ser alterada por esta ação. Crie uma proposta em rascunho pelo fluxo autorizado.");
  if (!workspace.canEdit) throw new EscalaError(403, "ESCALA_ACTION_FORBIDDEN", "Você não possui permissão para alterar esta filial.");
  if (request.effectiveFrom < workspace.input.startDate || request.effectiveUntil > workspace.input.endDate) {
    throw new EscalaError(400, "TURNO_DATES_OUTSIDE_PLAN", "O período selecionado precisa estar dentro do planejamento.");
  }
  const target = await getTurnoCatalogEntry(actor, request.catalogCode);
  const employee = workspace.input.employees.find(person => person.id === request.employeeId);
  if (!employee) throw new EscalaError(404, "TURNO_EMPLOYEE_NOT_FOUND", "O colaborador não pertence a esta revisão.");
  if (employee.planningEnabled === false || employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING" || !employee.shiftIds.length) {
    throw new EscalaError(422, "MANUAL_SHIFT_SCHEDULE_MODE", "A troca exige uma referência de horário controlado incluída no planejamento. Não foi criado horário para ENC ou pessoa excluída.");
  }

  const existingShifts = workspace.input.shifts;
  let targetShift = existingShifts.find(shift => sameMarkings(markingsFromShift(shift), target.markings));
  const candidate = shiftForCatalogCode(target.code, target.markings);
  if (!targetShift) {
    const idCollision = existingShifts.find(shift => shift.id === candidate.id);
    if (idCollision && !sameMarkings(markingsFromShift(idCollision), target.markings)) {
      throw new EscalaError(409, "TURNO_LOCAL_ID_CONFLICT", "Não foi possível materializar o código sem colidir com um identificador local.");
    }
    targetShift = idCollision ?? candidate;
  }

  const affected: TurnoSwapAffectedDayDto[] = [];
  const preserved: TurnoSwapPreservedDayDto[] = [];
  const currentShiftMap = new Map(existingShifts.map(shift => [shift.id, shift]));
  const previousCodesByShiftId = new Map<string, number | null>();
  for (const assignment of workspace.input.assignments) {
    if (assignment.employeeId !== employee.id || assignment.date < request.effectiveFrom || assignment.date > request.effectiveUntil
      || !assignment.shiftId || previousCodesByShiftId.has(assignment.shiftId)) continue;
    const previousShift = currentShiftMap.get(assignment.shiftId);
    const previousMarkings = previousShift && markingsFromShift(previousShift);
    previousCodesByShiftId.set(assignment.shiftId, previousMarkings?.ok
      ? await findTurnoCatalogCode(actor, previousMarkings.markings)
      : null);
  }
  const assignments = workspace.input.assignments.map(assignment => {
    if (assignment.employeeId !== employee.id || assignment.date < request.effectiveFrom || assignment.date > request.effectiveUntil) return assignment;
    if (assignment.kind === "ABSENCE") {
      preserved.push({ date: assignment.date, reason: "ABSENCE" });
      return assignment;
    }
    if (assignment.kind === "OFF") {
      preserved.push({ date: assignment.date, reason: "OFF" });
      return assignment;
    }
    if (assignment.kind === "HOLIDAY") {
      preserved.push({ date: assignment.date, reason: "HOLIDAY" });
      return assignment;
    }
    if (assignment.kind !== "WORK" || !assignment.shiftId) {
      preserved.push({ date: assignment.date, reason: "NO_SHIFT" });
      return assignment;
    }
    if (assignment.locked === true) {
      preserved.push({ date: assignment.date, reason: "LOCKED" });
      return assignment;
    }
    if (assignment.locked !== false) {
      preserved.push({ date: assignment.date, reason: "MANUAL" });
      return assignment;
    }
    const oldShift = currentShiftMap.get(assignment.shiftId);
    const oldMarkings = oldShift && markingsFromShift(oldShift);
    const previousCatalogCode = oldMarkings?.ok ? previousCodesByShiftId.get(assignment.shiftId) ?? null : null;
    const next = { ...assignment, shiftId: (targetShift as NonNullable<typeof targetShift>).id };
    affected.push({
      date: assignment.date,
      previousShiftId: assignment.shiftId,
      previousCatalogCode,
      nextShiftId: (targetShift as NonNullable<typeof targetShift>).id,
      nextCatalogCode: target.code,
    });
    return next;
  });

  const nextInput = materializeManualShiftOverrides({
    ...workspace.input,
    employees: workspace.input.employees.map(person => person.id === employee.id ? { ...withManualShiftOverride(person, {
      catalogCode: target.code, shiftId: (targetShift as NonNullable<typeof targetShift>).id, markings: target.markings,
      effectiveFrom: request.effectiveFrom, effectiveUntil: request.effectiveUntil,
    }), ...(person.weeklyHoursMode === "BRANCH" ? { weeklyHours: workspace.input.defaultWeeklyHours } : {}) } : person),
    shifts: existingShifts.some(shift => shift.id === (targetShift as NonNullable<typeof targetShift>).id) ? existingShifts : [...existingShifts, targetShift],
    assignments,
  });
  const validationLevel = assignments.some(day => ["WORK", "OFF", "DUTY"].includes(day.kind)) ? "FULL_SCHEDULE" as const : "NO_SCHEDULE" as const;
  const referenceIssues = manualShiftIssues(nextInput);
  const assignmentIssues = manualAssignmentIssues(nextInput);
  const validation = validationLevel === "FULL_SCHEDULE" ? validateEscala(nextInput) : null;
  const validationIssues = [...(validation?.issues ?? []), ...referenceIssues, ...assignmentIssues].map(issue => ({
    code: issue.code,
    message: issue.message,
    ...(issue.date ? { date: issue.date } : {}),
  }));
  const previewCore = {
    workspaceId: workspace.id,
    expectedRevision: workspace.revision,
    employeeId: employee.id,
    registration: employee.registration,
    target,
    affected,
    preserved,
    validationIssues,
    validationLevel,
    canApply: (validation?.valid ?? true) && !referenceIssues.length && !assignmentIssues.length,
  };
  const intent = [request.workspaceId, request.expectedRevision, request.employeeId, request.catalogCode, request.effectiveFrom, request.effectiveUntil];
  const previewId = createHash("sha256").update(JSON.stringify([actor.tenantId, actor.userId, intent, previewCore, generationScenarioBasis(nextInput)])).digest("hex");
  return { preview: { previewId, ...previewCore }, nextInput };
}

export async function previewTurnoSwap(actor: EscalaActor, request: Omit<TurnoSwapPreviewRequest, "action">): Promise<TurnoSwapPreviewDto> {
  return (await computeSwap(actor, request)).preview;
}

export async function applyTurnoSwap(actor: EscalaActor, request: Omit<TurnoSwapApplyRequest, "action">) {
  const { preview, nextInput } = await computeSwap(actor, request);
  if (preview.previewId !== request.previewId) throw new EscalaError(409, "TURNO_PREVIEW_STALE", "A prévia mudou. Revise novamente antes de confirmar.");
  if (!preview.canApply) throw new EscalaError(422, "TURNO_VALIDATION_FAILED", "A troca não passou pela validação integral da grade.");
  return saveEscala(actor, request.workspaceId, request.expectedRevision, parseEscalaInput(nextInput));
}
