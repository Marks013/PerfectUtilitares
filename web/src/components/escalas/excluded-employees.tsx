"use client";

import { exclusionPresentation } from "@/lib/escalas/presentation";
import type { EscalaEmployee } from "@/lib/escalas/types";
import { buttonClass } from "./controls";
import styles from "./escalas.module.css";

export function ExcludedEmployees({ employees, disabled, onEdit, onRemove }: {
  employees: EscalaEmployee[]; disabled: boolean;
  onEdit: (employee: EscalaEmployee) => void; onRemove: (employee: EscalaEmployee) => void;
}) {
  if (!employees.length) return null;
  return <details className={styles.excludedList}>
    <summary className={styles.disclosureTrigger}>Não incluídos no planejamento ({employees.length})</summary>
    <p className={styles.muted}>Relação separada da escala gráfica. Estas pessoas não entram na disponibilidade nem na cobertura. Os cadastros foram preservados.</p>
    <ul className={styles.teamList}>
      {employees.map((employee) => {
        const exclusion = exclusionPresentation(employee);
        return <li key={employee.id} className={styles.teamRow}>
          <div className={styles.teamIdentity}><strong>{employee.registration} · {employee.name}</strong><span>{employee.sector} / {employee.role}</span><span className={styles.statusTag}>X · fora do planejamento</span></div>
          <div className={styles.exclusionReason}><p><strong>Motivo:</strong> {exclusion.reason}</p><p><strong>Como revisar:</strong> {exclusion.guidance}</p></div>
          {employee.sourceSchedule && <details><summary className={styles.disclosureTrigger}>Referência FPRE136 original</summary><p className={styles.muted}>{employee.sourceSchedule.code} · {employee.sourceSchedule.description}. Dias úteis: {employee.sourceSchedule.weekday || "não informado"}. Sábado: {employee.sourceSchedule.saturday || "não informado"}.</p></details>}
          <div className={styles.actions}><button type="button" className={buttonClass} disabled={disabled} onClick={() => onEdit(employee)}>Revisar cadastro<span className="sr-only"> de {employee.name}</span></button><button type="button" className={buttonClass} disabled={disabled} onClick={() => onRemove(employee)}>Remover da proposta<span className="sr-only"> {employee.name}</span></button></div>
        </li>;
      })}
    </ul>
  </details>;
}
