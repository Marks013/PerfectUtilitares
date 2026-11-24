import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { lockEscalaAccess, requireEscalaCapability, type EscalaActor } from "./access";
import { buildEscalaApprovedPolicy, createInputFromEscalaApprovedPolicy, readEscalaApprovedPolicy } from "./approved-policy";
import { stableEscalaJson } from "./operational-input-policy";
import { EscalaError } from "./errors";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";
import { canonicalBranchCode } from "./branch-code";
import { precedingMonth, scheduledMonth } from "./monthly-creation";
const approve = z.strictObject({ action: z.literal("APPROVE"), input: z.unknown(),
  origin: z.strictObject({ workspaceId: z.string().min(1).max(100), revision: z.number().int().positive() }).nullable(),
  selectedSeedAssignments: z.array(z.unknown()).max(10500), regimeModelSelections: z.array(z.unknown()).max(250) });
const revoke = z.strictObject({ action: z.literal("REVOKE"), id: z.string().min(1).max(100) });

/** A cheap discriminator for the read path; verify hash and ancestry before trusting the snapshot. */
export function hasCarriedApproval(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object" || !("configuration" in snapshot)) return false;
  const configuration = snapshot.configuration;
  return Boolean(configuration && typeof configuration === "object"
    && "carriedApproval" in configuration && configuration.carriedApproval === true);
}

export async function loadEscalaApproval(actor: EscalaActor, id: string, db: Prisma.TransactionClient = prisma,
  scope?: Pick<EscalaInput, "branchCode" | "startDate" | "endDate" | "visibleMonth">) {
  return readApprovalChain(actor, id, db, scope, new Set());
}

