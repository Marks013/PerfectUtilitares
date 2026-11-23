import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { canonicalBranchCode } from "./branch-code";
import { isDate } from "./dates";
import { EscalaError } from "./errors";
import { type EscalaWorkforceSnapshot, escalaWorkforceSnapshotSchema } from "./global-workforce-domain";
import { materializeEscalaWorkforceDraft } from "./global-workforce-projection";
import { stableEscalaJson } from "./operational-input-policy";
import type { EscalaInput } from "./types";

const revision = z.number().int().min(1).max(2_147_483_647);
const date = z.string().refine(isDate);
const employeeId = z.string().min(1).max(100).regex(/^[\p{L}\p{N}_.:-]+$/u);
// PostgreSQL JSONB rejects U+0000. The projector uses a NUL separator only in memory.
const absenceKey = z.tuple([employeeId, date]);
const projectorKey = ([id, day]: z.output<typeof absenceKey>) => `${id}\0${day}`;
const storedKey = (key: string): z.output<typeof absenceKey> => absenceKey.parse(key.split("\0"));
const stateSchema = z.strictObject({
  baseRevision: revision,
  managedAbsenceKeys: z.array(absenceKey).max(10_500),
  managedEmploymentEnds: z.array(z.strictObject({
    employeeId, localActiveUntil: date.nullable(), baseActiveUntil: date,
  }).refine(value => value.localActiveUntil === null || value.baseActiveUntil < value.localActiveUntil)).max(250),
}).refine(value => new Set(value.managedAbsenceKeys.map(projectorKey)).size === value.managedAbsenceKeys.length
  && new Set(value.managedEmploymentEnds.map(end => end.employeeId)).size === value.managedEmploymentEnds.length);

type WorkforceBase = { revision: number; snapshot: EscalaWorkforceSnapshot };
type WorkforceDraftState = z.output<typeof stateSchema>;
const invalidState = () => new EscalaError(409, "ESCALA_WORKFORCE_DRAFT_STATE_INVALID", "O vínculo deste rascunho com a base global não pôde ser conferido.");

export function parseWorkforceDraftState(value: unknown): WorkforceDraftState | null {
  const parsed = stateSchema.nullish().safeParse(value);
  if (!parsed.success) throw invalidState();
  return parsed.data ?? null;
}

/** Reads only the authenticated company. Call from the same transaction as a revisioned write. */
export async function readWorkforceForDraft(tx: Prisma.TransactionClient, tenantId: string, branchCode: string): Promise<WorkforceBase | null> {
  const row = await tx.escalaWorkforce.findUnique({ where: { tenantId }, select: { revision: true, snapshot: true } });
  if (!row) return null;
  const snapshot = escalaWorkforceSnapshotSchema.safeParse(row.snapshot);
  if (!snapshot.success || !revision.safeParse(row.revision).success) {
    throw new EscalaError(409, "ESCALA_WORKFORCE_INVALID", "A base global não passou na conferência.");
  }
  const branch = canonicalBranchCode(branchCode);
  return snapshot.data.catalogs.some(catalog => catalog.branchCode === branch) ? { revision: row.revision, snapshot: snapshot.data } : null;
}

/** The caller must pass metadata loaded by the server, never a value supplied with a draft patch. */
export function projectWorkforceForDraft(input: EscalaInput, currentState: unknown, base: WorkforceBase) {
  const previous = parseWorkforceDraftState(currentState);
  if (!revision.safeParse(base.revision).success || (previous && previous.baseRevision > base.revision)) throw invalidState();
  const peopleIds = new Set(input.employees.map(person => person.id));
  if (previous && (previous.managedEmploymentEnds.some(end => !peopleIds.has(end.employeeId)) ||
    previous.managedAbsenceKeys.some(([id, day]) => !peopleIds.has(id) || day < input.startDate || day > input.endDate))) {
    throw new EscalaError(409, "ESCALA_WORKFORCE_DRAFT_STATE_INVALID", "A origem dos afastamentos ou vigências não corresponde ao rascunho.");
  }
  const projected = materializeEscalaWorkforceDraft({ status: "DRAFT", input }, base.snapshot,
    new Set(previous?.managedAbsenceKeys.map(projectorKey)), previous?.managedEmploymentEnds);
  const state: WorkforceDraftState = {
    baseRevision: base.revision,
    managedAbsenceKeys: [...projected.managedAbsenceKeys].sort().map(storedKey),
    managedEmploymentEnds: [...projected.managedEmploymentEnds].sort((a, b) => a.employeeId.localeCompare(b.employeeId)),
  };
  return { input: projected.input, state, changed: projected.changed || stableEscalaJson(previous) !== stableEscalaJson(state) };
}
