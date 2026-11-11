"use client";
import type { EscalaEmployee, EscalaInput } from "@/lib/escalas/types";
import { currentLeadership } from "@/lib/escalas/leadership";
import { compareSectors } from "@/lib/escalas/order";
import { buttonClass, Check, controlClass, Field } from "./controls";

export function LeadershipFields({ employee, input, onChange }: {
  employee: EscalaEmployee; input: EscalaInput; onChange: (value: EscalaEmployee["leadership"]) => void;
}) {
  const value = currentLeadership(employee) ?? { role: "NONE" as const, source: "INFERRED" as const, sectors: [] };
  const sectors = [...new Set([...input.employees.map(person => person.sector), employee.sector, ...value.sectors])].filter(Boolean).sort(compareSectors);
  return <details className="space-y-3 border-t border-[color:var(--app-border)] pt-3">
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Responsabilidade na equipe (opcional)</summary>
    <p className="text-sm text-[color:var(--app-muted)]">Ajuda a distribuir a presença dos responsáveis nos dias de maior movimento. Não substitui colaboradores de outro setor nem cria cobertura de horário.</p>
    <Field label="Papel na operação" hint={value.source === "MANUAL" ? "Escolha ajustada manualmente." : "Referência sugerida pelo cargo; você pode corrigir."}>
      {id => <select id={id} className={controlClass} value={value.role} onChange={event => {
        const role = event.target.value as NonNullable<EscalaEmployee["leadership"]>["role"];
        onChange({ role, source: "MANUAL", sectors: role === "SECTOR" && employee.sector ? [employee.sector] : [] });
      }}>
        <option value="NONE">Sem responsabilidade de liderança</option>
        <option value="SECTOR">Encarregado de setor</option>
        <option value="BRANCH">Gerente da filial</option>
      </select>}
    </Field>
    {value.role !== "NONE" && <fieldset className="min-w-0 space-y-1">
      <legend className="text-sm font-semibold">Setores sob responsabilidade</legend>
      <p className="text-xs text-[color:var(--app-muted)]">Marque somente a responsabilidade real. Gerente da filial não substitui automaticamente um encarregado.</p>
      <div className="flex max-h-44 flex-wrap gap-x-4 overflow-y-auto">
        {sectors.map(sector => <Check key={sector} label={sector} checked={value.sectors.includes(sector)} onChange={checked => onChange({ ...value, source: "MANUAL",
          sectors: checked ? [...new Set([...value.sectors, sector])] : value.sectors.filter(item => item !== sector) })} />)}
      </div>
    </fieldset>}
    {employee.leadership?.source === "MANUAL" && <button type="button" className={buttonClass} onClick={() => onChange(undefined)}>Usar sugestão do cargo</button>}
  </details>;
}
