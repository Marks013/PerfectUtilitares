import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { canonicalBranchCode } from "./branch-code";
import { isDate } from "./dates";
import { EscalaError } from "./errors";
import { preparedShiftSignature } from "./preparation";
import { escalaInputSchema } from "./schema";
import { materializeManualShiftOverrides, manualShiftAt } from "./shift-catalog/manual-override";
import type { EscalaEmployee, EscalaInput } from "./types";

function invalidSource() {
  return new EscalaError(409, "ESCALA_IMPORTED_TEAM_INVALID", "A última importação da equipe não pôde ser conferida. Peça ao administrador para confirmar uma nova importação.");
}

function incompatibleSeed() {
  return new EscalaError(409, "ESCALA_IMPORTED_TEAM_SEED_CONFLICT", "A equipe importada não é compatível com os dias ou horários da configuração aprovada. Peça ao administrador para revisar a configuração.");
}

function overlaps(person: EscalaEmployee, start: string, end: string) {
  return person.activeFrom <= end && (!person.activeUntil || person.activeUntil >= start);
}

const snapshotSchema = z.strictObject({ version: z.literal(1), employees: escalaInputSchema.shape.employees, shifts: escalaInputSchema.shape.shifts });
type ImportedTeamSnapshot = z.output<typeof snapshotSchema>;
type ImportedTeamSource = { workspaceId: string; revision: number; startDate: string; endDate: string; snapshot: ImportedTeamSnapshot };

function referencedShifts(person: EscalaEmployee) {
  const fixed = person.fixedImportedShiftId;
  return [...person.shiftIds, ...(person.originalShiftIds ?? []), ...(fixed ? [fixed] : [])];
}

function importedSnapshot(input: EscalaInput, startDate: string, endDate: string): ImportedTeamSnapshot {
  const employees = input.employees.filter(person => overlaps(person, startDate, endDate)).map(person => {
    const { manualShiftOverrides: _overrides, manualShiftBaseIds, manualShiftByDate: _byDate,
      planningHistory: _past, planningFuture: _future, ...imported } = person;
    return { ...imported, shiftIds: manualShiftBaseIds ?? person.shiftIds, history: [], historyKnown: false };
  });
  const ids = new Set(employees.flatMap(referencedShifts));
  const shifts = input.shifts.filter(shift => ids.has(shift.id));
  if (ids.size !== shifts.length) throw invalidSource();
  return { version: 1, employees, shifts };
}

function latestImportedTeam(approved: EscalaInput, source: ImportedTeamSnapshot) {
  const approvedPeople = new Map(approved.employees.map(person => [person.id, person]));
  const sourceShifts = new Map(source.shifts.map(shift => [shift.id, shift]));
  const shifts = new Map(approved.shifts.map(shift => [shift.id, shift]));
  const employees = source.employees.filter(person => overlaps(person, approved.startDate, approved.endDate)).map(person => {
    const target = approvedPeople.get(person.id);
    if (target && target.registration !== person.registration) throw incompatibleSeed();
    for (const id of referencedShifts(person)) {
      const importedShift = sourceShifts.get(id), approvedShift = shifts.get(id);
      if (!importedShift) throw invalidSource();
      if (approvedShift && preparedShiftSignature(approvedShift) !== preparedShiftSignature(importedShift)) throw incompatibleSeed();
      if (!approvedShift) shifts.set(id, importedShift);
    }
    return { ...person, history: target?.history ?? [], historyKnown: target?.historyKnown ?? false,
      ...(target?.manualShiftOverrides ? { manualShiftOverrides: target.manualShiftOverrides, manualShiftBaseIds: person.shiftIds } : {}) };
  });
  const people = new Map(employees.map(person => [person.id, person]));
  for (const day of approved.assignments) {
    const person = people.get(day.employeeId);
    if (!person || !overlaps(person, day.date, day.date)) throw incompatibleSeed();
    const manual = manualShiftAt(person, day.date);
    if (day.kind === "WORK" && (!day.shiftId || (manual ? manual !== day.shiftId : !person.shiftIds.includes(day.shiftId))))
      throw incompatibleSeed();
  }
  const { generationBasis: _generation, coverageBasis: _coverage, ...configuration } = approved;
  const candidate = escalaInputSchema.safeParse({ ...configuration, employees, shifts: [...shifts.values()], needsRegeneration: true });
  if (!candidate.success) throw incompatibleSeed();
  return materializeManualShiftOverrides(candidate.data);
}

