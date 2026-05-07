import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { UsersManager } from "@/components/users-manager";
import { prisma } from "@/lib/prisma";

export default async function UsuariosPage() {
  const session = await auth();

  if (session?.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const [users, tenants, invitations] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        tenantId: true,
        tenant: { select: { id: true, name: true, slug: true } },
        email: true,
        name: true,
        role: true,
        isActive: true,
        canAccessJornada: true,
        canAccessFotos: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: 200,
    }),
    prisma.tenant.findMany({
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.userInvitation.findMany({
      include: { tenant: { select: { name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-950">Usuários</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Administração de acesso ao sistema.
        </p>
      </div>

      <UsersManager
        currentUserId={session.user.id}
        initialInvitations={invitations.map((invitation) => ({
          ...invitation,
          createdAt: invitation.createdAt.toISOString(),
          expiresAt: invitation.expiresAt.toISOString(),
          acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
        }))}
        initialTenants={tenants.map((tenant) => ({
          ...tenant,
          createdAt: tenant.createdAt.toISOString(),
          updatedAt: tenant.updatedAt.toISOString(),
        }))}
        initialUsers={users.map((user) => ({
          ...user,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
