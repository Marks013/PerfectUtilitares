"use client";

import { isAdministrativeEscalaSector, isEscalaPlanningParticipant } from "@/lib/escalas/eligibility";
import { canDisplayEscalaAction, useEscalaClientAccess } from "./access-context";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import styles from "./escalas.module.css";
import { dayOfWeek, visibleDates } from "@/lib/escalas/dates";
import { holidayLabel } from "@/lib/escalas/calendar";
import { sortHoursEmployees, sortScheduleEntries } from "@/lib/escalas/order";
import { rosterCellColors, ROSTER_COLOR_LEGEND } from "@/lib/escalas/roster-colors";
import { assignmentPresentation, buildEscalaSchedule, escalaShiftCodes, type EscalaExportMode } from "@/lib/escalas/presentation";
import type { EscalaInput, EscalaValidation } from "@/lib/escalas/types";
import { buttonClass, controlClass, Field, panelClass } from "./controls";
import { indexEmployees, searchEmployees } from "./employee-search";
import type { EscalaRecoveryRequest } from "./recovery-navigation";
import { ShiftSummary } from "./shift-summary";
import { canChangeRosterDay, CellEditor, SwapEditor } from "./roster-editor";
import { applyRosterChanges, isCurrentRosterChange, rosterCoverageIssues, type RosterDay } from "./roster-model";
import { clock, displayDate, WEEKDAYS } from "./workspace-model";
import { inactiveViewPropsEqual, useActiveSnapshot } from "./view-activity";

export { CellEditor } from "./roster-editor";

