"use client";

import { useMemo, useState } from "react";
import styles from "./escalas.module.css";
import { dayOfWeek, visibleDates } from "@/lib/escalas/dates";
import { sortEmployees } from "@/lib/escalas/order";
import { assignmentPresentation, escalaShiftCodes } from "@/lib/escalas/presentation";
import type { EscalaInput, EscalaValidation } from "@/lib/escalas/types";
import { buttonClass, controlClass, Field, panelClass } from "./controls";
import { CellEditor, SwapEditor } from "./roster-editor";
import { applyRosterChanges, isCurrentRosterChange, rosterCoverageIssues, type RosterDay } from "./roster-model";
import { displayDate, WEEKDAYS } from "./workspace-model";

export { CellEditor } from "./roster-editor";

export function Roster({ input, validation, disabled, canUnlock, onChange }: {
  input: EscalaInput; validation: EscalaValidation | null; disabled: boolean; canUnlock: boolean; onChange: (input: EscalaInput) => void;
}) {
  const [filter, setFilter] = useState("");
  const [sector, setSector] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RosterDay | null>(null);
  const [undo, setUndo] = useState<{ previous: EscalaInput; applied: EscalaInput } | null>(null);
  const [notice, setNotice] = useState("");
  const dates = useMemo(() => visibleDates(input), [input]);
  const assignments = useMemo(() => new Map(input.assignments.map((day) => [`${day.employeeId}:${day.date}`, day])), [input.assignments]);
  const codes = useMemo(() => escalaShiftCodes(input), [input]);
  const coverage = useMemo(() => rosterCoverageIssues(input, dates, sector), [input, dates, sector]);
  const employees = sortEmployees(input.employees).filter((person) => (!sector || person.sector === sector)
    && `${person.name} ${person.registration} ${person.role}`.toLocaleLowerCase("pt-BR").includes(filter.toLocaleLowerCase("pt-BR")));
  const pages = Math.max(1, Math.ceil(employees.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const displayed = employees.slice(currentPage * 20, currentPage * 20 + 20);
  const selectedEmployee = selected ? input.employees.find((person) => person.id === selected.employeeId) : undefined;
  const canUndo = Boolean(undo && isCurrentRosterChange(undo.applied, input));
  const missingCoverage = !input.demands.some((demand) => dates.includes(demand.date) && (!sector || demand.sector === sector));
  function apply(next: EscalaInput) {
    setUndo({ previous: input, applied: next });
    onChange(next);
    setSelected(null);
    setNotice("Alteração aplicada ao rascunho. A cobertura foi atualizada. Você pode desfazer antes de outra alteração ou salvamento.");
  }
  let lastSector = "";
  return <section className={`${panelClass} ${styles.roster}`} aria-labelledby="escala-roster-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="escala-roster-title" className={styles.sectionTitle}>Grade mensal da filial</h2>
      <button type="button" className={buttonClass} disabled={disabled || !canUndo} onClick={() => {
        if (!undo || !isCurrentRosterChange(undo.applied, input)) return;
        onChange(undo.previous); setUndo(null); setSelected(null); setNotice("Última alteração desfeita. A proposta anterior foi restaurada.");
      }}>Desfazer última alteração</button>
    </div>
    <p className={styles.muted}>Filial {input.branchCode} · {input.branchName}. {displayDate(dates[0])} a {displayDate(dates.at(-1) ?? dates[0])}. Organização: setor e nome A–Z. Selecione um dia para editar ou trocar; pendência não equivale a folga.</p>
    <div className={styles.formGrid}>
      <Field label="Filtrar setor">{(id) => <select id={id} value={sector} className={controlClass} onChange={(event) => { setSector(event.target.value); setPage(0); setSelected(null); }}>
        <option value="">Todos os setores</option>
        {[...new Set(input.employees.map((person) => person.sector))].sort((a, b) => a.localeCompare(b, "pt-BR")).map((value) => <option key={value} value={value}>{value || "Sem setor informado"}</option>)}
      </select>}</Field>
      <Field label="Buscar nome, matrícula ou cargo">{(id) => <input id={id} type="search" value={filter} className={controlClass} onChange={(event) => { setFilter(event.target.value); setPage(0); setSelected(null); }} />}</Field>
    </div>
    <p className="text-sm">F: Folga · T01, T02…: turno planejado · SF: trabalho sem horário definido · P: Pendente · A: Ausência · FV: Fora do período de vínculo · EX: Não incluído.</p>
    {missingCoverage ? <p className={styles.muted}>Cobertura por horário não verificada: a necessidade deste setor ou período ainda não foi informada. Presença diária não equivale a cobertura horária.</p>
      : <p className="text-sm">{coverage.length ? `${coverage.length} faixa(s) de cobertura precisam de conferência. Os dias estão destacados na grade.` : "Nenhuma falta nas faixas de cobertura informadas."} Somente faixas declaradas são verificadas; estimativas não são mínimos confirmados.</p>}
    <section className={styles.rosterScroll}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The monthly table must remain keyboard-scrollable in read-only mode.
      tabIndex={0} aria-label="Grade mensal da equipe, com rolagem horizontal e vertical">
      <table className={styles.rosterTable}>
        <caption className="sr-only">Filial {input.branchCode}. Mês completo. Colaboradores por setor e nome. Legenda e alertas de cobertura ao lado da grade.</caption>
        <thead className={styles.tableHead}>
          <tr className={styles.headerRow}>
            <th scope="col" className={styles.nameHeading}>Colaborador</th>
            {dates.map((date) => {
              const issues = coverage.filter((issue) => issue.date === date);
              return <th key={date} scope="col" className={styles.dayHeading}>
                <span className="block">{date.slice(8)}</span><span className="block text-xs font-normal">{WEEKDAYS[dayOfWeek(date)]}</span>
                {input.policy.holidayDates.includes(date) && <span className="block text-xs">Feriado</span>}
                {issues.length > 0 && <a href={`#escala-cobertura-${date}`} className={styles.coverageLink} aria-label={`${displayDate(date)}: ${issues.length} faixa(s) abaixo da cobertura. Ver detalhes`}>! {issues.length}</a>}
              </th>;
            })}
          </tr>
        </thead>
        <tbody>{displayed.flatMap((employee) => {
          const heading = employee.sector !== lastSector;
          lastSector = employee.sector;
          const summary = validation?.summaries.find((item) => item.employeeId === employee.id);
          return [
            ...(heading ? [<tr key={`sector-${employee.sector}`}><th scope="rowgroup" colSpan={dates.length + 1} className={styles.sectorHeading}><span className={styles.sectorName}>{employee.sector || "Sem setor informado"}</span></th></tr>] : []),
            <tr key={employee.id}>
              <th scope="row" className={styles.nameCell}>
                <span className="block break-words">{employee.name}</span>
                <span className="block text-xs font-normal text-[color:var(--app-muted)]">{employee.registration} · {employee.role}</span>
                <span className="block text-xs font-normal text-[color:var(--app-muted)]">{employee.scheduleMode === "UNTIMED" ? "Sem horário fixo · horas não apuradas" : employee.scheduleMode === "MISSING" ? "Horário não informado · horas não apuradas" : `${employee.weeklyHours}h por semana`}</span>
                {employee.sourceSchedule && <details className="font-normal"><summary className="min-h-8 cursor-pointer py-1 text-xs">Horário importado</summary><p className="max-w-64 whitespace-normal text-xs">{employee.sourceSchedule.code} · {employee.sourceSchedule.description}<br />{employee.sourceSchedule.weekday}</p></details>}
                {summary && <span className="block text-xs font-normal">{summary.workDays} dias trabalhados · {summary.offDays} folgas</span>}
                {employee.planningEnabled === false && <span className="block text-xs font-normal text-[color:var(--app-coral)]">Não incluído · {employee.planningExclusionReason || "Conferência necessária"}</span>}
              </th>
              {dates.map((date) => {
                const assignment = assignments.get(`${employee.id}:${date}`);
                const label = assignmentPresentation(employee, date, assignment, codes);
                const inactive = (employee.activeFrom && date < employee.activeFrom) || (employee.activeUntil && date > employee.activeUntil);
                const gap = coverage.some((issue) => issue.sector === employee.sector && issue.date === date);
                return <td key={date} className={styles.dayCell}>
                  {employee.planningEnabled === false || inactive ? <span className={styles.inactiveCell} title={label.description}>{label.code}</span>
                    : <button type="button" disabled={disabled} onClick={() => setSelected({ employeeId: employee.id, date })}
                      className={`${styles.cellButton} ${gap ? styles.gapCell : ""} ${assignment?.kind === "OFF" ? styles.offCell : ""}`}
                      title={`${label.description}${gap ? ". Setor com cobertura a conferir" : ""}`}
                      aria-label={`${employee.name}, ${displayDate(date)}: ${label.description}${assignment?.locked ? ", bloqueado" : ""}. Editar`}>
                      <span>{label.code}</span>{assignment?.locked && <span className="block text-[10px]" aria-hidden="true">fixo</span>}
                    </button>}
                </td>;
              })}
            </tr>,
          ];
        })}</tbody>
      </table>
    </section>
    {!employees.length && <p className="text-sm">Nenhum colaborador corresponde aos filtros.</p>}
    {pages > 1 && <div className={styles.actions}>
      <button type="button" className={buttonClass} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
      <span className="text-sm">Página {currentPage + 1} de {pages} · {employees.length} colaboradores</span>
      <button type="button" className={buttonClass} disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Próxima</button>
    </div>}
    <p className="text-xs text-[color:var(--app-muted)]">As sugestões em massa consideram todos os colaboradores incluídos da filial, inclusive os ocultos pelos filtros. Os dias técnicos adjacentes continuam sendo conferidos, sem entrar nos totais mensais.</p>
    <p role="status" aria-live="polite" className="text-sm">{notice}</p>
    {coverage.length > 0 && <section aria-label="Detalhes da cobertura" className="space-y-3">
      {[...new Set(coverage.map((issue) => issue.date))].map((date) => <details key={date} id={`escala-cobertura-${date}`} className="scroll-mt-24 border-t border-[color:var(--app-border)] pt-2">
        <summary className={styles.disclosureTrigger}>{displayDate(date ?? dates[0])} · cobertura a conferir</summary>
        <ul className="space-y-2 text-sm">{coverage.filter((issue) => issue.date === date).map((issue) => <li key={`${issue.sector}:${issue.message}`}><strong>{issue.severity === "ERROR" ? "Mínimo confirmado" : "Estimativa"}</strong> · {issue.message}</li>)}</ul>
      </details>)}
    </section>}
    {selected && selectedEmployee && <fieldset disabled={disabled} className="space-y-3">
      <CellEditor key={`${selected.employeeId}:${selected.date}:${assignments.get(`${selected.employeeId}:${selected.date}`)?.locked}`} employee={selectedEmployee} date={selected.date}
        assignment={assignments.get(`${selected.employeeId}:${selected.date}`)} input={input} canUnlock={canUnlock}
        onCancel={() => setSelected(null)} onApply={(assignment) => apply(applyRosterChanges(input, [assignment], canUnlock))} />
      <SwapEditor key={`${selected.employeeId}:${selected.date}`} input={input} first={selected} dates={dates} onApply={apply} />
    </fieldset>}
  </section>;
}
