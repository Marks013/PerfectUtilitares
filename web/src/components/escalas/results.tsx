"use client";

import { useState } from "react";
import { sortEmployees } from "@/lib/escalas/order";
import type {
  EscalaAssignment,
  EscalaInput,
  EscalaSuggestion,
  EscalaValidation,
  EscalaWorkspace,
} from "@/lib/escalas/types";
import { buttonClass, Check, panelClass, primaryClass } from "./controls";
import { clock, displayDate } from "./workspace-model";

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
  suggestions,
  disabled,
  onGenerated,
  onSuggestion,
  onDismiss,
}: {
  input: EscalaInput;
  generated: {
    result: { status: string; message: string };
    proposalInput: EscalaInput;
    validation: EscalaValidation;
  } | null;
  suggestions: EscalaSuggestion[];
  disabled: boolean;
  onGenerated: () => void;
  onSuggestion: (suggestion: EscalaSuggestion) => void;
  onDismiss: () => void;
}) {
  if (!generated && !suggestions.length) return null;
  return (
    <section className={`${panelClass} border-[color:var(--app-teal)]`} aria-labelledby="escala-proposals-title">
      <h2 id="escala-proposals-title" className="text-lg font-bold">
        Prévia das alternativas
      </h2>
      <p className="text-sm">
        Nada foi gravado. Aplicar substitui a proposta completa exibida e invalida as outras alternativas. Sugestões
        isoladas não podem ser somadas sem uma nova análise conjunta.
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
      {suggestions.map((suggestion, index) => (
        <div key={suggestion.id} className="space-y-3 border-t border-[color:var(--app-border)] pt-4">
          <h3 className="font-semibold">
            Alternativa {index + 1}: {suggestion.offDates.map(displayDate).join(" e ")}
          </h3>
          <p className="text-sm">
            {suggestion.status === "VALIDATED" ? "Validada na proposta salva" : "Requer ajustes e conferência"}.{" "}
            {suggestion.changedEmployeeIds.length} colaborador(es) afetado(s). Menor margem de cobertura:{" "}
            {suggestion.validation.minimumCoverageMargin === null
              ? "não aferida"
              : `${suggestion.validation.minimumCoverageMargin} pessoa(s)`}
            .
          </p>
          <Changes input={input} assignments={suggestion.assignments} />
          <button
            type="button"
            className={primaryClass}
            disabled={disabled || !suggestion.validation.valid}
            onClick={() => onSuggestion(suggestion)}
          >
            Aplicar esta alternativa completa
          </button>
        </div>
      ))}
      <button type="button" className={buttonClass} disabled={disabled} onClick={onDismiss}>
        Descartar prévias
      </button>
    </section>
  );
}

