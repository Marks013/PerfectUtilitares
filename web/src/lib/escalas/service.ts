import { isEscalaPlanningParticipant, operationalEscalaInput } from "./eligibility";
import type { Prisma } from "@/generated/prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { canonicalBranchCode } from "./branch-code";
import { allowedBranches, branchPermission, EscalaError, requireEscalaPermission, type EscalaActor, type EscalaPermission } from "./access";
import { escalaInputSchema } from "./schema";
import { validateEscala } from "./validation";
import { logSolverRejection } from "./solver-diagnostics";
import { generationScenarioBasis, isHoursReferenceOnly, matchesGenerationScenarioBasis } from "./hours-reference";
import { compareBranches } from "./order";
import { addDays, dayOfWeek, monthBounds, visibleDates } from "./dates";
import { preserveCalendarSourceContext, sundayCalendarDraft } from "./calendar-upgrade";
import { isDecember2026Cutover } from "./planning-calendar";
import { excludeSupersededDecemberDrafts } from "./active-december-drafts";
import { fixedBoundaryReservations } from "./boundary";
import { publishedPlanningContext } from "./continuity";
import { planningContext } from "./planning-context.server";
import { removeReplacedDraftApprovals } from "./remove-replaced-draft-approvals";
import { carryWorkforceState, checkWorkforceReady, checkWorkforceWrite, openEndedAbsenceEmployeeIds, workforceDraftInfo } from "./global-workforce-binding";
import { assertTransferredWorkDoesNotOverlap } from "./global-workforce-publication";
import { projectWorkforceForDraft, readWorkforceForDraft } from "./global-workforce-draft";
import { assertEscalaEmployeeRemovalAllowed, inputWithoutEscalaEmployee } from "./employee-removal";
import type { EscalaAssignment, EscalaInput, EscalaWorkspace } from "./types";
import { fitsStoreClosing, storeClosingLabel, storeClosingMinutes, workAfterStoreClosing } from "./store-hours";
import { manualAssignmentIssues, manualShiftIssues, materializeManualShiftOverrides } from "./shift-catalog/manual-override";
import { lockEscalaAccess, requireEscalaCapability } from "./access";
import { loadEscalaApproval, inputFromEscalaApproval, hasCarriedApproval } from "./approved-policy-service";
import { loadLatestEscalaImportedTeam, persistEscalaImportedTeam, preserveLatestEscalaImportedTeamBeforeDelete } from "./latest-imported-team";
import { addEmployeeFromEscalaApprovedModel, createInputFromEscalaApprovedPolicy } from "./approved-policy";
import { assertEscalaOperationalInput, stableEscalaJson } from "./operational-input-policy";
import { ESCALA_CAPABILITIES, decideEscalaPermission } from "./permissions";
import { verifyEscalaProposal, type EscalaProposalScope } from "./proposal-proof";
import type { EscalaAbsenceCommand, EscalaWorkspaceAccessMetadata } from "./access-contracts";
import { assertNoPublishedAbsenceChanges, assignmentKey, editDraftAbsences, preserveManualAbsences } from "./manual-absence";
import { excludeConfirmedImportAbsences, importAbsenceApprovalView, preserveLockedAssignments, type AdminImportSaveIntent } from "./draft-save-policy";
import { scopedMonthDraft } from "./scoped-month-draft";
import { assertNoNewManualHolidayRest } from "./holiday-rest";
import { applyLocalHolidayCalendar } from "./calendar";
import { precedingSchedule, authorizeMonthlyConfiguration } from "./monthly-creation.server";
import { carryMonthlyConfiguration } from "./monthly-creation";
import { inheritMonthlyPattern } from "./monthly-pattern";
import { retainMonthlyCarry } from "./monthly-carry-guard";
import { generateEscalaWith } from "./service-generation";

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
  let rows = await prisma.escalaWorkspace.findMany({
    where: { tenantId: actor.tenantId, ...(branches ? { branchCode: { in: branches } } : {}) },
    orderBy: [{ branchCode: "asc" }, { startDate: "desc" }, { id: "asc" }],
  });
  if (!actor.admin && rows.length) {
    const approvalRequired = rows.filter(row => row.status !== "DRAFT");
    const approvedWorkspaceIds = new Set<string>();
    const batchSize = 1000;
    for (let offset = 0; offset < approvalRequired.length; offset += batchSize) {
      const approvals = await prisma.escalaRevision.findMany({
        where: { tenantId: actor.tenantId, approvedPolicyVersionId: { not: null },
          OR: approvalRequired.slice(offset, offset + batchSize).map(({ id, revision }) => ({ workspaceId: id, revision })) },
        select: { workspaceId: true },
      });
      for (const approval of approvals) approvedWorkspaceIds.add(approval.workspaceId);
    }
    rows = rows.filter(row => row.status === "DRAFT" || approvedWorkspaceIds.has(row.id));
  }
  rows = await excludeSupersededDecemberDrafts(actor.tenantId, rows);
  return rows.sort((a, b) => compareBranches(a, b) || b.startDate.localeCompare(a.startDate) || a.id.localeCompare(b.id)).map((row) => {
    const sunday = { planningWeekStartsOn: "SUNDAY" as const };
    const calendar = dayOfWeek(row.startDate) === 6 || isDecember2026Cutover({ ...row, ...sunday }) ? sunday : {};
    const visible = visibleDates({ ...row, ...calendar });
    const month = visible[0]?.slice(0, 7);
    const visibleMonth = month && visible[0] === monthBounds(month).startDate && visible.at(-1) === monthBounds(month).endDate ? month : undefined;
    return ({
    id: row.id, revision: row.revision, status: row.status,
    input: { branchCode: canonicalBranchCode(row.branchCode), branchName: row.branchName, startDate: row.startDate, endDate: row.endDate, ...calendar, ...(visibleMonth ? { visibleMonth } : {}) },
    updatedAt: row.updatedAt.toISOString(),
  }); });
}

