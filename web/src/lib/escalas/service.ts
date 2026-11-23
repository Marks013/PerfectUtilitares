import { isEscalaPlanningParticipant, operationalEscalaInput } from "./eligibility";
import type { Prisma } from "@/generated/prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { canonicalBranchCode } from "./branch-code";
import { allowedBranches, branchPermission, EscalaError, requireEscalaPermission, type EscalaActor, type EscalaPermission } from "./access";
import { escalaInputSchema } from "./schema";
import { EscalaSolverError, solveEscala } from "./solver-client";
import { validateEscala } from "./validation";
import { logSolverRejection } from "./solver-diagnostics";
import { findGenerationConflicts } from "./generation-conflicts";
import { generationScenarioBasis, isHoursReferenceOnly, matchesGenerationScenarioBasis, matchesHoursOnlyAssignments } from "./hours-reference";
import { compareBranches } from "./order";
import { addDays, dateRange, dayOfWeek, monthBounds, visibleDates } from "./dates";
import { preserveCalendarSourceContext, sundayCalendarDraft } from "./calendar-upgrade";
import { fixedBoundaryReservations } from "./boundary";
import { preservePublishedDays, publishedPlanningContext } from "./continuity";
import { matchesRestOnlyReferences, prepareGeneration } from "./generation";
import { admitCandidateReference, issueCandidateReceipt, selectCandidateReference } from "./candidate-reference.server";
import { isOperationallyReusable } from "./roster-quality";
import type { EscalaCandidateResponse } from "./candidate-reference";
import { dailyMinuteCeiling, isMixed42LongShift, SUPERMARKET_CCT, usesMixed42Week } from "./labor-rules";
import type { EscalaAssignment, EscalaInput, EscalaWorkspace } from "./types";
import { fitsStoreClosing, storeClosingLabel, storeClosingMinutes, workAfterStoreClosing } from "./store-hours";

import { manualAssignmentIssues, manualShiftIssues, materializeManualShiftOverrides } from "./shift-catalog/manual-override";
import { lockEscalaAccess, requireEscalaCapability } from "./access";
import { loadEscalaApproval, inputFromEscalaApproval } from "./approved-policy-service";
import { addEmployeeFromEscalaApprovedModel } from "./approved-policy";
import { assertEscalaOperationalInput, assertEscalaProtectedAssignments, stableEscalaJson } from "./operational-input-policy";
import { ESCALA_CAPABILITIES, decideEscalaPermission } from "./permissions";
import { signEscalaProposal, verifyEscalaProposal, type EscalaProposalScope } from "./proposal-proof";
type WorkspaceRow = {
  id: string; tenantId: string; branchCode: string; branchName: string;
  startDate: string; endDate: string; revision: number; status: string; updatedAt: Date;
};

function actorProvenance(actor: EscalaActor) {
  return actor.moduleSessionId ? { accessChannel: "ESCALAS_USERNAME_ONLY", moduleSessionId: actor.moduleSessionId } : {};
}

function snapshotJson(input: EscalaInput): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

export function parseEscalaInput(value: unknown): EscalaInput {
  const parsed = escalaInputSchema.safeParse(value);
  if (!parsed.success) throw new EscalaError(400, "ESCALA_INVALID_INPUT", parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return parsed.data;
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
    const included = new Set(input.employees.filter(isEscalaPlanningParticipant).map(person => person.id));
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
    const calendar = dayOfWeek(row.startDate) === 6 ? { planningWeekStartsOn: "SUNDAY" as const } : {};
    const visible = visibleDates({ ...row, ...calendar });
    const month = visible[0]?.slice(0, 7);
    const visibleMonth = month && visible[0] === monthBounds(month).startDate && visible.at(-1) === monthBounds(month).endDate ? month : undefined;
    return ({
    id: row.id, revision: row.revision, status: row.status,
    input: { branchCode: canonicalBranchCode(row.branchCode), branchName: row.branchName, startDate: row.startDate, endDate: row.endDate, ...calendar, ...(visibleMonth ? { visibleMonth } : {}) },
    updatedAt: row.updatedAt.toISOString(),
  }); });
}

