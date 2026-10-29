"use client";

import { useRef, useState, type MouseEvent } from "react";
import { buildEscalaDiagnostics } from "@/lib/escalas/diagnostics";
import { sortEmployees } from "@/lib/escalas/order";
import type {
  EscalaAssignment,
  EscalaInput,
  EscalaValidation,
  EscalaWorkspace,
} from "@/lib/escalas/types";
import { buttonClass, Check, panelClass, primaryClass } from "./controls";
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

function CoverageGaps({ rows }: { rows: ReturnType<typeof buildEscalaDiagnostics>["coverage"] }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / 15));
  const current = Math.min(page, pages - 1);
  if (!rows.length) return null;
  return <div className="space-y-3">
    <p className="text-sm font-semibold">{rows.length} faixa(s) com cobertura a ajustar</p>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Faltas por setor, função, dia e faixa de horário</caption>
        <thead><tr><th scope="col" className="p-2">Setor / função</th><th scope="col" className="p-2">Dia e faixa</th><th scope="col" className="p-2">Equipe faltante</th></tr></thead>
        <tbody>{rows.slice(current * 15, current * 15 + 15).map((row) => <tr key={JSON.stringify([row.sector, row.role, row.date, row.start, row.end])} className="border-t border-[color:var(--app-border)]">
          <th scope="row" className="p-2 font-normal"><strong>{row.sector}</strong>{row.role && <span className="block text-[color:var(--app-muted)]">{row.role}</span>}</th>
          <td className="p-2 tabular-nums">{displayDate(row.date)}<span className="block">{clock(row.start)}–{clock(row.end)}</span></td>
          <td className="p-2"><strong>Faltam {row.missing}</strong><span className="block text-xs text-[color:var(--app-muted)]">{row.present} presente(s) / {row.minimum} {row.estimated ? "estimados" : "necessários"}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
    {pages > 1 && <div className="flex flex-wrap items-center gap-3"><button type="button" className={buttonClass} disabled={!current} onClick={() => setPage(current - 1)}>Anterior</button><span className="text-sm">Página {current + 1} de {pages}</span><button type="button" className={buttonClass} disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Próxima</button></div>}
  </div>;
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
    {diagnostics.coverage.length > 0 && <CoverageGaps rows={diagnostics.coverage} />}
    {diagnostics.notices.length > 0 && <p className="text-sm text-[color:var(--app-muted)]">{diagnostics.notices.length} assunto(s) de revisão. Os limites da simulação aparecem no resumo, sem repetir avisos por pessoa.</p>}
    <Changes input={input} assignments={generated.proposalInput.assignments} />
    <div className="flex flex-wrap gap-3"><button type="button" className={primaryClass} disabled={disabled || !generated.validation.valid} onClick={onGenerated}>Aplicar proposta à grade</button><button type="button" className={buttonClass} disabled={disabled} onClick={onDismiss}>Descartar sugestão</button></div>
  </section>;
}

export function ValidationResults({ input, validation, onResolve }: { input: EscalaInput; validation: EscalaValidation | null; onResolve?: (target: ReviewTarget) => void }) {
  if (!validation) return <section className={panelClass}><h2 className="text-lg font-bold">Resumo da revisão</h2><p className="text-sm">Os dados foram alterados. Gere a proposta novamente ou salve as edições manuais para atualizar os resultados.</p></section>;
  const diagnostics = buildEscalaDiagnostics(input, validation.issues);
  const errors = diagnostics.notices.filter((notice) => notice.severity === "ERROR");
  const limits = diagnostics.notices.filter((notice) => notice.severity !== "ERROR");
  const reservations = validation.boundaryReservations ?? [];
  const orderedEmployees = sortEmployees(input.employees);
  const names = new Map(input.employees.map((employee) => [employee.id, employee.name]));
  return <section className={panelClass} aria-labelledby="escala-validation-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="escala-validation-title" className="text-lg font-bold">Resumo da revisão</h2><span className="text-sm">{errors.length} impeditivos · {limits.filter((notice) => notice.severity === "PENDING").length} pendências</span></div>
    <p className="text-sm font-semibold">{errors.length ? "Há conflitos concretos para ajustar no rascunho." : diagnostics.coverage.length ? "Confira as faixas com falta de equipe." : "Nenhum conflito técnico detectado nas faixas conferidas."}</p>
    {diagnostics.coverage.length > 0 && <CoverageGaps rows={diagnostics.coverage} />}
    {errors.map((notice) => {
      const guidance = groupValidationIssues([{ code: notice.code, severity: notice.severity, message: notice.message }])[0]?.guidance;
      return <div key={JSON.stringify([notice.code, notice.message, notice.employeeIds])} className="border-l-4 border-[color:var(--app-coral)] pl-3 text-sm"><h3 className="font-semibold">{notice.label}</h3>{!notice.global && notice.employeeIds.length > 0 && <p className="mt-1">{notice.employeeIds.map((id) => names.get(id) ?? "Colaborador não identificado").join(", ")}</p>}<p className="mt-1">{notice.message}</p>{notice.dates.length > 0 && <p className="mt-1 text-[color:var(--app-muted)]">{notice.dates.map(displayDate).join(", ")}</p>}{onResolve && guidance?.target && <button type="button" className={`${buttonClass} mt-2`} onClick={() => onResolve(guidance.target as ReviewTarget)}>{guidance.action}</button>}</div>;
    })}
    {limits.length > 0 && <details className="space-y-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Limites de conferência ({limits.length})</summary><p className="text-sm text-[color:var(--app-muted)]">Pendências documentais e histórico incompleto não impedem o rascunho. A simulação não certifica conformidade legal completa.</p><ul className="space-y-3 text-sm">{limits.map((notice) => <li key={notice.code + notice.message} className="border-t border-[color:var(--app-border)] pt-3"><strong>{notice.label}</strong><p className="mt-1">{notice.message}</p>{notice.code === "DAY_PENDING" && onResolve && <button type="button" className={`${buttonClass} mt-2`} onClick={() => onResolve("generate")}>Gerar proposta mensal</button>}</li>)}</ul></details>}
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

export function Publication({ workspace, validation, dirty, busy, outdated = false, onPublish, onRegenerate }: {
  workspace: EscalaWorkspace; validation: EscalaValidation | null; dirty: boolean; busy: boolean; outdated?: boolean; onPublish: () => void; onRegenerate?: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "xlsx" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const exportingRef = useRef(false);
  const blocked = dirty || busy || outdated || Boolean(exporting);
  const ready = workspace.canPublish && !blocked && Boolean(validation?.readyToPublish) && workspace.status !== "PUBLISHED";
  const url = (format: "pdf" | "xlsx") => `/api/escalas/export?id=${encodeURIComponent(workspace.id)}&revision=${workspace.revision}&format=${format}`;
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
      anchor.download = `escala-${workspace.input.branchCode.replace(/[^a-zA-Z0-9_-]/g, "-")}-${workspace.input.visibleMonth ?? workspace.input.startDate}-r${workspace.revision}.${format}`;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      setFeedback(`${format.toUpperCase()} preparado. Download iniciado.`);
    } catch (cause) { setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "A exportação demorou além do esperado. Os dados foram preservados; tente novamente."); }
    finally { exportingRef.current = false; setExporting(null); }
  }
  return <section className={panelClass} aria-labelledby="escala-publication-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="escala-publication-title" className="text-lg font-bold">Exportar proposta</h2><p className="mt-1 text-sm text-[color:var(--app-muted)]">PDF e Excel usam a mesma grade mensal da revisão salva {workspace.revision}.</p></div><div className="flex flex-wrap gap-2">{(["pdf", "xlsx"] as const).map((format) => !blocked ? <a key={format} href={url(format)} download className={buttonClass} onClick={(event) => { void download(event, format); }}>Baixar {format.toUpperCase()}</a> : <button key={format} type="button" disabled className={buttonClass}>{exporting === format ? `Preparando ${format.toUpperCase()}…` : `Baixar ${format.toUpperCase()}`}</button>)}</div></div>
    {outdated ? <p className="text-sm"><strong>Cenário alterado.</strong> Gere e aplique uma proposta atualizada antes de exportar.{onRegenerate && <button type="button" className={`${buttonClass} mt-3 block`} disabled={busy} onClick={onRegenerate}>Gerar proposta atualizada</button>}</p> : dirty ? <p className="text-sm">Salve a revisão para exportar as edições atuais.</p> : <p className="text-xs text-[color:var(--app-muted)]">Rascunhos levam essa identificação; avisos da simulação não impedem o download.</p>}
    <p role="status" aria-live="polite" aria-atomic="true" className="text-sm">{exporting ? `Processando: preparando ${exporting.toUpperCase()} da revisão ${workspace.revision}…` : feedback}</p>
    {exporting && <ProcessingBar label={`Preparando arquivo ${exporting.toUpperCase()}`} />}
    {error && <p role="alert" className="text-sm text-[color:var(--app-coral)]">{error}</p>}
    <details className="space-y-3 border-t border-[color:var(--app-border)] pt-3"><summary className="min-h-11 cursor-pointer py-2 font-semibold">Aprovação interna (opcional)</summary><p className="text-sm">Preserva uma revisão conferida e não certifica conformidade legal completa. Não há envio a colaboradores, integração com ponto ou lançamento em folha.</p><Check label={`Conferi a equipe, os horários, a cobertura e as regras da filial ${workspace.input.branchCode} para esta revisão`} checked={confirmed} disabled={!ready} onChange={setConfirmed} /><button type="button" className={primaryClass} disabled={!ready || !confirmed} onClick={onPublish}>{workspace.status === "PUBLISHED" ? "Revisão já publicada" : "Publicar proposta"}</button>{!ready && workspace.status !== "PUBLISHED" && <p className="text-sm text-[color:var(--app-muted)]">A aprovação exige revisão salva, conferida e perfil autorizado. Isso não impede exportar um rascunho atualizado.</p>}</details>
  </section>;
}
