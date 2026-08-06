import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const adminUserSelect = {
  id: true,
  tenantId: true,
  tenant: { select: { id: true, name: true, slug: true } },
  email: true,
  name: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type AdminUserUpdateData = {
  email?: string;
  tenantId?: string;
  name?: string;
  role?: "ADMIN" | "OPERATOR";
  status?: "ACTIVE" | "BLOCKED" | "BANNED";
};

type UpdateAdminUserInput = {
  targetUserId: string;
  actorUserId: string;
  data: AdminUserUpdateData;
};

export type UpdateAdminUserResult =
  | {
      ok: true;
      user: Prisma.UserGetPayload<{ select: typeof adminUserSelect }>;
    }
  | { ok: false; reason: "USER_NOT_FOUND" | "LAST_ACTIVE_ADMIN" };

type DeleteAccountInput = {
  targetUserId: string;
  actorUserId: string;
  action: "DELETE" | "SELF_DELETE";
};

type DeletedUser = {
  id: string;
  email: string;
  tenantId: string | null;
  role: "ADMIN" | "OPERATOR";
  status: "ACTIVE" | "BLOCKED" | "BANNED";
};

export type DeleteAccountResult =
  | { ok: true; user: DeletedUser; pdfJobIds: string[] }
  | { ok: false; reason: "USER_NOT_FOUND" | "LAST_ACTIVE_ADMIN" };

async function lockActiveAdminInvariant(
  transaction: Prisma.TransactionClient,
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(
      hashtext('perfectutilitares:active-admin-mutation')
    )
  `;
}

export async function updateUserWithAdminInvariant({
  targetUserId,
  actorUserId,
  data,
}: UpdateAdminUserInput): Promise<UpdateAdminUserResult> {
  return prisma.$transaction(
    async (transaction) => {
      await lockActiveAdminInvariant(transaction);

      const currentUser = await transaction.user.findUnique({
        where: { id: targetUserId },
        select: { id: true, role: true, status: true },
      });
      if (!currentUser) {
        return { ok: false, reason: "USER_NOT_FOUND" } as const;
      }

      const removesActiveAdmin =
        currentUser.role === "ADMIN" &&
        currentUser.status === "ACTIVE" &&
        (data.role === "OPERATOR" ||
          data.status === "BLOCKED" ||
          data.status === "BANNED");

      if (removesActiveAdmin) {
        const activeAdminCount = await transaction.user.count({
          where: { role: "ADMIN", status: "ACTIVE" },
        });
        if (activeAdminCount <= 1) {
          return { ok: false, reason: "LAST_ACTIVE_ADMIN" } as const;
        }
      }

      const user = await transaction.user.update({
        where: { id: targetUserId },
        data,
        select: adminUserSelect,
      });

      await transaction.auditLog.create({
        data: {
          userId: actorUserId,
          action: "UPDATE",
          entity: "User",
          entityId: user.id,
          metadata: {
            email: user.email,
            tenantId: user.tenantId,
            role: user.role,
            status: user.status,
          },
        },
      });

      return { ok: true, user } as const;
    },
    { isolationLevel: "ReadCommitted" },
  );
}

export async function deleteAccountWithAdminInvariant({
  targetUserId,
  actorUserId,
  action,
}: DeleteAccountInput): Promise<DeleteAccountResult> {
  return prisma.$transaction(
    async (transaction) => {
      await lockActiveAdminInvariant(transaction);

      const user = await transaction.user.findUnique({
        where: { id: targetUserId },
        select: {
          id: true,
          email: true,
          tenantId: true,
          role: true,
          status: true,
        },
      });
      if (!user) {
        return { ok: false, reason: "USER_NOT_FOUND" } as const;
      }

      if (user.role === "ADMIN" && user.status === "ACTIVE") {
        const activeAdminCount = await transaction.user.count({
          where: { role: "ADMIN", status: "ACTIVE" },
        });
        if (activeAdminCount <= 1) {
          return { ok: false, reason: "LAST_ACTIVE_ADMIN" } as const;
        }
      }

      const pdfJobs = await transaction.pdfJob.findMany({
        where: { userId: targetUserId },
        select: { id: true },
      });

      await transaction.auditLog.create({
        data: {
          userId: actorUserId,
          action,
          entity: "User",
          entityId: user.id,
          metadata: {
            email: user.email,
            tenantId: user.tenantId,
            role: user.role,
            status: user.status,
          },
        },
      });
      await transaction.user.delete({ where: { id: targetUserId } });

      return {
        ok: true,
        user,
        pdfJobIds: pdfJobs.map((job) => job.id),
      } as const;
    },
    { isolationLevel: "ReadCommitted" },
  );
}
