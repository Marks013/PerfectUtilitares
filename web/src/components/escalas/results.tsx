"use client";

import { useState } from "react";
import { sortEmployees } from "@/lib/escalas/order";
import type {
  EscalaAssignment,
  EscalaInput,
  EscalaIssue,
  EscalaValidation,
  EscalaWorkspace,
} from "@/lib/escalas/types";
import { buttonClass, Check, panelClass, primaryClass } from "./controls";
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

export function Proposals({
  input,
  generated,
  disabled,
  onGenerated,
  onDismiss,
}: {
  input: EscalaInput;
  generated: {
    result: { status: string; message: string };
    proposalInput: EscalaInput;
    validation: EscalaValidation;
  } | null;
  disabled: boolean;
  onGenerated: () => void;
  onDismiss: () => void;
}) {
  if (!generated) return null;
  const coverageGaps = generated.validation.issues.filter((issue) => issue.code === "ESTIMATED_COVERAGE_GAP");
  return (
    <section className={`${panelClass} border-[color:var(--app-teal)]`} aria-labelledby="escala-proposals-title">
      <h2 id="escala-proposals-title" className="text-lg font-bold">
        Sugestão em massa pronta para conferir
      </h2>
      <p className="text-sm">
        A sugestão ainda não foi aplicada. Confira as folgas de toda a filial e os horários propostos. Aplicar atualiza
        o rascunho exibido; a publicação continua dependendo da sua conferência.
      </p>
      {generated && (
        <div className="space-y-3">
          <p className="font-semibold">
            {generated.result.status === "OPTIMAL"
              ? "Melhor solução comprovada para o modelo"
              : "Solução viável encontrada"}
          </p>
          <p className="text-sm">{generated.result.message}</p>
          <p className="text-sm">
            Conferência independente: {generated.validation.issues.filter((issue) => issue.severity === "ERROR").length}{" "}
            impeditivos e {generated.validation.issues.filter((issue) => issue.severity === "PENDING").length}{" "}
            pendências.
          </p>
          {coverageGaps.length > 0 && <div className="space-y-2 border-l-4 border-[color:var(--app-coral)] pl-3">
            <p className="text-sm font-semibold">Cobertura a ajustar: {coverageGaps.length} faixa(s) abaixo da estimativa.</p>
            <p className="text-sm">O rascunho pode ser aplicado para conferência. A publicação depende de ajustar a cobertura; os mínimos já confirmados continuam obrigatórios.</p>
            <IssueDetails input={generated.proposalInput} issues={coverageGaps} />
          </div>}
          <Changes input={input} assignments={generated.proposalInput.assignments} />
          <button
            type="button"
            className={primaryClass}
            disabled={disabled || !generated.validation.valid}
            onClick={onGenerated}
          >
            Aplicar proposta à grade
          </button>
        </div>
      )}
      <button type="button" className={buttonClass} disabled={disabled} onClick={onDismiss}>
        Descartar sugestão
      </button>
    </section>
  );
}

function IssueDetails({ input, issues }: { input: EscalaInput; issues: EscalaIssue[] }) {
  const [page, setPage] = useState(0);
  const names = new Map(input.employees.map((employee) => [employee.id, employee]));
  const pages = Math.max(1, Math.ceil(issues.length / 25));
  const current = Math.min(page, pages - 1);
  return <details className="space-y-2">
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Ver detalhes ({issues.length})</summary>
    <ul className="space-y-2 text-sm">
      {issues.slice(current * 25, current * 25 + 25).map((issue) => {
        const employee = issue.employeeId ? names.get(issue.employeeId) : undefined;
        return <li key={JSON.stringify([issue.code, issue.employeeId, issue.date, issue.message])} className="border-t border-[color:var(--app-border)] pt-2">
          {employee && <p className="font-semibold">{employee.sector} / {employee.role} · {employee.name} ({employee.registration})</p>}
          <p>{issue.date ? `${displayDate(issue.date)} · ` : ""}{employee ? `${employee.name}: ` : ""}{issue.message}</p>
        </li>;
      })}
    </ul>
    {pages > 1 && <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={buttonClass} disabled={current === 0} onClick={() => setPage(current - 1)}>Anterior</button>
      <span className="text-sm">Página {current + 1} de {pages}</span>
      <button type="button" className={buttonClass} disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Próxima</button>
    </div>}
  </details>;
}

