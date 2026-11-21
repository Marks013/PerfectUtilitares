"use client";

import type { WorkspaceSummary } from "../use-escalas-workspace";
import { planPeriod } from "../plan-selector";
import { useEscalaClientAccess } from "../access-context";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "../controls";
import styles from "../escalas.module.css";
import local from "./flow.module.css";
import { CatalogScope } from "./use-catalog-task";
import { FlowFilters } from "./flow-filters";
import { omissionLabels } from "./flow-model";
import { EXPORT_PAGE_SIZE, useExportFlow } from "./use-export-flow";
import { ExportPreview } from "./export-preview";

export function TurnoExport(props: { plans: WorkspaceSummary[]; disabled: boolean }) {
  const access = useEscalaClientAccess();
  const administrator = access?.channel === "ACCOUNT" && access.administrator && access.allBranches;
  const sourceScope = JSON.stringify(props.plans.map(plan => [plan.id, plan.revision]).sort());
  return <CatalogScope allowed={administrator}><ExportSession key={sourceScope} {...props} /></CatalogScope>;
}

function ExportSession({ plans, disabled }: { plans: WorkspaceSummary[]; disabled: boolean }) {
  const access = useEscalaClientAccess();
  const canDefine = access?.channel === "ACCOUNT" && access.administrator && access.allBranches;
  const f = useExportFlow(plans, disabled, canDefine);
  const missingReferences = f.manifest?.omissions.filter(item => item.reason === "CATALOG_REQUIRED") ?? [];
  const canSync = canDefine && missingReferences.length > 0 && missingReferences.every(
    item => f.loaded.some(source => source.id === item.workspaceId && source.canEdit),
  );
  return <details className={panelClass}>
    <summary className={styles.disclosureTrigger}>Turnos e arquivos de integração</summary>
    {f.task.error && <div ref={f.task.errorRef} role="alert" tabIndex={-1} aria-label="Problemas na exportação de turnos" className={`${styles.errorText} ${styles.feedbackFocus}`}><p><strong>Confira a exportação de turnos</strong></p><p>{f.task.error}</p></div>}
    <p className={local.scopeNote}>Exporte os turnos cadastrados ou os horários dos colaboradores. Consulte a lista e escolha os itens que vão para o arquivo.</p>
    <div className={styles.formGrid}>
      <Field label="O que deseja exportar?">{id => <select id={id} className={controlClass} value={f.mode} disabled={disabled} onChange={event => f.setMode(event.target.value === "EMPLOYEES" ? "EMPLOYEES" : "CATALOG")}><option value="CATALOG">Turnos cadastrados</option><option value="EMPLOYEES">Turnos por colaborador</option></select>}</Field>
      {f.mode === "CATALOG" && <Field label="Quais turnos incluir?">{id => <select id={id} className={controlClass} value={f.scope} disabled={disabled} onChange={event => f.setScope(event.target.value === "USED" ? "USED" : "ALL")}><option value="ALL">Todo o catálogo da empresa</option><option value="USED">Em uso nos planejamentos escolhidos</option></select>}</Field>}
      <Field label={f.relational ? "Mês dos planejamentos" : "Mês de referência do arquivo"}>{id => <><input id={id} ref={f.periodRef} className={controlClass} type="month" min="2026-01" max="9999-12" value={f.period} disabled={disabled} aria-invalid={Boolean(f.periodError)} aria-describedby={f.periodError ? `${id}-error` : undefined} onChange={event => f.setPeriod(event.target.value)} />{f.periodError && <span id={`${id}-error`} className={styles.errorText}>{f.periodError}</span>}</>}</Field>
    </div>
    {f.relational && <fieldset disabled={disabled} className={styles.stackSmall}><legend>Escolha um planejamento salvo de cada filial que deseja incluir</legend>
      {!f.groups.length && <p>Nenhum planejamento disponível neste mês.</p>}
      {f.groups.map(branch => <Field key={branch} label={`Planejamento da filial ${branch}`}>{id => <select id={id} className={controlClass} value={f.sources[branch] ?? ""} onChange={event => f.setSource(branch, event.target.value)}><option value="">Não incluir esta filial</option>{f.summaries.filter(plan => planPeriod(plan).branch === branch).map(plan => <option key={plan.id} value={plan.id}>Filial {branch} · {plan.input.branchName} · revisão {plan.revision} · {plan.status === "PUBLISHED" ? "publicado" : "rascunho"}</option>)}</select>}</Field>)}
      {f.selectedPlans.length > 50 && <p role="alert" className={styles.errorText}>Escolha até 50 planejamentos, um por filial.</p>}
    </fieldset>}
    <button type="button" className={buttonClass} disabled={disabled || Boolean(f.task.busy) || f.relational && (!f.selectedPlans.length || f.selectedPlans.length > 50)} onClick={() => void f.consult()}>{f.complete ? "Atualizar lista de itens" : "Consultar itens"}</button>
    <details><summary className={styles.disclosureTrigger}>Sobre o catálogo e os horários dos planejamentos</summary>
      <p className={styles.muted}>O catálogo reúne os turnos da empresa. Os filtros de filial, colaborador, setor e matrícula mostram onde esses horários aparecem nos planejamentos escolhidos; o código não pertence a uma filial.</p>
      <p className={styles.muted}>Um planejamento pode ter apenas horários de referência, sem dias de trabalho montados. Incluir esses horários no arquivo não comprova presença em um dia.</p>
      <p className={styles.muted}>Consultar ou atualizar a lista não cadastra turnos. Criar ou editar definições e configurar jornadas de 8h/9h continua sendo uma ação administrativa, feita nos controles próprios.</p>
    </details>
    {f.complete && <>
      {f.loaded.length > 0 && <p className={styles.muted}>Planejamentos conferidos: {f.loaded.map(item => `filial ${planPeriod(item).branch}, revisão ${item.revision}`).join("; ")}.</p>}
      <FlowFilters people={f.people} entries={f.entries} filters={f.filters} relational={f.relational} disabled={disabled} onChange={f.changeFilters} />
      <p role="status">{f.keys.length} {f.mode === "CATALOG" ? f.keys.length === 1 ? "turno encontrado" : "turnos encontrados" : f.keys.length === 1 ? "pessoa encontrada" : "pessoas encontradas"} · {f.selected.length} {f.selected.length === 1 ? "selecionado" : "selecionados"} para conferir.</p>
      <div className={local.selection}>
        <button type="button" className={buttonClass} disabled={disabled || !f.visibleKeys.length} onClick={() => f.changeSelected([...new Set([...f.selected, ...f.visibleKeys])])}>Selecionar esta página ({f.visibleKeys.length})</button>
        <button type="button" className={buttonClass} disabled={disabled || !f.keys.length} onClick={() => f.changeSelected([...f.keys])}>Selecionar todos os {f.keys.length} resultados</button>
        <button type="button" className={buttonClass} disabled={disabled || !f.selected.length} onClick={() => f.changeSelected([])}>Limpar seleção</button>
      </div>
      {!f.keys.length && <p>Nenhum resultado com estes filtros. A seleção está vazia; nenhum arquivo será preparado.</p>}
      <ul className={local.rows}>{f.mode === "CATALOG" ? f.matchingEntries.slice(f.currentPage * EXPORT_PAGE_SIZE, (f.currentPage + 1) * EXPORT_PAGE_SIZE).map(entry => <li className={local.row} key={entry.code}><label className={styles.check}><input className={styles.checkInput} type="checkbox" checked={f.selected.includes(String(entry.code))} disabled={disabled} onChange={event => f.changeSelected(event.target.checked ? [...f.selected, String(entry.code)] : f.selected.filter(key => key !== String(entry.code)))} /><span className={local.identity}>{entry.code} · {entry.markings.join(" / ")}</span></label><p className={styles.muted}>{f.scope === "ALL" ? "Turno cadastrado na empresa, mesmo sem colaborador associado." : "Horário encontrado nos planejamentos e filtros escolhidos."}</p></li>) : f.matchingPeople.slice(f.currentPage * EXPORT_PAGE_SIZE, (f.currentPage + 1) * EXPORT_PAGE_SIZE).map(person => <li className={local.row} key={person.key}>
        <label className={styles.check}><input className={styles.checkInput} type="checkbox" checked={f.selected.includes(person.key)} disabled={disabled} onChange={event => f.changeSelected(event.target.checked ? [...f.selected, person.key] : f.selected.filter(key => key !== person.key))} /><span className={local.identity}><strong>{person.registration || "Sem matrícula"} · {person.name}</strong><br />Filial {person.branchCode} · {person.sector || "Sem setor informado"}</span></label>
        {person.references.length > 1 ? <Field label={`Referência para ${person.registration || person.name}`} hint="O arquivo não possui datas; escolha uma referência sem alterar a grade.">{id => <select id={id} className={controlClass} value={f.choices[person.key] ?? ""} disabled={disabled} onChange={event => f.setChoice(person.key, event.target.value)}><option value="">Escolha uma referência</option>{person.references.filter(ref => !f.filters.catalogCodes.length || ref.code !== null && f.filters.catalogCodes.includes(ref.code)).map(ref => <option key={ref.shiftId} value={ref.shiftId}>{ref.code ?? "Sem código"} · {ref.label}</option>)}</select>}</Field> : <p className={styles.muted}>{person.references[0] ? `${person.references[0].code ?? "Sem código no catálogo"} · ${person.references[0].label}${person.references[0].problem ? ` · ${omissionLabels[person.references[0].problem] ?? person.references[0].problem}` : ""}` : `${omissionLabels[person.referenceProblem]}. Será uma pendência se selecionado.`}</p>}
      </li>)}</ul>
      <div className={styles.actions}><button type="button" className={buttonClass} disabled={!f.currentPage} onClick={() => f.setPage(f.currentPage - 1)}>Página anterior</button><span>Página {f.currentPage + 1} de {f.pages} · Marcados nesta página: {f.visibleKeys.filter(key => f.selected.includes(key)).length}</span><button type="button" className={buttonClass} disabled={f.currentPage + 1 >= f.pages} onClick={() => f.setPage(f.currentPage + 1)}>Próxima página</button></div>
      {f.unavailableChoices && <p className={styles.errorText}>Escolha uma referência para cada pessoa selecionada com mais de uma opção.</p>}
      <button type="button" className={primaryClass} disabled={disabled || Boolean(f.task.busy) || !f.selected.length || f.unavailableChoices || Boolean(f.manifest)} onClick={() => void f.preview()}>Conferir seleção para arquivo</button>
    </>}
    {!disabled && missingReferences.length > 0 && !canSync && <p className={styles.muted}>Para cadastrar as referências pendentes, é preciso ter permissão de edição em todos os planejamentos afetados.</p>}
    {!disabled && <ExportPreview flow={f} disabled={disabled} canDefine={canSync} />}
    {f.task.busy && <div role="status">{f.task.busy} <button type="button" className={buttonClass} onClick={f.task.cancel}>Cancelar espera</button></div>}
    {f.notice && <p role="status">{f.notice}</p>}
    {disabled && <p className={styles.muted}>Aguarde o salvamento e o processamento da edição aberta.</p>}
  </details>;
}
