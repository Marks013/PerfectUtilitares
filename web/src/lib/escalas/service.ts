import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { allowedBranches, branchPermission, EscalaError, requireEscalaPermission, type EscalaActor, type EscalaPermission } from "./access";
import { escalaInputSchema } from "./schema";
import { EscalaSolverError, solveEscala } from "./solver-client";
import { validateEscala } from "./validation";
import { compareBranches } from "./order";
import { addDays, dateRange } from "./dates";
import { fixedBoundaryReservations } from "./boundary";
import { publishedPlanningContext } from "./continuity";
import { certificateAuthorizes, CCT_FROM, CCT_UNTIL, collectiveExtensionAuthorized, dailyMinuteCeiling, SUPERMARKET_CCT } from "./labor-rules";
import type { EscalaAssignment, EscalaInput, EscalaSuggestion, EscalaWorkspace } from "./types";

type WorkspaceRow = {
  id: string; tenantId: string; branchCode: string; branchName: string;
  startDate: string; endDate: string; revision: number; status: string; updatedAt: Date;
};

function snapshotJson(input: EscalaInput): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

export function parseEscalaInput(value: unknown): EscalaInput {
  const parsed = escalaInputSchema.safeParse(value);
  if (!parsed.success) throw new EscalaError(400, "ESCALA_INVALID_INPUT", parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  return parsed.data;
}

function view(row: WorkspaceRow, input: EscalaInput, permission: EscalaPermission): EscalaWorkspace {
  return { id: row.id, revision: row.revision, status: row.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT", input,
    validation: validateEscala(input), ...permission, updatedAt: row.updatedAt.toISOString() };
}

export async function listEscalas(actor: EscalaActor) {
  const branches = await allowedBranches(actor);
  const rows = await prisma.escalaWorkspace.findMany({
    where: { tenantId: actor.tenantId, ...(branches ? { branchCode: { in: branches } } : {}) },
    orderBy: [{ branchCode: "asc" }, { startDate: "desc" }, { id: "asc" }],
  });
  return rows.sort((a, b) => compareBranches(a, b) || b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id)).map((row) => ({
    id: row.id, revision: row.revision, status: row.status,
    input: { branchCode: row.branchCode, branchName: row.branchName, startDate: row.startDate, endDate: row.endDate },
    updatedAt: row.updatedAt.toISOString(),
  }));
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
  const permission = await branchPermission(actor, input.branchCode);
  requireEscalaPermission(permission, "edit");
  input = publishedPlanningContext(input, []);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.escalaWorkspace.create({ data: {
      tenantId: actor.tenantId, branchCode: input.branchCode, branchName: input.branchName,
      startDate: input.startDate, endDate: input.endDate,
    } });
    await tx.escalaRevision.create({ data: { tenantId: actor.tenantId, workspaceId: created.id, revision: 1,
      status: "DRAFT", input: snapshotJson(input), createdById: actor.userId } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", entity: "EscalaWorkspace", entityId: created.id,
      metadata: { tenantId: actor.tenantId, revision: 1, employeeCount: input.employees.length } } });
    return created;
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
    where: { tenantId: actor.tenantId, branchCode: input.branchCode, id: { not: id }, startDate: { lt: input.startDate }, endDate: { gte: addDays(input.startDate, -21) } },
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
  return publishedPlanningContext(input, published);
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
  const current = await getEscala(actor, id);
  requireEscalaPermission(current, publish ? "publish" : "edit");
  assertRevision(current, expectedRevision);
  if (input.branchCode !== current.input.branchCode || input.startDate !== current.input.startDate || input.endDate !== current.input.endDate) {
    throw new EscalaError(409, "ESCALA_IDENTITY_CHANGED", "Filial e período identificam esta escala. Crie outra proposta para alterar esses campos.");
  }
  preserveLockedAssignments(current.input, input, !publish && current.canPublish);
  input = publishedPlanningContext(input, []);
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
      input: snapshotJson(input), createdById: actor.userId } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: publish ? "PUBLISH" : "UPDATE", entity: "EscalaWorkspace", entityId: id,
      metadata: { tenantId: actor.tenantId, revision, previousRevision: expectedRevision, employeeCount: input.employees.length } } });
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
  if (alreadyPublished) return current;
  return { ...current, revision, status, input, validation, updatedAt: updatedAt.toISOString() } as EscalaWorkspace;
}

