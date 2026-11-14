import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalBranchCode } from "./branch-code";
import { allowedBranches, branchPermission, EscalaError, requireEscalaPermission, type EscalaActor, type EscalaPermission } from "./access";
import { escalaInputSchema } from "./schema";
import { EscalaSolverError, solveEscala } from "./solver-client";
import { validateEscala } from "./validation";
import { logSolverRejection } from "./solver-diagnostics";
import { findGenerationConflicts } from "./generation-conflicts";
import { generationScenarioBasis, isHoursReferenceOnly, matchesHoursOnlyAssignments } from "./hours-reference";
import { compareBranches } from "./order";
import { addDays, dateRange, monthBounds, visibleDates } from "./dates";
import { fixedBoundaryReservations } from "./boundary";
import { preservePublishedDays, publishedPlanningContext } from "./continuity";
import { matchesRestOnlyReferences, prepareGeneration } from "./generation";
import { dailyMinuteCeiling, isMixed42LongShift, SUPERMARKET_CCT, usesMixed42Week } from "./labor-rules";
import type { EscalaAssignment, EscalaInput, EscalaWorkspace } from "./types";
import { fitsStoreClosing, storeClosingLabel, storeClosingMinutes, workAfterStoreClosing } from "./store-hours";

import { manualAssignmentIssues, manualShiftIssues, materializeManualShiftOverrides } from "./shift-catalog/manual-override";
type WorkspaceRow = {
  id: string; tenantId: string; branchCode: string; branchName: string;
  startDate: string; endDate: string; revision: number; status: string; updatedAt: Date;
};

function actorProvenance(actor: EscalaActor) {
  return actor.moduleSessionId ? { accessChannel: "ESCALAS_MODULE_PASSWORD", moduleSessionId: actor.moduleSessionId } : {};
}

function snapshotJson(input: EscalaInput): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