// The consultation endpoint may read the current draft; every other loader still requires approval.
export function getEscalaForRead(actor: EscalaActor, id: string) { return loadEscala(actor, id, undefined, true); }
export function getEscala(actor: EscalaActor, id: string, revision?: number) { return loadEscala(actor, id, revision, false); }

async function loadEscala(actor: EscalaActor, id: string, revision: number | undefined, consultation: boolean): Promise<EscalaWorkspace & EscalaWorkspaceAccessMetadata> {
  const row = await prisma.escalaWorkspace.findFirst({ where: { id, tenantId: actor.tenantId } });
  if (!row) throw new EscalaError(404, "ESCALA_NOT_FOUND", "Escala não encontrada.");
  const permission = await branchPermission(actor, row.branchCode);
  const version = await prisma.escalaRevision.findUnique({ where: {
    tenantId_workspaceId_revision: { tenantId: actor.tenantId, workspaceId: row.id, revision: revision ?? row.revision },
  } });
  if (!version) throw new EscalaError(404, "ESCALA_REVISION_NOT_FOUND", "Versão da escala não encontrada.");
  const readOnlyDraft = !actor.admin && !version.approvedPolicyVersionId;
  if (readOnlyDraft && !(consultation && revision === undefined && version.revision === row.revision
    && row.status === "DRAFT" && version.status === "DRAFT")) {
    throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "O planejamento precisa de aprovação administrativa antes do acesso operacional.");
  }
  const input = parseEscalaInput(version.input);
  const linkedApproval = consultation && !actor.admin && version.status === "DRAFT" && version.approvedPolicyVersionId
    ? await prisma.escalaBranchPolicyVersion.findFirst({ where: { tenantId: actor.tenantId, id: version.approvedPolicyVersionId }, select: { revokedAt: true, snapshot: true } })
    : null;
  let unavailable = Boolean(linkedApproval?.revokedAt);
  if (version.approvedPolicyVersionId && linkedApproval && !unavailable && hasCarriedApproval(linkedApproval.snapshot)) {
    try { await loadEscalaApproval(actor, version.approvedPolicyVersionId, prisma, input); }
    catch (error) {
      if (!(error instanceof EscalaError) || (error.status !== 403 && error.status !== 409)) throw error;
      unavailable = true;
    }
  }
  const effectivePermission = readOnlyDraft || unavailable ? { canEdit: false, canPublish: false } : permission;
  let workforce: EscalaWorkspace["workforce"];
  if (version.status === "DRAFT" && version.revision === row.revision) {
    workforce = await workforceDraftInfo(prisma, actor.tenantId, input, row.workforceState);
  } else if (version.status === "PUBLISHED" && Array.isArray(version.restHiddenEmployeeIds)) {
    const ids = new Set(input.employees.map(person => person.id));
    const hidden = version.restHiddenEmployeeIds.filter((id): id is string => typeof id === "string" && ids.has(id));
    if (hidden.length) workforce = { needsSync: false, openEndedAbsenceEmployeeIds: hidden };
  }
  return { ...view({ ...row, revision: version.revision, status: version.status, updatedAt: version.createdAt }, input, effectivePermission),
    approvedPolicyVersionId: version.approvedPolicyVersionId, ...(unavailable ? { approvedPolicyRevoked: true as const } : {}), ...(workforce ? { workforce } : {}) };
}

