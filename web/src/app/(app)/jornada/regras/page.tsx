import { JornadaRulesManager } from "@/components/jornada-rules-manager";
import type { JornadaRuleFormValues } from "@/lib/jornada/rule-schema";
import { requirePageModuleAccess } from "@/lib/modules/access";
import { prisma } from "@/lib/prisma";

const diasValidos = ["util", "sabado", "domingo", "feriado"] as const;

function normalizeDiasValidos(dias: string[]) {
  return dias.filter(
    (dia): dia is JornadaRuleFormValues["diasValidos"][number] =>
      diasValidos.includes(dia as (typeof diasValidos)[number]),
  );
}

export default async function RegrasPage() {
  const [session, rules] = await Promise.all([
    requirePageModuleAccess("jornada"),
    prisma.jornadaRule.findMany({
      orderBy: [{ active: "desc" }, { duracaoMinutos: "asc" }],
    }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-950">Regras</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Jornadas usadas na validação manual.
        </p>
      </div>

      <JornadaRulesManager
        canManage={session?.user.role === "ADMIN"}
        initialRules={rules.map((rule) => ({
          ...rule,
          diasValidos: normalizeDiasValidos(rule.diasValidos),
          createdAt: rule.createdAt.toISOString(),
          updatedAt: rule.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