export function assertRevision(workspace: EscalaWorkspace, expectedRevision: number) {
  if (workspace.revision !== expectedRevision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "A versão da proposta mudou. Recarregue a escala e gere uma nova análise.");
}

function requireSolverSetup(input: EscalaInput) {
  const included = input.employees.filter((person) => person.planningEnabled !== false && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate));
  const timed = included.filter((person) => person.scheduleMode !== "UNTIMED");
  if (!included.length || (timed.length > 0 && (!input.shifts.length || timed.some((person) => !person.shiftIds.length)))) throw new EscalaError(422, "ESCALA_SETUP_REQUIRED", "Inclua pelo menos um colaborador e defina horários para quem tem jornada controlada. Pessoas sem horário fixo participam do rodízio de folgas sem turno fictício.");
  if (input.policy.normativeProfile === SUPERMARKET_CCT && input.policy.holidayRestAllowed) throw new EscalaError(422, "ESCALA_CCT_HOLIDAY_REST", "A CCT de supermercados veda compensar o DSR em feriado. Corrija a configuração antes de gerar.");
  if (input.policy.normativeProfile === SUPERMARKET_CCT && (input.startDate < CCT_FROM || input.endDate > CCT_UNTIL)) throw new EscalaError(422, "ESCALA_CCT_VALIDITY", "O período está fora da vigência da CCT PR003084/2026. Selecione e confira o instrumento aplicável antes de gerar.");
  if (input.policy.normativeProfile === SUPERMARKET_CCT && input.demands.some((demand) => demand.minimum > 0
    && ((new Date(`${demand.date}T12:00:00Z`).getUTCDay() === 0 && !certificateAuthorizes(input.policy, demand.date, "sundays"))
      || (input.policy.holidayDates.includes(demand.date) && !certificateAuthorizes(input.policy, demand.date, "holidays"))))) throw new EscalaError(422, "ESCALA_CERTIFICATE_REQUIRED", "A cobertura exige domingo ou feriado sem certidão sindical conferida para esta filial. Confira a autorização antes de gerar.");
  const minutes = new Map(input.shifts.map((shift) => [shift.id, shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0)]));
  if (dateRange(input.startDate, input.endDate).some((date) => timed.some((person) => person.activeFrom <= date && (!person.activeUntil || person.activeUntil >= date)
    && person.shiftIds.every((shiftId) => (minutes.get(shiftId) ?? Infinity) > Math.min(input.policy.dailyLimitMinutes, dailyMinuteCeiling(date)))))) {
    throw new EscalaError(422, "ESCALA_DAILY_LIMIT", "Os horários excedem o limite diário na vigência selecionada. Reaplique a configuração em lote da equipe para propor horários compatíveis; um acordo não amplia o teto deste regime.");
  }
  if (dateRange(input.startDate, input.endDate).some((date) => !collectiveExtensionAuthorized(input.policy, date)
    && timed.some((person) => person.activeFrom <= date && (!person.activeUntil || person.activeUntil >= date)
      && person.shiftIds.every((shiftId) => (minutes.get(shiftId) ?? Infinity) > 480)))) {
    throw new EscalaError(422, "ESCALA_DAILY_EXTENSION_REQUIRED", "Os horários permitidos exigem mais de 8 horas diárias sem autorização coletiva vigente. Revise os horários ou o acordo; esta pendência é de configuração, não de efetivo.");
  }
  const unsupportedHoliday = !input.policy.holidayRestAllowed && input.policy.holidayDates.some((date) => date >= input.startDate && date <= input.endDate
    && !input.policy.authorizedHolidayDates.includes(date)
    && included.some((person) => date >= person.activeFrom && (!person.activeUntil || date <= person.activeUntil)
      && !input.assignments.some((item) => item.employeeId === person.id && item.date === date && item.kind === "ABSENCE")));
  if (unsupportedHoliday) throw new EscalaError(422, "ESCALA_HOLIDAY_POLICY_REQUIRED", "Confirme o tratamento do feriado não trabalhado. Esta versão não possui estado próprio de feriado remunerado e não o converterá em DSR, ausência ou horas a repor. Registre a regra aplicável antes de gerar.");
}