export async function createEscala(actor: EscalaActor, input: EscalaInput, approvedPolicyVersionId?: string, origin?: EscalaWorkspace,
  reuseImportedTeam = false, scopedMonth = false): Promise<EscalaWorkspace & { approvedPolicyVersionId: string | null; teamSeed?: "LATEST_IMPORT" | "APPROVED_CONFIGURATION"; openedExisting?: true }> {
  if (input.planningCalendarSource && (!origin || input.planningCalendarSource.workspaceId !== origin.id
    || input.planningCalendarSource.revision !== origin.revision))
    throw new EscalaError(400, "ESCALA_CALENDAR_SOURCE_INVALID", "Use a ação de atualização da semana para criar uma proposta com origem conferida.");
  input = { ...input, branchCode: canonicalBranchCode(input.branchCode) };
  input = retainMonthlyCarry(undefined, input);
  const permission = await branchPermission(actor, input.branchCode);
  await requireEscalaCapability(actor, "workspace.create", input.branchCode);
  if (!actor.admin && !approvedPolicyVersionId && !scopedMonth) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Selecione uma configuração aprovada pelo administrador.");
  if (!approvedPolicyVersionId && !origin) assertNoNewManualHolidayRest(undefined, input);
  input = materializeManualShiftOverrides(input);
  await assertManualCatalogSelections(actor, input);
  // Coverage provenance belongs to each row; legacy global review never promotes estimates.
  input = preserveCalendarSourceContext(input, publishedPlanningContext(input, []));
  let importedFrom: { workspaceId: string; revision: number } | undefined;
  let workforce: EscalaWorkspace["workforce"];
  const row = await prisma.$transaction(async (tx) => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, "workspace.create", input.branchCode, tx);
    if (scopedMonth) {
      await requireEscalaCapability(actor, "workspace.read", input.branchCode, tx);
      const existing = await tx.escalaWorkspace.findFirst({ where: {
        tenantId: actor.tenantId, branchCode: input.branchCode, startDate: input.startDate, endDate: input.endDate,
      }, select: { id: true } });
      if (existing) return { kind: "existing", id: existing.id } as const;
    }
    let originWorkforce: unknown;
    if (origin) {
      const latest = await tx.escalaWorkspace.findFirst({ where: { id: origin.id, tenantId: actor.tenantId, revision: origin.revision } });
      if (!latest || latest.revision !== origin.revision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "O planejamento original mudou. Recarregue antes de atualizar a semana.");
      originWorkforce = latest.workforceState;
    }
    const prior = origin ? undefined : await precedingSchedule(tx, actor, input);
    const configured = scopedMonth ? await tx.escalaBranchPolicyVersion.findFirst({
      where: { tenantId: actor.tenantId, branchCode: input.branchCode, startDate: input.startDate, endDate: input.endDate,
        visibleMonth: input.visibleMonth, revokedAt: null },
      orderBy: { version: "desc" }, select: { id: true },
    }) : null;
    if (configured) {
      const approved = await loadEscalaApproval(actor, configured.id, tx, input);
      const explicit = createInputFromEscalaApprovedPolicy(approved.row.snapshot, approved.row.snapshotHash);
      if (!explicit.ok) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Configuração inválida.");
      approvedPolicyVersionId = configured.id;
      input = explicit.value;
    }
    const derived = scopedMonth && !configured && prior ? await authorizeMonthlyConfiguration(tx, actor, input, prior) : undefined;
    if (derived) {
      approvedPolicyVersionId = derived.id;
      input = derived.input;
    } else if (scopedMonth && !configured && prior) input = carryMonthlyConfiguration(input, prior.input);
    const base = await readWorkforceForDraft(tx, actor.tenantId, input.branchCode);
    if (approvedPolicyVersionId) {
      const approved = await loadEscalaApproval(actor, approvedPolicyVersionId, tx);
      const approvedInput = createInputFromEscalaApprovedPolicy(approved.row.snapshot, approved.row.snapshotHash);
      if (!approvedInput.ok) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Configuração inválida.");
      const expected = parseEscalaInput(approvedInput.value);
      if (stableEscalaJson(publishedPlanningContext(materializeManualShiftOverrides(expected), [])) !== stableEscalaJson(input)) {
        throw new EscalaError(403, "ESCALA_PROTECTED_INPUT", "A criação deve usar a configuração aprovada exata.");
      }
      if ((reuseImportedTeam || configured) && !base) {
        const imported = await loadLatestEscalaImportedTeam(tx, actor.tenantId, input);
        if (imported) {
          input = imported.input;
          importedFrom = { workspaceId: imported.workspaceId, revision: imported.revision };
        }
      }
    }
    const projection = base ? projectWorkforceForDraft(input, carryWorkforceState(input, originWorkforce), base) : null;
    if (projection) input = projection.input;
    const created = await tx.escalaWorkspace.create({ data: {
      tenantId: actor.tenantId, branchCode: input.branchCode, branchName: input.branchName,
      startDate: input.startDate, endDate: input.endDate, ...(projection ? { workforceState: projection.state } : {}),
    } });
    input = await planningContext(actor, created.id, input, tx);
    if (prior) input = parseEscalaInput(inheritMonthlyPattern(applyLocalHolidayCalendar(input), prior.input));
    if (base) {
      const hidden = openEndedAbsenceEmployeeIds(input, base.snapshot);
      workforce = { needsSync: false, ...(hidden.length ? { openEndedAbsenceEmployeeIds: hidden } : {}) };
    }
    await tx.escalaRevision.create({ data: { tenantId: actor.tenantId, workspaceId: created.id, revision: 1,
      status: "DRAFT", input: snapshotJson(input), createdById: actor.userId, approvedPolicyVersionId: approvedPolicyVersionId ?? null, ...actorProvenance(actor) } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", entity: "EscalaWorkspace", entityId: created.id,
      metadata: { ...actorProvenance(actor), tenantId: actor.tenantId, revision: 1, employeeCount: input.employees.length,
        ...(importedFrom ? { importedTeamOrigin: importedFrom } : {}),
        ...(derived && prior ? { inheritedConfiguration: { workspaceId: prior.workspaceId, revision: prior.revision, policyId: derived.id } } : {}) } } });
    return { kind: "created", row: created } as const;
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
  if (row.kind === "existing") return { ...await getEscalaForRead(actor, row.id), openedExisting: true };
  return { ...view(row.row, input, scopedMonth && !actor.admin && !approvedPolicyVersionId ? { canEdit: false, canPublish: false } : permission), approvedPolicyVersionId: approvedPolicyVersionId ?? null, ...(workforce ? { workforce } : {}),
    ...(reuseImportedTeam ? { teamSeed: importedFrom ? "LATEST_IMPORT" : "APPROVED_CONFIGURATION" } : {}) };
}