export function ValidationResults({ input, validation, onResolve }: { input: EscalaInput; validation: EscalaValidation | null; onResolve?: (target: ReviewTarget) => void }) {
  if (!validation)
    return (
      <section className={panelClass}>
        <h2 className="text-lg font-bold">Conferência da filial</h2>
        <p className="text-sm">
          Os dados foram alterados. Execute a conferência ou salve a revisão para atualizar os resultados.
        </p>
      </section>
    );
  const orderedEmployees = sortEmployees(input.employees);
  const warnings = validation.issues.filter((issue) => issue.severity === "WARNING");
  const issues = validation.issues.filter((issue) => issue.severity !== "WARNING");
  const groups = groupValidationIssues(issues);
  const ungenerated = !input.assignments.some((item) => item.kind === "WORK" || item.kind === "DUTY");
  const reservations = validation.boundaryReservations ?? [];
  return (
    <section className={panelClass} aria-labelledby="escala-validation-title">
      <h2 id="escala-validation-title" className="text-lg font-bold">
        Conferência da filial
      </h2>
      <p className="font-semibold">
        {validation.readyToPublish
          ? "Conferência concluída: pronta para aprovação interna"
          : ungenerated && input.employees.length > 0
            ? "Equipe pronta para receber sugestões em massa"
          : validation.valid
            ? "Sem conflitos detectados, com pendências para publicar"
            : "Existem conflitos que precisam ser resolvidos"}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span>{groups.filter((group) => group.severity === "ERROR").length} impeditivos</span>
        <span>{groups.filter((group) => group.severity === "PENDING").length} pendências</span>
        <span>
          Margem mínima de cobertura:{" "}
          {validation.minimumCoverageMargin === null ? "não aferida" : validation.minimumCoverageMargin}
        </span>
      </div>
      {groups.length > 0 && <div className="space-y-3">
        <p className="text-sm">{groups.length} assunto(s) para resolver. Ocorrências repetidas foram agrupadas.</p>
        {groups.map((group) => <div key={group.key} className="app-radius-lg border border-[color:var(--app-border)] p-4">
          <h3 className="font-semibold">{group.guidance.title}</h3>
          <p className="mt-1 text-sm">{group.guidance.instruction}</p>
          {onResolve && group.guidance.target && <button type="button" className={`${buttonClass} mt-3`} onClick={() => onResolve(group.guidance.target as ReviewTarget)}>{group.guidance.action}</button>}
          <IssueDetails input={input} issues={group.issues} />
        </div>)}
      </div>}
      {warnings.length > 0 && (
        <details className="space-y-2">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Limites de conferência ({warnings.length})</summary>
          <p className="text-sm">Estes avisos não impedem a publicação interna da proposta. A conferência não certifica conformidade legal completa.</p>
          {groupValidationIssues(warnings).map((group) => <IssueDetails key={group.key} input={input} issues={group.issues} />)}
        </details>
      )}
      {reservations.length > 0 && (
        <details className="space-y-3">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">
            Folgas fixas reservadas para continuidade
          </summary>
          <p className="text-sm text-[color:var(--app-muted)]">
            Estas folgas fixas adjacentes precisam ser mantidas na próxima escala para preservar a continuidade do
            descanso. São reservas explícitas da configuração do colaborador, fora do período desta proposta; não são
            dias publicados dentro deste horizonte.
          </p>
          <ul className="max-h-80 space-y-3 overflow-y-auto text-sm">
            {orderedEmployees.map((employee) => {
              const dates = reservations
                .filter((reservation) => reservation.employeeId === employee.id)
                .map((reservation) => reservation.date)
                .sort();
              return dates.length > 0 ? (
                <li key={employee.id} className="border-b border-[color:var(--app-border)] pb-3">
                  <p className="font-semibold">
                    {employee.sector || "Sem setor informado"} / {employee.role || "Sem cargo informado"}
                  </p>
                  <p>
                    {employee.name} · {employee.registration}
                  </p>
                  <p>Folga fixa reservada: {dates.map(displayDate).join(", ")}</p>
                </li>
              ) : null;
            })}
          </ul>
        </details>
      )}
      <details className="space-y-3">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">Conferência por colaborador (opcional)</summary>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Apuração por colaborador em todo o período da proposta</caption>
            <thead>
              <tr>
                <th scope="col" className="p-2">
                  Setor / cargo / colaborador
                </th>
                <th scope="col" className="p-2">
                  Horas computadas
                </th>
                <th scope="col" className="p-2">
                  Trabalho / folgas
                </th>
                <th scope="col" className="p-2">
                  Maior sequência
                </th>
                <th scope="col" className="p-2">
                  Domingos trabalhados
                </th>
              </tr>
            </thead>
            <tbody>
              {orderedEmployees.map((employee) => {
                const summary = validation.summaries.find((item) => item.employeeId === employee.id);
                return summary ? (
                  <tr key={employee.id} className="border-t border-[color:var(--app-border)]">
                    <th scope="row" className="p-2 font-normal">
                      {employee.sector} / {employee.role}
                      <span className="block font-semibold">
                        {employee.name} · {employee.registration}
                      </span>
                    </th>
                    <td className="p-2 tabular-nums">{(employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING") ? "Horas não apuradas" : clock(summary.workedMinutes)}</td>
                    <td className="p-2">
                      {summary.workDays} / {summary.offDays}
                    </td>
                    <td className="p-2">{summary.maxStreak} dias</td>
                    <td className="p-2">{summary.sundaysWorked}</td>
                  </tr>
                ) : null;
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

export function Publication({ workspace, validation, dirty, busy, onPublish }: {
  workspace: EscalaWorkspace; validation: EscalaValidation | null; dirty: boolean; busy: boolean; onPublish: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const ready = workspace.canPublish && !dirty && !busy && Boolean(validation?.readyToPublish) && workspace.status !== "PUBLISHED";
  return <section className={panelClass} aria-labelledby="escala-publication-title">
    <h2 id="escala-publication-title" className="text-lg font-bold">Exportar proposta</h2>
    <p className="text-sm">PDF e Excel usam a mesma grade mensal da revisão salva {workspace.revision}. Advertências não impedem exportar um rascunho identificado.</p>
    <div className="flex flex-wrap gap-3">
      {(["pdf", "xlsx"] as const).map((format) => !dirty && !busy ? <a key={format}
        href={`/api/escalas/export?id=${encodeURIComponent(workspace.id)}&revision=${workspace.revision}&format=${format}`}
        download className={buttonClass}>Baixar {format.toUpperCase()} {workspace.status === "DRAFT" ? "da proposta" : "publicado"}</a>
        : <button key={format} type="button" disabled className={buttonClass}>Baixar {format.toUpperCase()}</button>)}
    </div>
    <p className="text-xs text-[color:var(--app-muted)]">Os arquivos usam a revisão salva, com identificação de rascunho quando aplicável. Salve as alterações para exportar.</p>
    <details className="space-y-3 border-t border-[color:var(--app-border)] pt-3">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Aprovação interna (opcional para simular e exportar)</summary>
      <p className="text-sm">A publicação aprova internamente os dados da revisão {workspace.revision} e registra uma versão preservada. Alterações posteriores formam uma nova proposta. Não há envio a colaboradores, integração com ponto ou lançamento em folha. A aprovação interna preserva os limites de conferência informados e não certifica conformidade legal completa.</p>
      <Check label={`Conferi a equipe, os horários, a cobertura e as regras da filial ${workspace.input.branchCode} para esta revisão`} checked={confirmed} disabled={!ready} onChange={setConfirmed} />
      <button type="button" className={primaryClass} disabled={!ready || !confirmed} onClick={onPublish}>{workspace.status === "PUBLISHED" ? "Revisão já publicada" : "Publicar proposta"}</button>
      {!ready && workspace.status !== "PUBLISHED" && <p className="text-sm text-[color:var(--app-muted)]">Resolva todos os impeditivos e pendências, salve a revisão e utilize um perfil autorizado a aprovar. Isso não impede exportar o rascunho salvo.</p>}
    </details>
  </section>;
}
