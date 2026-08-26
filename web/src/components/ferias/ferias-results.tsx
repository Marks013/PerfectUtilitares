"use client";

import { AlertTriangle, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  type FeriasAnalysis, type FeriasChoice, type FeriasRow,
  formatCompetency, formatVacationDate,
} from "./ferias-contract";

const fieldClass = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-input)] px-3 text-sm text-[color:var(--app-fg)] focus-visible:outline-2 focus-visible:outline-[color:var(--app-teal)] disabled:opacity-50";
const iconButtonClass = "app-icon-button disabled:opacity-40";

function RowChoices({ row, choice, busy, onChoose }: {
  row: FeriasRow; choice?: FeriasChoice; busy: boolean;
  onChoose: (row: number, field: "holderId" | "loanIdentity", value: string) => void;
}) {
  const groups = [
    { field: "holderId" as const, title: "Titular Unimed", candidates: row.holderCandidates },
    { field: "loanIdentity" as const, title: "Consignado Digital", candidates: row.loanCandidates },
  ];
  return groups.filter((group) => group.candidates.length > 0).map((group) => {
    const id = `ferias-${row.row}-${group.field}`;
    const selected = choice && Object.hasOwn(choice, group.field)
      ? choice[group.field] ?? "" : row[group.field] ?? "";
    return (
      <div key={group.field} className="min-w-0">
        <label htmlFor={id} className="text-xs font-semibold">{group.title} · linha {row.row}</label>
        <select id={id} className={fieldClass} disabled={busy}
          value={selected}
          onChange={(event) => onChoose(row.row, group.field, event.target.value)}>
          <option value="">Selecione a pessoa correspondente</option>
          {group.candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}
        </select>
        {selected && selected === row[group.field] && <p className="mt-1 text-xs text-[color:var(--app-muted)]">Vínculo confirmado</p>}
      </div>
    );
  });
}