export async function createEscalaApproved(actor: EscalaActor, approvedPolicyVersionId: string) {
  return createEscala(actor, await inputFromEscalaApproval(actor, approvedPolicyVersionId), approvedPolicyVersionId, undefined, true);
}

export async function createEscalaMonth(actor: EscalaActor, branchCode: string, month: string) {
  return createEscala(actor, parseEscalaInput(scopedMonthDraft(branchCode, month)), undefined, undefined, false, true);
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
  try { assertRevision(latest, expectedRevision); checkWorkforceReady(latest); }
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
  const registration = enrollment.registration.trim();
  // This enrollment has no binding dates, so it overlaps every valid interval for the same registration.
  if (current.input.employees.some(person => person.registration === registration)) {
    throw new EscalaError(422, "ESCALA_DUPLICATE_REGISTRATION", "Esta matrícula já está cadastrada na equipe desta escala.");
  }
  const personId = randomUUID();
  const enrollmentResult = addEmployeeFromEscalaApprovedModel(approved.row.snapshot, approved.row.snapshotHash, {
    id: personId, regimeModelId: enrollment.regimeModelId, name: enrollment.name, registration,
    activeFrom: "", preferredOffDays: [],
  }, current.input);
  if (!enrollmentResult.ok) throw new EscalaError(422, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Modelo ou matrícula não permitido nesta aprovação.");
  return saveEscala(actor, id, expectedRevision, enrollmentResult.value, false, { serverEnrollment: { employeeId: personId, regimeModelId: enrollment.regimeModelId } });
}

export async function removeEscalaEmployee(actor: EscalaActor, id: string, expectedRevision: number, employeeId: string) {
  const current = await getEscala(actor, id);
  assertRevision(current, expectedRevision);
  await requireEscalaCapability(actor, "workspace.save", current.input.branchCode);
  await requireEscalaCapability(actor, "employee.manage", current.input.branchCode);
  return saveEscala(actor, id, expectedRevision, inputWithoutEscalaEmployee(current.input, employeeId), false, { serverRemoval: { employeeId } });
}

export async function changeEscalaAbsence(actor: EscalaActor, id: string, expectedRevision: number, command: EscalaAbsenceCommand) {
  const current = await getEscala(actor, id);
  assertRevision(current, expectedRevision);
  await requireEscalaCapability(actor, "employee.manage", current.input.branchCode);
  if (current.status !== "DRAFT") throw new EscalaError(409, "ESCALA_ABSENCE_DRAFT_REQUIRED", "Ajuste afastamentos em um rascunho, não em uma escala publicada.");
  return saveEscala(actor, id, expectedRevision, editDraftAbsences(current.input, command, actor.admin).input, false, { manualAbsence: command });
}

export async function rebaseEscalaApproval(actor: EscalaActor, id: string, expectedRevision: number, approvalId: string) {
  const current = await getEscala(actor, id);
  await requireEscalaCapability(actor, "settings.manage");
  const approved = await loadEscalaApproval(actor, approvalId);
  const protectedPeople = (people: EscalaInput["employees"]) => people.map(person => {
    const copy = structuredClone(person) as Partial<typeof person>;
    delete copy.name; delete copy.preferredOffDays; delete copy.planningHistory; delete copy.planningFuture;
    delete copy.offMode; delete copy.fixedOffDays; delete copy.fixedRestSlots;
    return copy;
  });
  if (stableEscalaJson(protectedPeople(current.input.employees)) !== stableEscalaJson(protectedPeople(approved.snapshot.seed.employees))) {
    throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "A aprovação precisa incluir os dados protegidos da equipe atual antes da vinculação.");
  }
  const { carriedApproval: _inherited, ...configuration } = approved.snapshot.configuration;
  const input = parseEscalaInput({ ...configuration, planningCalendarSource: current.input.planningCalendarSource,
    employees: current.input.employees,
    shifts: current.input.shifts, assignments: current.input.assignments, needsRegeneration: true });
  return saveEscala(actor, id, expectedRevision, input, false, { rebaseId: approvalId });
}

