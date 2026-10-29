"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./escalas.module.css";
import { dayOfWeek, visibleDates } from "@/lib/escalas/dates";
import { sortEmployees } from "@/lib/escalas/order";
import { assignmentPresentation, buildEscalaSchedule, escalaShiftCodes, type EscalaExportMode } from "@/lib/escalas/presentation";
import type { EscalaInput, EscalaValidation } from "@/lib/escalas/types";
import { buttonClass, controlClass, Field, panelClass } from "./controls";
import type { EscalaRecoveryRequest } from "./recovery-navigation";
import { ShiftSummary } from "./shift-summary";
import { CellEditor, SwapEditor } from "./roster-editor";
import { applyRosterChanges, isCurrentRosterChange, rosterCoverageIssues, type RosterDay } from "./roster-model";
import { displayDate, WEEKDAYS } from "./workspace-model";

export { CellEditor } from "./roster-editor";

export function Roster({ input, validation, disabled, canUnlock, onChange, mode, onModeChange, onReviewEmployee, onReviewCoverage, onUndo, review }: {
  input: EscalaInput; validation: EscalaValidation | null; disabled: boolean; canUnlock: boolean; onChange: (input: EscalaInput) => void;
  review?: EscalaRecoveryRequest; mode?: EscalaExportMode; onModeChange?: (mode: EscalaExportMode) => void; onReviewEmployee?: (employeeId: string) => void; onReviewCoverage?: () => void; onUndo?: (previous: EscalaInput, applied: EscalaInput) => Promise<boolean>;
}) {
  const [localMode, setLocalMode] = useState<EscalaExportMode>("both");
  const view = mode ?? localMode;
  const [hoursDate, setHoursDate] = useState("");
  const [filter, setFilter] = useState("");
  const [sector, setSector] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RosterDay | null>(null);
  const [undo, setUndo] = useState<{ previous: EscalaInput; applied: EscalaInput } | null>(null);
  const [notice, setNotice] = useState("");
  const dates = useMemo(() => visibleDates(input), [input]);
  const presentation = useMemo(() => buildEscalaSchedule(input), [input]);
  const scheduleByEmployee = new Map(presentation.people.map((person) => [person.employee.id, person]));
  const currentDate = dates.includes(hoursDate) ? hoursDate : dates[0];
  const assignments = useMemo(() => new Map(input.assignments.map((day) => [`${day.employeeId}:${day.date}`, day])), [input.assignments]);
  const codes = useMemo(() => escalaShiftCodes(input), [input]);
  const coverage = useMemo(() => rosterCoverageIssues(input, dates, sector), [input, dates, sector]);
  const employees = sortEmployees(input.employees.filter((person) => person.planningEnabled !== false)).filter((person) => (!sector || person.sector === sector)
    && `${person.name} ${person.registration} ${person.role}`.toLocaleLowerCase("pt-BR").includes(filter.toLocaleLowerCase("pt-BR")));
  const pages = Math.max(1, Math.ceil(employees.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const displayed = employees.slice(currentPage * 20, currentPage * 20 + 20);
  useEffect(() => {
    if (!review?.employeeId || !review.date || !input.employees.some(person => person.id === review.employeeId && person.planningEnabled !== false)) return;
    if (review.date < input.startDate || review.date > input.endDate) return;
    setSelected({ employeeId: review.employeeId, date: review.date });
    setHoursDate(review.date);
  }, [review, input.employees, input.startDate, input.endDate]);
  const selectedEmployee = selected ? input.employees.find((person) => person.id === selected.employeeId) : undefined;
  const canUndo = useMemo(() => Boolean(undo && isCurrentRosterChange(undo.applied, input)), [undo, input]);
  const missingCoverage = !input.demands.some((demand) => dates.includes(demand.date) && (!sector || demand.sector === sector));
  function apply(next: EscalaInput) {
    setUndo({ previous: input, applied: next });
    onChange(next);
    setSelected(null);
    setNotice("Alteração aplicada ao rascunho. A cobertura foi atualizada. Você pode desfazer antes de outra alteração ou salvamento.");
  }
  let lastSector = "";
  let lastHoursSector = "";
  return <section className={`${panelClass} ${styles.roster}`} aria-label="Grade mensal da filial">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="escala-roster-title" className={styles.sectionTitle}>Escala de folgas e horários</h2>
      <button type="button" className={buttonClass} disabled={disabled || !canUndo} onClick={() => {
        if (!undo || !isCurrentRosterChange(undo.applied, input)) return;
        if (onUndo) { void onUndo(undo.previous, undo.applied).then(restored => { if (restored) { setUndo(null); setSelected(null); setNotice("Última alteração desfeita e salva. A proposta anterior foi restaurada."); } }); return; }
        onChange(undo.previous); setUndo(null); setSelected(null); setNotice("Última alteração desfeita. A proposta anterior foi restaurada.");
      }}>Desfazer última alteração</button>
    </div>
    <p className={styles.muted}>Filial {input.branchCode} · {input.branchName}. {displayDate(dates[0])} a {displayDate(dates.at(-1) ?? dates[0])}. Organização: setor, cargo, nome e horário crescente. Selecione um dia para editar ou trocar; pendência não equivale a folga.</p>
    <div className={styles.formGrid}>
      <Field label="Visualização da escala">{(id) => <select id={id} className={controlClass} value={view} onChange={(event) => { const next = event.target.value as EscalaExportMode; setLocalMode(next); onModeChange?.(next); }}>
        <option value="rest">Somente folgas</option><option value="hours">Somente horários</option><option value="both">Folgas e horários</option>
      </select>}</Field>
      <Field label="Filtrar setor">{(id) => <select id={id} value={sector} className={controlClass} onChange={(event) => { setSector(event.target.value); setPage(0); setSelected(null); }}>
        <option value="">Todos os setores</option>
        {[...new Set(input.employees.map((person) => person.sector))].sort((a, b) => a.localeCompare(b, "pt-BR")).map((value) => <option key={value} value={value}>{value || "Sem setor informado"}</option>)}
      </select>}</Field>
      <Field label="Buscar nome, matrícula ou cargo">{(id) => <input id={id} type="search" value={filter} className={controlClass} onChange={(event) => { setFilter(event.target.value); setPage(0); setSelected(null); }} />}</Field>
    </div>
    <p className="text-sm">{presentation.legend}</p>
    {missingCoverage ? <p className={styles.muted}>Cobertura por horário não verificada: a necessidade deste setor ou período ainda não foi informada. Presença diária não equivale a cobertura horária.</p>
      : <p className="text-sm">{coverage.length ? `${coverage.length} faixa(s) de cobertura precisam de conferência. Os dias estão destacados na grade.` : "Nenhuma falta nas faixas de cobertura informadas."} Somente faixas declaradas são verificadas; estimativas não são mínimos confirmados.</p>}
    {view !== "hours" && <><h3 className={styles.sectionTitle}>Escala de folgas</h3>
    <section className={styles.rosterScroll}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The monthly table must remain keyboard-scrollable in read-only mode.
      tabIndex={0} aria-label="Grade mensal da equipe, com rolagem horizontal e vertical">
      <table className={styles.rosterTable}>
        <caption className="sr-only">Filial {input.branchCode}. Mês completo. Colaboradores por setor, cargo e nome. Legenda e alertas de cobertura ao lado da grade.</caption>
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
                <span className="block text-xs font-normal">Horário proposto: {scheduleByEmployee.get(employee.id)?.proposedVariants.length && (scheduleByEmployee.get(employee.id)?.proposedVariants.length ?? 0) > 1 ? "Varia no mês; consulte os horários" : scheduleByEmployee.get(employee.id)?.proposedSchedule}</span>
                {(scheduleByEmployee.get(employee.id)?.proposedVariants.length ?? 0) > 1 && <details className="font-normal"><summary className="min-h-8 cursor-pointer py-1 text-xs">Ver variação dos horários</summary><ul className="max-w-64 whitespace-normal text-xs">{scheduleByEmployee.get(employee.id)?.proposedVariants.map((variant) => <li key={variant.shiftId}>{variant.code} · {variant.schedule} · dias {variant.dates.map((date) => date.slice(8)).join(", ")}</li>)}</ul></details>}
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
                      className={styles.cellButton} data-kind={assignment?.kind ?? "PENDING"} data-code={label.code} data-locked={Boolean(assignment?.locked)}
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
    </section></>}
    {view !== "rest" && <section aria-labelledby="escala-hours-title" className="space-y-3">
      <h3 id="escala-hours-title" className={styles.sectionTitle}>Escala de horários</h3>
      <Field label="Dia dos horários propostos">{(id) => <select id={id} className={controlClass} value={currentDate} onChange={(event) => { setHoursDate(event.target.value); setSelected(null); }}>{dates.map((date) => <option key={date} value={date}>{displayDate(date)}</option>)}</select>}</Field>
      <p className={styles.muted}>Horários exatos da proposta neste dia. Intervalos, folgas, afastamentos e horários não processados não representam presença horária.</p>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Horários propostos em {displayDate(currentDate)}. Mesmos colaboradores e filtros da escala de folgas.</caption>
        <thead><tr><th scope="col" className="p-2">Colaborador / função</th><th scope="col" className="p-2">Horário proposto</th><th scope="col" className="p-2">Intervalo</th><th scope="col" className="p-2">Total / situação</th></tr></thead>
        <tbody>{displayed.flatMap((employee) => {
          const heading = employee.sector !== lastHoursSector; lastHoursSector = employee.sector;
          const cell = scheduleByEmployee.get(employee.id)?.cells.find((item) => item.date === currentDate);
          return [...(heading ? [<tr key={"hours-sector-" + employee.sector}><th scope="rowgroup" colSpan={4} className={styles.sectorHeading}>{employee.sector || "Sem setor informado"}</th></tr>] : []), <tr key={employee.id} className="border-t border-[color:var(--app-border)]"><th scope="row" className="p-2 font-normal"><span className="block">{employee.registration} · {employee.name}</span><span className="block text-xs">{employee.sector} · {employee.role}</span></th>
            <td className="p-2">{cell?.shiftId ? cell.schedule : cell?.description ?? "Dia não processado"}</td><td className="p-2">{cell?.interval}</td><td className="p-2"><span className="block">{cell?.daily} · {cell?.code}</span><button type="button" className={buttonClass} disabled={disabled || cell?.code === "FV"} onClick={() => setSelected({ employeeId: employee.id, date: currentDate })}>Revisar dia</button></td></tr>];
        })}</tbody>
      </table></div>
    </section>}
    {!employees.length && <p className="text-sm">Nenhum colaborador corresponde aos filtros.</p>}
    {pages > 1 && <div className={styles.actions}>
      <button type="button" className={buttonClass} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
      <span className="text-sm">Página {currentPage + 1} de {pages} · {employees.length} colaboradores</span>
      <button type="button" className={buttonClass} disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Próxima</button>
    </div>}
    <details className={styles.disclosure}><summary className={styles.disclosureTrigger}>Turnos utilizados na escala</summary><ShiftSummary input={input} usedOnly /></details>
    {presentation.excluded.length > 0 && <details className="border-t border-[color:var(--app-border)] pt-3"><summary className={styles.disclosureTrigger}>{presentation.excluded.length} colaborador(es) não incluído(s) — relação separada</summary>
      <ul className="space-y-3 text-sm">{presentation.excluded.map(({ employee, code, reason, guidance }) => <li key={employee.id}><p><strong>{code} · {employee.registration} · {employee.name}</strong> · {employee.role} · {employee.sector}</p><p>Motivo: {reason}</p><p>{guidance}</p>{onReviewEmployee && <button type="button" className={buttonClass} onClick={() => onReviewEmployee(employee.id)}>Conferir colaborador</button>}</li>)}</ul>
    </details>}
    <p className="text-xs text-[color:var(--app-muted)]">As sugestões em massa consideram todos os colaboradores incluídos da filial, inclusive os ocultos pelos filtros. Os dias técnicos adjacentes continuam sendo conferidos, sem entrar nos totais mensais.</p>
    <p role="status" aria-live="polite" className="text-sm">{notice}</p>
    {coverage.length > 0 && <details id="escala-coverage-roster" className={styles.disclosure}><summary className={styles.disclosureTrigger}>Cobertura a conferir ({coverage.length} faixas)</summary><div className={styles.reviewScroller}><ul className={styles.referenceList}>{coverage.map((issue, index) => <li id={index === coverage.findIndex(row => row.date === issue.date) ? `escala-cobertura-${issue.date}` : undefined} key={JSON.stringify([issue.date, issue.sector, issue.code, issue.message])}><strong>{issue.severity === "ERROR" ? "Mínimo informado" : "Estimativa"}</strong> · {issue.message}</li>)}</ul></div>{onReviewCoverage && <button type="button" className={buttonClass} onClick={onReviewCoverage}>Abrir central de revisão</button>}</details>}
    {selected && selectedEmployee && <fieldset disabled={disabled} className="space-y-3">
      <CellEditor key={`${selected.employeeId}:${selected.date}:${assignments.get(`${selected.employeeId}:${selected.date}`)?.locked}`} employee={selectedEmployee} date={selected.date}
        assignment={assignments.get(`${selected.employeeId}:${selected.date}`)} input={input} canUnlock={canUnlock}
        onCancel={() => setSelected(null)} onApply={(assignment) => apply(applyRosterChanges(input, [assignment], canUnlock))} />
      <SwapEditor key={`${selected.employeeId}:${selected.date}`} input={input} first={selected} dates={dates} onApply={apply} />
    </fieldset>}
  </section>;
}