export function parseEscalaInput(value: unknown): EscalaInput {
  const parsed = escalaInputSchema.safeParse(value);
  if (!parsed.success) throw new EscalaError(400, "ESCALA_INVALID_INPUT", parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  if (!parsed.data.employees.some(person => person.manualShiftOverrides?.length)) return parsed.data;
  const materialized = materializeManualShiftOverrides(parsed.data);
  const checked = escalaInputSchema.safeParse(materialized);
  if (!checked.success) throw new EscalaError(400, "ESCALA_INVALID_INPUT", checked.error.issues.slice(0, 8).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return checked.data;
}

async function assertManualCatalogSelections(actor: EscalaActor, input: EscalaInput, previous?: EscalaInput) {
  const changed = input.employees.filter(person => JSON.stringify(person.manualShiftOverrides ?? []) !== JSON.stringify(previous?.employees.find(old => old.id === person.id)?.manualShiftOverrides ?? []));
  if (!changed.some(person => person.manualShiftOverrides?.length)) return;
  const { getTurnoCatalogEntry } = await import("./shift-catalog/catalog");
  const checked = new Map<number, readonly string[]>();
  for (const person of changed) for (const choice of person.manualShiftOverrides ?? []) {
    let markings = checked.get(choice.catalogCode);
    if (!markings) {
      markings = (await getTurnoCatalogEntry(actor, choice.catalogCode)).markings;
      checked.set(choice.catalogCode, markings);
    }
    if (markings.join("|") !== choice.markings.join("|")) throw new EscalaError(422, "TURNO_CATALOG_CHANGED", "As marcações não correspondem ao código no catálogo desta empresa. Atualize a prévia antes de salvar.");
  }
}

function view(row: WorkspaceRow, input: EscalaInput, permission: EscalaPermission): EscalaWorkspace {
  // A saved draft can predate the closing rule. Flag its actual workdays on
  // read, without writing a revision or modifying published history.
  if (row.status !== "PUBLISHED" && !input.needsRegeneration && input.assignments.length) {
    const closing = storeClosingMinutes(input);
    const late = new Set(input.shifts.filter(shift => !fitsStoreClosing(shift, closing)).map(shift => shift.id));
    const included = new Set(input.employees.filter(person => person.planningEnabled !== false).map(person => person.id));
    if (late.size && input.assignments.some(day => day.kind === "WORK" && included.has(day.employeeId) && late.has(day.shiftId ?? ""))) {
      input = { ...input, needsRegeneration: true };
    }
  }
  return { id: row.id, revision: row.revision, status: row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT", input,
    validation: validateEscala(input, { publishedSnapshot: row.status === "PUBLISHED" }), ...permission, updatedAt: row.updatedAt.toISOString() };
}

export async function listEscalas(actor: EscalaActor) {
  const branches = await allowedBranches(actor);
  const rows = await prisma.escalaWorkspace.findMany({
    where: { tenantId: actor.tenantId, ...(branches ? { branchCode: { in: branches } } : {}) },
    orderBy: [{ branchCode: "asc" }, { startDate: "desc" }, { id: "asc" }],
  });
  return rows.sort((a, b) => compareBranches(a, b) || b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id)).map((row) => {
    const visible = visibleDates(row);
    const month = visible[0]?.slice(0, 7);
    const visibleMonth = month && visible[0] === monthBounds(month).startDate && visible.at(-1) === monthBounds(month).endDate ? month : undefined;
    return ({
    id: row.id, revision: row.revision, status: row.status,
    input: { branchCode: canonicalBranchCode(row.branchCode), branchName: row.branchName, startDate: row.startDate, endDate: row.endDate, ...(visibleMonth ? { visibleMonth } : {}) },
    updatedAt: row.updatedAt.toISOString(),
  }); });
}

export async function getEscala(actor: EscalaActor, id: string, revision?: number): Promise<EscalaWorkspace> {
  const row = await prisma.escalaWorkspace.findFirst({ where: { id, tenantId: actor.tenantId } });
  if (!row) throw new EscalaError(404, "ESCALA_NOT_FOUND", "Escala não encontrada.");
  const permission = await branchPermission(actor, row.branchCode);
  const version = await prisma.escalaRevision.findUnique({ where: {
    tenantId_workspaceId_revision: { tenantId: actor.tenantId, workspaceId: row.id, revision: revision ?? row.revision },
  } });
  if (!version) throw new EscalaError(404, "ESCALA_REVISION_NOT_FOUND", "Versão da escala não encontrada.");
  const input = parseEscalaInput(version.input);
  return view({ ...row, revision: version.revision, status: version.status, updatedAt: version.createdAt }, input, permission);
}

export async function createEscala(actor: EscalaActor, input: EscalaInput): Promise<EscalaWorkspace> {
  input = { ...input, branchCode: canonicalBranchCode(input.branchCode) };
  const permission = await branchPermission(actor, input.branchCode);
  requireEscalaPermission(permission, "edit");
  input = materializeManualShiftOverrides(input);
  await assertManualCatalogSelections(actor, input);
  // Coverage provenance belongs to each row; legacy global review never promotes estimates.
  input = publishedPlanningContext(input, []);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.escalaWorkspace.create({ data: {
      tenantId: actor.tenantId, branchCode: input.branchCode, branchName: input.branchName,
      startDate: input.startDate, endDate: input.endDate,
    } });
    await tx.escalaRevision.create({ data: { tenantId: actor.tenantId, workspaceId: created.id, revision: 1,
      status: "DRAFT", input: snapshotJson(input), createdById: actor.userId, ...actorProvenance(actor) } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", entity: "EscalaWorkspace", entityId: created.id,
      metadata: { ...actorProvenance(actor), tenantId: actor.tenantId, revision: 1, employeeCount: input.employees.length } } });
    return created;
  }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const target = "meta" in error && error.meta && typeof error.meta === "object" && "target" in error.meta ? error.meta.target : null;
      if ((Array.isArray(target) && target.includes("branchCode"))
        || (typeof target === "string" && target.includes("EscalaWorkspace_tenantId_branchCode_startDate_endDate"))) {
        throw new EscalaError(409, "ESCALA_ALREADY_EXISTS", "Já existe um planejamento desta filial e período. Abra o planejamento existente para continuar.");
      }
    }
    throw error;
  });
  return view(row, input, permission);
}

