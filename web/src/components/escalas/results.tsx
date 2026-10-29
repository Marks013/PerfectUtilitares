"use client";

import { useRef, useState, type MouseEvent } from "react";
import { buildEscalaDiagnostics, type EscalaDiagnosticNotice } from "@/lib/escalas/diagnostics";
import type { EscalaExportMode } from "@/lib/escalas/presentation";
import { consolidateCoverageGaps } from "@/lib/escalas/coverage-presence";
import type { EscalaRecoveryContext } from "./recovery-navigation";
import styles from "./escalas.module.css";
import { sortEmployees } from "@/lib/escalas/order";
import type {
  EscalaAssignment,
  EscalaInput,
  EscalaValidation,
  EscalaWorkspace,
} from "@/lib/escalas/types";
import { buttonClass, Check, controlClass, Field, panelClass, primaryClass } from "./controls";
import { clock, displayDate } from "./workspace-model";
import { ProcessingBar } from "./workspace-feedback";
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
    {diagnostics.coverageGroups.length > 0 && <CoverageGaps rows={diagnostics.coverageGroups} />}
    {diagnostics.notices.length > 0 && <p className="text-sm text-[color:var(--app-muted)]">{diagnostics.notices.length} assunto(s) de revisão. Os limites da simulação aparecem no resumo, sem repetir avisos por pessoa.</p>}
    <Changes input={input} assignments={generated.proposalInput.assignments} />
    <div className="flex flex-wrap gap-3"><button type="button" className={primaryClass} disabled={disabled || !generated.validation.valid} onClick={onGenerated}>Aplicar proposta à grade</button><button type="button" className={buttonClass} disabled={disabled} onClick={onDismiss}>Descartar sugestão</button></div>
  </section>;
}

