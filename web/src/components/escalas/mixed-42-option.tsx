"use client";

import { useId } from "react";
import { legalWeeklyHours } from "@/lib/escalas/labor-rules";
import type { EscalaInput } from "@/lib/escalas/types";
import { buttonClass, Check, panelClass } from "./controls";
import styles from "./escalas.module.css";
import { addDate, changeMixed42Sectors, datesBetween, mixed42EligibleSectors } from "./workspace-model";

const suggestedSectorNames = new Set(["frente de caixa", "acougue", "balcao"]);
function isSuggestedSector(sector: string) {
  return suggestedSectorNames.has(sector.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase());
}

export function Mixed42Option({ input, disabled, onChange }: {
  input: EscalaInput; disabled: boolean; onChange: (input: EscalaInput) => void;
}) {
  const hint = useId();
  if (input.defaultWeeklyHours !== 42) return null;
  const sectors = mixed42EligibleSectors(input);
  const selected = input.mixed42Sectors ?? [];
  const has42Week = datesBetween(input.startDate, input.endDate).some((day, index) => index % 7 === 0 && legalWeeklyHours(addDate(day, 6)) >= 42);
  const suggestions = sectors.filter(isSuggestedSector);
  const count = sectors.filter((sector) => selected.includes(sector)).length;
  return <details className={panelClass}>
    <summary className={styles.disclosureTrigger}>Jornada mista de 42h (opcional){count > 0 && " · setores selecionados: " + count}</summary>
    <p id={hint} className={styles.muted}>Nas semanas efetivas de 42h, os setores selecionados terão 3 dias de 8h e 2 dias de 9h. Nos dias de 9h, o intervalo fixo não trabalhado é de 3h. Sem seleção, o modelo de 42h continua uniforme, com 8h24 por dia.</p>
    <p className={styles.muted}>Uso em simulação. Selecionar um setor não confirma autorização para aplicar essa jornada na operação.</p>
    {sectors.length > 0 ? <fieldset disabled={disabled} aria-describedby={hint} className={styles.stackSmall}>
      <legend className={styles.fieldLabel}>Setores que usarão jornada mista</legend>
      {suggestions.length > 0 && <p className={styles.muted}>Sugestões da sua equipe: {suggestions.join(", ")}. Nenhum setor é marcado automaticamente.</p>}
      <div className={styles.formGrid}>{sectors.map((sector) => <Check key={sector} label={sector} checked={selected.includes(sector)} disabled={disabled} onChange={(checked) => onChange(changeMixed42Sectors(input, checked ? [...selected, sector] : selected.filter((value) => value !== sector)))} />)}</div>
    </fieldset> : <p className={styles.muted}>{has42Week ? "Nenhum setor com jornada de 42h e horário informado nesta equipe." : "O período não tem semanas de 42h para simular essa distribuição."}</p>}
    {selected.length > 0 && <div className={styles.actions}><button type="button" className={buttonClass} disabled={disabled} onClick={() => onChange(changeMixed42Sectors(input, []))}>Limpar seleção de setores</button></div>}
  </details>;
}
