import type { Prisma } from "@/generated/prisma/client";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { JornadaHistoryTable } from "@/components/jornada-history-table";
import { prisma } from "@/lib/prisma";

export const metadata = {
  robots: { index: false, follow: false },
  title: "Histórico de Jornadas",
};

type HistoricoPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

export default async function HistoricoPage({
  searchParams,
}: HistoricoPageProps) {
  const session = await auth();

  if (
    session?.user.status !== "ACTIVE" ||
    session.user.role !== "ADMIN"
  ) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const status = getParam(params, "status") ?? "todos";
  const busca = (getParam(params, "q") ?? "").trim();

  const where: Prisma.JornadaValidationWhereInput = {};

  if (status === "validas") {
    where.valido = true;
  } else if (status === "invalidas") {
    where.valido = false;
  }

  if (busca) {
    where.OR = [
      { horariosNormalizado: { contains: busca, mode: "insensitive" } },
      { horariosOriginal: { contains: busca, mode: "insensitive" } },
      { codigo: { contains: busca, mode: "insensitive" } },
      { mensagem: { contains: busca, mode: "insensitive" } },
    ];
  }

  const [historico, totalFiltrado] = await Promise.all([
    prisma.jornadaValidation.findMany({
      where,
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.jornadaValidation.count({ where }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold app-text">Histórico</h1>
        <p className="mt-1 text-sm app-text-muted">
          Histórico global de validações.
        </p>
      </div>

      <form className="grid gap-3 app-radius-lg border app-border app-bg-card p-4 app-shadow md:grid-cols-[1fr_180px_auto]">
        <label className="block text-sm font-medium app-text">
          Busca
          <input
            name="q"
            defaultValue={busca}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
            placeholder="Horário, código ou mensagem"
          />
        </label>
        <label className="block text-sm font-medium app-text">
          Status
          <select
            name="status"
            defaultValue={status}
            className="mt-1 w-full app-radius-md border app-border px-3 py-2 text-sm outline-none app-focus-border"
          >
            <option value="todos">Todos</option>
            <option value="validas">Válidas</option>
            <option value="invalidas">Inválidas</option>
          </select>
        </label>
        <button
          type="submit"
          className="self-end app-radius-md app-action-fill px-4 py-2 text-sm font-medium text-white app-hover-action"
        >
          Filtrar
        </button>
      </form>

      <div className="text-sm app-text-muted">
        Exibindo {historico.length} de {totalFiltrado} registros filtrados.
      </div>

      <JornadaHistoryTable
        items={historico.map((item) => ({
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          horariosNormalizado: item.horariosNormalizado,
          mensagem: item.mensagem,
          valido: item.valido,
          codigo: item.codigo,
          user: item.user,
        }))}
      />
    </div>
  );
}