export function ValidationResults({ input, validation, onResolve }: { input: EscalaInput; validation: EscalaValidation | null; onResolve?: ResolveReview }) {
  if (!validation) return <section className={panelClass}><h2 className="text-lg font-bold">Resumo da revisão</h2><p className="text-sm">Os dados foram alterados. Gere a proposta novamente ou salve as edições manuais para atualizar os resultados.</p></section>;
  const diagnostics = buildEscalaDiagnostics(input, validation.issues);
  const errors = diagnostics.notices.filter((notice) => notice.severity === "ERROR");
  const reviews = diagnostics.notices.filter((notice) => notice.severity === "PENDING");
  const information = diagnostics.notices.filter((notice) => notice.severity === "WARNING");
  const reservations = validation.boundaryReservations ?? [];
  const orderedEmployees = sortEmployees(input.employees.filter((employee) => employee.planningEnabled !== false));
  return <section className={panelClass} aria-labelledby="escala-validation-title">
    <div className={styles.header}><h2 id="escala-validation-title" className={styles.sectionTitle}>Conferência da proposta</h2><span className="text-sm">{errors.length} impedimento(s) · {reviews.length} ponto(s) para revisar</span></div>
    <p className="text-sm font-semibold">{errors.length ? "Corrija os impedimentos antes de aplicar a proposta." : diagnostics.coverageGroups.some((row) => !row.estimated) ? "Há mínimos informados que precisam de ajuste de cobertura." : diagnostics.coverageGroups.length ? "Confira a distribuição nos horários abaixo da estimativa automática." : "Nenhum impedimento técnico detectado nos dados conferidos."}</p>
    {errors.length > 0 && <section className={styles.reviewGroup} aria-label="Impedimentos"><h3 className="font-semibold">Exige correção ({errors.length})</h3><ul className={styles.coverageGapList}>{errors.map((notice) => <ReviewNotice key={JSON.stringify([notice.code, notice.message, notice.employeeIds])} notice={notice} input={input} onResolve={onResolve} />)}</ul></section>}
    {diagnostics.coverageGroups.length > 0 && <CoverageGaps rows={diagnostics.coverageGroups} onResolve={onResolve} />}
    {reviews.length > 0 && <section className={styles.reviewGroup} aria-label="Pontos para revisar"><h3 className="font-semibold">Pode continuar com revisão ({reviews.length})</h3><p className={styles.muted}>Estes pontos não impedem o rascunho. Confira o impacto indicado antes de usar a proposta.</p><ul className={styles.coverageGapList}>{reviews.map((notice) => <ReviewNotice key={JSON.stringify([notice.code, notice.message, notice.employeeIds])} notice={notice} input={input} onResolve={onResolve} />)}</ul></section>}
    {information.length > 0 && <details className={styles.reviewGroup}><summary className={styles.disclosureTrigger}>Informações e limites de conferência ({information.length})</summary><p className={styles.muted}>Tratamentos realizados e limites dos dados disponíveis. A simulação não certifica conformidade legal completa.</p><ul className={styles.coverageGapList}>{information.map((notice) => <ReviewNotice key={JSON.stringify([notice.code, notice.message, notice.employeeIds])} notice={notice} input={input} onResolve={onResolve} />)}</ul></details>}
    {reservations.length > 0 && <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Folgas fixas reservadas para continuidade</summary><p className="text-sm text-[color:var(--app-muted)]">Estas folgas precisam ser mantidas na próxima escala para preservar a continuidade. São reservas fora da proposta; não são dias publicados dentro deste horizonte.</p><ul className="max-h-80 space-y-3 overflow-y-auto text-sm">{orderedEmployees.map((employee) => {
      const dates = reservations.filter((reservation) => reservation.employeeId === employee.id).map((reservation) => reservation.date).sort();
      return dates.length ? <li key={employee.id} className="border-b border-[color:var(--app-border)] pb-3"><p className="font-semibold">{employee.sector || "Sem setor informado"} / {employee.role || "Sem cargo informado"}</p><p>{employee.name} · {employee.registration}</p><p>Folga fixa reservada: {dates.map(displayDate).join(", ")}</p></li> : null;
    })}</ul></details>}
    <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Conferência por colaborador (opcional)</summary><div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Apuração por colaborador no mês da proposta</caption><thead><tr><th scope="col" className="p-2">Setor / cargo / colaborador</th><th scope="col" className="p-2">Horas computadas</th><th scope="col" className="p-2">Trabalho / folgas</th><th scope="col" className="p-2">Maior sequência</th><th scope="col" className="p-2">Domingos trabalhados</th></tr></thead><tbody>{orderedEmployees.map((employee) => {
      const summary = validation.summaries.find((item) => item.employeeId === employee.id);
      return summary ? <tr key={employee.id} className="border-t border-[color:var(--app-border)]"><th scope="row" className="p-2 font-normal">{employee.sector} / {employee.role}<span className="block font-semibold">{employee.name} · {employee.registration}</span></th><td className="p-2 tabular-nums">{employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING" ? "Horas não apuradas" : clock(summary.workedMinutes)}</td><td className="p-2">{summary.workDays} / {summary.offDays}</td><td className="p-2">{summary.maxStreak} dias</td><td className="p-2">{summary.sundaysWorked}</td></tr> : null;
    })}</tbody></table></div></details>
  </section>;
}

export function Publication({ workspace, validation, dirty, busy, outdated = false, mode = "both", onModeChange, onPublish, onRegenerate }: {
  workspace: EscalaWorkspace; validation: EscalaValidation | null; dirty: boolean; busy: boolean; outdated?: boolean; mode?: EscalaExportMode; onModeChange?: (mode: EscalaExportMode) => void; onPublish: () => void; onRegenerate?: () => void;
}) {
  const [localMode, setLocalMode] = useState<EscalaExportMode>(mode);
  const selectedMode = onModeChange ? mode : localMode;
  const [confirmed, setConfirmed] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const exportingRef = useRef(false);
  const blocked = dirty || busy || outdated || Boolean(exporting);
  const ready = workspace.canPublish && !blocked && Boolean(validation?.readyToPublish) && workspace.status !== "PUBLISHED";
  const url = (format: "pdf" | "xlsx") => `/api/escalas/export?id=${encodeURIComponent(workspace.id)}&revision=${workspace.revision}&format=${format}&mode=${selectedMode}`;
  async function download(event: MouseEvent<HTMLAnchorElement>, format: "pdf" | "xlsx") {
    event.preventDefault();
    if (blocked || exportingRef.current) return;
    exportingRef.current = true;
    setExporting(format); setFeedback(""); setError("");
    try {
      const response = await fetch(url(format), { cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error("Não foi possível preparar o arquivo. Salve a revisão e tente novamente.");
      const blob = await response.blob();
      if (!blob.size) throw new Error("O arquivo retornou vazio. Tente exportar novamente.");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `escala-${workspace.input.branchCode.replace(/[^a-zA-Z0-9_-]/g, "-")}-${workspace.input.visibleMonth ?? workspace.input.startDate}-r${workspace.revision}-${selectedMode}.${format}`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setFeedback(`${format.toUpperCase()} preparado. Download iniciado.`);
    } catch (cause) { setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "A exportação demorou além do esperado. Os dados foram preservados; tente novamente."); }
    finally { exportingRef.current = false; setExporting(null); }
  }
  return <section className={panelClass} aria-labelledby="escala-publication-title">
    <Field label="Conteúdo do PDF e XLSX">{id => <select id={id} className={controlClass} disabled={blocked} value={selectedMode} onChange={event => { const value = event.target.value as EscalaExportMode; if (onModeChange) onModeChange(value); else setLocalMode(value); }}><option value="rest">Somente escala de folgas</option><option value="hours">Somente escala de horários</option><option value="both">Folgas e horários</option></select>}</Field>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="escala-publication-title" className="text-lg font-bold">Exportar proposta</h2><p className="mt-1 text-sm text-[color:var(--app-muted)]">PDF e Excel usam a mesma grade mensal da revisão salva {workspace.revision}.</p></div><div className="flex flex-wrap gap-2">{(["pdf", "xlsx"] as const).map((format) => !blocked ? <a key={format} href={url(format)} download className={buttonClass} onClick={(event) => { void download(event, format); }}>Baixar {format.toUpperCase()}</a> : <button key={format} type="button" disabled className={buttonClass}>{exporting === format ? `Preparando ${format.toUpperCase()}…` : `Baixar ${format.toUpperCase()}`}</button>)}</div></div>
    {outdated ? <p className="text-sm"><strong>Cenário alterado.</strong> Gere e aplique uma proposta atualizada antes de exportar.{onRegenerate && <button type="button" className={`${buttonClass} mt-3 block`} disabled={busy} onClick={onRegenerate}>Gerar proposta atualizada</button>}</p> : dirty ? <p className="text-sm">Salve a revisão para exportar as edições atuais.</p> : <p className="text-xs text-[color:var(--app-muted)]">Rascunhos levam essa identificação; avisos da simulação não impedem o download.</p>}
    <p role="status" aria-live="polite" aria-atomic="true" className="text-sm">{exporting ? `Processando: preparando ${exporting.toUpperCase()} da revisão ${workspace.revision}…` : feedback}</p>
    {exporting && <ProcessingBar label={`Preparando arquivo ${exporting.toUpperCase()}`} />}
    {error && <p role="alert" className="text-sm text-[color:var(--app-coral)]">{error}</p>}
    <details className="space-y-3 border-t border-[color:var(--app-border)] pt-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Aprovação interna (opcional)</summary><p className="text-sm">Preserva uma revisão conferida e não certifica conformidade legal completa. Não há envio a colaboradores, integração com ponto ou lançamento em folha.</p><Check label={`Conferi a equipe, os horários, a cobertura e as regras da filial ${workspace.input.branchCode} para esta revisão`} checked={confirmed} disabled={!ready} onChange={setConfirmed} /><button type="button" className={primaryClass} disabled={!ready || !confirmed} onClick={onPublish}>{workspace.status === "PUBLISHED" ? "Revisão já publicada" : "Publicar proposta"}</button>{!ready && workspace.status !== "PUBLISHED" && <p className="text-sm text-[color:var(--app-muted)]">A aprovação exige revisão salva, conferida e perfil autorizado. Isso não impede exportar um rascunho atualizado.</p>}</details>
  </section>;
}
