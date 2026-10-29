"use client";

import { useState } from "react";
import { buildEscalaDiagnostics, type EscalaDiagnosticNotice } from "@/lib/escalas/diagnostics";
import { consolidateCoverageGaps } from "@/lib/escalas/coverage-presence";
import type { EscalaRecoveryContext } from "./recovery-navigation";
import styles from "./escalas.module.css";
import { sortEmployees } from "@/lib/escalas/order";
import type {
  EscalaAssignment,
  EscalaInput,
  EscalaValidation,
} from "@/lib/escalas/types";
import { buttonClass, panelClass, primaryClass } from "./controls";
import { clock, displayDate } from "./workspace-model";
import { groupValidationIssues, type ReviewTarget } from "./validation-guidance";

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

function CoverageGaps({ rows, onResolve }: { rows: ReturnType<typeof buildEscalaDiagnostics>["coverageGroups"]; onResolve?: ResolveReview }) {
  const [page, setPage] = useState(0);
  const groups = consolidateCoverageGaps(rows);
  const pages = Math.max(1, Math.ceil(groups.length / 12));
  const current = Math.min(page, pages - 1);
  if (!groups.length) return null;
  return <div className={styles.reviewGroup}>
    <div><h3 className="font-semibold">Cobertura por setor e horário</h3><p className={styles.muted}>Ocorrências equivalentes estão reunidas. A estimativa automática é uma referência de distribuição, não uma necessidade comprovada.</p></div>
    <ul className={styles.coverageGapList}>
      {groups.slice(current * 12, current * 12 + 12).map((row) => <li key={JSON.stringify([row.sector, row.dates, row.start, row.end, row.roles])} className={styles.reviewNotice} data-severity={row.estimated ? "WARNING" : "ERROR"}>
        <div className={styles.header}><h4 className="font-semibold">{row.sector}</h4><span className={styles.statusTag}>{row.kind === "no-service" ? "Sem atendimento nesta faixa" : row.estimated ? "Abaixo da estimativa" : "Mínimo informado não atendido"}</span></div>
        <p className="tabular-nums"><strong>{clock(row.start)}–{clock(row.end)}</strong> · {row.dates.length === 1 ? displayDate(row.dates[0]) : `${row.dates.length} dias entre ${displayDate(row.dates[0])} e ${displayDate(row.dates.at(-1) ?? row.dates[0])}`}</p>
        <dl className={styles.reviewContext}><div><dt>Efetivamente trabalhando</dt><dd>{row.present} pessoa(s), sem contar intervalos, afastamentos ou horários indefinidos.</dd></div><div><dt>Referência utilizada</dt><dd>{row.minimum} pessoa(s) · {row.estimated ? "estimativa automática, não mínimo obrigatório" : "mínimo informado para a operação"}.</dd></div></dl>
        {row.roles.length > 0 && <details><summary className={styles.disclosureTrigger}>Funções nesta faixa</summary><ul className={styles.referenceList}>{row.roles.map((role) => <li key={JSON.stringify([role.role, role.estimated])}>{role.role || "Equipe do setor"}: {role.present} trabalhando / {role.minimum} {role.estimated ? "na referência estimada" : "no mínimo informado"}.</li>)}</ul></details>}
        <p><strong>Ajuste a avaliar:</strong> {row.suggestion}</p>
        {row.dates.length > 1 && <details><summary className={styles.disclosureTrigger}>Consultar os {row.dates.length} dias</summary><p>{row.dates.map(displayDate).join(", ")}</p></details>}
        {onResolve && <button type="button" className={buttonClass} onClick={() => onResolve("coverage", { sector: row.sector, date: row.dates[0] })}>Conferir este setor e horário</button>}
      </li>)}
    </ul>
    {pages > 1 && <div className={styles.actions}><button type="button" className={buttonClass} disabled={!current} onClick={() => setPage(current - 1)}>Anterior</button><span className="text-sm">Página {current + 1} de {pages}</span><button type="button" className={buttonClass} disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Próxima</button></div>}
  </div>;
}

