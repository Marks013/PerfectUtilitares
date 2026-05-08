import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { JornadaHistoryTable } from "@/components/jornada-history-table";
import { prisma } from "@/lib/prisma";

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

  if (session?.user.role !== "ADMIN") {
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
        <h1 className="text-2xl font-semibold text-neutral-950">Histórico</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Histórico global de validações. Apenas administradores podem acessar.
        </p>
      </div>

      <form className="grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_180px_auto]">
        <label className="block text-sm font-medium text-neutral-800">
          Busca
          <input
            name="q"
            defaultValue={busca}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
            placeholder="Horário, código ou mensagem"
          />
        </label>
        <label className="block text-sm font-medium text-neutral-800">
          Status
          <select
            name="status"
            defaultValue={status}
            className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-950"
          >
            <option value="todos">Todos</option>
            <option value="validas">Válidas</option>
            <option value="invalidas">Inválidas</option>
          </select>
        </label>
        <button className="self-end rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          Filtrar
        </button>
      </form>

      <div className="text-sm text-neutral-600">
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
