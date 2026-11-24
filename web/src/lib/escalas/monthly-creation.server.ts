import type { Prisma } from "@/generated/prisma/client";
import type { EscalaActor } from "./access";
import { buildEscalaApprovedPolicy, createInputFromEscalaApprovedPolicy } from "./approved-policy";
import { loadEscalaApproval } from "./approved-policy-service";
import { monthBounds } from "./dates";
import { EscalaError } from "./errors";
import { carryMonthlyConfiguration, precedingMonth, scheduledMonth } from "./monthly-creation";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";

/** Runs behind the same tenant transaction and permission lock as CREATE_MONTH. */
export async function precedingSchedule(db: Prisma.TransactionClient, actor: EscalaActor, target: EscalaInput) {
  const visibleMonth = scheduledMonth(target);
  if (!visibleMonth) return;
  const month = precedingMonth(visibleMonth);
  const { startDate, endDate } = monthBounds(month);
  const rows = await db.escalaWorkspace.findMany({
    where: { tenantId: actor.tenantId, branchCode: target.branchCode, startDate: { lte: startDate }, endDate: { gte: endDate } },
    select: { id: true, revision: true, status: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
  let published;
  for (const row of rows) {
    if (row.status !== "DRAFT" && row.status !== "PUBLISHED") continue;
    const version = await db.escalaRevision.findUnique({
      where: { tenantId_workspaceId_revision: { tenantId: actor.tenantId, workspaceId: row.id, revision: row.revision } },
      select: { input: true, approvedPolicyVersionId: true },
    });
    const parsed = escalaInputSchema.safeParse(version?.input);
    if (!version || !parsed.success || parsed.data.branchCode !== target.branchCode || scheduledMonth(parsed.data) !== month) continue;
    const source = { input: parsed.data, approvedPolicyVersionId: version.approvedPolicyVersionId, workspaceId: row.id, revision: row.revision };
    if (row.status === "DRAFT") return source;
    if (row.status === "PUBLISHED") published ??= source;
  }
  return published;
}

export async function authorizeMonthlyConfiguration(db: Prisma.TransactionClient, actor: EscalaActor,
  target: EscalaInput, source: NonNullable<Awaited<ReturnType<typeof precedingSchedule>>>) {
  if (!source.approvedPolicyVersionId) return;
  let parent: Awaited<ReturnType<typeof loadEscalaApproval>>;
  try { parent = await loadEscalaApproval(actor, source.approvedPolicyVersionId, db, source.input); }
  catch (error) { if (error instanceof EscalaError && (error.status === 403 || error.status === 409)) return; throw error; }
  // A configuration explicitly registered for the target period takes precedence,
  // even when all versions were revoked. The fallback must not bypass that choice.
  const exact = await db.escalaBranchPolicyVersion.findFirst({
    where: { tenantId: actor.tenantId, branchCode: target.branchCode, startDate: target.startDate, endDate: target.endDate },
    select: { id: true },
  });
  if (exact) return;
  const inherited = carryMonthlyConfiguration(target, source.input);
  const candidate = buildEscalaApprovedPolicy({
    input: {
      ...inherited, shifts: parent.snapshot.seed.shifts,
      employees: parent.snapshot.seed.employees.map(person => ({
        ...person, historyKnown: false, history: [], manualShiftOverrides: undefined,
        manualShiftBaseIds: undefined, manualShiftByDate: undefined,
      })),
    },
    version: 1, carriedApproval: true, selectedSeedAssignments: [],
    regimeModelSelections: parent.snapshot.regimeModels.map(model => ({
      id: model.id, label: model.label, employeeId: model.sourceEmployeeId,
    })),
    provenance: {
      tenantId: actor.tenantId, approvedById: parent.row.approvedById, approvedAt: parent.row.approvedAt.toISOString(),
      origin: { workspaceId: source.workspaceId, revision: source.revision },
    },
  });
  if (!candidate.ok) return;
  const { snapshot, approvedAt, ...record } = candidate.value;
  const canonical = createInputFromEscalaApprovedPolicy(snapshot, record.snapshotHash);
  if (!canonical.ok) return;
  const row = await db.escalaBranchPolicyVersion.create({ data: {
    ...record, snapshot: JSON.parse(JSON.stringify(snapshot)), approvedAt: new Date(approvedAt),
  } });
  return { id: row.id, input: canonical.value };
}
