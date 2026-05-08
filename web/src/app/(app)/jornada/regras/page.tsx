import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { JornadaRulesManager } from "@/components/jornada-rules-manager";
import type { JornadaRuleFormValues } from "@/lib/jornada/rule-schema";
import { prisma } from "@/lib/prisma";

const diasValidos = ["util", "sabado", "domingo", "feriado"] as const;

function normalizeDiasValidos(dias: string[]) {
  return dias.filter(
    (dia): dia is JornadaRuleFormValues["diasValidos"][number] =>
      diasValidos.includes(dia as (typeof diasValidos)[number]),
  );
}

export default async function RegrasPage() {
  const session = await auth();

  if (session?.user.role !== "ADMIN") {
    redirect("/dashboard");
  }

  const rules = await prisma.jornadaRule.findMany({
    orderBy: [{ active: "desc" }, { duracaoMinutos: "asc" }],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-950">Regras</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Jornadas usadas na validação manual.
        </p>
      </div>

      <JornadaRulesManager
        canManage
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
