import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { type EscalaActor, lockEscalaAccess, requireEscalaCapability } from "./access";
import { canonicalBranchCode } from "./branch-code";
import { isDate } from "./dates";
import { EscalaError } from "./errors";
import { parseFphi105Report } from "./fphi105";
import { discoverFpre136Branches } from "./fpre136";
import {
  applyEscalaWorkforceFphi105,
  dismissEscalaWorkforcePerson,
  type EscalaWorkforceSnapshot,
  escalaWorkforceSnapshotSchema,
  setEscalaWorkforceReturnDate,
} from "./global-workforce-domain";
import { applyEscalaWorkforceFpre136 } from "./global-workforce-team-import";
import { previewEscalaImport } from "./import";

const branch = z.string().trim().min(1).max(160).transform(canonicalBranchCode);
const registration = z.string().trim().min(1).max(160);
const date = z.string().refine(isDate);
const maxRevision = 2_147_483_647;
const expectedRevision = z.number().int().positive().max(maxRevision);
const fields = {
  branchCode: branch,
  registration,
  expectedRevision,
};
const commandSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("CREATE_PERSON"), ...fields, registration: z.string().trim().regex(/^\d{1,60}$/),
    name: z.string().trim().min(1).max(160), sector: z.string().trim().max(160), role: z.string().trim().max(160), activeFrom: date }),
  z.strictObject({
    action: z.literal("UPDATE_PERSON"),
    ...fields,
    name: z.string().trim().min(1).max(160).optional(),
    sector: z.string().trim().max(160).optional(),
    role: z.string().trim().max(160).optional(),
    activeFrom: date.optional(),
  }),
  z.strictObject({
    action: z.literal("SET_ABSENCE"),
    ...fields,
    startDate: date,
    endDate: date.nullable(),
    previousStartDate: date.optional(),
  }),
  z.strictObject({ action: z.literal("REMOVE_ABSENCE"), ...fields, startDate: date }),
  z.strictObject({ action: z.literal("SET_RETURN_DATE"), ...fields, startDate: date, returnDate: date }),
  z.strictObject({ action: z.literal("DISMISS_PERSON"), ...fields, dismissedFrom: date }),
]);
type ManualCommand = z.output<typeof commandSchema>;
type WorkforcePerson = EscalaWorkforceSnapshot["people"][number];

const stale = () => new EscalaError(409, "ESCALA_WORKFORCE_STALE", "A base global mudou. Recarregue antes de editar.");

async function loadSnapshot(tx: Prisma.TransactionClient, tenantId: string, requireInitialized = true) {
  const stored = await tx.escalaWorkforce.findUnique({
    where: { tenantId },
    select: { revision: true, snapshot: true },
  });
  if (!stored) {
    if (requireInitialized) throw new EscalaError(409, "ESCALA_WORKFORCE_NOT_READY", "A base global ainda não foi inicializada.");
    return { revision: 0, snapshot: { version: 1, people: [], catalogs: [], absences: [] } satisfies EscalaWorkforceSnapshot };
  }
  const snapshot = escalaWorkforceSnapshotSchema.safeParse(stored.snapshot);
  if (!snapshot.success) throw new EscalaError(409, "ESCALA_WORKFORCE_INVALID", "A base global não passou na conferência.");
  return { revision: stored.revision, snapshot: snapshot.data };
}

async function persistChange(
  tx: Prisma.TransactionClient, actor: EscalaActor, current: Awaited<ReturnType<typeof loadSnapshot>>,
  next: EscalaWorkforceSnapshot, action: string, summary: { branchCode: string } | { rowCount: number },
) {
  if (next === current.snapshot) return { revision: current.revision, changed: false };
  const validated = escalaWorkforceSnapshotSchema.safeParse(next);
  if (!validated.success) {
    throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_CHANGE", "A alteração é incompatível com a base global.");
  }
  if (current.revision === maxRevision) {
    throw new EscalaError(409, "ESCALA_WORKFORCE_REVISION_LIMIT", "A base global atingiu o limite de revisões.");
  }
  const revision = current.revision + 1;
  const data = { revision, snapshot: validated.data as Prisma.InputJsonValue };
  if (current.revision === 0) {
    try { await tx.escalaWorkforce.create({ data: { tenantId: actor.tenantId, ...data } }); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw stale();
      throw error;
    }
  } else {
    const updated = await tx.escalaWorkforce.updateMany({ where: { tenantId: actor.tenantId, revision: current.revision }, data });
    if (updated.count !== 1) throw stale();
  }
  const provenance = actor.moduleSessionId ? { accessChannel: "ESCALAS_USERNAME_ONLY", moduleSessionId: actor.moduleSessionId } : {};
  await tx.auditLog.create({
    data: {
      userId: actor.userId,
      action,
      entity: "EscalaWorkforce",
      entityId: actor.tenantId,
      metadata: { ...provenance, ...summary, previousRevision: current.revision, revision },
    },
  });
  return { revision, changed: true };
}