export function ValidationResults({ input, validation }: { input: EscalaInput; validation: EscalaValidation | null }) {
  const [page, setPage] = useState(0);
  if (!validation)
    return (
      <section className={panelClass}>
        <h2 className="text-lg font-bold">5. Conferência</h2>
        <p className="text-sm">
          Os dados foram alterados. Execute a conferência ou salve a revisão para atualizar os resultados.
        </p>
      </section>
    );
  const orderedEmployees = sortEmployees(input.employees);
  const positions = new Map(orderedEmployees.map((employee, index) => [employee.id, index]));
  const names = new Map(input.employees.map((employee) => [employee.id, employee]));
  const issues = [...validation.issues].sort(
    (a, b) =>
      (positions.get(a.employeeId ?? "") ?? -1) - (positions.get(b.employeeId ?? "") ?? -1) ||
      (a.date ?? "").localeCompare(b.date ?? "") ||
      a.code.localeCompare(b.code),
  );
  const pages = Math.max(1, Math.ceil(issues.length / 25));
  const currentPage = Math.min(page, pages - 1);
  return (
    <section className={panelClass} aria-labelledby="escala-validation-title">
      <h2 id="escala-validation-title" className="text-lg font-bold">
        5. Conferência
      </h2>
      <p className="font-semibold">
        {validation.readyToPublish
          ? "Conferência concluída: pronta para aprovação interna"
          : validation.valid
            ? "Sem conflitos detectados, com pendências para publicar"
            : "Existem conflitos que precisam ser resolvidos"}
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span>{issues.filter((issue) => issue.severity === "ERROR").length} impeditivos</span>
        <span>{issues.filter((issue) => issue.severity === "PENDING").length} pendências</span>
        <span>
          Margem mínima de cobertura:{" "}
          {validation.minimumCoverageMargin === null ? "não aferida" : validation.minimumCoverageMargin}
        </span>
      </div>
      {issues.length > 0 && (
        <div className="space-y-2">
          <ul className="space-y-2">
            {issues.slice(currentPage * 25, currentPage * 25 + 25).map((issue) => {
              const employee = issue.employeeId ? names.get(issue.employeeId) : undefined;
              return (
                <li
                  key={`${issue.code}-${issue.employeeId}-${issue.date}-${issue.message}`}
                  className="app-radius-lg border border-[color:var(--app-border)] p-3 text-sm"
                >
                  <span className="font-semibold">
                    {issue.severity === "ERROR" ? "Impeditivo" : "Pendente"}
                    {employee
                      ? ` · ${employee.sector} / ${employee.role} · ${employee.name} (${employee.registration})`
                      : " · Filial"}
                    {issue.date ? ` · ${displayDate(issue.date)}` : ""}
                  </span>
                  <p>{issue.message}</p>
                  <p className="mt-1 text-xs text-[color:var(--app-muted)]">Referência: {issue.code}</p>
                </li>
              );
            })}
          </ul>
          {pages > 1 && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={buttonClass}
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                Anterior
              </button>
              <span className="text-sm">
                Página {currentPage + 1} de {pages}
              </span>
              <button
                type="button"
                className={buttonClass}
                disabled={currentPage + 1 === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Próxima
              </button>
            </div>
          )}
        </div>
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
                    <td className="p-2 tabular-nums">{clock(summary.workedMinutes)}</td>
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

export function Publication({
  workspace,
  validation,
  dirty,
  busy,
  onPublish,
}: {
  workspace: EscalaWorkspace;
  validation: EscalaValidation | null;
  dirty: boolean;
  busy: boolean;
  onPublish: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const ready =
    workspace.canPublish && !dirty && !busy && Boolean(validation?.readyToPublish) && workspace.status !== "PUBLISHED";
  return (
    <section className={panelClass} aria-labelledby="escala-publication-title">
      <h2 id="escala-publication-title" className="text-lg font-bold">
        6. Aprovar e publicar
      </h2>
      <p className="text-sm">
        A publicação aprova internamente os dados da revisão {workspace.revision} e registra uma versão preservada.
        Alterações posteriores formam uma nova proposta. Não há envio a colaboradores, integração com ponto ou
        lançamento em folha.
      </p>
      <Check
        label={`Conferi a equipe, os horários, a cobertura e as regras da filial ${workspace.input.branchCode} para esta revisão`}
        checked={confirmed}
        disabled={!ready}
        onChange={setConfirmed}
      />
      <button type="button" className={primaryClass} disabled={!ready || !confirmed} onClick={onPublish}>
        {workspace.status === "PUBLISHED" ? "Revisão já publicada" : "Publicar revisão conferida"}
      </button>
      {!ready && workspace.status !== "PUBLISHED" && (
        <p className="text-sm text-[color:var(--app-muted)]">
          Resolva todos os impeditivos e pendências, salve a revisão e utilize um perfil autorizado a aprovar.
        </p>
      )}
      <div className="flex flex-wrap gap-3 border-t border-[color:var(--app-border)] pt-4">
        {(["pdf", "xlsx"] as const).map((format) =>
          !dirty && !busy ? (
            <a
              key={format}
              href={`/api/escalas/export?id=${encodeURIComponent(workspace.id)}&revision=${workspace.revision}&format=${format}`}
              download
              className={buttonClass}
            >
              Baixar {format.toUpperCase()} {workspace.status === "DRAFT" ? "da proposta" : "publicado"}
            </a>
          ) : (
            <button key={format} type="button" disabled className={buttonClass}>
              Baixar {format.toUpperCase()}
            </button>
          ),
        )}
      </div>
      <p className="text-xs text-[color:var(--app-muted)]">
        Os arquivos usam a revisão salva, com identificação de rascunho quando aplicável. Salve as alterações para
        exportar.
      </p>
    </section>
  );
}