export function FeriasResults({ analysis, choices, busy, stale, onChoose }: {
  analysis: FeriasAnalysis; choices: FeriasChoice[]; busy: boolean; stale: boolean;
  onChoose: (row: number, field: "holderId" | "loanIdentity", value: string) => void;
}) {
  const [pendingOnly, setPendingOnly] = useState(false);
  const [page, setPage] = useState(0);
  const rows = pendingOnly ? analysis.rows.filter((row) => row.issues.length > 0) : analysis.rows;
  const totalPages = Math.max(1, Math.ceil(rows.length / 20));
  const currentPage = Math.min(page, totalPages - 1);
  const visibleRows = rows.slice(currentPage * 20, currentPage * 20 + 20);
  const loanSource = analysis.sources.find((source) => source.name === "Consignado Digital");
  const unimedSources = analysis.sources.filter((source) => source.name !== "Consignado Digital");
  const unimedPending = !unimedSources.length || unimedSources.some((source) => !source.ready);
  const loansPending = !loanSource?.ready;
  const metrics = [
    ["Colaboradores", analysis.summary.total],
    ["Com Unimed", analysis.summary.unimed],
    ["Com consignado", analysis.summary.loans],
    ["Colaboradores pendentes", analysis.summary.pending],
    ["Em destaque", analysis.summary.highlighted],
  ] as const;

  return (
    <section aria-labelledby="ferias-results-title" className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ferias-results-title" className="text-lg font-bold">Conferência · {formatCompetency(analysis.competency)}</h2>
        <span className="text-xs text-[color:var(--app-muted)]">{stale ? "Alterações aguardando nova análise" : "Última análise concluída"}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-y border-[color:var(--app-border)] py-4 sm:grid-cols-3 lg:grid-cols-5">
        {metrics.map(([label, count]) => (
          <div key={label}><dt className="text-xs text-[color:var(--app-muted)]">{label}</dt><dd className="mt-1 text-xl font-bold tabular-nums">{count}</dd></div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {analysis.sources.map((source) => (
          <span key={source.name} className="inline-flex items-center gap-2">
            {source.ready ? <Check className="size-4 shrink-0 text-[color:var(--app-teal)]" aria-hidden="true" /> : <AlertTriangle className="size-4 shrink-0 text-[color:var(--app-coral)]" aria-hidden="true" />}
            {source.name} · {formatCompetency(source.competency)}: {source.ready ? "disponível" : "pendente"}
          </span>
        ))}
      </div>
      {unimedSources.some((source) => source.fallback) && unimedSources.every((source) => source.ready) && (
        <div className="rounded-lg border border-[color:var(--app-warning-border)] bg-[color:var(--app-warning-soft)] p-3 text-sm">
          <p className="font-semibold">Base alternativa da Unimed · {formatCompetency(unimedSources[0].competency)}</p>
          <p className="mt-1 text-[color:var(--app-muted)]">A base Unimed de {formatCompetency(analysis.competency)} não estava completa. Cadastro e fatura foram consultados juntos no mês anterior; o Consignado Digital permanece em {formatCompetency(analysis.competency)}.</p>
        </div>
      )}
      {analysis.pricePeriods.length > 0 && <p className="text-xs text-[color:var(--app-muted)]">Tabela de preços · início de vigência: {analysis.pricePeriods.map(formatVacationDate).join(", ")}</p>}
      {analysis.issues.length > 0 && (
        <div className="rounded-lg border border-[color:var(--app-coral)] bg-[color:var(--app-danger-soft)] p-3 text-sm">
          <p className="font-semibold">Pendências da competência</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">{analysis.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div>
      )}
      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={pendingOnly} onChange={(event) => { setPendingOnly(event.target.checked); setPage(0); }} className="size-4 accent-[color:var(--app-teal)]" />
        Somente colaboradores com pendências
      </label>
      <ul className="divide-y divide-[color:var(--app-border)] border-y border-[color:var(--app-border)]">
        {visibleRows.map((row) => (
          <li key={row.row} className="min-w-0 py-4" data-testid={`ferias-row-${row.row}`}>
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="break-words font-semibold">{row.name}</p>
                <p className="mt-1 break-words text-xs text-[color:var(--app-muted)]">Matrícula {row.registration} · {row.branch || "Filial não informada"} · linha {row.row}</p>
                <p className="mt-1 text-sm">{formatVacationDate(row.start)} a {formatVacationDate(row.end)}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <span>{row.days} dias</span>
                  {row.highlight && <span className="inline-flex items-center gap-1 font-semibold text-[color:var(--app-amber)]"><AlertTriangle className="size-3" aria-hidden="true" /> Em destaque</span>}
                </p>
              </div>
              <div className="min-w-0 text-sm"><p className="text-xs text-[color:var(--app-muted)]">Unimed</p><p className="mt-1 break-words">{unimedPending ? "Base pendente" : row.unimedText || (row.issues.length ? "A conferir" : "Sem valor identificado")}</p></div>
              <div className="min-w-0 text-sm"><p className="text-xs text-[color:var(--app-muted)]">Consignado Digital</p><p className="mt-1 break-words">{loansPending ? "Base pendente" : row.loanText || (row.issues.length ? "A conferir" : "Sem valor identificado")}</p></div>
            </div>
            {(row.issues.length > 0 || row.warnings.length > 0) && (
              <ul className="mt-3 space-y-1 text-sm">
                {row.issues.map((issue) => <li key={`issue-${issue}`} className="text-[color:var(--app-coral)]">{issue}</li>)}
                {row.warnings.map((warning) => <li key={`warning-${warning}`} className="text-[color:var(--app-muted)]">{warning}</li>)}
              </ul>
            )}
            {(row.holderCandidates.length > 0 || row.loanCandidates.length > 0) && (
              <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                <RowChoices row={row} choice={choices.find((choice) => choice.row === row.row)} busy={busy} onChoose={onChoose} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {!visibleRows.length && <p className="py-4 text-sm text-[color:var(--app-muted)]">Nenhum colaborador nesta seleção.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[color:var(--app-muted)]">{rows.length} {rows.length === 1 ? "colaborador" : "colaboradores"} · página {currentPage + 1} de {totalPages}</p>
        <div className="flex gap-2">
          <button type="button" className={iconButtonClass} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} aria-label="Página anterior" title="Página anterior"><ChevronLeft className="size-4" aria-hidden="true" /></button>
          <button type="button" className={iconButtonClass} disabled={currentPage + 1 >= totalPages} onClick={() => setPage(currentPage + 1)} aria-label="Próxima página" title="Próxima página"><ChevronRight className="size-4" aria-hidden="true" /></button>
        </div>
      </div>
    </section>
  );
}
