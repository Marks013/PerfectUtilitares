import { DashboardChart } from "@/components/dashboard-chart";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";

function formatDay(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export default async function DashboardPage() {
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);

  const [
    validacoes,
    validas,
    validacoesHoje,
    regras,
    codigos,
    fotosProcessadas,
    recentes,
  ] = await Promise.all([
    prisma.jornadaValidation.count(),
    prisma.jornadaValidation.count({ where: { valido: true } }),
    prisma.jornadaValidation.count({ where: { createdAt: { gte: inicioHoje } } }),
    prisma.jornadaRule.count({ where: { active: true } }),
    prisma.codigoJornada.count(),
    prisma.auditLog.count({
      where: {
        action: {
          in: ["PHOTO_3X4_PROCESSED", "PHOTO_3X4_BATCH_PROCESSED"],
        },
      },
    }),
    prisma.jornadaValidation.findMany({
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  const invalidas = validacoes - validas;
  const taxaValidasValor = validacoes
    ? Math.round((validas / validacoes) * 100)
    : 0;
  const taxaValidas = `${taxaValidasValor}%`;
  const buckets = new Map<string, { name: string; validas: number; invalidas: number }>();

  recentes.forEach((item) => {
    const key = formatDay(item.createdAt);
    const current = buckets.get(key) ?? { name: key, validas: 0, invalidas: 0 };
    if (item.valido) current.validas += 1;
    else current.invalidas += 1;
    buckets.set(key, current);
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-950">Dashboard</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Visão operacional das validações manuais.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Validações" value={validacoes} />
        <StatCard label="Válidas" value={validas} />
        <StatCard label="Inválidas" value={invalidas} />
        <StatCard
          label="Taxa válida"
          value={taxaValidas}
          progress={taxaValidasValor}
          tone={taxaValidasValor >= 70 ? "green" : "red"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Validações hoje" value={validacoesHoje} />
        <StatCard label="Códigos" value={codigos} />
        <StatCard label="Fotos processadas" value={fotosProcessadas} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <DashboardChart data={[...buckets.values()].reverse()} />
        <StatCard label="Regras ativas" value={regras} />
      </div>

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-neutral-600">
            <tr>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Horários</th>
              <th className="px-4 py-3">Resultado</th>
              <th className="px-4 py-3">Usuário</th>
            </tr>
          </thead>
          <tbody>
            {recentes.slice(0, 8).map((item) => (
              <tr key={item.id} className="border-t border-neutral-100">
                <td className="px-4 py-3">
                  {new Intl.DateTimeFormat("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(item.createdAt)}
                </td>
                <td className="px-4 py-3">{item.horariosNormalizado}</td>
                <td className="px-4 py-3">
                  <span
                    className={item.valido ? "text-green-700" : "text-red-700"}
                  >
                    {item.mensagem}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {item.user?.name ?? item.user?.email ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