export async function readEscalaWorkforceBranch(actor: EscalaActor, branchCode: string) {
  const target = branch.safeParse(branchCode);
  if (!target.success) throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_BRANCH", "Informe uma filial válida.");
  return prisma.$transaction(async (tx) => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, "employee.manage", target.data, tx);
    const { revision, snapshot } = await loadSnapshot(tx, actor.tenantId, false);
    const people = snapshot.people.filter((person) => person.branchCode === target.data);
    const registrations = new Set(people.map((person) => person.employee.registration));
    return {
      revision,
      people: people.map(person => {
        const scoped = { ...person };
        delete scoped.previousBranchCodes;
        return scoped;
      }),
      catalogs: snapshot.catalogs.filter((catalog) => catalog.branchCode === target.data),
      absences: snapshot.absences.filter((absence) => registrations.has(absence.registration)),
    };
  });
}

function setAbsence(snapshot: EscalaWorkforceSnapshot, person: WorkforcePerson, command: Extract<ManualCommand, { action: "SET_ABSENCE" }>) {
  const { registration, startDate, endDate, previousStartDate } = command;
  const previous = snapshot.absences.find((absence) =>
    absence.registration === registration && absence.startDate === (previousStartDate ?? startDate));
  if (previousStartDate && !previous) {
    throw new EscalaError(404, "ESCALA_WORKFORCE_ABSENCE_NOT_FOUND", "Afastamento não encontrado.");
  }
  if ((endDate && endDate < startDate) ||
      (startDate !== previous?.startDate &&
        (startDate < person.employee.activeFrom || Boolean(person.dismissedFrom && startDate >= person.dismissedFrom)))) {
    throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_ABSENCE", "O início e o término do afastamento precisam respeitar o vínculo.");
  }
  if (previous && previous.startDate === startDate && previous.endDate === endDate) return snapshot;
  if (snapshot.absences.some((absence) => absence !== previous && absence.registration === registration && absence.startDate === startDate)) {
    throw new EscalaError(409, "ESCALA_WORKFORCE_CONFLICTING_ABSENCE", "Já existe um afastamento com esse início.");
  }
  const next = { registration, startDate, endDate, source: "MANUAL" } as const;
  return { ...snapshot, absences: previous
    ? snapshot.absences.map((absence) => absence === previous ? next : absence)
    : [...snapshot.absences, next] };
}

function applyManualChange(snapshot: EscalaWorkforceSnapshot, person: WorkforcePerson, command: Exclude<ManualCommand, { action: "CREATE_PERSON" }>): EscalaWorkforceSnapshot {
  switch (command.action) {
    case "UPDATE_PERSON": {
      const { name, sector, role, activeFrom } = command;
      const employee = { ...person.employee, name: name ?? person.employee.name, sector: sector ?? person.employee.sector,
        role: role ?? person.employee.role, activeFrom: activeFrom ?? person.employee.activeFrom };
      if (employee.name === person.employee.name && employee.sector === person.employee.sector &&
          employee.role === person.employee.role && employee.activeFrom === person.employee.activeFrom) return snapshot;
      return { ...snapshot, people: snapshot.people.map((item) => item === person ? { ...item, employee } : item) };
    }
    case "SET_ABSENCE":
      return setAbsence(snapshot, person, command);
    case "REMOVE_ABSENCE": {
      const absences = snapshot.absences.filter((absence) => absence.registration !== command.registration || absence.startDate !== command.startDate);
      return absences.length === snapshot.absences.length ? snapshot : { ...snapshot, absences };
    }
    case "SET_RETURN_DATE":
      return setEscalaWorkforceReturnDate(snapshot, command, command.returnDate);
    case "DISMISS_PERSON":
      return dismissEscalaWorkforcePerson(snapshot, command.registration, command.dismissedFrom);
  }
}

