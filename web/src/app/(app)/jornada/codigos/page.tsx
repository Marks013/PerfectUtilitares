import { CodigoJornadaManager } from "@/components/codigo-jornada-manager";
import { requirePageModuleAccess } from "@/lib/modules/access";
import { prisma } from "@/lib/prisma";

export default async function CodigosPage() {
  const [session, codigos] = await Promise.all([
    requirePageModuleAccess("jornada"),
    prisma.codigoJornada.findMany({
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-950">Códigos</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Banco de códigos de horários.
        </p>
      </div>

      <CodigoJornadaManager
        canManage={session?.user.role === "ADMIN"}
        initialCodigos={codigos.map((codigo) => ({
          ...codigo,
          createdAt: codigo.createdAt.toISOString(),
          updatedAt: codigo.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