export async function validateEscalaOperational(actor: EscalaActor, id: string, expectedRevision: number, input: EscalaInput) {
  const current = await getEscala(actor, id);
  assertRevision(current, expectedRevision);
  const context = await requireEscalaCapability(actor, "workspace.save", current.input.branchCode);
  preserveManualAbsences(current.input, input);
  if (!actor.admin) {
    if (!current.approvedPolicyVersionId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "É necessária aprovação administrativa.");
    await loadEscalaApproval(actor, current.approvedPolicyVersionId, prisma, current.input);
    assertEscalaOperationalInput(current.input, input, ESCALA_CAPABILITIES.filter(capability => decideEscalaPermission(context, capability).allowed));
  }
  return validateEscala(materializeManualShiftOverrides(input));
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

export async function saveEscala(actor: EscalaActor, id: string, expectedRevision: number, input: EscalaInput, publish = false,
  options: { proposalProof?: string; catalogIntent?: boolean; serverEnrollment?: { employeeId: string; regimeModelId: string }; serverRemoval?: { employeeId: string }; rebaseId?: string; adminImport?: AdminImportSaveIntent; manualAbsence?: EscalaAbsenceCommand } = {}) {
  input = { ...input, branchCode: canonicalBranchCode(input.branchCode) };
  const current = await getEscala(actor, id);
  requireEscalaPermission(current, publish ? "publish" : "edit");
  assertRevision(current, expectedRevision);
  if (!options.proposalProof) input = retainMonthlyCarry(current.input, input);
  if (!publish && current.status === "PUBLISHED") throw new EscalaError(409, "ESCALA_REOPEN_REQUIRED", "Reabra a publicação como rascunho antes de editar.");
  if (JSON.stringify(input.planningCalendarSource) !== JSON.stringify(current.input.planningCalendarSource))
    throw new EscalaError(409, "ESCALA_CALENDAR_SOURCE_CHANGED", "A origem da atualização da semana não pode ser alterada. Recarregue o rascunho atual.");
  const context = await requireEscalaCapability(actor, publish ? "workspace.publish" : "workspace.save", current.input.branchCode);
  const absence = options.manualAbsence && editDraftAbsences(current.input, options.manualAbsence, actor.admin);
  if (absence) {
    await requireEscalaCapability(actor, "employee.manage", current.input.branchCode);
    if (current.status !== "DRAFT" || publish || Object.keys(options).length !== 1 || stableEscalaJson(absence.input) !== stableEscalaJson(input))
      throw new EscalaError(403, "ESCALA_PROTECTED_INPUT", "O lançamento deve alterar somente os afastamentos indicados no rascunho.");
  } else if (options.adminImport?.audit.purpose !== "ABSENCES") preserveManualAbsences(current.input, input);
  const removal = options.serverRemoval;
  if (removal) {
    await requireEscalaCapability(actor, "employee.manage", current.input.branchCode);
    if (publish || options.proposalProof || options.catalogIntent || options.serverEnrollment || options.rebaseId || options.adminImport
      || stableEscalaJson(inputWithoutEscalaEmployee(current.input, removal.employeeId)) !== stableEscalaJson(input)) {
      throw new EscalaError(403, "ESCALA_EMPLOYEE_REMOVAL_INVALID", "A remoção deve alterar somente o colaborador indicado e seus dias editáveis.");
    }
  }
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
  let fixedRestChanged = false;
  if (!actor.admin) {
    if (!approvalId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "É necessária aprovação administrativa.");
    await loadEscalaApproval(actor, approvalId, prisma, current.input);
    if (options.proposalProof) verifyEscalaProposal(options.proposalProof, await proposalScope(actor, current), input);
    if (!options.serverEnrollment && !removal && !absence) fixedRestChanged = assertEscalaOperationalInput(current.input, input,
      ESCALA_CAPABILITIES.filter(capability => decideEscalaPermission(context, capability).allowed), Boolean(options.proposalProof), options.catalogIntent,
      !publish && !options.proposalProof && current.canPublish);
  } else if (options.proposalProof) verifyEscalaProposal(options.proposalProof, await proposalScope(actor, current), input);
  else if (approvalId && !options.rebaseId && !options.serverEnrollment && !removal && !absence) {
    // An administrator may edit rules/data, but an old approval must not certify the new regime.
    const audit = options.adminImport?.audit;
    const approvalInput = audit?.purpose === "ABSENCES" ? importAbsenceApprovalView(current.input, input, audit.startDate, audit.endDate) : input;
    try { assertEscalaOperationalInput(current.input, approvalInput, ESCALA_CAPABILITIES, false, false, !publish && current.canPublish); }
    catch (error) {
      if (!(error instanceof EscalaError) || error.code !== "ESCALA_PROTECTED_INPUT") throw error;
      approvalId = null;
    }
  }
  if (input.branchCode !== current.input.branchCode || input.startDate !== current.input.startDate || input.endDate !== current.input.endDate) {
    throw new EscalaError(409, "ESCALA_IDENTITY_CHANGED", "Filial e período identificam esta escala. Crie outra proposta para alterar esses campos.");
  }
  if (!options.proposalProof) assertNoNewManualHolidayRest(current.input, input);
  if (absence && !absence.changedDates.size) return current;
  input = materializeManualShiftOverrides(input);
  await assertManualCatalogSelections(actor, input, current.input);
  const manualReferenceIssue = manualShiftIssues(input)[0];
  if (manualReferenceIssue) throw new EscalaError(422, manualReferenceIssue.code, manualReferenceIssue.message);
  const manualAssignmentIssue = manualAssignmentIssues(input)[0];
  if (manualAssignmentIssue) throw new EscalaError(422, manualAssignmentIssue.code, manualAssignmentIssue.message);
  preserveLockedAssignments(excludeConfirmedImportAbsences(current.input, input, options.adminImport), input, !publish && current.canPublish);
  const scenarioChanged = generationScenarioBasis(current.input) !== generationScenarioBasis(input);
  const preparedProposal = !input.needsRegeneration && matchesGenerationScenarioBasis(input);
  if (removal) input = { ...input, needsRegeneration: true, generationBasis: undefined, coverageBasis: undefined };
  else if ((scenarioChanged || current.input.needsRegeneration) && !preparedProposal) {
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
  let restHiddenEmployeeIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, publish ? "workspace.publish" : "workspace.save", current.input.branchCode, tx);
    const workforce = await checkWorkforceWrite(tx, actor.tenantId, current, rawInput, {
      legacyTeamWrite: Boolean(options.adminImport || options.serverEnrollment || removal), absenceCommand: options.manualAbsence,
    });
    if (fixedRestChanged) await requireEscalaCapability(actor, "employee.manage", current.input.branchCode, tx);
    if (options.adminImport) {
      await requireEscalaCapability(actor, "import.manage", undefined, tx);
      await options.adminImport.verify(tx, current, rawInput);
    }
    if (absence) {
      await requireEscalaCapability(actor, "employee.manage", current.input.branchCode, tx);
      await assertNoPublishedAbsenceChanges(tx, actor.tenantId, id, current.input, absence);
    }
    if (requiresUnlockAuthority) await requireEscalaCapability(actor, "workspace.publish", current.input.branchCode, tx);
    if (options.proposalProof) await requireEscalaCapability(actor, "schedule.apply", current.input.branchCode, tx);
    if (options.proposalProof) verifyEscalaProposal(options.proposalProof, await proposalScope(actor, current, tx), rawInput);
    if (options.serverEnrollment) await requireEscalaCapability(actor, "employee.manage", current.input.branchCode, tx);
    if (removal) {
      await requireEscalaCapability(actor, "employee.manage", current.input.branchCode, tx);
      await assertEscalaEmployeeRemovalAllowed(tx, actor.tenantId, id, expectedRevision, current.input, removal.employeeId);
    }
    if (options.catalogIntent) await requireEscalaCapability(actor, "shift.manage", current.input.branchCode, tx);
    if (options.rebaseId) await requireEscalaCapability(actor, "settings.manage", undefined, tx);
    if (approvalId) {
      const approved = await loadEscalaApproval(actor, approvalId, tx, input);
      if (approved.row.branchCode !== input.branchCode || approved.row.startDate !== input.startDate || approved.row.endDate !== input.endDate
        || approved.row.visibleMonth !== (input.visibleMonth ?? null)) throw new EscalaError(403, "ESCALA_PROTECTED_INPUT", "Configuração de outro período.");
    }
    if (publish) {
      input = await preservePublishedContinuity(tx, actor, id, input);
      if (workforce) await assertTransferredWorkDoesNotOverlap(tx, actor.tenantId, input, workforce.snapshot);
      validation = validateEscala(input);
      if (!validation.readyToPublish) throw new EscalaError(422, "ESCALA_NOT_READY", "A escala possui impedimentos ou pendências. Resolva a conferência antes de publicar.");
      if (workforce) restHiddenEmployeeIds = openEndedAbsenceEmployeeIds(input, workforce.snapshot);
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
      input: snapshotJson(input), createdById: actor.userId, approvedPolicyVersionId: approvalId, ...actorProvenance(actor),
      ...(restHiddenEmployeeIds.length ? { restHiddenEmployeeIds } : {}) } });
    const importedTeam = options.adminImport?.audit;
    if (importedTeam?.purpose === "EMPLOYEES") await persistEscalaImportedTeam(tx, {
      tenantId: actor.tenantId, workspaceId: id, revision, startDate: importedTeam.startDate, endDate: importedTeam.endDate, input,
    });
    await tx.auditLog.create({ data: { userId: actor.userId, action: publish ? "PUBLISH" : "UPDATE", entity: "EscalaWorkspace", entityId: id,
      metadata: { ...actorProvenance(actor), tenantId: actor.tenantId, revision, previousRevision: expectedRevision, employeeCount: input.employees.length,
        approvedPolicyVersionId: approvalId, approvalInvalidated: Boolean(current.approvedPolicyVersionId && !approvalId),
        ...(options.adminImport ? { adminImport: options.adminImport.audit } : {}),
        ...(absence ? { manualAbsence: { ...options.manualAbsence, changedDays: absence.changedDates.size } } : {}),
        ...(removal ? { removedEmployeeId: removal.employeeId } : {}),
        ...(options.serverEnrollment ? { employeeId: options.serverEnrollment.employeeId, regimeModelId: options.serverEnrollment.regimeModelId } : {}) } } });
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
  if (alreadyPublished) return current;
  const { workforce: draftWorkforce, ...metadata } = current;
  const workforce = publish
    ? (restHiddenEmployeeIds.length ? { needsSync: false, openEndedAbsenceEmployeeIds: restHiddenEmployeeIds } : undefined)
    : draftWorkforce;
  return { ...metadata, revision, status, input, validation, approvedPolicyVersionId: approvalId,
    updatedAt: updatedAt.toISOString(), ...(workforce ? { workforce } : {}) } as EscalaWorkspace;
}

