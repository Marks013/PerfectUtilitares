"use client";

import { memo, useMemo, useRef, useState } from "react";
import { buildEscalaDiagnostics, type EscalaDiagnosticNotice } from "@/lib/escalas/diagnostics";
import { summarizeCoverageGaps } from "@/lib/escalas/coverage-summary";
import { sectorPresenceGaps } from "@/lib/escalas/coverage-presence";
import { monthlySundays } from "@/lib/escalas/monthly-sundays";
import type { EscalaRecoveryContext } from "./recovery-navigation";
import styles from "./escalas.module.css";
import { compareSectors, sortEmployees } from "@/lib/escalas/order";
import type {
  EscalaAssignment,
  EscalaInput,
  EscalaValidation,
} from "@/lib/escalas/types";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import { inactiveViewPropsEqual, useActiveSnapshot } from "./view-activity";
import { addDate, clock, displayDate } from "./workspace-model";
import { groupValidationIssues, isReviewInformation, reviewNoticeText, type ReviewTarget } from "./validation-guidance";

function changesBetween(previous: EscalaAssignment[], next: EscalaAssignment[]) {
  const before = new Map(previous.map((item) => [`${item.employeeId}:${item.date}`, item]));
  const after = new Map(next.map((item) => [`${item.employeeId}:${item.date}`, item]));
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].flatMap((key) => {
    const old = before.get(key);
    const value = after.get(key);
    if (old?.kind === value?.kind && old?.shiftId === value?.shiftId && Boolean(old?.locked) === Boolean(value?.locked))
      return [];
    const assignment = value ?? old;
    return assignment
      ? [
          {
            employeeId: assignment.employeeId,
            date: assignment.date,
            before: old,
            after: value,
          },
        ]
      : [];
  });
}

function dayText(assignment: EscalaAssignment | undefined, input: EscalaInput) {
  if (!assignment) return "Pendente";
  if (assignment.kind === "DUTY") return "Trabalho sem horário fixo";
  return assignment.kind === "OFF"
    ? "Folga"
    : assignment.kind === "ABSENCE"
      ? "Ausência"
      : (input.shifts.find((shift) => shift.id === assignment.shiftId)?.name ?? "Trabalho");
}