function addWorkforcePerson(snapshot: EscalaWorkforceSnapshot, command: Extract<ManualCommand, { action: "CREATE_PERSON" }>): EscalaWorkforceSnapshot {
  const { branchCode, registration, name, sector, role, activeFrom } = command;
  const identity = (value: string) => value.replace(/^0+(?=\d)/, "");
  if (snapshot.people.some(person => identity(person.employee.registration) === identity(registration))) {
    throw new EscalaError(409, "ESCALA_WORKFORCE_DUPLICATE_REGISTRATION", "A matrícula informada já consta na base global.");
  }
  if (!snapshot.catalogs.some(catalog => catalog.branchCode === branchCode)) {
    throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_BRANCH", "A filial não está cadastrada na base global.");
  }
  return { ...snapshot, people: [...snapshot.people, { branchCode, dismissedFrom: null, employee: {
    id: `global-${createHash("sha256").update(registration).digest("hex").slice(0, 24)}`, registration, name, sector, role, activeFrom,
    weeklyHours: 42, weeklyHoursMode: "BRANCH", shiftIds: [], scheduleMode: "MISSING", offMode: "VARIABLE", fixedOffDays: [],
    offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], sundayRestRule: "PROTECTIVE", historyKnown: false, history: [],
  } }] };
}

/** Internal command boundary: scope comes from the stored identity, not from a client-supplied snapshot. */
export async function editEscalaWorkforce(actor: EscalaActor, rawCommand: unknown) {
  const parsed = commandSchema.safeParse(rawCommand);
  if (!parsed.success) throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_COMMAND", "Confira os dados da alteração.");
  const command = parsed.data;
  return prisma.$transaction(async (tx) => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, "employee.manage", command.branchCode, tx);
    const current = await loadSnapshot(tx, actor.tenantId);
    if (current.revision !== command.expectedRevision) throw stale();
    if (command.action === "CREATE_PERSON") {
      return persistChange(tx, actor, current, addWorkforcePerson(current.snapshot, command), command.action, { branchCode: command.branchCode });
    }
    const person = current.snapshot.people.find((item) =>
      item.branchCode === command.branchCode && item.employee.registration === command.registration);
    if (!person) throw new EscalaError(404, "ESCALA_WORKFORCE_PERSON_NOT_FOUND", "Não foi encontrada uma matrícula correspondente nesta filial.");
    const next = applyManualChange(current.snapshot, person, command);
    return persistChange(tx, actor, current, next, command.action, { branchCode: command.branchCode });
  });
}

async function requireWorkforceImporter(tx: Prisma.TransactionClient, actor: EscalaActor) {
  await lockEscalaAccess(tx, actor.tenantId);
  await requireEscalaCapability(actor, "import.manage", undefined, tx);
  if (!actor.admin) throw new EscalaError(403, "ESCALA_ACTION_FORBIDDEN", "Somente administradores podem importar para a base global.");
}

function prepareFphi105(tenantId: string, current: Awaited<ReturnType<typeof loadSnapshot>>, file: Buffer) {
  const report = parseFphi105Report(file);
  if (!report.records.length || report.issues.length || report.invalidRows || report.unrecognizedRows ||
      new Set(report.records.map((record) => record.companyCode)).size !== 1) {
    throw new EscalaError(422, "ESCALA_WORKFORCE_UNREVIEWABLE_IMPORT", "O relatório precisa estar íntegro e identificar uma única empresa.");
  }
  const people = new Map(current.snapshot.people.map((person) => [person.employee.registration, person]));
  const employmentTypes = new Map<string, string>();
  const eventKey = (registration: string, startDate: string) => JSON.stringify([registration, startDate]);
  const existing = new Map(current.snapshot.absences.map(event => [eventKey(event.registration, event.startDate), event]));
  const reportBranches = new Map<string, string>();
  const records = report.records.map(({ registration, startDate, endDate, branchCode, employmentType }) => {
    const person = people.get(registration);
    if (!person) {
      throw new EscalaError(422, "ESCALA_WORKFORCE_UNKNOWN_REGISTRATION", "O relatório contém matrícula que não pertence à base global.");
    }
    const previousType = employmentTypes.get(registration);
    const sourceBranch = branchCode ? canonicalBranchCode(branchCode) : undefined;
    const key = eventKey(registration, startDate);
    const previousBranch = reportBranches.get(key);
    const event = existing.get(key);
    // A former branch may close the known event, but cannot open or rewrite it.
    const historicalReturn = sourceBranch !== undefined && person.previousBranchCodes?.includes(sourceBranch) && endDate !== null
      && event !== undefined && (event.endDate === null || event.endDate === endDate);
    if ((sourceBranch !== undefined && sourceBranch !== person.branchCode && !historicalReturn) ||
        (sourceBranch !== undefined && previousBranch !== undefined && previousBranch !== sourceBranch) ||
        (previousType !== undefined && previousType !== employmentType)) {
      throw new EscalaError(422, "ESCALA_WORKFORCE_AMBIGUOUS_REGISTRATION", "O relatório contém vínculos ou filiais ambíguos.");
    }
    if (sourceBranch !== undefined) reportBranches.set(key, sourceBranch);
    employmentTypes.set(registration, employmentType);
    return { registration, startDate, endDate };
  });
  const next = applyEscalaWorkforceFphi105(current.snapshot, records);
  const fileHash = createHash("sha256").update(file).digest("hex");
  const impactHash = createHash("sha256").update(JSON.stringify([tenantId, current.revision, fileHash, next])).digest("hex");
  return {
    next,
    summary: {
      revision: current.revision,
      impactHash,
      rowCount: records.length,
      openRowCount: records.filter((record) => record.endDate === null).length,
      changed: next !== current.snapshot,
      canApply: true,
    },
  };
}