async function readApprovalChain(actor: EscalaActor, id: string, db: Prisma.TransactionClient,
  scope: Pick<EscalaInput, "branchCode" | "startDate" | "endDate" | "visibleMonth"> | undefined,
  seen: Set<string>): Promise<{ row: Awaited<ReturnType<Prisma.TransactionClient["escalaBranchPolicyVersion"]["findFirstOrThrow"]>>; snapshot: import("./approved-policy").EscalaApprovedPolicySnapshot }> {
  const row = await db.escalaBranchPolicyVersion.findFirst({ where: { tenantId: actor.tenantId, id } });
  if (!row || row.id !== id || row.tenantId !== actor.tenantId) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "É necessária uma configuração administrativa aprovada para este período.");
  if (row.revokedAt) throw new EscalaError(409, "ESCALA_CONFIG_REVOKED", "A configuração foi revogada. Consulte o administrador.");
  const checked = readEscalaApprovedPolicy(row.snapshot, row.snapshotHash);
  if (!checked.ok || row.snapshotSchemaVersion !== 1 || row.version < 1) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "A configuração aprovada não pôde ser conferida.");
  const snapshot = checked.value, config = snapshot.configuration, provenance = snapshot.provenance;
  if (config.branchCode !== row.branchCode || config.startDate !== row.startDate || config.endDate !== row.endDate
    || (config.visibleMonth ?? null) !== row.visibleMonth || provenance.tenantId !== actor.tenantId
    || provenance.approvedById !== row.approvedById || provenance.approvedAt !== row.approvedAt.toISOString()
    || (provenance.origin?.workspaceId ?? null) !== row.originWorkspaceId || (provenance.origin?.revision ?? null) !== row.originRevision) {
    throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "A referência administrativa é inconsistente.");
  }
  if (scope && (row.branchCode !== scope.branchCode || row.startDate !== scope.startDate || row.endDate !== scope.endDate
    || row.visibleMonth !== (scope.visibleMonth ?? null))) throw new EscalaError(403, "ESCALA_PROTECTED_INPUT", "A aprovação não pertence a esta filial e período.");
  if (config.carriedApproval) {
    const origin = provenance.origin;
    if (!origin || !config.visibleMonth || seen.has(id))
      throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "A origem da configuração herdada não pôde ser conferida.");
    seen.add(id);
    const previous = await db.escalaRevision.findUnique({
      where: { tenantId_workspaceId_revision: { tenantId: actor.tenantId, workspaceId: origin.workspaceId, revision: origin.revision } },
      select: { input: true, approvedPolicyVersionId: true },
    });
    const source = escalaInputSchema.safeParse(previous?.input);
    if (!previous?.approvedPolicyVersionId || !source.success || source.data.branchCode !== config.branchCode
      || scheduledMonth(source.data) !== precedingMonth(config.visibleMonth))
      throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "A origem da configuração herdada não pertence ao mês anterior desta filial.");
    const parent = await readApprovalChain(actor, previous.approvedPolicyVersionId, db, source.data, seen);
    if (parent.row.approvedById !== row.approvedById || parent.row.approvedAt.valueOf() !== row.approvedAt.valueOf())
      throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "A autorização original da configuração herdada diverge.");
  }
  return { row, snapshot };
}
export async function inputFromEscalaApproval(actor: EscalaActor, id: string) {
  const { row } = await loadEscalaApproval(actor, id);
  await requireEscalaCapability(actor, "workspace.create", row.branchCode);
  const result = createInputFromEscalaApprovedPolicy(row.snapshot, row.snapshotHash);
  if (!result.ok) throw new EscalaError(409, "ESCALA_CONFIG_APPROVAL_REQUIRED", "Configuração inválida.");
  return result.value;
}
export async function listEscalaApprovals(actor: EscalaActor, branchCode: string, startDate: string, endDate: string) {
  await requireEscalaCapability(actor, "workspace.read", branchCode);
  const rows = await prisma.escalaBranchPolicyVersion.findMany({ where: { tenantId: actor.tenantId, branchCode, startDate, endDate }, orderBy: { version: "desc" } });
  return { policies: rows.map(row => {
    const checked = readEscalaApprovedPolicy(row.snapshot, row.snapshotHash);
    return { id: row.id, branchCode: row.branchCode, startDate: row.startDate, endDate: row.endDate,
      visibleMonth: row.visibleMonth, version: row.version, approvedAt: row.approvedAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
      regimeModels: checked.ok ? checked.value.regimeModels.map(model => ({ id: model.id, label: model.label })) : [] };
  }) };
}
export async function administerEscalaApproval(actor: EscalaActor, value: unknown) {
  const command = approve.safeParse(value), revocation = revoke.safeParse(value);
  if (!command.success && !revocation.success) throw new EscalaError(400, "ESCALA_INVALID_COMMAND", "Comando inválido.");
  return prisma.$transaction(async tx => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, "settings.manage", undefined, tx);
    if (revocation.success) {
      const row = await tx.escalaBranchPolicyVersion.findFirst({ where: { id: revocation.data.id, tenantId: actor.tenantId } });
      if (!row) throw new EscalaError(404, "ESCALA_NOT_FOUND", "Configuração não encontrada.");
      if (!row.revokedAt) await tx.escalaBranchPolicyVersion.update({ where: { tenantId_id: { tenantId: actor.tenantId, id: row.id } }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", entity: "EscalaBranchPolicyVersion", entityId: row.id,
        metadata: { tenantId: actor.tenantId, action: "REVOKE" } } });
      return { revoked: true };
    }
    if (!command.success) throw new EscalaError(400, "ESCALA_INVALID_COMMAND", "Comando inválido.");
    const data = command.data;
    if (data.origin) {
      const row = await tx.escalaWorkspace.findFirst({ where: { id: data.origin.workspaceId, tenantId: actor.tenantId, revision: data.origin.revision } });
      const source = await tx.escalaRevision.findUnique({ where: { tenantId_workspaceId_revision: {
        tenantId: actor.tenantId, workspaceId: data.origin.workspaceId, revision: data.origin.revision } } });
      if (!row || !source || stableEscalaJson(source.input) !== stableEscalaJson(data.input)) throw new EscalaError(409, "ESCALA_STALE_REVISION", "A origem mudou ou difere da revisão selecionada.");
      const parsed = escalaInputSchema.safeParse(data.input);
      if (!parsed.success || canonicalBranchCode(row.branchCode) !== parsed.data.branchCode
        || row.startDate !== parsed.data.startDate || row.endDate !== parsed.data.endDate) throw new EscalaError(409, "ESCALA_STALE_REVISION", "A origem pertence a outra filial ou período.");
    }
    // Published context is derived, not attendance. Only a matched persisted source may omit it;
    // CREATE/generation/publication reload it from canonical published revisions on the server.
    let approvalInput = data.input;
    if (data.origin) {
      const parsed = escalaInputSchema.safeParse(approvalInput);
      if (!parsed.success) throw new EscalaError(422, "INVALID_APPROVED_POLICY", "A origem não possui formato válido.");
      approvalInput = { ...parsed.data, employees: parsed.data.employees.map(person => {
        const copy = structuredClone(person); delete copy.planningHistory; delete copy.planningFuture; return copy;
      }) };
    }
    const built = buildEscalaApprovedPolicy({ input: approvalInput, version: 1, selectedSeedAssignments: data.selectedSeedAssignments,
      regimeModelSelections: data.regimeModelSelections,
      provenance: { tenantId: actor.tenantId, approvedById: actor.userId, approvedAt: new Date().toISOString(), origin: data.origin } });
    if (!built.ok) throw new EscalaError(422, "INVALID_APPROVED_POLICY", "A configuração não possui dados aprovados coerentes para este período.");
    const candidate = built.value;
    const last = await tx.escalaBranchPolicyVersion.findFirst({ where: { tenantId: actor.tenantId, branchCode: candidate.branchCode,
      startDate: candidate.startDate, endDate: candidate.endDate }, orderBy: { version: "desc" }, select: { version: true } });
    if (last && last.version >= 2_147_483_647) throw new EscalaError(409, "ESCALA_STALE_REVISION", "O limite de versões foi atingido.");
    const row = await tx.escalaBranchPolicyVersion.create({ data: { ...candidate, version: (last?.version ?? 0) + 1,
      snapshot: JSON.parse(JSON.stringify(candidate.snapshot)), approvedAt: new Date(candidate.approvedAt) } });
    await tx.auditLog.create({ data: { userId: actor.userId, action: "CREATE", entity: "EscalaBranchPolicyVersion", entityId: row.id,
      metadata: { tenantId: actor.tenantId, branchCode: row.branchCode, version: row.version } } });
    return { policy: { id: row.id, branchCode: row.branchCode, startDate: row.startDate, endDate: row.endDate,
      visibleMonth: row.visibleMonth, version: row.version, approvedAt: row.approvedAt.toISOString(), revokedAt: null,
      regimeModels: candidate.snapshot.regimeModels.map(model => ({ id: model.id, label: model.label })) } };
  }, { isolationLevel: "ReadCommitted", timeout: 15_000 }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new EscalaError(409, "ESCALA_STALE_REVISION", "Outra aprovação ocupou esta versão. Atualize antes de tentar novamente.");
    }
    throw error;
  });
}