function assignmentKey(item: EscalaAssignment) { return `${item.employeeId}\0${item.date}`; }
function sameAssignment(a: EscalaAssignment, b: EscalaAssignment | undefined) {
  return Boolean(b && a.kind === b.kind && a.shiftId === b.shiftId && Boolean(a.locked) === Boolean(b.locked));
}

type PublishedDay = { date: string; signature: string; scheduled: boolean };

function publishedDayIndex(input: EscalaInput, firstDate: string, lastDate: string) {
  const employees = new Map(input.employees.map((person) => [person.id, person]));
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const records = new Map<string, PublishedDay>();
  const register = (assignment: EscalaAssignment, scheduled: boolean, reservation = false) => {
    const person = employees.get(assignment.employeeId);
    if (!person || assignment.date < firstDate || assignment.date > lastDate || assignment.date < person.activeFrom
      || (person.activeUntil && assignment.date > person.activeUntil)) return;
    const key = JSON.stringify([person.registration, assignment.date]);
    const segments = assignment.kind === "WORK" ? shifts.get(assignment.shiftId ?? "")?.segments.map((segment) => [segment.start, segment.end, segment.kind]) : undefined;
    // IDs, display names and lock flags do not change the employee's actual scheduled periods.
    const signature = JSON.stringify([assignment.kind, ...(segments ? [segments] : [])]);
    if (records.has(key)) {
      if (reservation) return;
      throw new EscalaError(409, "ESCALA_PUBLISHED_OVERLAP", `Há mais de um vínculo ou registro para a mesma matrícula em ${assignment.date}. Confira a identificação antes de publicar.`);
    }
    records.set(key, { date: assignment.date, signature, scheduled });
  };
  input.assignments.forEach((assignment) => { register(assignment, true); });
  input.employees.forEach((person) => { person.history.forEach((assignment) => { register(assignment, false); }); });
  fixedBoundaryReservations(input).forEach((assignment) => { register(assignment, true, true); });
  return records;
}

