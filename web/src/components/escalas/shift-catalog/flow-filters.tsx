import type { TurnoCatalogEntryDto } from "@/lib/escalas/shift-catalog/contracts";
import type { TurnoFlowFilters } from "@/lib/escalas/shift-catalog/flow-contracts";
import { buttonClass, controlClass, Field } from "../controls";
import styles from "../escalas.module.css";
import local from "./flow.module.css";
import { personKey, sectorKey, type FlowPerson } from "./flow-model";

function Group<T>({ label, options, values, getKey, getLabel, onChange, disabled }: {
  label: string; options: readonly T[]; values: readonly T[]; getKey: (item: T) => string; getLabel: (item: T) => string; onChange: (items: T[]) => void; disabled: boolean;
}) {
  const keys = new Set(values.map(getKey));
  const [search, setSearch] = useState(""), [limit, setLimit] = useState(100);
  const matching = options.filter(item => getLabel(item).toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")));
  return <details className={local.filter}>
    <summary className={styles.disclosureTrigger}>{label} · {values.length ? `${values.length} ${values.length === 1 ? "opção marcada" : "opções marcadas"}` : "todas as opções"}</summary>
    <fieldset disabled={disabled} className={local.filterOptions}><legend className="sr-only">{label}</legend>
      <Field label={`Buscar opções de ${label.toLocaleLowerCase("pt-BR")}`} hint="A busca localiza opções; não muda os filtros já marcados.">{id => <input id={id} type="search" className={controlClass} value={search} onChange={event => { setSearch(event.target.value); setLimit(100); }} />}</Field>
      <p className={styles.muted}>{Math.min(limit, matching.length)} de {matching.length} opções encontradas.</p>
      {!matching.length && <p className={styles.muted}>Nenhuma opção disponível.</p>}
      {matching.slice(0, limit).map(item => <label key={getKey(item)} className={styles.check}><input className={styles.checkInput} type="checkbox" checked={keys.has(getKey(item))} onChange={event => onChange(event.target.checked ? [...values, item] : values.filter(value => getKey(value) !== getKey(item)))} /><span>{getLabel(item)}</span></label>)}
      {matching.length > limit && <button type="button" className={buttonClass} onClick={() => setLimit(value => value + 100)}>Mostrar mais opções de {label.toLocaleLowerCase("pt-BR")}</button>}
    </fieldset>
  </details>;
}

export function FlowFilters({ people, entries, filters, relational, disabled, onChange }: {
  people: readonly FlowPerson[]; entries: readonly TurnoCatalogEntryDto[]; filters: TurnoFlowFilters; relational: boolean; disabled: boolean; onChange: (filters: TurnoFlowFilters) => void;
}) {
  const branches = [...new Set(people.map(person => person.branchCode))];
  const sectors = [...new Map(people.map(person => [sectorKey({ workspaceId: person.workspaceId, value: person.sector }), { workspaceId: person.workspaceId, value: person.sector }])).values()];
  const registrations = [...new Set(people.map(person => person.registration))].sort();
  const keys = people.map(({ workspaceId, employeeId }) => ({ workspaceId, employeeId }));
  return <div className={styles.stackSmall}>
    <p className={styles.muted}>Use os filtros para encontrar os itens. Sem marcar uma opção, o filtro considera todos os itens permitidos. Depois, marque na lista o que vai para o arquivo.</p>
    {!relational && <p className={styles.muted}>Para filtrar por filial, colaborador, setor ou matrícula, escolha “Em uso nos planejamentos escolhidos” e consulte a lista.</p>}
    <div className={local.filters}>
      <Group label="Filial" options={branches} values={filters.branchCodes} getKey={item => item} getLabel={item => `Filial ${item}`} disabled={disabled || !relational} onChange={branchCodes => onChange({ ...filters, branchCodes })} />
      <Group label="Colaborador" options={keys} values={filters.employeeKeys} getKey={personKey} getLabel={item => { const person = people.find(row => row.key === personKey(item)); return person ? `${person.branchCode} · ${person.registration || "sem matrícula"} · ${person.name}` : "Pessoa indisponível"; }} disabled={disabled || !relational} onChange={employeeKeys => onChange({ ...filters, employeeKeys })} />
      <Group label="Setor" options={sectors} values={filters.sectors} getKey={sectorKey} getLabel={item => `${people.find(person => person.workspaceId === item.workspaceId)?.branchCode ?? ""} · ${item.value || "Sem setor informado"}`} disabled={disabled || !relational} onChange={sectors => onChange({ ...filters, sectors })} />
      <Group label="Turno" options={entries.map(entry => entry.code)} values={filters.catalogCodes} getKey={String} getLabel={code => `${code} · ${entries.find(item => item.code === code)?.markings.join(" / ") ?? ""}`} disabled={disabled} onChange={catalogCodes => onChange({ ...filters, catalogCodes })} />
      <Group label="Matrícula" options={registrations} values={filters.registrations} getKey={item => item} getLabel={item => item || "Não informada"} disabled={disabled || !relational} onChange={registrations => onChange({ ...filters, registrations })} />
    </div>
    <button type="button" className={buttonClass} disabled={disabled} onClick={() => onChange({ branchCodes: [], employeeKeys: [], sectors: [], catalogCodes: [], registrations: [] })}>Limpar filtros</button>
    <details><summary className={styles.disclosureTrigger}>Como combinar os filtros</summary>
      <p className={styles.muted}>Você pode marcar mais de uma opção: ao escolher dois setores, por exemplo, aparecem pessoas de qualquer um deles. Ao marcar também uma filial ou um colaborador, os resultados precisam atender a essas escolhas na mesma pessoa.</p>
      <p className={styles.muted}>A busca dentro de um filtro apenas encontra opções. Os itens marcados para o arquivo ficam na lista abaixo. Se mudar os filtros, os itens que não correspondem mais serão retirados da seleção; confira os marcados antes de preparar o arquivo.</p>
    </details>
  </div>;
}
import { useState } from "react";
