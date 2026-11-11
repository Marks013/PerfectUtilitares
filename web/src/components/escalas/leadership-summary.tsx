import type { EscalaSolveResult } from "@/lib/escalas/types";

export function LeadershipSummary({ counts }: { counts: NonNullable<EscalaSolveResult["optimization"]>["leadership"] }) {
  if (!counts?.prioritizedSectorDays) return null;
  const present = counts.prioritizedSectorDays - counts.prioritizedSectorDaysWithoutLeader;
  return <section aria-label="Presença dos responsáveis" className="space-y-1 rounded-lg border border-[color:var(--app-border)] p-3 text-sm">
    <h3 className="font-semibold">Presença dos responsáveis</h3>
    <p>{present} de {counts.prioritizedSectorDays} presenças planejadas nos setores e dias priorizados.</p>
    {counts.criticalSectorDaysWithoutLeader > 0 && <p>{counts.criticalSectorDaysWithoutLeader} setor(es)/dia de maior movimento sem responsável planejado. Confira a equipe e suas disponibilidades.</p>}
    <p className="text-xs text-[color:var(--app-muted)]">Cada setor é contado uma vez por dia. Isso não acrescenta colaboradores nem cobertura por horário.</p>
  </section>;
}