const correctionsSchema = z.array(z.strictObject({ line: z.number().int().min(2).max(512 * 1024 + 1),
  registration: z.string().trim().regex(/^\d{1,60}$/), })).max(250)
  .refine(rows => new Set(rows.map(row => row.line)).size === rows.length);
const importRevision = z.number().int().min(0).max(maxRevision);
const importFields = { purpose: z.enum(["EMPLOYEES", "ABSENCES"]), registrationCorrections: correctionsSchema.optional() };
const workforceImportCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({ ...importFields, action: z.literal("IMPORT_PREVIEW"), expectedRevision: importRevision.optional() }),
  z.strictObject({ ...importFields, action: z.literal("IMPORT_APPLY"), expectedRevision: importRevision, impactHash: z.hash("sha256") }),
]).refine(command => command.purpose === "EMPLOYEES" || command.registrationCorrections === undefined);
type ImportCommand = z.output<typeof workforceImportCommandSchema>;

async function prepareFpre136(tenantId: string, current: Awaited<ReturnType<typeof loadSnapshot>>, file: Buffer,
  corrections: ImportCommand["registrationCorrections"],
) {
  const branchCodes = discoverFpre136Branches(file);
  const registrationCorrections = new Map(corrections?.map(item => [item.line, item.registration]));
  const previews = await Promise.all(branchCodes.map(branchCode => previewEscalaImport(file, "csv", {
    branchCode, registrationCorrections, defaultWeeklyHours: 42, startDate: "",
  })));
  const missingRegistrations = previews.flatMap(preview => (preview.replacement?.missingRegistrations ?? []).map(item => ({
    ...item, branchCode: preview.report?.branchCode,
  }))).sort((first, second) => first.line - second.line);
  if (corrections?.some(item => !missingRegistrations.some(missing => missing.line === item.line && missing.resolved))) {
    throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_COMMAND", "Corrija somente as linhas sem matrícula indicadas pela prévia.");
  }
  const canApply = missingRegistrations.every(item => item.resolved);
  const next = canApply ? applyEscalaWorkforceFpre136(current.snapshot, previews, branchCodes) : current.snapshot;
  const fileHash = createHash("sha256").update(file).digest("hex");
  const impactHash = createHash("sha256").update(JSON.stringify([tenantId, current.revision, fileHash, canApply, next])).digest("hex");
  return { next, summary: { revision: current.revision, impactHash, branchCodes, missingRegistrations,
    canApply, rowCount: previews[0].report?.sourceEmployees ?? 0, changed: next !== current.snapshot } };
}

export async function importEscalaWorkforce(actor: EscalaActor, rawCommand: unknown, file: Buffer) {
  const parsed = workforceImportCommandSchema.safeParse(rawCommand);
  if (!parsed.success) throw new EscalaError(422, "ESCALA_WORKFORCE_INVALID_COMMAND", "Confira os dados da importação.");
  const command = parsed.data;
  const bytes = Buffer.from(file);
  return prisma.$transaction(async tx => {
    await requireWorkforceImporter(tx, actor);
    const current = await loadSnapshot(tx, actor.tenantId, command.purpose === "ABSENCES");
    if (command.expectedRevision !== undefined && current.revision !== command.expectedRevision) throw stale();
    const { next, summary } = command.purpose === "EMPLOYEES"
      ? await prepareFpre136(actor.tenantId, current, bytes, command.registrationCorrections)
      : prepareFphi105(actor.tenantId, current, bytes);
    if (command.action === "IMPORT_PREVIEW") return { preview: summary };
    if (!summary.canApply) throw new EscalaError(422, "ESCALA_WORKFORCE_INCOMPLETE_TEAM", "Preencha as matrículas pendentes antes de confirmar a importação.");
    if (summary.impactHash !== command.impactHash) throw new EscalaError(409, "ESCALA_WORKFORCE_PREVIEW_CHANGED", "O arquivo ou o impacto mudou. Confira uma nova prévia.");
    return persistChange(tx, actor, current, next, command.purpose === "EMPLOYEES" ? "IMPORT_FPRE136" : "IMPORT_FPHI105", { rowCount: summary.rowCount });
  });
}