function ReviewNotice({ notice, input, onResolve }: { notice: EscalaDiagnosticNotice; input: EscalaInput; onResolve?: ResolveReview }) {
  const guidance = groupValidationIssues([{ code: notice.code, severity: notice.severity, message: notice.message }])[0]?.guidance;
  const employees = sortEmployees(input.employees.filter((person) => notice.employeeIds.includes(person.id)));
  const context: EscalaRecoveryContext = { ...(employees.length === 1 ? { employeeId: employees[0].id } : {}), ...(notice.dates[0] ? { date: notice.dates[0] } : {}) };
  const title = ["Atenção", "Informação", "Impedimento"].includes(notice.label) ? guidance?.title : notice.label;
  return <li className={styles.reviewNotice} data-severity={notice.severity}>
    <h4 className="font-semibold">{title || "Revisão da proposta"}</h4>
    <p>{notice.message}</p>
    {notice.dates.length > 0 && <p className={styles.muted}><strong>Período afetado:</strong> {notice.dates.length === 1 ? displayDate(notice.dates[0]) : `${displayDate(notice.dates[0])} a ${displayDate(notice.dates.at(-1) ?? notice.dates[0])}`}{notice.dates.length > 1 ? ` · ${notice.dates.length} datas de referência` : ""}.</p>}
    {employees.length === 1 && <p><strong>{employees[0].registration} · {employees[0].name}</strong><span className="block">{employees[0].sector} / {employees[0].role}</span></p>}
    {guidance && guidance.instruction !== notice.message && <p><strong>{notice.severity === "ERROR" ? "Como corrigir:" : "Orientação:"}</strong> {guidance.instruction}</p>}
    {(employees.length > 1 || notice.dates.length > 1) && <details><summary className={styles.disclosureTrigger}>Consultar pessoas e datas</summary>{notice.dates.length > 1 && <p className={styles.muted}>{notice.dates.map(displayDate).join(", ")}</p>}<ul className={styles.referenceList}>{employees.map((person) => <li key={person.id}><strong>{person.registration} · {person.name}</strong><span>{person.sector} / {person.role}</span>{onResolve && <button type="button" className={buttonClass} onClick={() => onResolve("team", { employeeId: person.id, ...(notice.dates[0] ? { date: notice.dates[0] } : {}) })}>Conferir colaborador<span className="sr-only"> {person.name}</span></button>}</li>)}</ul></details>}
    {onResolve && guidance?.target && <button type="button" className={buttonClass} onClick={() => onResolve(guidance.target as ReviewTarget, context)}>{guidance.action}</button>}
  </li>;
}

export function Proposals({ input, generated, disabled, onGenerated, onDismiss }: {
  input: EscalaInput; generated: { result: { status: string; message: string }; proposalInput: EscalaInput; validation: EscalaValidation } | null;
  disabled: boolean; onGenerated: () => void; onDismiss: () => void;
}) {
  if (!generated) return null;
  const diagnostics = buildEscalaDiagnostics(generated.proposalInput, generated.validation.issues);
  return <section className={`${panelClass} border-[color:var(--app-teal)]`} aria-labelledby="escala-proposals-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="escala-proposals-title" className="text-lg font-bold">Proposta pronta para revisão</h2><p className="mt-1 text-sm text-[color:var(--app-muted)]">A sugestão ainda não foi aplicada. Os horários originais e os dias bloqueados foram preservados.</p></div><span className="text-sm font-semibold">{generated.proposalInput.defaultWeeklyHours}h por semana</span></div>
    <p className="text-sm">{generated.result.status === "OPTIMAL" ? "Melhor solução comprovada para o modelo" : "Solução viável encontrada"}. {generated.result.message}</p>
    {diagnostics.coverageGroups.length > 0 && <details><summary className={styles.disclosureTrigger}>Conferir desfalques desta proposta ({diagnostics.coverageGroups.length})</summary><div className={styles.reviewScroller}><CoverageGaps rows={diagnostics.coverageGroups} /></div></details>}
    {diagnostics.notices.length > 0 && <p className="text-sm text-[color:var(--app-muted)]">{diagnostics.notices.length} assunto(s) de revisão. Os limites da simulação aparecem no resumo, sem repetir avisos por pessoa.</p>}
    <Changes input={input} assignments={generated.proposalInput.assignments} />
    <div className="flex flex-wrap gap-3"><button type="button" className={primaryClass} disabled={disabled || !generated.validation.valid} onClick={onGenerated}>Aplicar proposta à grade</button><button type="button" className={buttonClass} disabled={disabled} onClick={onDismiss}>Descartar sugestão</button></div>
  </section>;
}