async function preservePublishedContinuity(tx: Prisma.TransactionClient, actor: EscalaActor, id: string, input: EscalaInput) {
  // executeRaw discards SELECT result fields; pg_advisory_xact_lock's void value is never deserialized.
  const lockKey = `escalas-publication:${JSON.stringify([actor.tenantId, input.branchCode])}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  const firstDate = addDays(input.startDate, -21);
  const lastDate = addDays(input.endDate, 21);
  const peers = await tx.escalaWorkspace.findMany({
    where: { tenantId: actor.tenantId, branchCode: input.branchCode, id: { not: id }, startDate: { lte: lastDate }, endDate: { gte: firstDate } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { revisions: { where: { tenantId: actor.tenantId, status: "PUBLISHED" }, orderBy: { revision: "desc" }, take: 1, select: { input: true } } },
  });
  const current = publishedDayIndex(input, firstDate, lastDate);
  const published: EscalaInput[] = [];
  for (const peer of peers) {
    const revision = peer.revisions[0];
    if (!revision) continue;
    const parsed = escalaInputSchema.safeParse(revision.input);
    if (!parsed.success) throw new EscalaError(409, "ESCALA_PUBLISHED_OVERLAP", "Uma versão publicada desta filial não pôde ser conferida. Revise os períodos e seus históricos antes de publicar.");
    published.push(parsed.data);
    const previous = publishedDayIndex(parsed.data, firstDate, lastDate);
    for (const [key, day] of current) {
      const other = previous.get(key);
      // Compare schedules to schedules and declared history to schedules. Never treat a plan as time-clock evidence.
      if (other && (day.scheduled || other.scheduled) && day.signature !== other.signature) {
        throw new EscalaError(409, "ESCALA_PUBLISHED_OVERLAP", `Há divergência com uma escala já publicada desta filial em ${day.date}. Compatibilize as revisões e o histórico informado antes de publicar; o histórico não foi alterado.`);
      }
    }
  }
  const contextual = publishedPlanningContext(input, published);
  assertPublishedBoundary(contextual, input);
  for (const peer of published) {
    if (peer.startDate > input.startDate) {
      const earlier = published.filter((other) => other !== peer);
      assertPublishedBoundary(publishedPlanningContext(peer, [...earlier, input]), publishedPlanningContext(peer, earlier));
    }
  }
  return contextual;
}

const continuityCodes = new Set(["WORK_STREAK", "SUNDAY_ROTATION", "INTER_SHIFT_REST", "WEEKLY_REST", "OFF_OCCUPIED", "CONSECUTIVE_OFF", "CONSECUTIVE_PENDING", "INPUT_INVALID"]);

function assertPublishedBoundary(input: EscalaInput, baseline: EscalaInput) {
  const key = (entry: { code: string; employeeId?: string; date?: string; message: string }) => JSON.stringify([entry.code, entry.employeeId, entry.date, entry.message]);
  const existing = new Set(validateEscala(baseline).issues.filter((entry) => continuityCodes.has(entry.code)).map(key));
  const issue = validateEscala(input).issues.find((entry) => continuityCodes.has(entry.code) && !existing.has(key(entry)));
  if (issue) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", `A proposta rompe a continuidade de uma escala publicada${issue.date ? ` em ${issue.date}` : ""}: ${issue.message}`);
}

async function planningContext(actor: EscalaActor, id: string, input: EscalaInput) {
  const rows = await prisma.escalaWorkspace.findMany({
    where: { tenantId: actor.tenantId, branchCode: input.branchCode, id: { not: id }, startDate: { lte: addDays(input.endDate, 21) }, endDate: { gte: addDays(input.startDate, -21) } },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    select: { revisions: { where: { tenantId: actor.tenantId, status: "PUBLISHED" }, orderBy: { revision: "desc" }, take: 1, select: { input: true } } },
  });
  const published: EscalaInput[] = [];
  for (const row of rows) {
    const revision = row.revisions?.[0];
    if (!revision) continue;
    const parsed = escalaInputSchema.safeParse(revision.input);
    if (!parsed.success) throw new EscalaError(409, "ESCALA_PUBLISHED_CONTINUITY", "Uma proposta publicada da filial não pôde ser conferida.");
    published.push(parsed.data);
  }
  return preservePublishedDays(publishedPlanningContext(input, published), published);
}

export function preserveLockedAssignments(previous: EscalaInput, next: EscalaInput, canUnlock = false) {
  const assignments = new Map(next.assignments.map((item) => [assignmentKey(item), item]));
  const previousShifts = new Map(previous.shifts.map((shift) => [shift.id, shift]));
  const nextShifts = new Map(next.shifts.map((shift) => [shift.id, shift]));
  for (const item of previous.assignments.filter((assignment) => assignment.locked)) {
    const proposed = assignments.get(assignmentKey(item));
    const explicitUnlock = canUnlock && proposed?.locked === false && proposed.kind === item.kind && proposed.shiftId === item.shiftId;
    if ((!sameAssignment(item, proposed) && !explicitUnlock) || (item.shiftId && JSON.stringify(previousShifts.get(item.shiftId)) !== JSON.stringify(nextShifts.get(item.shiftId)))) {
      throw new EscalaError(409, "ESCALA_LOCKED_ASSIGNMENT", "A proposta altera um dia bloqueado ou seu horário. Um aprovador pode desmarcar o bloqueio e salvar, preservando a atribuição; depois poderá editá-la.");
    }
  }
}

export async function saveEscala(actor: EscalaActor, id: string, expectedRevision: number, input: EscalaInput, publish = false) {
  input = { ...input, branchCode: canonicalBranchCode(input.branchCode) };
  const current = await getEscala(actor, id);
  requireEscalaPermission(current, publish ? "publish" : "edit");
  assertRevision(current, expectedRevision);
  if (input.branchCode !== current.input.branchCode || input.startDate !== current.input.startDate || input.endDate !== current.input.endDate) {
    throw new EscalaError(409, "ESCALA_IDENTITY_CHANGED", "Filial e período identificam esta escala. Crie outra proposta para alterar esses campos.");
  }
  input = materializeManualShiftOverrides(input);
  await assertManualCatalogSelections(actor, input, current.input);
  const manualReferenceIssue = manualShiftIssues(input)[0];
  if (manualReferenceIssue) throw new EscalaError(422, manualReferenceIssue.code, manualReferenceIssue.message);
  const manualAssignmentIssue = manualAssignmentIssues(input)[0];
  if (manualAssignmentIssue) throw new EscalaError(422, manualAssignmentIssue.code, manualAssignmentIssue.message);
  preserveLockedAssignments(current.input, input, !publish && current.canPublish);
  const scenarioChanged = generationScenarioBasis(current.input) !== generationScenarioBasis(input);
  const preparedProposal = !input.needsRegeneration && input.generationBasis === generationScenarioBasis(input);
  if ((scenarioChanged || current.input.needsRegeneration) && !preparedProposal) {
    input = { ...input, needsRegeneration: true, generationBasis: undefined };
  }
  if (isHoursReferenceOnly(input) && !preparedProposal) input = { ...input, needsRegeneration: true };
  if (storeClosingMinutes(current.input) !== storeClosingMinutes(input)) {
    input = { ...input, needsRegeneration: input.needsRegeneration || input.assignments.length > 0,
      demands: input.demands.filter(demand => demand.estimated !== true) };
  }
  input = publishedPlanningContext(input, []);
  const lateWork = workAfterStoreClosing(input);
  if (lateWork.length && !publish) {
    const previous = new Map(current.input.assignments.map(day => [assignmentKey(day), day]));
    const previousShifts = new Map(current.input.shifts.map(shift => [shift.id, shift.segments]));
    const nextShifts = new Map(input.shifts.map(shift => [shift.id, shift.segments]));
    // Keep an obsolete draft recoverable, including an explicit unlock. Never
    // accept newly introduced or edited late work, even with a caller-supplied stale flag.
    const unchangedLateWork = lateWork.every(day => {
      const old = previous.get(assignmentKey(day));
      return old?.kind === "WORK" && old.shiftId === day.shiftId
        && JSON.stringify(previousShifts.get(old.shiftId ?? "")) === JSON.stringify(nextShifts.get(day.shiftId ?? ""));
    });
    if (!unchangedLateWork) throw new EscalaError(422, "ESCALA_CLOSING_EXCEEDED", `Há trabalho após o fechamento da loja (${storeClosingLabel(input)}). Ajuste a saída ou gere uma nova proposta antes de salvar. Os registros não foram alterados.`);
    input = { ...input, needsRegeneration: true };
  }
  let validation = validateEscala(input);
  const status = publish ? "PUBLISHED" : "DRAFT";
  const alreadyPublished = publish && current.status === "PUBLISHED";
  const revision = expectedRevision + 1;
  const updatedAt = new Date();
  await prisma.$transaction(async (tx) => {
    if (publish) {
      input = await preservePublishedContinuity(tx, actor, id, input);
      validation = validateEscala(input);
      if (!validation.readyToPublish) throw new EscalaError(422, "ESCALA_NOT_READY", "A escala possui impedimentos ou pendências. Resolva a conferência antes de publicar.");
    }
    if (alreadyPublished) {
      const latest = await tx.escalaWorkspace.findFirst({ where: { id, tenantId: actor.tenantId, revision: expectedRevision }, select: { revision: true } });
      if (!latest) throw new EscalaError(409, "ESCALA_STALE_REVISION", "Esta escala foi alterada por outra pessoa. Recarregue a versão atual antes de continuar.");
      return;
    }
    const updated = await tx.escalaWorkspace.updateMany({
      where: { id, tenantId: actor.tenantId, revision: expectedRevision },
      data: { revision, status, branchName: input.branchName, updatedAt },
    });
    if (updated.count !== 1) throw new EscalaError(409, "ESCALA_STALE_REVISION", "Esta escala foi alterada por outra pessoa. Recarregue a versão atual antes de continuar.");
    await tx.escalaRevision.create({ data: { tenantId: actor.tenantId, workspaceId: id, revision, status,
      input: snapshotJson(input), createdById: actor.userId, ...actorProvenance(actor) } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: publish ? "PUBLISH" : "UPDATE", entity: "EscalaWorkspace", entityId: id,
      metadata: { ...actorProvenance(actor), tenantId: actor.tenantId, revision, previousRevision: expectedRevision, employeeCount: input.employees.length } } });
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
  if (alreadyPublished) return current;
  return { ...current, revision, status, input, validation, updatedAt: updatedAt.toISOString() } as EscalaWorkspace;
}

function assertRevision(workspace: EscalaWorkspace, expectedRevision: number) {
  if (workspace.revision !== expectedRevision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "A versão da proposta mudou. Recarregue a escala e gere uma nova análise.");
}

function requireSolverSetup(input: EscalaInput) {
  const included = input.employees.filter((person) => person.planningEnabled !== false && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate));
  const timed = included.filter((person) => (person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING"));
  if (!included.length || (timed.length > 0 && (!input.shifts.length || timed.some((person) => !person.shiftIds.length)))) throw new EscalaError(422, "ESCALA_SETUP_REQUIRED", "Inclua pelo menos um colaborador e defina horários para quem tem jornada controlada. Pessoas sem horário fixo participam do rodízio de folgas sem turno fictício.");
  if (input.policy.normativeProfile === SUPERMARKET_CCT && input.policy.holidayRestAllowed) throw new EscalaError(422, "ESCALA_CCT_HOLIDAY_REST", "A CCT de supermercados veda compensar o DSR em feriado. Corrija a configuração antes de gerar.");
  const minutes = new Map(input.shifts.map((shift) => [shift.id, shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)]));
  const longMixed = new Set(input.shifts.filter(isMixed42LongShift).map(shift => shift.id));
  if (dateRange(input.startDate, input.endDate).some((date) => timed.some((person) => person.activeFrom <= date && (!person.activeUntil || person.activeUntil >= date)
    && person.shiftIds.every((shiftId) => !(longMixed.has(shiftId) && usesMixed42Week(input, person, date))
      && (minutes.get(shiftId) ?? Infinity) > Math.min(input.policy.dailyLimitMinutes, dailyMinuteCeiling(date)))))) {
    throw new EscalaError(422, "ESCALA_DAILY_LIMIT", "Os horários excedem o limite diário na vigência selecionada. Reaplique a configuração em lote da equipe para propor horários compatíveis; um acordo não amplia o teto deste regime.");
  }
  // Administrative compensation evidence is classified by referenceNotices; operational ceilings above remain mandatory.
}

export async function generateEscala(actor: EscalaActor, id: string, expectedRevision: number, options?: import("./solver-transport").SolverOptions) {
  const current = await getEscala(actor, id);
  requireEscalaPermission(current, "edit");
  assertRevision(current, expectedRevision);
  if (current.input.generationMode === "HOURS_ONLY" && !isHoursReferenceOnly(current.input)) {
    const existing = new Set(current.input.assignments.map(day => `${day.employeeId}\0${day.date}`));
    const incomplete = current.input.employees.some(person => person.planningEnabled !== false
      && dateRange(current.input.startDate, current.input.endDate).some(date => date >= person.activeFrom
        && (!person.activeUntil || date <= person.activeUntil) && !existing.has(`${person.id}\0${date}`)));
    if (incomplete) throw new EscalaError(422, "ESCALA_HOURS_BASELINE_INCOMPLETE", "A grade está incompleta. Complete os dias ou gere folgas e horários antes de ajustar somente os horários; nenhum dia foi inventado.");
  }
  const qualityReference = structuredClone(current.input);
  const prepared = prepareGeneration(current.input);
  if (isHoursReferenceOnly(prepared.input)) {
    const proposalInput = parseEscalaInput({ ...prepared.input, needsRegeneration: false, generationBasis: generationScenarioBasis(prepared.input) });
    try { preserveLockedAssignments(current.input, proposalInput); }
    catch (error) { logSolverRejection("service-preservation", "LOCK_CHANGED"); throw error; }
    if (!matchesHoursOnlyAssignments(current.input, proposalInput)) { logSolverRejection("service-preservation", "HOURS_ONLY_CHANGED"); throw new EscalaSolverError("SOLVER_INVALID_RESPONSE"); }
    const validation = validateEscala(proposalInput);
    if (!validation.valid) { logSolverRejection("service-validation", "RULES_INVALID", { issues: validation.issues }); throw new EscalaError(422, "ESCALA_HOURS_REFERENCE_INVALID", "Alguns horários não atendem às regras do cenário. Confira entrada, intervalo, saída e fechamento; nenhum dia de trabalho ou folga foi criado."); }
    const latest = await getEscala(actor, id);
    try { assertRevision(latest, expectedRevision); }
    catch (error) { logSolverRejection("service-recheck", "RECHECK_FAILED"); throw error; }
    return { result: { status: "FEASIBLE" as const, assignments: proposalInput.assignments, wallTimeSeconds: 0,
      message: "Referências de horários preparadas. Nenhuma presença diária, folga ou cobertura foi gerada." }, proposalInput, validation, preparation: prepared.preparation };
  }
  requireSolverSetup(prepared.input);
  const contextual = await planningContext(actor, id, parseEscalaInput(prepared.input));
  const closingConflict = workAfterStoreClosing(contextual).find(day => day.locked);
  if (closingConflict) throw new EscalaError(409, "ESCALA_CLOSING_PUBLISHED_CONFLICT", `Um dia já publicado em ${closingConflict.date} termina após o fechamento atual (${storeClosingLabel(contextual)}). Corrija o horário na escala publicada de origem ou ajuste o fechamento deste planejamento antes de gerar. O dia publicado foi preservado.`);
  const calculation = await solveEscala(contextual, { ...options, qualityReference });
  const result = calculation.status === "INFEASIBLE" ? {
    ...calculation, conflicts: [...findGenerationConflicts(contextual), ...(calculation.solverDiagnostics ?? []).map(diagnostic => ({
      code: `SOLVER_${diagnostic.family}`, message: diagnostic.message,
      target: diagnostic.family === "COVERAGE" ? "coverage" as const : "team" as const,
    }))],
    message: contextual.generationMode === "REST_ONLY"
      ? `${calculation.message} Neste modo, os horários de entrada e saída são mantidos. Se puder flexibilizá-los, selecione "Folgas e horários" e gere novamente.` : calculation.message,
  } : calculation;
  let proposalInput = contextual;
  if (result.status === "FEASIBLE" || result.status === "OPTIMAL") {
    try {
      proposalInput = parseEscalaInput({ ...contextual, needsRegeneration: false, generationBasis: generationScenarioBasis(contextual), assignments: result.assignments });
    } catch {
      // Context was parsed before invoking the worker. Only its returned assignments are new here.
      logSolverRejection("service-schema", "SCHEMA_INVALID");
      throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
    }
  }
  try { preserveLockedAssignments(current.input, proposalInput); }
  catch (error) { logSolverRejection("service-preservation", "LOCK_CHANGED"); throw error; }
  if (!matchesHoursOnlyAssignments(current.input, proposalInput)) { logSolverRejection("service-preservation", "HOURS_ONLY_CHANGED"); throw new EscalaSolverError("SOLVER_INVALID_RESPONSE"); }
  const latest = await getEscala(actor, id);
  try { assertRevision(latest, expectedRevision); }
  catch (error) { logSolverRejection("service-recheck", "RECHECK_FAILED"); throw error; }
  const validation = validateEscala(proposalInput);
  if ((result.status === "FEASIBLE" || result.status === "OPTIMAL") && (!validation.valid || validation.issues.some((issue) => issue.code === "DAY_PENDING") || !matchesRestOnlyReferences(contextual, result.assignments))) {
    logSolverRejection("service-validation", !validation.valid || validation.issues.some(issue => issue.code === "DAY_PENDING") ? "RULES_INVALID" : "REST_ONLY_CHANGED", { issues: validation.issues });
    throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
  }
  return { result, proposalInput, validation, preparation: prepared.preparation };
}

/** Explicit deletion; FK Restrict requires removing the exact revisions in the same transaction. */
export async function deleteEscala(actor: EscalaActor, id: string, expectedRevision: number) {
  const row = await prisma.escalaWorkspace.findFirst({ where: { id, tenantId: actor.tenantId } });
  if (!row) throw new EscalaError(404, "ESCALA_NOT_FOUND", "Planejamento não encontrado nesta empresa.");
  const permission = await branchPermission(actor, row.branchCode);
  requireEscalaPermission(permission, "edit");
  if (row.revision !== expectedRevision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "O planejamento mudou. Recarregue antes de excluir.");
  await prisma.$transaction(async (tx) => {
    const lockKey = "escalas-publication:" + JSON.stringify([actor.tenantId, row.branchCode]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    const current = await tx.escalaWorkspace.findFirst({ where: { id, tenantId: actor.tenantId } });
    if (!current || current.revision !== expectedRevision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "O planejamento mudou durante a exclusão. Recarregue a lista.");
    const published = await tx.escalaRevision.findFirst({ where: { tenantId: actor.tenantId, workspaceId: id, status: "PUBLISHED" }, select: { revision: true } });
    if (published) {
      requireEscalaPermission(permission, "publish");
      // Published neighbouring periods may use shared technical days or planning history.
      // No source IDs were stored in legacy snapshots: fail safely instead of destroying that context.
      const dependencies = await tx.escalaWorkspace.findMany({ where: {
        tenantId: actor.tenantId, branchCode: row.branchCode, id: { not: id },
        startDate: { lte: addDays(row.endDate, 21) }, endDate: { gte: addDays(row.startDate, -21) },
        revisions: { some: { status: "PUBLISHED", tenantId: actor.tenantId } },
      }, select: { id: true } });
      if (dependencies.length) throw new EscalaError(409, "ESCALA_DELETE_DEPENDENCY", "Há planejamentos publicados próximos que podem depender dos dias compartilhados ou do histórico desta filial. Revise essa continuidade antes de excluir; nenhuma revisão foi removida.");
    }
    await tx.escalaRevision.deleteMany({ where: { tenantId: actor.tenantId, workspaceId: id } });
    const deleted = await tx.escalaWorkspace.deleteMany({ where: { tenantId: actor.tenantId, id, revision: expectedRevision } });
    if (deleted.count !== 1) throw new EscalaError(409, "ESCALA_STALE_REVISION", "O planejamento mudou durante a exclusão. Nenhum dado foi removido.");
    await tx.auditLog.create({ data: { userId: actor.userId, action: "DELETE", entity: "EscalaWorkspace", entityId: id, metadata: { ...actorProvenance(actor), tenantId: actor.tenantId, revision: expectedRevision } } });
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
  return { deletedId: id };
}
