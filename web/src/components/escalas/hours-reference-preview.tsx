"use client";

import { useMemo } from "react";
import type { EscalaInput } from "@/lib/escalas/types";
import { hoursProposalGroups } from "./hours-proposal";
import { panelClass } from "./controls";
import styles from "./escalas.module.css";

/** References are not daily attendance; no calendar cells or coverage claims are created. */
export function HoursReferencePreview({ input }: { input: EscalaInput }) {
  const groups = useMemo(() => hoursProposalGroups(input, input).filter(group => group.people.length), [input]);
  return <section className={panelClass} aria-labelledby="escala-hour-references-title">
    <h2 id="escala-hour-references-title" className={styles.sectionTitle}>Referências de horários</h2>
    <p className={styles.muted}>Horários propostos para conferir e exportar. Nenhum dia de trabalho ou folga foi criado; ainda não há cobertura diária calculada.</p>
    <ul className="space-y-3">
      {groups.map(group => <li key={group.key} className="min-w-0 break-words border-t border-[color:var(--app-border)] pt-3 text-sm">
        <h3 className="font-semibold">{group.sector || "Setor não informado"} · {group.role || "Cargo não informado"}</h3>
        <p><strong>Original importado:</strong> {group.original}</p>
        <p><strong>Referência proposta:</strong> {group.proposal.join("; ")}</p>
        <details><summary className={styles.disclosureTrigger}>{group.people.length} colaborador(es)</summary><ul>{group.people.map(person => <li key={person}>{person}</li>)}</ul></details>
      </li>)}
    </ul>
  </section>;
}