export type ReviewSection = "errors" | "reviews" | "coverage" | "information";

export function ValidationResults({ input, validation, onResolve, section, onSectionChange }: { input: EscalaInput; validation: EscalaValidation | null; onResolve?: ResolveReview; section?: ReviewSection; onSectionChange?: (section: ReviewSection) => void }) {
  const [selectedView, setView] = useState<ReviewSection>();
  if (!validation) return <section className={panelClass}><h2 className={styles.sectionTitle}>Revisão do cenário</h2><p className="text-sm">A edição ainda não foi conferida. Aguarde o salvamento ou gere uma proposta para atualizar os resultados.</p></section>;
  const diagnostics = buildEscalaDiagnostics(input, validation.issues);
  const errors = diagnostics.notices.filter(notice => notice.severity === "ERROR");
  const reviews = diagnostics.notices.filter(notice => notice.severity === "PENDING");
  const information = diagnostics.notices.filter(notice => notice.severity === "WARNING");
  const reservations = validation.boundaryReservations ?? [];
  const employees = sortEmployees(input.employees.filter(person => person.planningEnabled !== false));
  const view = section ?? selectedView ?? (errors.length ? "errors" : diagnostics.coverageGroups.length ? "coverage" : reviews.length ? "reviews" : information.length ? "information" : "errors");
  const notices = view === "errors" ? errors : view === "reviews" ? reviews : information;
  const menus = [{ id: "errors", label: "Erros", count: errors.length }, { id: "reviews", label: "Avisos", count: reviews.length }, { id: "coverage", label: "Desfalques", count: diagnostics.coverageGroups.length }, { id: "information", label: "Informações", count: information.length }] as const;
  return <section className={panelClass} aria-labelledby="escala-validation-title">
    <div className={styles.header}><h2 id="escala-validation-title" className={styles.sectionTitle}>Central de revisão</h2><span className={styles.muted}>{errors.length} erro(s) · {reviews.length} aviso(s)</span></div>
    <p className="text-sm">{errors.length ? "Há impedimentos técnicos. Escolha uma ocorrência para conferir a correção sugerida." : "Nenhum impedimento técnico detectado. Avisos e estimativas ficam separados para consulta opcional."}</p>
    <fieldset className={styles.reviewTabs}><legend className="sr-only">Tipo de revisão</legend>{menus.map(menu => <button type="button" key={menu.id} className={buttonClass} aria-pressed={view === menu.id} aria-controls="escala-review-content" onClick={() => { setView(menu.id); onSectionChange?.(menu.id); }}>{menu.label} ({menu.count})</button>)}</fieldset>
    <section id="escala-review-content" className={styles.reviewScroller} aria-label={(menus.find(menu => menu.id === view)?.label ?? "Revisão") + " da escala"}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the review region.
      tabIndex={0}>
      {view === "coverage" ? diagnostics.coverageGroups.length ? <CoverageGaps rows={diagnostics.coverageGroups} onResolve={onResolve} /> : <p>Nenhum desfalque detectado nas faixas com referência disponível.</p> : <>
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
        <table className="w-full text-left text-sm"><caption className="py-2 text-left font-semibold">Apuração por colaborador</caption><thead><tr><th scope="col" className="p-2">Setor / cargo / colaborador</th><th scope="col" className="p-2">Horas</th><th scope="col" className="p-2">Trabalho / folgas</th><th scope="col" className="p-2">Sequência máxima</th><th scope="col" className="p-2">Domingos trabalhados</th></tr></thead><tbody>{employees.map(person => {
          const summary = validation.summaries.find(item => item.employeeId === person.id);
          return summary ? <tr key={person.id}><th scope="row" className="p-2 font-normal">{person.sector} / {person.role}<span className="block font-semibold">{person.name} · {person.registration}</span></th><td className="p-2">{person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING" ? "Não apuradas" : clock(summary.workedMinutes)}</td><td className="p-2">{summary.workDays} / {summary.offDays}</td><td className="p-2">{summary.maxStreak} dias</td><td className="p-2">{summary.sundaysWorked}</td></tr> : null;
        })}</tbody></table>
      </div>}
    </section>
  </section>;
}

export { Publication } from "./publication";