async function findLegacyImportedTeam(db: Prisma.TransactionClient, tenantId: string, branchCode: string,
  deletingWorkspaceId?: string): Promise<ImportedTeamSource | undefined> {
  const workspaces = await db.escalaWorkspace.findMany({ where: { tenantId, branchCode }, select: { id: true } });
  if (!workspaces.length) return undefined;
  const workspaceIds = new Set(workspaces.map(workspace => workspace.id));
  const event = await db.auditLog.findFirst({
    where: { entity: "EscalaWorkspace", action: "UPDATE", entityId: { in: [...workspaceIds] }, AND: [
      { metadata: { path: ["tenantId"], equals: tenantId } },
      { metadata: { path: ["adminImport", "purpose"], equals: "EMPLOYEES" } },
    ] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { entityId: true, metadata: true },
  });
  if (!event || (deletingWorkspaceId && event.entityId !== deletingWorkspaceId)) return undefined;
  const workspaceId = event.entityId;
  const metadata = event.metadata as { tenantId?: unknown; revision?: unknown; adminImport?: { purpose?: unknown; startDate?: unknown; endDate?: unknown } } | null;
  const revision = metadata?.revision, startDate = metadata?.adminImport?.startDate, endDate = metadata?.adminImport?.endDate;
  if (!workspaceId || !workspaceIds.has(workspaceId) || metadata?.tenantId !== tenantId || metadata.adminImport?.purpose !== "EMPLOYEES"
    || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1
    || typeof startDate !== "string" || !isDate(startDate) || typeof endDate !== "string" || !isDate(endDate) || startDate > endDate) throw invalidSource();
  const stored = await db.escalaRevision.findUnique({ where: { tenantId_workspaceId_revision: { tenantId, workspaceId, revision } },
    select: { tenantId: true, workspaceId: true, revision: true, input: true, workspace: { select: { branchCode: true } } } });
  if (!stored || stored.tenantId !== tenantId || stored.workspaceId !== workspaceId || stored.revision !== revision
    || stored.workspace.branchCode !== branchCode) throw invalidSource();
  const checked = escalaInputSchema.safeParse(stored.input);
  if (!checked.success || checked.data.branchCode !== branchCode || startDate < checked.data.startDate || endDate > checked.data.endDate)
    throw invalidSource();
  return { workspaceId, revision, startDate, endDate, snapshot: importedSnapshot(checked.data, startDate, endDate) };
}

async function writeImportedTeam(db: Prisma.TransactionClient, tenantId: string, branchCode: string, source: ImportedTeamSource) {
  const seed = { sourceWorkspaceId: source.workspaceId, sourceRevision: source.revision, startDate: source.startDate, endDate: source.endDate,
    snapshot: JSON.parse(JSON.stringify(source.snapshot)) as Prisma.InputJsonValue };
  await db.escalaImportedTeam.upsert({ where: { tenantId_branchCode: { tenantId, branchCode } },
    create: { tenantId, branchCode, ...seed }, update: seed });
}

/** Call only after a complete team import was confirmed, within its transaction. */
export async function persistEscalaImportedTeam(db: Prisma.TransactionClient, source: {
  tenantId: string; workspaceId: string; revision: number; startDate: string; endDate: string; input: EscalaInput;
}) {
  const { tenantId, input, workspaceId, revision, startDate, endDate } = source;
  await writeImportedTeam(db, tenantId, canonicalBranchCode(input.branchCode), {
    workspaceId, revision, startDate, endDate, snapshot: importedSnapshot(input, startDate, endDate),
  });
}

/** Migrate the latest legacy source before its workspace can disappear. */
export async function preserveLatestEscalaImportedTeamBeforeDelete(db: Prisma.TransactionClient, tenantId: string,
  branch: string, deletingWorkspaceId: string) {
  const branchCode = canonicalBranchCode(branch);
  const stored = await db.escalaImportedTeam.findUnique({ where: { tenantId_branchCode: { tenantId, branchCode } }, select: { branchCode: true } });
  if (stored) return;
  const legacy = await findLegacyImportedTeam(db, tenantId, branchCode, deletingWorkspaceId);
  if (legacy) await writeImportedTeam(db, tenantId, branchCode, legacy);
}

/** Only a completed administrative team import can supply the seed of another month. */
export async function loadLatestEscalaImportedTeam(db: Prisma.TransactionClient, tenantId: string, approvedInput: EscalaInput) {
  const branchCode = canonicalBranchCode(approvedInput.branchCode);
  const stored = await db.escalaImportedTeam.findUnique({ where: { tenantId_branchCode: { tenantId, branchCode } } });
  if (stored) {
    const parsed = snapshotSchema.safeParse(stored.snapshot);
    if (!parsed.success || stored.tenantId !== tenantId || stored.branchCode !== branchCode
      || !stored.sourceWorkspaceId || !Number.isSafeInteger(stored.sourceRevision) || stored.sourceRevision < 1) throw invalidSource();
    return { input: latestImportedTeam(approvedInput, parsed.data), workspaceId: stored.sourceWorkspaceId, revision: stored.sourceRevision };
  }
  const legacy = await findLegacyImportedTeam(db, tenantId, branchCode);
  if (!legacy) return undefined;
  return { input: latestImportedTeam(approvedInput, legacy.snapshot), workspaceId: legacy.workspaceId, revision: legacy.revision };
}