function assertRevision(workspace: EscalaWorkspace, expectedRevision: number) {
  if (workspace.revision !== expectedRevision) throw new EscalaError(409, "ESCALA_STALE_REVISION", "A versão da proposta mudou. Recarregue a escala e gere uma nova análise.");
}

export function generateEscala(actor: EscalaActor, id: string, expectedRevision: number, options?: Parameters<typeof generateEscalaWith>[4]) {
  return generateEscalaWith({ getEscala, assertRevision, parseEscalaInput, recheckEscalaGeneration }, actor, id, expectedRevision, options);
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
    if (approvalOrigins && (!actor.admin || published)) throw new EscalaError(409, "ESCALA_DELETE_DEPENDENCY", "Este histórico de aprovação não pode ser excluído.");
    if (approvalOrigins) await removeReplacedDraftApprovals(tx, actor.tenantId, current);
    await preserveLatestEscalaImportedTeamBeforeDelete(tx, actor.tenantId, row.branchCode, id);
    await tx.escalaRevision.deleteMany({ where: { tenantId: actor.tenantId, workspaceId: id } });
    const deleted = await tx.escalaWorkspace.deleteMany({ where: { tenantId: actor.tenantId, id, revision: expectedRevision } });
    if (deleted.count !== 1) throw new EscalaError(409, "ESCALA_STALE_REVISION", "O planejamento mudou durante a exclusão. Nenhum dado foi removido.");
    await tx.auditLog.create({ data: { userId: actor.userId, action: "DELETE", entity: "EscalaWorkspace", entityId: id, metadata: { ...actorProvenance(actor), tenantId: actor.tenantId, revision: expectedRevision } } });
  }, { isolationLevel: "ReadCommitted", maxWait: 5000, timeout: 15000 });
  return { deletedId: id };
}