export async function generateEscala(actor: EscalaActor, id: string, expectedRevision: number) {
  const current = await getEscala(actor, id);
  requireEscalaPermission(current, "edit");
  assertRevision(current, expectedRevision);
  requireSolverSetup(current.input);
  const contextual = await planningContext(actor, id, current.input);
  const result = await solveEscala(contextual);
  const proposalInput = result.status === "FEASIBLE" || result.status === "OPTIMAL"
    ? parseEscalaInput({ ...contextual, assignments: result.assignments }) : contextual;
  preserveLockedAssignments(current.input, proposalInput);
  const latest = await getEscala(actor, id);
  assertRevision(latest, expectedRevision);
  const validation = validateEscala(proposalInput);
  if ((result.status === "FEASIBLE" || result.status === "OPTIMAL") && !validation.valid) throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
  return { result, proposalInput, validation };
}

export async function suggestEscala(actor: EscalaActor, id: string, expectedRevision: number, employeeId: string, weekStart: string) {
  const current = await getEscala(actor, id);
  requireEscalaPermission(current, "edit");
  assertRevision(current, expectedRevision);
  requireSolverSetup(current.input);
  const contextual = await planningContext(actor, id, current.input);
  const employee = current.input.employees.find((person) => person.id === employeeId && person.planningEnabled !== false);
  const first = new Date(`${weekStart}T00:00:00Z`);
  if (!employee || Number.isNaN(first.valueOf()) || first.toISOString().slice(0, 10) !== weekStart || first.getUTCDay() !== 1 || weekStart < current.input.startDate || weekStart > current.input.endDate) {
    throw new EscalaError(400, "ESCALA_INVALID_SUGGESTION", "Selecione um colaborador e uma segunda-feira dentro do período.");
  }
  const dates = Array.from({ length: 7 }, (_, index) => new Date(first.valueOf() + index * 86_400_000).toISOString().slice(0, 10));
  if (dates[6] > current.input.endDate) throw new EscalaError(400, "ESCALA_INVALID_WEEK", "A semana deve estar inteiramente no período.");
  const suggestions: EscalaSuggestion[] = [];
  const excludedOffPairs: string[][] = [];
  // Each bounded solve searches every feasible pair jointly with the whole branch.
  // Exclude only completed alternatives, never a few arbitrarily preselected weekdays.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await solveEscala(contextual, { employeeId, weekStart, excludedOffPairs: [...excludedOffPairs] });
    if (result.status !== "FEASIBLE" && result.status !== "OPTIMAL") break;
    const proposed = parseEscalaInput({ ...contextual, assignments: result.assignments });
    preserveLockedAssignments(current.input, proposed);
    const offDates = proposed.assignments.filter((item) => item.employeeId === employeeId && dates.includes(item.date) && item.kind === "OFF").map((item) => item.date).sort();
    if (offDates.length !== 2 || excludedOffPairs.some((pair) => pair.every((date, index) => date === offDates[index]))) break;
    excludedOffPairs.push(offDates);
    const validation = validateEscala(proposed);
    if (!validation.valid) continue;
    const previous = new Map(current.input.assignments.map((item) => [assignmentKey(item), item]));
    const changedEmployeeIds = [...new Set(proposed.assignments.filter((item) => !sameAssignment(item, previous.get(assignmentKey(item)))).map((item) => item.employeeId))];
    const suggestionId = createHash("sha256").update(JSON.stringify({ id, expectedRevision, employeeId, offDates, assignments: proposed.assignments })).digest("hex").slice(0, 24);
    suggestions.push({ id: suggestionId, employeeId, offDates, assignments: proposed.assignments, changedEmployeeIds, validation,
      status: validation.readyToPublish && changedEmployeeIds.every((changed) => changed === employeeId) ? "VALIDATED" : "REQUIRES_CHANGES" });
  }
  assertRevision(await getEscala(actor, id), expectedRevision);
  return { suggestions };
}