function Changes({ input, assignments }: { input: EscalaInput; assignments: EscalaAssignment[] }) {
  const changes = changesBetween(input.assignments, assignments);
  const changedIds = new Set(changes.map((change) => change.employeeId));
  const employees = sortEmployees(input.employees).filter((employee) => changedIds.has(employee.id));
  return (
    <details className="space-y-3">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">
        Conferir todas as mudanças: {changes.length} dias de {employees.length} colaboradores
      </summary>
      <div className="max-h-96 space-y-4 overflow-y-auto pr-2">
        {employees.map((employee) => (
          <div key={employee.id} className="space-y-1 border-b border-[color:var(--app-border)] pb-3">
            <p className="text-sm font-semibold">
              {employee.sector} / {employee.role} · {employee.name} · {employee.registration}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs">
              {changes
                .filter((change) => change.employeeId === employee.id)
                .sort((a, b) => a.date.localeCompare(b.date))
                .map((change) => (
                  <li key={change.date}>
                    {displayDate(change.date)}: {dayText(change.before, input)} para {dayText(change.after, input)}
                    {change.after?.locked ? " (bloqueado)" : ""}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

type ResolveReview = (target: ReviewTarget, context?: EscalaRecoveryContext) => void;

function CoverageDayDetails({ rows, onResolve }: { rows: ReturnType<typeof buildEscalaDiagnostics>["coverageGroups"]; onResolve?: ResolveReview }) {
  const [page, setPage] = useState(0);
  const ordered = [...rows].sort((a, b) => a.start - b.start || a.end - b.end || Number(a.estimated) - Number(b.estimated));
  const pages = Math.max(1, Math.ceil(ordered.length / 12)), current = Math.min(page, pages - 1);
  return <div className="space-y-3">
    <ul className="divide-y divide-[color:var(--app-border)] text-sm">
      {ordered.slice(current * 12, current * 12 + 12).map((row, index) => <li key={JSON.stringify([row.start, row.end, row.roles, index])} className="space-y-1 py-3">
        <p className="tabular-nums"><strong>{clock(row.start)}–{clock(row.end)}</strong> · {row.present} trabalhando / {row.minimum} {row.estimated ? "na estimativa" : "no mínimo informado"}{row.present === 0 ? " · Sem presença nesta faixa" : ""}</p>
        {row.roles.length > 0 && <details><summary className={styles.disclosureTrigger}>Conferir funções nesta faixa</summary><ul>{row.roles.map(role => <li key={JSON.stringify([role.role, role.estimated])}>{role.role}: {role.present} trabalhando / {role.minimum} {role.estimated ? "na estimativa" : "no mínimo informado"}.</li>)}</ul></details>}
        {onResolve && <button type="button" className={buttonClass} onClick={() => onResolve("coverage", { sector: row.sector, date: row.date, start: row.start })}>Conferir este setor e horário</button>}
      </li>)}
    </ul>
    {pages > 1 && <div className={styles.actions}><button type="button" className={buttonClass} disabled={!current} onClick={() => setPage(current - 1)}>Anterior</button><span className="text-sm">Faixas {current * 12 + 1}–{Math.min(ordered.length, (current + 1) * 12)} de {ordered.length}</span><button type="button" className={buttonClass} disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Próxima</button></div>}
  </div>;
}

function PresenceGaps({ rows, onResolve }: { rows: ReturnType<typeof sectorPresenceGaps>; onResolve?: ResolveReview }) {
  if (!rows.length) return null;
  return <div className={styles.reviewGroup} role="status">
    <p className="font-semibold">Dias sem ninguém com horário no setor</p>
    <p className={styles.muted}>Confira se o setor precisa funcionar nesses dias. Uma estimativa zero não confirma fechamento nem atendimento.</p>
    <ul className="space-y-2">{rows.map(row => <li key={row.sector}>
      <p>{row.dates.length} dia(s) sem presença com horário{row.withoutPositiveReferenceDates.length ? `; ${row.withoutPositiveReferenceDates.length} sem necessidade positiva informada ou estimada` : ""}.</p>
      <details><summary className={styles.disclosureTrigger}>Consultar datas de {row.sector}</summary><p className="text-sm tabular-nums">{row.dates.map(displayDate).join(", ")}</p></details>
      {onResolve && <button type="button" className={buttonClass} onClick={() => onResolve("coverage", { sector: row.sector, date: row.dates[0] })}>Conferir cobertura de {row.sector}</button>}
    </li>)}</ul>
  </div>;
}

function CoverageGaps({ rows, emptySectors = [], onResolve }: { rows: ReturnType<typeof buildEscalaDiagnostics>["coverageGroups"]; emptySectors?: ReturnType<typeof sectorPresenceGaps>; onResolve?: ResolveReview }) {
  const summaries = useMemo(() => {
    const groups = new Map(summarizeCoverageGaps(rows).map(row => [row.sector, row]));
    for (const row of emptySectors) if (!groups.has(row.sector)) groups.set(row.sector, { sector: row.sector, dates: row.dates, noServiceDates: row.dates, minimumDates: [], hasEstimates: true, peakMissing: 0, peakSectorMissing: 0, hasRoleMismatch: false, windows: [] });
    return [...groups.values()].sort((a, b) => compareSectors(a.sector, b.sector));
  }, [rows, emptySectors]);
  const [selected, setSelected] = useState<{ sector: string; date: string } | null>(null);
  if (!summaries.length) return null;
  return <div className={styles.reviewGroup}>
    <div><h3 className="font-semibold">Desfalques por setor</h3><p className={styles.muted}>Um resumo por setor. As faixas abaixo são prioridades, não a lista completa. A estimativa automática não é uma necessidade comprovada.</p></div>
    <ul className={styles.coverageGapList}>
      {summaries.map(row => {
        const open = selected?.sector === row.sector;
        const date = open && row.dates.includes(selected.date) ? selected.date : row.dates[0];
        return <li key={row.sector} className={styles.reviewNotice} data-severity={row.minimumDates.length ? "ERROR" : "WARNING"}>
          <div className={styles.header}><h4 className="font-semibold">{row.sector || "Setor não informado"}</h4><span className={styles.statusTag}>{row.minimumDates.length ? "Rever mínimo informado" : "Referência estimada"}</span></div>
          <PresenceGaps rows={emptySectors.filter(item => item.sector === row.sector)} onResolve={onResolve} />
          <p>{row.dates.length} dia(s) com ponto de atenção{row.noServiceDates.length ? ` · ${row.noServiceDates.length} dia(s) sem presença em alguma faixa` : ""}.</p>
          <ul className="space-y-1 text-sm tabular-nums">{row.windows.map(window => <li key={window.start + ":" + window.end}><strong>{clock(window.start)}–{clock(window.end)}</strong> · {window.dates.length} dia(s) · {window.peakSectorMissing ? `até ${window.peakSectorMissing} pessoa(s) abaixo da referência` : "rever a distribuição das funções"}</li>)}</ul>
          <p className={styles.muted}>Compare com a necessidade real e reveja entradas, intervalos e folgas. Não significa contratar a quantidade indicada.</p>
          <div className={styles.actions}><button type="button" className={buttonClass} aria-expanded={open} onClick={() => setSelected(open ? null : { sector: row.sector, date })}>{open ? "Fechar detalhes" : "Consultar dias e horários"}<span className="sr-only"> de {row.sector}</span></button>{onResolve && <button type="button" className={buttonClass} onClick={() => onResolve("coverage", { sector: row.sector, date: row.windows[0]?.dates[0] ?? row.dates[0], start: row.windows[0]?.start })}>Ajustar este setor<span className="sr-only"> {row.sector}</span></button>}</div>
          {open && <div className="space-y-3 border-t border-[color:var(--app-border)] pt-3"><Field label={`Dia para conferir em ${row.sector}`}>{id => <select id={id} className={controlClass} value={date} onChange={event => setSelected({ sector: row.sector, date: event.target.value })}>{row.dates.map(day => <option key={day} value={day}>{displayDate(day)}</option>)}</select>}</Field><CoverageDayDetails key={row.sector + date} rows={rows.filter(gap => gap.sector === row.sector && gap.date === date)} onResolve={onResolve} /></div>}
        </li>;
      })}
    </ul>
  </div>;
}

function ReviewNotice({ notice, input, onResolve }: { notice: EscalaDiagnosticNotice; input: EscalaInput; onResolve?: ResolveReview }) {
  const guidance = groupValidationIssues([{ code: notice.code, severity: notice.severity, message: notice.message }])[0]?.guidance;
  const employees = sortEmployees(input.employees.filter((person) => notice.employeeIds.includes(person.id)));
  const context: EscalaRecoveryContext = { ...(employees.length === 1 ? { employeeId: employees[0].id } : {}), ...(notice.dates[0] ? { date: notice.dates[0] } : {}) };
  const simple = reviewNoticeText(notice.code);
  const title = simple?.title ?? (["Atenção", "Informação", "Impedimento"].includes(notice.label) ? guidance?.title : notice.label);
  const message = simple?.message ?? notice.message;
  if (notice.code === "ABSENCE_OCCUPIED" && context.date) context.date = addDate(context.date, -1);
  const informationOnly = isReviewInformation(notice.code, notice.severity);
  return <li className={styles.reviewNotice} data-severity={notice.severity}>
    <h4 className="font-semibold">{title || "Revisão da proposta"}</h4>
    <p>{message}</p>
    {notice.dates.length > 0 && <p className={styles.muted}><strong>Período afetado:</strong> {notice.dates.length === 1 ? displayDate(notice.dates[0]) : `${displayDate(notice.dates[0])} a ${displayDate(notice.dates.at(-1) ?? notice.dates[0])}`}{notice.dates.length > 1 ? ` · ${notice.dates.length} datas de referência` : ""}.</p>}
    {employees.length === 1 && <p><strong>{employees[0].registration} · {employees[0].name}</strong><span className="block">{employees[0].sector} / {employees[0].role}</span></p>}
    {!informationOnly && guidance && guidance.instruction !== message && <p><strong>{notice.severity === "ERROR" ? "Como corrigir:" : "Orientação:"}</strong> {guidance.instruction}</p>}
    {(employees.length > 1 || notice.dates.length > 1) && <details><summary className={styles.disclosureTrigger}>Consultar pessoas e datas</summary>{notice.dates.length > 1 && <p className={styles.muted}>{notice.dates.map(displayDate).join(", ")}</p>}<ul className={styles.referenceList}>{employees.map((person) => <li key={person.id}><strong>{person.registration} · {person.name}</strong><span>{person.sector} / {person.role}</span>{onResolve && <button type="button" className={buttonClass} onClick={() => onResolve("team", { employeeId: person.id, ...(notice.dates[0] ? { date: notice.dates[0] } : {}) })}>Conferir colaborador<span className="sr-only"> {person.name}</span></button>}</li>)}</ul></details>}
    {simple && simple.message !== notice.message && <details><summary className={styles.disclosureTrigger}>Detalhes da conferência</summary><p className={styles.muted}>{notice.message}</p></details>}
    {onResolve && guidance?.target && (!informationOnly || guidance.target !== "rules") && <button type="button" className={buttonClass} onClick={() => onResolve(guidance.target as ReviewTarget, context)}>{guidance.action}</button>}
  </li>;
}

function useActiveDiagnostics(input: EscalaInput, issues: EscalaValidation["issues"] | undefined, active: boolean) {
  const cache = useRef<{ input: EscalaInput; issues: EscalaValidation["issues"]; value: ReturnType<typeof buildEscalaDiagnostics> } | null>(null);
  return useMemo(() => {
    if (active && issues && (cache.current?.input !== input || cache.current.issues !== issues)) cache.current = { input, issues, value: buildEscalaDiagnostics(input, issues) };
    return cache.current?.value ?? null;
  }, [input, issues, active]);
}

export const Proposals = memo(function Proposals({ input: nextInput, generated: nextGenerated, disabled, onGenerated, onDismiss, active = true }: {
  input: EscalaInput; generated: { result: { status: string; message: string }; proposalInput: EscalaInput; validation: EscalaValidation } | null;
  disabled: boolean; onGenerated: () => void; onDismiss: () => void; active?: boolean;
}) {
  const { input, generated } = useActiveSnapshot({ input: nextInput, generated: nextGenerated }, active);
  const diagnostics = useActiveDiagnostics(generated?.proposalInput ?? input, generated?.validation.issues, active);
  const emptySectors = useMemo(() => generated && active ? sectorPresenceGaps(generated.proposalInput) : [], [generated, active]);
  if (!generated || !diagnostics) return null;
  return <section className={`${panelClass} border-[color:var(--app-teal)]`} aria-labelledby="escala-proposals-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="escala-proposals-title" className="text-lg font-bold">Proposta pronta para revisão</h2><p className="mt-1 text-sm text-[color:var(--app-muted)]">A sugestão ainda não foi aplicada. Os horários originais e os dias bloqueados foram preservados.</p></div><span className="text-sm font-semibold">{generated.proposalInput.defaultWeeklyHours}h por semana</span></div>
    <p className="text-sm">{generated.result.status === "OPTIMAL" ? "Melhor solução comprovada para o modelo" : "Solução viável encontrada"}. {generated.result.message}</p>
    {(diagnostics.coverageGroups.length > 0 || emptySectors.length > 0) && <details><summary className={styles.disclosureTrigger}>Conferir setores com desfalque ({new Set([...diagnostics.coverageGroups.map(row => row.sector), ...emptySectors.map(row => row.sector)]).size})</summary><div className={styles.reviewScroller}><CoverageGaps rows={diagnostics.coverageGroups} emptySectors={emptySectors} /></div></details>}
    {diagnostics.notices.length > 0 && <p className="text-sm text-[color:var(--app-muted)]">{diagnostics.notices.length} assunto(s) de revisão. Os limites da simulação aparecem no resumo, sem repetir avisos por pessoa.</p>}
    <Changes input={input} assignments={generated.proposalInput.assignments} />
    <div className="flex flex-wrap gap-3"><button type="button" className={primaryClass} disabled={disabled || !generated.validation.valid} onClick={onGenerated}>Aplicar proposta à grade</button><button type="button" className={buttonClass} disabled={disabled} onClick={onDismiss}>Descartar sugestão</button></div>
  </section>;
}, inactiveViewPropsEqual);

export type ReviewSection = "errors" | "reviews" | "coverage" | "information";

export const ValidationResults = memo(function ValidationResults({ input: nextInput, validation: nextValidation, onResolve, section, onSectionChange, active = true }: { input: EscalaInput; validation: EscalaValidation | null; onResolve?: ResolveReview; section?: ReviewSection; onSectionChange?: (section: ReviewSection) => void; active?: boolean }) {
  const [selectedView, setView] = useState<ReviewSection>();
  const { input, validation } = useActiveSnapshot({ input: nextInput, validation: nextValidation }, active);
  const diagnostics = useActiveDiagnostics(input, validation?.issues, active);
  const emptySectors = useMemo(() => active && input.assignments.some(record => record.kind === "WORK" || record.kind === "DUTY") ? sectorPresenceGaps(input) : [], [input, active]);
  const sundayCounts = useMemo(() => monthlySundays(input), [input]);
  if (!validation) return <section className={panelClass}><h2 className={styles.sectionTitle}>Revisão do cenário</h2><p className="text-sm">A edição ainda não foi conferida. Aguarde o salvamento ou gere uma proposta para atualizar os resultados.</p></section>;
  if (!diagnostics) return null;
  const errors = diagnostics.notices.filter(notice => notice.severity === "ERROR");
  const reviews = diagnostics.notices.filter(notice => notice.severity === "PENDING" && !isReviewInformation(notice.code, notice.severity));
  const information = diagnostics.notices.filter(notice => notice.severity === "WARNING" || isReviewInformation(notice.code, notice.severity));
  const reservations = validation.boundaryReservations ?? [];
  const employees = sortEmployees(input.employees.filter(person => person.planningEnabled !== false));
  const coverageCount = new Set([...diagnostics.coverageGroups.map(row => row.sector), ...emptySectors.map(row => row.sector)]).size;
  const view = section ?? selectedView ?? (errors.length ? "errors" : diagnostics.coverageGroups.length ? "coverage" : reviews.length ? "reviews" : information.length ? "information" : "errors");
  const notices = view === "errors" ? errors : view === "reviews" ? reviews : information;
  const menus = [{ id: "errors", label: "Erros", count: errors.length }, { id: "reviews", label: "Avisos", count: reviews.length }, { id: "coverage", label: "Desfalques", count: coverageCount }, { id: "information", label: "Informações", count: information.length }] as const;
  return <section className={panelClass} aria-labelledby="escala-validation-title">
    <div className={styles.header}><h2 id="escala-validation-title" className={styles.sectionTitle}>Central de revisão</h2><span className={styles.muted}>{errors.length} erro(s) · {reviews.length} aviso(s)</span></div>
    <p className="text-sm">{errors.length ? "Há impedimentos técnicos. Escolha uma ocorrência para conferir a correção sugerida." : "Nenhum impedimento técnico detectado. Avisos e estimativas ficam separados para consulta opcional."}</p>
    <fieldset className={styles.reviewTabs}><legend className="sr-only">Tipo de revisão</legend>{menus.map(menu => <button type="button" key={menu.id} className={buttonClass} aria-pressed={view === menu.id} aria-controls="escala-review-content" onClick={() => { setView(menu.id); onSectionChange?.(menu.id); }}>{menu.label} ({menu.count})</button>)}</fieldset>
    <section id="escala-review-content" className={styles.reviewScroller} aria-label={(menus.find(menu => menu.id === view)?.label ?? "Revisão") + " da escala"}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the review region.
      tabIndex={0}>
      {view === "coverage" ? coverageCount ? <CoverageGaps rows={diagnostics.coverageGroups} emptySectors={emptySectors} onResolve={onResolve} /> : <p>Nenhum desfalque detectado nas faixas com referência disponível.</p> : <>
        <h3 className="font-semibold">{view === "errors" ? "Exige correção (" + errors.length + ")" : view === "reviews" ? "Pode continuar com revisão (" + reviews.length + ")" : "Informações e limites de conferência (" + information.length + ")"}</h3>
        {!notices.length && <p className={styles.muted}>Nenhuma ocorrência nesta categoria.</p>}
        <ul className={styles.coverageGapList}>{notices.map(notice => <ReviewNotice key={JSON.stringify([notice.code, notice.message, notice.employeeIds])} notice={notice} input={input} onResolve={onResolve} />)}</ul>
      </>}
      {view === "information" && <div className={styles.stackSmall}>
        <p className={styles.muted}>A simulação apoia o planejamento. A cobertura automática é estimativa; horários não informados e histórico indisponível limitam as conclusões correspondentes.</p>
        {reservations.length > 0 && <section><h3 className="font-semibold">Folgas fixas reservadas para continuidade</h3><ul>{employees.map(person => {
          const dates = reservations.filter(day => day.employeeId === person.id).map(day => day.date).sort();
          return dates.length ? <li key={person.id}>{person.registration} · {person.name}: {dates.map(displayDate).join(", ")}</li> : null;
        })}</ul></section>}
        <p className={styles.muted}>Domingos abaixo: apenas o mês exibido. Afastamentos e dias sem definição ficam separados; a continuidade entre meses continua sendo conferida pelo algoritmo.</p>
        <table className="w-full text-left text-sm"><caption className="py-2 text-left font-semibold">Apuração por colaborador</caption><thead><tr><th scope="col" className="p-2">Setor / cargo / colaborador</th><th scope="col" className="p-2">Horas</th><th scope="col" className="p-2">Trabalho / folgas</th><th scope="col" className="p-2">Sequência máxima</th><th scope="col" className="p-2">Domingos no mês</th></tr></thead><tbody>{employees.map(person => {
          const summary = validation.summaries.find(item => item.employeeId === person.id);
          const sunday = sundayCounts.get(person.id);
          return summary ? <tr key={person.id}><th scope="row" className="p-2 font-normal">{person.sector} / {person.role}<span className="block font-semibold">{person.name} · {person.registration}</span></th><td className="p-2">{person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING" ? "Sem horário fixo" : clock(summary.workedMinutes)}</td><td className="p-2">{summary.workDays} / {summary.offDays}</td><td className="p-2">{summary.maxStreak} dias</td><td className="p-2">{sunday?.off ?? 0} folga(s) / {sunday?.available ?? 0} disponíveis<span className="block text-xs text-[color:var(--app-muted)]">{sunday?.worked ?? 0} trabalhado(s) · {sunday?.absent ?? 0} afastado(s){sunday?.unknown ? ` · ${sunday.unknown} sem definição` : ""}</span></td></tr> : null;
        })}</tbody></table>
      </div>}
    </section>
  </section>;
}, inactiveViewPropsEqual);

export { Publication } from "./publication";