export const Roster = memo(function Roster({ input: nextInput, validation, disabled, canUnlock, onChange, mode, onModeChange, onReviewEmployee, onReviewCoverage, onUndo, review, active = true }: {
  input: EscalaInput; validation: EscalaValidation | null; disabled: boolean; canUnlock: boolean; onChange: (input: EscalaInput) => void;
  review?: EscalaRecoveryRequest; mode?: EscalaExportMode; onModeChange?: (mode: EscalaExportMode) => void; onReviewEmployee?: (employeeId: string) => void; onReviewCoverage?: () => void; onUndo?: (previous: EscalaInput, applied: EscalaInput) => Promise<boolean>; active?: boolean;
}) {
  const input = useActiveSnapshot(nextInput, active);
  const access = useEscalaClientAccess();
  const analytics = canDisplayEscalaAction(access, "report.analytics", input.branchCode);
  const administrative = canDisplayEscalaAction(access, "settings.manage", input.branchCode);
  const hoursOnly = input.generationMode === "HOURS_ONLY";
  const [localMode, setLocalMode] = useState<EscalaExportMode>(() => hoursOnly ? "hours" : input.generationMode === "REST_ONLY" ? "rest" : "both");
  const view = hoursOnly ? "hours" : mode ?? localMode;
  const [hoursDate, setHoursDate] = useState("");
  const [filter, setFilter] = useState("");
  const [sector, setSector] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<RosterDay | null>(null);
  const rosterElement = useRef<HTMLElement>(null);
  const rosterHeading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const coverageDetails = useRef<HTMLDetailsElement>(null);
  const editorOrigin = useRef<HTMLButtonElement | null>(null);
  const focusFrame = useRef(0);
  useEffect(() => () => window.cancelAnimationFrame(focusFrame.current), []);
  const [undo, setUndo] = useState<{ previous: EscalaInput; applied: EscalaInput } | null>(null);
  const [notice, setNotice] = useState("");
  const dates = useMemo(() => visibleDates(input), [input]);
  const presentation = useMemo(() => buildEscalaSchedule(input), [input]);
  const scheduleByEmployee = new Map(presentation.people.map((person) => [person.employee.id, person]));
  const currentDate = dates.includes(hoursDate) ? hoursDate : dates[0];
  const assignments = useMemo(() => new Map(input.assignments.map((day) => [`${day.employeeId}:${day.date}`, day])), [input.assignments]);
  const codes = useMemo(() => escalaShiftCodes(input), [input]);
  const coverageCache = useRef<{ input: EscalaInput; dates: string[]; sector: string; value: ReturnType<typeof rosterCoverageIssues> } | null>(null);
  const coverage = useMemo(() => {
    if (!analytics) return [];
    if (active && (coverageCache.current?.input !== input || coverageCache.current.dates !== dates || coverageCache.current.sector !== sector)) coverageCache.current = { input, dates, sector, value: rosterCoverageIssues(input, dates, sector) };
    return coverageCache.current?.value ?? [];
  }, [input, dates, sector, active, analytics]);
  const coverageIndex = useMemo(() => {
    const byDate = new Map<string, { count: number; first: number }>();
    const bySectorAndDate = new Set<string>();
    coverage.forEach((issue, index) => {
      if (!issue.date) return;
      const date = byDate.get(issue.date);
      if (date) date.count++;
      else byDate.set(issue.date, { count: 1, first: index });
      bySectorAndDate.add(`${issue.date}:${issue.sector}`);
    });
    return { byDate, bySectorAndDate };
  }, [coverage]);
  const searchIndex = useMemo(() => indexEmployees(input.employees), [input.employees]);
  const searchMatches = useMemo(() => new Set(searchEmployees(searchIndex, filter.replace(/\s+/g, " ")).map(person => person.id)), [searchIndex, filter]);
  const matches = (person: EscalaInput["employees"][number]) => (!sector || person.sector === sector) && searchMatches.has(person.id);
  const restEmployees = sortScheduleEntries(presentation.restPeople.map(person => ({ employee: person.employee, schedule: person.proposedSchedule })))
    .map(person => person.employee).filter(matches);
  const hoursEmployees = sortHoursEmployees(input).filter(person => person.planningEnabled !== false && scheduleByEmployee.has(person.id)).filter(matches);
  const employees = view === "hours" ? hoursEmployees : restEmployees;
  const matchedCount = view === "both" ? new Set([...restEmployees, ...hoursEmployees].map(person => person.id)).size : employees.length;
  const hasFilters = Boolean(sector || filter.trim());
  const pages = Math.max(1, Math.ceil((view === "both" ? Math.max(restEmployees.length, hoursEmployees.length) : employees.length) / 20));
  const currentPage = Math.min(page, pages - 1);
  const displayed = restEmployees.slice(currentPage * 20, currentPage * 20 + 20);
  const displayedHours = hoursEmployees.slice(currentPage * 20, currentPage * 20 + 20);
  const reviewedRequest = useRef(0);
  useEffect(() => {
    if (!active || !review?.employeeId || !review.date || reviewedRequest.current === review.request || !input.employees.some(person => person.id === review.employeeId && isEscalaPlanningParticipant(person))) return;
    if (review.date < input.startDate || review.date > input.endDate) return;
    reviewedRequest.current = review.request;
    editorOrigin.current = null;
    setFilter("");
    setSector("");
    setSelected({ employeeId: review.employeeId, date: review.date });
    setHoursDate(review.date);
  }, [review, input.employees, input.startDate, input.endDate, active]);
  const selectedEmployee = selected ? input.employees.find((person) => person.id === selected.employeeId) : undefined;
  const selectedAssignment = selected ? assignments.get(`${selected.employeeId}:${selected.date}`) : undefined;
  const canSwapSelected = selectedAssignment !== undefined && selectedAssignment.locked !== true
    && selectedAssignment.kind !== "ABSENCE" && canChangeRosterDay(selectedAssignment, administrative, canUnlock);
  const canUndo = useMemo(() => Boolean(undo && isCurrentRosterChange(undo.applied, input)), [undo, input]);
  const missingCoverage = !input.demands.some((demand) => !isAdministrativeEscalaSector(demand.sector) && dates.includes(demand.date) && (!sector || demand.sector === sector));
  function openEditor(day: RosterDay, origin: HTMLButtonElement) {
    window.cancelAnimationFrame(focusFrame.current);
    editorOrigin.current = origin;
    setSelected(day);
  }
  function clearFilters() {
    setFilter("");
    setSector("");
    setPage(0);
    setSelected(null);
    searchInput.current?.focus();
  }
  function closeEditor() {
    setSelected(null);
    window.cancelAnimationFrame(focusFrame.current);
    focusFrame.current = window.requestAnimationFrame(() => {
      const roster = rosterElement.current;
      if (!roster?.isConnected || roster.closest("[hidden], [inert]") || !roster.getClientRects().length) return;
      const origin = editorOrigin.current;
      editorOrigin.current = null;
      const target = origin?.isConnected && roster.contains(origin) && !origin.matches(":disabled")
        && !origin.closest("[hidden], [inert]") && origin.getClientRects().length ? origin : rosterHeading.current;
      const scrollRegion = target?.closest<HTMLElement>('[tabindex="0"]');
      const scrollLeft = scrollRegion?.scrollLeft;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      if (scrollRegion && scrollLeft !== undefined) scrollRegion.scrollLeft = scrollLeft;
    });
  }
  function apply(next: EscalaInput) {
    setUndo({ previous: input, applied: next });
    onChange(next);
    closeEditor();
    setNotice("Alteração aplicada ao rascunho. A cobertura foi atualizada. Você pode desfazer antes de outra alteração ou salvamento.");
  }
  let lastSector = "";
  let lastHoursSector = "";
  return <section ref={rosterElement} className={`${panelClass} ${styles.roster}`} aria-label="Grade mensal da filial">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 ref={rosterHeading} id="escala-roster-title" tabIndex={-1} className={`${styles.sectionTitle} ${styles.feedbackFocus}`}>{hoursOnly ? "Escala de horários" : "Escala de folgas e horários"}</h2>
      <button type="button" className={buttonClass} disabled={disabled || !canUndo} onClick={() => {
        if (!undo || !isCurrentRosterChange(undo.applied, input)) return;
        if (onUndo) { void onUndo(undo.previous, undo.applied).then(restored => { if (restored) { setUndo(null); setSelected(null); setNotice("Última alteração desfeita e salva. A proposta anterior foi restaurada."); } }); return; }
        onChange(undo.previous); setUndo(null); setSelected(null); setNotice("Última alteração desfeita. A proposta anterior foi restaurada.");
      }}>Desfazer última alteração</button>
    </div>
    <p className={styles.muted}>Filial {input.branchCode} · {input.branchName}. {displayDate(dates[0])} a {displayDate(dates.at(-1) ?? dates[0])}. Selecione um dia para revisar.</p>
    {!hoursOnly && selected && selectedEmployee && selectedAssignment?.kind !== "HOLIDAY" && <fieldset disabled={disabled} className={styles.stackSmall}>
      <CellEditor key={`${selected.employeeId}:${selected.date}:${selectedAssignment?.locked}`} employee={selectedEmployee} date={selected.date}
        assignment={selectedAssignment} input={input} canUnlock={canUnlock}
        onCancel={closeEditor} onApply={(assignment) => apply(applyRosterChanges(input, [assignment], canUnlock))} />
      {canSwapSelected && <SwapEditor key={`${selected.employeeId}:${selected.date}`} input={input} first={selected} dates={dates} onApply={apply} />}
    </fieldset>}
    <div className={styles.formGrid}>
      <Field label="Visualização da escala">{(id) => <select id={id} className={controlClass} value={view} onChange={(event) => { const next = event.target.value as EscalaExportMode; setLocalMode(next); onModeChange?.(next); }}>
        {!hoursOnly && <option value="rest">Somente folgas</option>}<option value="hours">Somente horários</option>{!hoursOnly && <option value="both">Folgas e horários</option>}
      </select>}</Field>
      <Field label="Filtrar setor">{(id) => <select id={id} value={sector} className={controlClass} onChange={(event) => { setSector(event.target.value); setPage(0); setSelected(null); }}>
        <option value="">Todos os setores</option>
        {[...new Set(input.employees.filter(person => !isAdministrativeEscalaSector(person.sector)).map(person => person.sector))].sort((a, b) => a.localeCompare(b, "pt-BR")).map((value) => <option key={value} value={value}>{value || "Sem setor informado"}</option>)}
      </select>}</Field>
      <Field label="Buscar nome, matrícula ou cargo">{(id) => <input ref={searchInput} id={id} type="search" value={filter} className={controlClass} onChange={(event) => { setFilter(event.target.value); setPage(0); setSelected(null); }} />}</Field>
    </div>
    <div className={styles.actions}>
      <p role="status" className={styles.muted}>{matchedCount > 0
        ? `${matchedCount} ${matchedCount === 1 ? "colaborador encontrado" : "colaboradores encontrados"}`
        : hasFilters ? "Nenhum colaborador corresponde aos filtros." : "Nenhum colaborador nesta visualização."}</p>
      {hasFilters && <button type="button" className={buttonClass} onClick={clearFilters}>Limpar filtros</button>}
    </div>
    <details>
      <summary className={styles.disclosureTrigger}>Legenda e calendário</summary>
      <div className={styles.stackSmall}>
        <p className="text-sm">{presentation.legend}</p>
        <p className={styles.muted}>{ROSTER_COLOR_LEGEND}</p>
        <p className={styles.muted}>{presentation.calendarLabel}</p>
        {presentation.holidayNotes.length > 0 && <p className={styles.muted}>Feriados: {presentation.holidayNotes.join("; ")}</p>}
        <p className={styles.muted}>Use a rolagem dentro da tabela para consultar todos os dias. Setores de A–Z. Nas folgas e nos horários: cargo, horário completo crescente e nome.</p>
      </div>
    </details>
    {analytics && (missingCoverage ? <p className={styles.muted}>Cobertura por horário não verificada: a necessidade deste setor ou período ainda não foi informada. Presença diária não equivale a cobertura horária.</p>
      : <p className="text-sm">{coverage.length ? `${coverage.length} faixa(s) de cobertura precisam de conferência. Os dias estão destacados na grade.` : "Nenhuma falta nas faixas de cobertura informadas."} Somente faixas declaradas são verificadas; estimativas não são mínimos confirmados.</p>)}
    {view !== "hours" && displayed.length > 0 && <><h3 className={styles.sectionTitle}>Escala de folgas</h3>
    <section className={styles.rosterScroll}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The monthly table must remain keyboard-scrollable in read-only mode.
      tabIndex={0} aria-label="Grade mensal da equipe, com rolagem horizontal e vertical">
      <table className={styles.rosterTable}>
        <caption className="sr-only">Filial {input.branchCode}. Mês completo. Colaboradores por setor, cargo, horário completo crescente e nome. Legenda e alertas de cobertura ao lado da grade.</caption>
        <thead className={styles.tableHead}>
          <tr className={styles.headerRow}>
            <th scope="col" className={styles.nameHeading}>Colaborador</th>
            {dates.map((date) => {
              const issues = coverageIndex.byDate.get(date)?.count ?? 0;
              return <th key={date} scope="col" className={styles.dayHeading} data-sunday={dayOfWeek(date) === 6}>
                <span className="block">{date.slice(8)}</span><span className="block text-xs font-normal">{WEEKDAYS[dayOfWeek(date)]}</span>
                {holidayLabel(input, date) && <span className="block text-xs" title={holidayLabel(input, date)}><span aria-hidden="true">Feriado{input.policy.closedDates.includes(date) ? " · fechado" : ""}</span><span className="sr-only">{holidayLabel(input, date)}{input.policy.closedDates.includes(date) ? ", loja fechada" : ""}</span></span>}
                {issues > 0 && <a href={`#escala-cobertura-${date}`} className={styles.coverageLink} aria-label={`${displayDate(date)}: ${issues} faixa(s) abaixo da cobertura. Ver detalhes`} onClick={event => {
                  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
                  const details = coverageDetails.current;
                  const item = details?.querySelector<HTMLElement>(`#escala-cobertura-${date}`);
                  if (!details || !item) return;
                  event.preventDefault();
                  details.open = true;
                  item.focus({ preventScroll: true });
                  item.scrollIntoView?.({ block: "nearest" });
                }}>! {issues}</a>}
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
                <span className="block text-xs font-normal text-[color:var(--app-muted)]">{employee.registration} · <strong className={styles.personRole}>{employee.role}</strong></span>
                <details className={styles.rosterFacts}><summary>Consultar horário proposto</summary>
                <span className="block text-xs font-normal text-[color:var(--app-muted)]">{employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING" ? "Folgas planejadas · sem horário fixo" : employee.simulationDailyMinutes !== undefined ? clock(employee.simulationDailyMinutes) + " por dia · horário reduzido mantido" : employee.weeklyHours + "h por semana"}</span>
                <p className="max-w-64 whitespace-normal text-xs">{scheduleByEmployee.get(employee.id)?.proposedVariants.length && (scheduleByEmployee.get(employee.id)?.proposedVariants.length ?? 0) > 1 ? "Varia no mês; consulte os horários" : scheduleByEmployee.get(employee.id)?.proposedSchedule}</p>
                {(scheduleByEmployee.get(employee.id)?.proposedVariants.length ?? 0) > 1 && <details className="font-normal"><summary className="min-h-8 cursor-pointer py-1 text-xs">Ver variação dos horários</summary><ul className="max-w-64 whitespace-normal text-xs">{scheduleByEmployee.get(employee.id)?.proposedVariants.map((variant) => <li key={variant.shiftId}>{variant.code} · {variant.schedule} · dias {variant.dates.map((date) => date.slice(8)).join(", ")}</li>)}</ul></details>}
                {employee.sourceSchedule && <details className="font-normal"><summary className="min-h-8 cursor-pointer py-1 text-xs">Horário importado</summary><p className="max-w-64 whitespace-normal text-xs">{employee.sourceSchedule.code} · {employee.sourceSchedule.description}<br />{employee.sourceSchedule.weekday}</p></details>}
                {summary && <span className="block text-xs font-normal">{summary.workDays} dias trabalhados · {summary.offDays} folgas</span>}
                {employee.planningEnabled === false && <span className="block text-xs font-normal text-[color:var(--app-coral)]">Não incluído · {employee.planningExclusionReason || "Conferência necessária"}</span>}
                </details>
              </th>
              {dates.map((date) => {
                const assignment = assignments.get(`${employee.id}:${date}`);
                const label = assignmentPresentation(employee, date, assignment, codes);
                const inactive = (employee.activeFrom && date < employee.activeFrom) || (employee.activeUntil && date > employee.activeUntil);
                const gap = coverageIndex.bySectorAndDate.has(`${date}:${employee.sector}`);
                const action = canChangeRosterDay(assignment, administrative, canUnlock) ? "Editar" : "Consultar dia";
                return <td key={date} className={styles.dayCell}>
                  {employee.planningEnabled === false || inactive || assignment?.kind === "HOLIDAY" ? <span className={styles.inactiveCell} style={rosterCellColors(label.code)} title={label.description}><span aria-hidden="true">{label.code}</span><span className="sr-only">{employee.name}, {displayDate(date)}: {label.description}</span></span>
                    : <button type="button" disabled={disabled} onClick={event => openEditor({ employeeId: employee.id, date }, event.currentTarget)}
                      className={styles.cellButton} style={rosterCellColors(label.code)} data-kind={assignment?.kind ?? "PENDING"} data-code={label.code} data-locked={Boolean(assignment?.locked)}
                      title={`${label.description}${gap ? ". Setor com cobertura a conferir" : ""}`}
                      aria-label={`${employee.name}, ${displayDate(date)}: ${label.description}${assignment?.locked ? ", bloqueado" : ""}. ${action}`}>
                      <span>{label.code}</span>{assignment?.locked && <span className="block text-[10px]" aria-hidden="true">fixo</span>}
                    </button>}
                </td>;
              })}
            </tr>,
          ];
        })}</tbody>
      </table>
    </section></>}
    {view !== "rest" && <details aria-labelledby="escala-hours-title" className={styles.disclosure} open={view === "hours" || undefined}>
      <summary id="escala-hours-title" className={styles.disclosureTrigger}>Escala de horários</summary>
      <div className={`${styles.disclosureBody} ${styles.stackSmall}`}>
      <Field label="Dia dos horários propostos">{(id) => <select id={id} className={controlClass} value={currentDate} onChange={(event) => { setHoursDate(event.target.value); setSelected(null); }}>{dates.map((date) => <option key={date} value={date}>{displayDate(date)}</option>)}</select>}</Field>
      <p className={styles.muted}>Horários exatos da proposta neste dia. Pausas, folgas, afastamentos e pessoas sem horário fixo não entram na contagem por hora.</p>
      {displayedHours.length > 0 && <section className={styles.tableScroll}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll the hours table independently.
        tabIndex={0} aria-label="Horários da equipe, com rolagem horizontal"><table className={styles.hoursTable}><caption className="sr-only">Horários propostos em {displayDate(currentDate)}. Colaboradores por setor, cargo, horário completo crescente e nome. Mesmos colaboradores e filtros da escala de folgas.</caption>
        <thead><tr><th scope="col" className={styles.hoursIdentity} style={{ background: "var(--app-input)", fontWeight: 700, zIndex: 2 }}>Colaborador / função</th><th scope="col" className="p-2">Horário proposto</th><th scope="col" className="p-2">Intervalo</th><th scope="col" className="p-2">Total / situação</th></tr></thead>
        <tbody>{displayedHours.flatMap((employee) => {
          const heading = employee.sector !== lastHoursSector; lastHoursSector = employee.sector;
          const cell = scheduleByEmployee.get(employee.id)?.cells.find((item) => item.date === currentDate);
          const unavailable = cell?.code === "FV" || cell?.code === "FE";
          const action = !unavailable && !canChangeRosterDay(assignments.get(`${employee.id}:${currentDate}`), administrative, canUnlock) ? "Consultar dia" : "Revisar dia";
            return [...(heading ? [<tr key={"hours-sector-" + employee.sector}><th scope="rowgroup" colSpan={4} className={styles.sectorHeading}>{employee.sector || "Sem setor informado"}</th></tr>] : []), <tr key={employee.id} className="border-t border-[color:var(--app-border)]"><th scope="row" className={styles.hoursIdentity}><span className="block">{employee.registration} · {employee.name}</span><span className="block text-xs">{employee.sector} · {employee.role}</span>{hoursOnly ? onReviewEmployee && <button type="button" className={buttonClass} disabled={disabled} onClick={() => onReviewEmployee(employee.id)}>Conferir horários do colaborador</button> : <button type="button" className={buttonClass} disabled={disabled || unavailable} onClick={event => openEditor({ employeeId: employee.id, date: currentDate }, event.currentTarget)}>{action}</button>}</th>
            <td className="p-2">{cell?.shiftId ? cell.schedule : cell?.description ?? "Dia ainda sem definição"}</td><td className="p-2">{cell?.interval}</td><td className="p-2"><span className="block">{cell?.daily} · {cell?.code}</span></td></tr>];
        })}</tbody>
      </table></section>}
      </div>
    </details>}
    {pages > 1 && <div className={styles.actions}>
      <button type="button" className={buttonClass} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
      <span className="text-sm">Página {currentPage + 1} de {pages}</span>
      <button type="button" className={buttonClass} disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Próxima</button>
    </div>}
    <details className={styles.disclosure}><summary className={styles.disclosureTrigger}>Turnos utilizados na escala</summary><ShiftSummary input={input} usedOnly /></details>
    {presentation.excluded.length > 0 && <details className="border-t border-[color:var(--app-border)] pt-3"><summary className={styles.disclosureTrigger}>{presentation.excluded.length} colaborador(es) não incluído(s) — relação separada</summary>
      <ul className="space-y-3 text-sm">{presentation.excluded.map(({ employee, code, reason, guidance }) => <li key={employee.id}><p><strong>{code} · {employee.registration} · {employee.name}</strong> · {employee.role} · {employee.sector}</p><p>Motivo: {reason}</p><p>{guidance}</p>{onReviewEmployee && <button type="button" className={buttonClass} onClick={() => onReviewEmployee(employee.id)}>Conferir colaborador</button>}</li>)}</ul>
    </details>}
    <p className="text-xs text-[color:var(--app-muted)]">As sugestões em massa consideram todos os colaboradores incluídos da filial, inclusive os ocultos pelos filtros. Os dias técnicos adjacentes continuam sendo conferidos, sem entrar nos totais mensais.</p>
    <p role="status" aria-live="polite" className="text-sm">{notice}</p>
    {coverage.length > 0 && <details ref={coverageDetails} id="escala-coverage-roster" className={styles.disclosure}><summary className={styles.disclosureTrigger}>Cobertura a conferir ({coverage.length} faixas)</summary><div className={styles.reviewScroller}><ul className={styles.referenceList}>{coverage.map((issue, index) => <li tabIndex={-1} className={styles.feedbackFocus} id={issue.date && index === coverageIndex.byDate.get(issue.date)?.first ? `escala-cobertura-${issue.date}` : undefined} key={JSON.stringify([issue.date, issue.sector, issue.code, issue.message])}><strong>{issue.severity === "ERROR" ? "Mínimo informado" : "Estimativa"}</strong> · {issue.message}</li>)}</ul></div>{onReviewCoverage && <button type="button" className={buttonClass} onClick={onReviewCoverage}>Abrir central de revisão</button>}</details>}
  </section>;
}, inactiveViewPropsEqual);
