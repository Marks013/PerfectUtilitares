import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lockEscalaAccess, requireEscalaCapability, type EscalaActor } from "./access";
import { parseEscalaOperatorAdminCommand } from "./operator-admin-input";
import { EscalaError } from "./errors";

const modeCommand = z.strictObject({ action: z.literal("SET_ACCESS_MODE"), mode: z.enum(["ADMIN_ONLY", "SCOPED"]),
  expectedVersion: z.number().int().min(0).max(2_147_483_646) });
const conflict = () => new EscalaError(409, "ESCALA_STALE_REVISION", "O cadastro mudou. Atualize antes de salvar.");

export async function listEscalaOperators(actor: EscalaActor) {
  await requireEscalaCapability(actor, "access.manage");
  const [policy, operators] = await Promise.all([
    prisma.escalaModuleAccessPolicy.findUnique({ where: { tenantId: actor.tenantId } }),
    prisma.escalaOperator.findMany({ where: { tenantId: actor.tenantId }, orderBy: { usernameNormalized: "asc" },
      select: { id: true, usernameNormalized: true, displayName: true, active: true, permissionVersion: true,
        branchGrants: { select: { branchCode: true, active: true, capabilities: true } } } }),
  ]);
  return { policy: { mode: policy?.mode ?? "ADMIN_ONLY", version: policy?.version ?? 0 },
    operators: operators.map(({ usernameNormalized, ...operator }) => ({ ...operator, username: usernameNormalized })) };
}

export async function administerEscalaOperators(actor: EscalaActor, value: unknown) {
  const mode = modeCommand.safeParse(value);
  const parsed = parseEscalaOperatorAdminCommand(value);
  if (!mode.success && !parsed.ok) throw new EscalaError(400, "INVALID_OPERATOR_COMMAND", "Comando de administração inválido.");
  await prisma.$transaction(async tx => {
    await lockEscalaAccess(tx, actor.tenantId);
    await requireEscalaCapability(actor, "access.manage", undefined, tx);
    const now = new Date();
    if (mode.success) {
      const policy = await tx.escalaModuleAccessPolicy.findUnique({ where: { tenantId: actor.tenantId } });
      if ((policy?.version ?? 0) !== mode.data.expectedVersion) throw conflict();
      if (policy) await tx.escalaModuleAccessPolicy.update({ where: { tenantId: actor.tenantId },
        data: { mode: mode.data.mode, version: { increment: 1 } } });
      else await tx.escalaModuleAccessPolicy.create({ data: { tenantId: actor.tenantId, mode: mode.data.mode, version: 1 } });
      await tx.escalaModuleSession.updateMany({ where: { tenantId: actor.tenantId, revokedAt: null }, data: { revokedAt: now } });
    } else if (parsed.ok) {
      const command = parsed.command;
      if ("branchGrants" in command) for (const grant of command.branchGrants) {
        const [workspace, approved] = await Promise.all([
          tx.escalaWorkspace.count({ where: { tenantId: actor.tenantId, branchCode: grant.branchCode } }),
          tx.escalaBranchPolicyVersion.count({ where: { tenantId: actor.tenantId, branchCode: grant.branchCode, revokedAt: null } }),
        ]);
        if (!workspace && !approved) throw new EscalaError(422, "ESCALA_BRANCH_FORBIDDEN", "A filial não possui referência administrativa cadastrada.");
      }
      if (command.action === "CREATE_OPERATOR") {
        await tx.escalaOperator.create({ data: { tenantId: actor.tenantId,
          usernameNormalized: command.usernameNormalized, displayName: command.displayName, active: command.active,
          branchGrants: { create: command.branchGrants.map(grant => ({ ...grant, tenantId: actor.tenantId })) } } });
      } else {
        const operator = await tx.escalaOperator.findUnique({ where: { tenantId_id: { tenantId: actor.tenantId, id: command.operatorId } } });
        if (!operator) throw new EscalaError(404, "ESCALA_OPERATOR_NOT_FOUND", "Cadastro não encontrado.");
        if (operator.permissionVersion !== command.expectedPermissionVersion || operator.permissionVersion >= 2_147_483_647) throw conflict();
        const update = await tx.escalaOperator.updateMany({ where: { tenantId: actor.tenantId, id: operator.id,
          permissionVersion: command.expectedPermissionVersion }, data: { permissionVersion: { increment: 1 },
          ...(command.action === "UPDATE_OPERATOR" ? { usernameNormalized: command.usernameNormalized,
            displayName: command.displayName, active: command.active } : {}) } });
        if (update.count !== 1) throw conflict();
        if (command.action === "REPLACE_BRANCH_GRANTS") {
          await tx.escalaOperatorBranchGrant.deleteMany({ where: { tenantId: actor.tenantId, operatorId: operator.id } });
          if (command.branchGrants.length) await tx.escalaOperatorBranchGrant.createMany({
            data: command.branchGrants.map(grant => ({ ...grant, tenantId: actor.tenantId, operatorId: operator.id })) });
        }
        await tx.escalaModuleSession.updateMany({ where: { tenantId: actor.tenantId, operatorId: operator.id, revokedAt: null }, data: { revokedAt: now } });
      }
    }
    await tx.auditLog.create({ data: { userId: actor.userId, action: "UPDATE", entity: "EscalaModuleAccessPolicy",
      entityId: actor.tenantId, metadata: { tenantId: actor.tenantId, command: mode.success ? mode.data.action : parsed.ok ? parsed.command.action : "INVALID" } } });
  }, { isolationLevel: "ReadCommitted", timeout: 15_000 }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new EscalaError(409, "ESCALA_OPERATOR_EXISTS", "Já existe um cadastro com esse nome nesta empresa.");
    }
    throw error;
  });
  return listEscalaOperators(actor);
}