export async function getEscala(actor: EscalaActor, id: string, revision?: number): Promise<EscalaWorkspace & { approvedPolicyVersionId: string | null }> {
  const row = await prisma.escalaWorkspace.findFirst({ where: { id, tenantId: actor.tenantId } });
  if (!row) throw new EscalaError(404, "ESCALA_NOT_FOUND", "Escala não encontrada.");
  const permission = await branchPermission(actor, row.branchCode);
  const version = await prisma.escalaRevision.findUnique({ where: {
    tenantId_workspaceId_revision: { tenantId: actor.tenantId, workspaceId: row.id, revision: revision ?? row.revision },
  } });
  if (!version) throw new EscalaError(404, "ESCALA_REVISION_NOT_FOUND", "Versão da escala não encontrada.");
  if (!actor.admin && !version.approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "O planejamento precisa de aprovação administrativa antes do acesso operacional.");
  const input = parseEscalaInput(version.input);
  return { ...view({ ...row, revision: version.revision, status: version.status, updatedAt: version.createdAt }, input, permission),
    approvedPolicyVersionId: version.approvedPolicyVersionId };
}

export async function createEscala(actor: EscalaActor, input: EscalaInput, approvedPolicyVersionId?: string, origin?: EscalaWorkspace): Promise<EscalaWorkspace & { approvedPolicyVersionId: string | null }> {
  if (input.planningCalendarSource && (!origin || input.planningCalendarSource.workspaceId !== origin.id
    || input.planningCalendarSource.revision !== origin.revision))
    throw new EscalaError(400, "ESCALA_CALENDAR_SOURCE_INVALID", "Use a ação de atualização da semana para criar uma proposta com origem conferida.");
  input = { ...input, branchCode: canonicalBranchCode(input.branchCode) };
  const permission = await branchPermission(actor, input.branchCode);
  await requireEscalaCapability(actor, "workspace.create", input.branchCode);
  if (!actor.admin && !approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Selecione uma configuração aprovada pelo administrador.");
  input = materializeManualShiftOverrides(input);
  await assertManualCatalogSelections(actor, input);
  // Coverage provenance belongs to each row; legacy global review never promotes estimates.
  input = preserveCalendarSourceContext(input, publishedPlanningContext(input, []));
  const row = await prisma.$transaction(async (tx) => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, "workspace.create", input.branchCode, tx);
    if (origin) {
      const latest = await tx.escalaWorkspace.findFirst({ where: { id: origin.id, tenantId: actor.tenantId, revision: origin.revision } });
      if (!latest || latest.revision !== origin.revision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "O planejamento original mudou. Recarregue antes de atualizar a semana.");
    }
    if (approvedPolicyVersionId) {
      const approved = await loadEscalaApproval(actor, approvedPolicyVersionId, tx);
      const expected = parseEscalaInput({ ...approved.snapshot.configuration, ...approved.snapshot.seed });
      if (stableEscalaJson(publishedPlanningContext(materializeManualShiftOverrides(expected), [])) !== stableEscalaJson(input)) {
        throw new EscalaError(403, "ESCALA_PROTECTED_INPUT", "A criação deve usar a configuração aprovada exata.");
      }
    }
    const created = await tx.escalaWorkspace.create({ data: {
      tenantId: actor.tenantId, branchCode: input.branchCode, branchName: input.branchName,
      startDate: input.startDate, endDate: input.endDate,
    } });
    input = await planningContext(actor, created.id, input, tx);
    await tx.escalaRevision.create({ data: { tenantId: actor.tenantId, workspaceId: created.id, revision: 1,
      status: "DRAFT", input: snapshotJson(input), createdById: actor.userId, approvedPolicyVersionId: approvedPolicyVersionId ?? null, ...actorProvenance(actor) } });
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
  return { ...view(row, input, permission), approvedPolicyVersionId: approvedPolicyVersionId ?? null };
}

export async function createEscalaApproved(actor: EscalaActor, approvedPolicyVersionId: string) {
  return createEscala(actor, await inputFromEscalaApproval(actor, approvedPolicyVersionId), approvedPolicyVersionId);
}

/** Explicit upgrade creates another revision history; the source is never overwritten. */
export async function upgradeEscalaCalendar(actor: EscalaActor, id: string, expectedRevision: number): Promise<EscalaWorkspace> {
  const current = await getEscala(actor, id);
  requireEscalaPermission(current, "edit");
  assertRevision(current, expectedRevision);
  const draft = parseEscalaInput(sundayCalendarDraft(current.input, { workspaceId: id, revision: expectedRevision }));
  return createEscala(actor, draft, undefined, current);
}

async function proposalScope(actor: EscalaActor, current: EscalaWorkspace & { approvedPolicyVersionId: string | null }, db: Prisma.TransactionClient = prisma): Promise<EscalaProposalScope> {
  if (!actor.moduleSessionId && !actor.accountSessionId) throw new EscalaError(401, "ESCALA_ACCESS_REQUIRED", "Entre novamente para obter uma proposta vinculada à sua sessão.");
  const context = await requireEscalaCapability(actor, "schedule.generate", current.input.branchCode, db);
  const policy = await db.escalaModuleAccessPolicy.findUnique({ where: { tenantId: actor.tenantId }, select: { version: true } });
  if (current.approvedPolicyVersionId) await loadEscalaApproval(actor, current.approvedPolicyVersionId, db, current.input);
  const principal = context.principal;
  return { tenantId: actor.tenantId, principal: `${principal?.kind}:${principal?.id}`,
    session: actor.moduleSessionId ?? actor.accountSessionId ?? "", workspaceId: current.id, revision: current.revision,
    approvalId: current.approvedPolicyVersionId, accessVersion: createHash("sha256").update(stableEscalaJson({ context,
      policyVersion: policy?.version ?? 0, accountSecurityVersion: actor.accountSecurityVersion })).digest("hex") };
}

/** Reauthorize generation delivery independently of its status or proof. */
export async function recheckEscalaGeneration(actor: EscalaActor, id: string, expectedRevision: number): Promise<EscalaProposalScope> {
  const latest = await getEscala(actor, id);
  try { assertRevision(latest, expectedRevision); }
  catch (error) { logSolverRejection("service-recheck", "RECHECK_FAILED"); throw error; }
  return proposalScope(actor, latest);
}

export async function addEscalaEmployee(actor: EscalaActor, id: string, expectedRevision: number,
  enrollment: { regimeModelId: string; name: string; registration: string }) {
  const current = await getEscala(actor, id);
  assertRevision(current, expectedRevision);
  await requireEscalaCapability(actor, "employee.manage", current.input.branchCode);
  if (!current.approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Selecione uma aprovação administrativa.");
  const approved = await loadEscalaApproval(actor, current.approvedPolicyVersionId, prisma, current.input);
  const personId = randomUUID();
  const seedResult = addEmployeeFromEscalaApprovedModel(approved.row.snapshot, approved.row.snapshotHash, {
    id: personId, regimeModelId: enrollment.regimeModelId, name: enrollment.name, registration: enrollment.registration,
    activeFrom: "", preferredOffDays: [],
  });
  if (!seedResult.ok) throw new EscalaError(422, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Modelo ou matrícula não permitido nesta aprovação.");
  const person = seedResult.value.employees.find(employee => employee.id === personId);
  if (!person) throw new EscalaError(422, "ESCALA_INVALID_INPUT", "O cadastro não pôde ser preparado.");
  const input = parseEscalaInput({ ...current.input, employees: [...current.input.employees, person] });
  return saveEscala(actor, id, expectedRevision, input, false, { serverEnrollment: { employeeId: personId, regimeModelId: enrollment.regimeModelId } });
}

export async function rebaseEscalaApproval(actor: EscalaActor, id: string, expectedRevision: number, approvalId: string) {
  const current = await getEscala(actor, id);
  await requireEscalaCapability(actor, "settings.manage");
  const approved = await loadEscalaApproval(actor, approvalId);
  const protectedPeople = (people: EscalaInput["employees"]) => people.map(person => {
    const copy = structuredClone(person) as Partial<typeof person>;
    delete copy.name; delete copy.preferredOffDays; delete copy.planningHistory; delete copy.planningFuture;
    return copy;
  });
  if (stableEscalaJson(protectedPeople(current.input.employees)) !== stableEscalaJson(protectedPeople(approved.snapshot.seed.employees))) {
    throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "A aprovação precisa incluir os dados protegidos da equipe atual antes da vinculação.");
  }
  const input = parseEscalaInput({ ...approved.snapshot.configuration, employees: current.input.employees,
    shifts: current.input.shifts, assignments: current.input.assignments, needsRegeneration: true });
  return saveEscala(actor, id, expectedRevision, input, false, { rebaseId: approvalId });
}

export async function validateEscalaOperational(actor: EscalaActor, id: string, expectedRevision: number, input: EscalaInput) {
  const current = await getEscala(actor, id);
  assertRevision(current, expectedRevision);
  const context = await requireEscalaCapability(actor, "workspace.save", current.input.branchCode);
  if (!actor.admin) {
    if (!current.approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "É necessária aprovação administrativa.");
    await loadEscalaApproval(actor, current.approvedPolicyVersionId, prisma, current.input);
    assertEscalaOperationalInput(current.input, input, ESCALA_CAPABILITIES.filter(capability => decideEscalaPermission(context, capability).allowed));
  }
  return validateEscala(materializeManualShiftOverrides(input));
}

function assignmentKey(item: EscalaAssignment) { return `${item.employeeId}\0${item.date}`; }
function sameAssignment(a: EscalaAssignment, b: EscalaAssignment | undefined) {
  return Boolean(b && a.kind === b.kind && a.shiftId === b.shiftId && Boolean(a.locked) === Boolean(b.locked));
}

type PublishedDay = { date: string; signature: string; scheduled: boolean };

function publishedDayIndex(rawInput: EscalaInput, firstDate: string, lastDate: string) {
  const input = operationalEscalaInput(rawInput);
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
  const contextual = preserveCalendarSourceContext(input, publishedPlanningContext(input, published));
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

async function planningContext(actor: EscalaActor, id: string, input: EscalaInput, db: Prisma.TransactionClient = prisma) {
  const rows = await db.escalaWorkspace.findMany({
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
  return preserveCalendarSourceContext(input, preservePublishedDays(publishedPlanningContext(input, published), published));
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

/** Server-created intent only; no HTTP SAVE command accepts this object or its callback. */
export type AdminImportSaveIntent = {
  removedAbsenceKeys: readonly string[]; invalidatesApproval: boolean;
  verify: (tx: Prisma.TransactionClient, current: EscalaWorkspace & { approvedPolicyVersionId: string | null }, rawInput: EscalaInput) => Promise<void>;
  audit: { purpose: "EMPLOYEES" | "ABSENCES"; fileHash: string; impactHash: string; startDate: string; endDate: string;
    addedPeople: number; removedPeople: number; addedAbsenceDays: number; removedAbsenceDays: number };
};

export async function saveEscala(actor: EscalaActor, id: string, expectedRevision: number, input: EscalaInput, publish = false,
  options: { proposalProof?: string; catalogIntent?: boolean; serverEnrollment?: { employeeId: string; regimeModelId: string }; rebaseId?: string; adminImport?: AdminImportSaveIntent } = {}) {
  input = { ...input, branchCode: canonicalBranchCode(input.branchCode) };
  const current = await getEscala(actor, id);
  requireEscalaPermission(current, publish ? "publish" : "edit");
  assertRevision(current, expectedRevision);
  if (JSON.stringify(input.planningCalendarSource) !== JSON.stringify(current.input.planningCalendarSource))
    throw new EscalaError(409, "ESCALA_CALENDAR_SOURCE_CHANGED", "A origem da atualização da semana não pode ser alterada. Recarregue o rascunho atual.");
  const context = await requireEscalaCapability(actor, publish ? "workspace.publish" : "workspace.save", current.input.branchCode);
  if (options.proposalProof) await requireEscalaCapability(actor, "schedule.apply", current.input.branchCode);
  if (options.adminImport) {
    if (!actor.admin || publish || options.proposalProof || options.catalogIntent || options.serverEnrollment || options.rebaseId
      || typeof options.adminImport.verify !== "function") throw new EscalaError(403, "ESCALA_IMPORT_INTENT_INVALID", "A importação exige confirmação administrativa própria.");
    await requireEscalaCapability(actor, "import.manage");
  }
  let approvalId = options.rebaseId ?? current.approvedPolicyVersionId;
  if (options.adminImport?.invalidatesApproval) approvalId = null;
  const rawInput = structuredClone(input);
  const lockedKeys = new Set(current.input.assignments.filter(day => day.locked === true).map(assignmentKey));
  const requiresUnlockAuthority = !publish && !options.proposalProof
    && rawInput.assignments.some(day => day.locked === false && lockedKeys.has(assignmentKey(day)));
  if (options.rebaseId) await requireEscalaCapability(actor, "settings.manage");
  if (!actor.admin) {
    if (!approvalId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "É necessária aprovação administrativa.");
    await loadEscalaApproval(actor, approvalId, prisma, current.input);
    if (options.proposalProof) verifyEscalaProposal(options.proposalProof, await proposalScope(actor, current), input);
    if (!options.serverEnrollment) assertEscalaOperationalInput(current.input, input,
      ESCALA_CAPABILITIES.filter(capability => decideEscalaPermission(context, capability).allowed), Boolean(options.proposalProof), options.catalogIntent,
      !publish && !options.proposalProof && current.canPublish);
  } else if (options.proposalProof) verifyEscalaProposal(options.proposalProof, await proposalScope(actor, current), input);
  else if (approvalId && !options.rebaseId && !options.serverEnrollment) {
    // An administrator may edit rules/data, but an old approval must not certify the new regime.
    try { assertEscalaOperationalInput(current.input, input, ESCALA_CAPABILITIES, false, false, !publish && current.canPublish); }
    catch (error) {
      if (!(error instanceof EscalaError) || error.code !== "ESCALA_PROTECTED_INPUT") throw error;
      approvalId = null;
    }
  }
  if (input.branchCode !== current.input.branchCode || input.startDate !== current.input.startDate || input.endDate !== current.input.endDate) {
    throw new EscalaError(409, "ESCALA_IDENTITY_CHANGED", "Filial e período identificam esta escala. Crie outra proposta para alterar esses campos.");
  }
  input = materializeManualShiftOverrides(input);
  await assertManualCatalogSelections(actor, input, current.input);
  const manualReferenceIssue = manualShiftIssues(input)[0];
  if (manualReferenceIssue) throw new EscalaError(422, manualReferenceIssue.code, manualReferenceIssue.message);
  const manualAssignmentIssue = manualAssignmentIssues(input)[0];
  if (manualAssignmentIssue) throw new EscalaError(422, manualAssignmentIssue.code, manualAssignmentIssue.message);
  const removedAbsences = new Set(options.adminImport?.removedAbsenceKeys ?? []);
  if (removedAbsences.size) {
    const intent = options.adminImport;
    const nextKeys = new Set(input.assignments.map(assignmentKey));
    if (intent?.audit.purpose !== "ABSENCES" || [...removedAbsences].some(key =>
      nextKeys.has(key) || !current.input.assignments.some(day => assignmentKey(day) === key && day.kind === "ABSENCE"
        && day.date >= intent.audit.startDate && day.date <= intent.audit.endDate))) {
      throw new EscalaError(403, "ESCALA_IMPORT_INTENT_INVALID", "O delta de afastamentos não corresponde à confirmação.");
    }
  }
  preserveLockedAssignments(removedAbsences.size ? { ...current.input,
    assignments: current.input.assignments.filter(day => !removedAbsences.has(assignmentKey(day))) } : current.input, input, !publish && current.canPublish);
  const scenarioChanged = generationScenarioBasis(current.input) !== generationScenarioBasis(input);
  const preparedProposal = !input.needsRegeneration && matchesGenerationScenarioBasis(input);
  if ((scenarioChanged || current.input.needsRegeneration) && !preparedProposal) {
    input = { ...input, needsRegeneration: true, generationBasis: undefined };
  }
  if (isHoursReferenceOnly(input) && !preparedProposal) input = { ...input, needsRegeneration: true };
  if (storeClosingMinutes(current.input) !== storeClosingMinutes(input)) {
    input = { ...input, needsRegeneration: input.needsRegeneration || input.assignments.length > 0,
      demands: input.demands.filter(demand => demand.estimated !== true) };
  }
  input = preserveCalendarSourceContext(current.input, publishedPlanningContext(input, []));
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
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, publish ? "workspace.publish" : "workspace.save", current.input.branchCode, tx);
    if (options.adminImport) {
      await requireEscalaCapability(actor, "import.manage", undefined, tx);
      await options.adminImport.verify(tx, current, rawInput);
    }
    if (requiresUnlockAuthority) await requireEscalaCapability(actor, "workspace.publish", current.input.branchCode, tx);
    if (options.proposalProof) await requireEscalaCapability(actor, "schedule.apply", current.input.branchCode, tx);
    if (options.proposalProof) verifyEscalaProposal(options.proposalProof, await proposalScope(actor, current, tx), rawInput);
    if (options.serverEnrollment) await requireEscalaCapability(actor, "employee.manage", current.input.branchCode, tx);
    if (options.catalogIntent) await requireEscalaCapability(actor, "shift.manage", current.input.branchCode, tx);
    if (options.rebaseId) await requireEscalaCapability(actor, "settings.manage", undefined, tx);
    if (approvalId) {
      const approved = await loadEscalaApproval(actor, approvalId, tx, input);
      if (approved.row.branchCode !== input.branchCode || approved.row.startDate !== input.startDate || approved.row.endDate !== input.endDate
        || approved.row.visibleMonth !== (input.visibleMonth ?? null)) throw new EscalaError(403, "ESCALA_PROTECTED_INPUT", "Configuração de outro período.");
    }
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
      input: snapshotJson(input), createdById: actor.userId, approvedPolicyVersionId: approvalId, ...actorProvenance(actor) } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: publish ? "PUBLISH" : "UPDATE", entity: "EscalaWorkspace", entityId: id,
      metadata: { ...actorProvenance(actor), tenantId: actor.tenantId, revision, previousRevision: expectedRevision, employeeCount: input.employees.length,
        approvedPolicyVersionId: approvalId, approvalInvalidated: Boolean(current.approvedPolicyVersionId && !approvalId),
        ...(options.adminImport ? { adminImport: options.adminImport.audit } : {}),
        ...(options.serverEnrollment ? { employeeId: options.serverEnrollment.employeeId, regimeModelId: options.serverEnrollment.regimeModelId } : {}) } } });
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
  if (alreadyPublished) return current;
  return { ...current, revision, status, input, validation, approvedPolicyVersionId: approvalId, updatedAt: updatedAt.toISOString() } as EscalaWorkspace;
}

function assertRevision(workspace: EscalaWorkspace, expectedRevision: number) {
  if (workspace.revision !== expectedRevision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "A versão da proposta mudou. Recarregue a escala e gere uma nova análise.");
}

function requireSolverSetup(input: EscalaInput) {
  const included = input.employees.filter((person) => isEscalaPlanningParticipant(person) && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate));
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

export async function generateEscala(actor: EscalaActor, id: string, expectedRevision: number, options?: import("./solver-transport").SolverOptions & { comparisonReference?: unknown }) {
  const { comparisonReference, ...solverOptions } = options ?? {};
  const current = await getEscala(actor, id);
  assertRevision(current, expectedRevision);
  await requireEscalaCapability(actor, "schedule.generate", current.input.branchCode);
  if (!actor.admin) {
    if (!current.approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "É necessária aprovação administrativa.");
    await loadEscalaApproval(actor, current.approvedPolicyVersionId, prisma, current.input);
  }
  if (current.input.generationMode === "HOURS_ONLY" && !isHoursReferenceOnly(current.input)) {
    const existing = new Set(current.input.assignments.map(day => `${day.employeeId}\0${day.date}`));
    const incomplete = current.input.employees.some(person => isEscalaPlanningParticipant(person)
      && dateRange(current.input.startDate, current.input.endDate).some(date => date >= person.activeFrom
        && (!person.activeUntil || date <= person.activeUntil) && !existing.has(`${person.id}\0${date}`)));
    if (incomplete) throw new EscalaError(422, "ESCALA_HOURS_BASELINE_INCOMPLETE", "A grade está incompleta. Complete os dias ou gere folgas e horários antes de ajustar somente os horários; nenhum dia foi inventado.");
  }
  const qualityReference = structuredClone(current.input);
  const scope = { tenantId: actor.tenantId, owner: JSON.stringify([actor.userId, actor.moduleSessionId, actor.accountSessionId]), workspaceId: id, revision: expectedRevision };
  const prepared = prepareGeneration(current.input);
  if (isHoursReferenceOnly(prepared.input)) {
    const proposalInput = parseEscalaInput({ ...prepared.input, needsRegeneration: false, generationBasis: generationScenarioBasis(prepared.input) });
    try { preserveLockedAssignments(current.input, proposalInput); if (!actor.admin) assertEscalaProtectedAssignments(current.input, proposalInput, true); }
    catch (error) { logSolverRejection("service-preservation", "LOCK_CHANGED"); throw error; }
    if (!matchesHoursOnlyAssignments(current.input, proposalInput)) { logSolverRejection("service-preservation", "HOURS_ONLY_CHANGED"); throw new EscalaSolverError("SOLVER_PROTECTED_RECORD_CHANGED"); }
    const validation = validateEscala(proposalInput);
    if (!validation.valid) { logSolverRejection("service-validation", "RULES_INVALID", { issues: validation.issues }); throw new EscalaError(422, "ESCALA_HOURS_REFERENCE_INVALID", "Alguns horários não atendem às regras do cenário. Confira entrada, intervalo, saída e fechamento; nenhum dia de trabalho ou folga foi criado."); }
    const finalScope = await recheckEscalaGeneration(actor, id, expectedRevision);
    const admission = admitCandidateReference(comparisonReference, scope, qualityReference, prepared.input);
    return { result: { status: "FEASIBLE" as const, assignments: proposalInput.assignments, wallTimeSeconds: 0,
      message: "Referências de horários preparadas. Nenhuma presença diária, folga ou cobertura foi gerada." }, proposalInput, validation, preparation: prepared.preparation,
      comparison: admission.comparison, candidateReceipt: undefined,
      proposalProof: signEscalaProposal(finalScope, proposalInput) };
  }
  requireSolverSetup(prepared.input);
  const contextual = await planningContext(actor, id, parseEscalaInput(prepared.input));
  const closingConflict = workAfterStoreClosing(contextual).find(day => day.locked);
  if (closingConflict) throw new EscalaError(409, "ESCALA_CLOSING_PUBLISHED_CONFLICT", `Um dia já publicado em ${closingConflict.date} termina após o fechamento atual (${storeClosingLabel(contextual)}). Corrija o horário na escala publicada de origem ou ajuste o fechamento deste planejamento antes de gerar. O dia publicado foi preservado.`);
  const admission = admitCandidateReference(comparisonReference, scope, qualityReference, contextual);
  const calculation = await solveEscala(contextual, { ...solverOptions, qualityReference });
  let result = calculation.status === "INFEASIBLE" ? {
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
  try { preserveLockedAssignments(current.input, proposalInput); if (!actor.admin) assertEscalaProtectedAssignments(current.input, proposalInput, true); }
  catch (error) { logSolverRejection("service-preservation", "LOCK_CHANGED"); throw error; }
  if (!matchesHoursOnlyAssignments(current.input, proposalInput)) { logSolverRejection("service-preservation", "HOURS_ONLY_CHANGED"); throw new EscalaSolverError("SOLVER_PROTECTED_RECORD_CHANGED"); }
  let validation = validateEscala(proposalInput);
  if (result.status === "FEASIBLE" || result.status === "OPTIMAL") {
    const incomplete = validation.issues.some(issue => issue.code === "DAY_PENDING");
    const referencesChanged = !matchesRestOnlyReferences(contextual, result.assignments);
    if (referencesChanged || incomplete || !validation.valid) {
      logSolverRejection("service-validation", referencesChanged ? "REST_ONLY_CHANGED" : incomplete ? "MISSING_ACTIVE_DATE" : "RULES_INVALID", { issues: validation.issues });
      throw new EscalaSolverError(referencesChanged ? "SOLVER_PROTECTED_RECORD_CHANGED" : incomplete ? "SOLVER_RESPONSE_INCOMPLETE" : "SOLVER_RULES_INVALID");
    }
  }
  let comparison = admission.comparison;
  if (result.status === "FEASIBLE" || result.status === "OPTIMAL") {
    const selected = selectCandidateReference(admission, proposalInput, qualityReference);
    comparison = selected.comparison;
    if (comparison.selection === "REFERENCE_RETAINED") {
      proposalInput = parseEscalaInput(selected.input);
      preserveLockedAssignments(current.input, proposalInput);
      // Admission authenticates comparison; it does not replace operational protection.
      if (!actor.admin) assertEscalaProtectedAssignments(current.input, proposalInput, true);
      validation = validateEscala(proposalInput);
      if (!isOperationallyReusable(validation) || !matchesHoursOnlyAssignments(current.input, proposalInput)
        || !matchesRestOnlyReferences(contextual, proposalInput.assignments)
        || manualAssignmentIssues(proposalInput, contextual.assignments).length) throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
      result = { status: "FEASIBLE", assignments: proposalInput.assignments, wallTimeSeconds: result.wallTimeSeconds,
        message: "A nova alternativa perderia uma condição protegida. A proposta anterior verificada foi mantida integralmente. Confira a qualidade operacional antes de aplicar." };
    }
  }
  // Recheck after selection, even for a terminal result with no proposal proof.
  const finalScope = await recheckEscalaGeneration(actor, id, expectedRevision);
  const extra: EscalaCandidateResponse = { comparison };
  if ((result.status === "FEASIBLE" || result.status === "OPTIMAL") && isOperationallyReusable(validation)) {
    extra.candidateReceipt = issueCandidateReceipt(scope, qualityReference, contextual, proposalInput);
  }
  return { result, proposalInput, validation, preparation: prepared.preparation, ...extra,
    ...((result.status === "FEASIBLE" || result.status === "OPTIMAL") ? { proposalProof: signEscalaProposal(finalScope, proposalInput) } : {}) };
}

/** Explicit deletion; FK Restrict requires removing the exact revisions in the same transaction. */
export async function deleteEscala(actor: EscalaActor, id: string, expectedRevision: number) {
  await requireEscalaCapability(actor, "workspace.delete");
  const row = await prisma.escalaWorkspace.findFirst({ where: { id, tenantId: actor.tenantId } });
  if (!row) throw new EscalaError(404, "ESCALA_NOT_FOUND", "Planejamento não encontrado nesta empresa.");
  const permission = await branchPermission(actor, row.branchCode);
  requireEscalaPermission(permission, "edit");
  if (row.revision !== expectedRevision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "O planejamento mudou. Recarregue antes de excluir.");
  await prisma.$transaction(async (tx) => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, "workspace.delete", undefined, tx);
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
    const approvalOrigins = await tx.escalaBranchPolicyVersion.count({ where: { tenantId: actor.tenantId, originWorkspaceId: id } });
    if (approvalOrigins) throw new EscalaError(409, "ESCALA_DELETE_DEPENDENCY", "Este planejamento é origem de uma aprovação administrativa. O histórico deve ser preservado.");
    await tx.escalaRevision.deleteMany({ where: { tenantId: actor.tenantId, workspaceId: id } });
    const deleted = await tx.escalaWorkspace.deleteMany({ where: { tenantId: actor.tenantId, id, revision: expectedRevision } });
    if (deleted.count !== 1) throw new EscalaError(409, "ESCALA_STALE_REVISION", "O planejamento mudou durante a exclusão. Nenhum dado foi removido.");
    await tx.auditLog.create({ data: { userId: actor.userId, action: "DELETE", entity: "EscalaWorkspace", entityId: id, metadata: { ...actorProvenance(actor), tenantId: actor.tenantId, revision: expectedRevision } } });
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
  return { deletedId: id };
}
