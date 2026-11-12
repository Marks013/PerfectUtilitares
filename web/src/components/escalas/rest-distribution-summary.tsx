"use client";

import { useMemo } from "react";
import { restPairSummary } from "@/lib/escalas/rest-quality";
import { sortEmployees } from "@/lib/escalas/order";
import type { EscalaInput } from "@/lib/escalas/types";
import styles from "./escalas.module.css";

export type RestDistributionSearch = { attempted: boolean; retainedReference: boolean };

/** Derived from the displayed grade; saved revisions do not acquire an invented search history. */
export function RestDistributionSummary({ input, previousInput, search }: {
  input: EscalaInput; previousInput?: EscalaInput; search?: RestDistributionSearch;
}) {
  const summary = useMemo(() => restPairSummary(input), [input]);
  const previous = useMemo(() => previousInput ? restPairSummary(previousInput) : undefined, [previousInput]);
  const aboveTarget = useMemo(() => {
    const counts = new Map(summary.people.filter(person => person.correctableExcess > 0).map(person => [person.employeeId, person]));
    return sortEmployees(input.employees.filter(person => person.planningEnabled !== false && counts.has(person.id)))
      .map(person => ({ person, counts: counts.get(person.id) }));
  }, [input.employees, summary]);
  if (!input.assignments.length) return null;
  return <section aria-label="Distribuição das folgas" className="min-w-0 space-y-3 rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3 text-sm">
    <div className="space-y-1">
      <h3 className="font-semibold">Distribuição das folgas</h3>
      <p className={styles.muted}>Preferência: até {summary.targetMonthlyPairs} pares por pessoa no mês. Dois dias seguidos contam como um par; não é uma quantidade a preencher.</p>
    </div>
    <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
      <div><dt className={styles.muted}>Pares no período exibido</dt><dd className="font-semibold tabular-nums">{previous ? `${previous.totalPairs} antes · ${summary.totalPairs} agora` : summary.totalPairs}</dd></div>
      <div><dt className={styles.muted}>Pessoas com excesso para revisar</dt><dd className="font-semibold tabular-nums">{aboveTarget.length}</dd></div>
      <div><dt className={styles.muted}>Pares com dias editáveis</dt><dd className="tabular-nums">{summary.adjustablePairs}</dd></div>
      <div><dt className={styles.muted}>Pares preservados por bloqueios ou escolhas</dt><dd className="tabular-nums">{summary.imposedPairs}</dd></div>
    </dl>
    {search?.retainedReference ? <p>A grade de referência foi preservada porque a nova distribuição não passou nas proteções.</p>
      : search && !search.attempted ? <p>A etapa de redistribuição não foi executada no prazo disponível. Os pares restantes ainda podem ser revistos.</p>
      : search?.attempted && aboveTarget.length > 0 ? <p>Não foi encontrada uma troca segura para todo o excesso no prazo disponível. Isso não comprova que todos os pares sejam inevitáveis.</p>
      : !search ? <p className={styles.muted}>Contagem da grade exibida, sem alterar as folgas salvas.</p> : null}
    {aboveTarget.length > 0 && <details>
      <summary className={styles.disclosureTrigger}>Conferir quem passou da meta</summary>
      <ul className="mt-2 space-y-2">
        {aboveTarget.map(({ person, counts }) => <li key={person.id} className="min-w-0 break-words">
          <strong>{person.registration} · {person.name}</strong><span className="block">{person.sector || "Setor não informado"} · {counts?.totalPairs} pares, sendo {counts?.imposedPairs} preservados por bloqueios ou escolhas.</span>
        </li>)}
      </ul>
    </details>}
  </section>;
}
