"use client";

import { Download, FileSpreadsheet, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { FeriasResults } from "./ferias-results";
import { useFeriasWorkspace } from "./use-ferias-workspace";

const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] disabled:cursor-not-allowed disabled:opacity-40";

export function FeriasWorkspace() {
  const model = useFeriasWorkspace();
  const canExport = Boolean(model.analysis?.canExport && !model.stale && !model.busy);

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-6 text-[color:var(--app-fg)]">
      <header className="flex items-center gap-3 border-b border-[color:var(--app-border)] pb-5">
        <FileSpreadsheet className="size-7 shrink-0 text-[color:var(--app-teal)]" aria-hidden="true" />
        <h1 className="text-2xl font-bold">Férias</h1>
      </header>
      <section aria-labelledby="ferias-file-title" className="space-y-4">
        <h2 id="ferias-file-title" className="text-base font-semibold">Planilha do mês</h2>
        <label htmlFor="ferias-file" className="block text-sm font-medium">Arquivo de férias</label>
        <input id="ferias-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-describedby="ferias-file-limit" className="block min-h-11 w-full min-w-0 rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-input)] p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[color:var(--app-teal)] file:px-3 file:py-2 file:font-semibold file:text-[color:var(--app-canvas)] focus-visible:outline-2 focus-visible:outline-[color:var(--app-teal)]"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) model.selectFile(file); event.target.value = ""; }} />
        <p id="ferias-file-limit" className="text-xs text-[color:var(--app-muted)]">XLSX · até 5 MB e 1.000 colaboradores.</p>
        {model.file && (
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-3">
            <span className="min-w-0 break-words text-sm font-medium">{model.file.name}</span>
            <button type="button" className="app-icon-button shrink-0 text-[color:var(--app-coral)]" onClick={() => model.selectFile(null)} title="Remover planilha" aria-label="Remover planilha"><Trash2 className="size-4" aria-hidden="true" /></button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!model.file || model.busy} onClick={() => void model.run("analisar")} className={`${buttonClass} bg-[color:var(--app-teal)] text-[color:var(--app-canvas)]`}>
            <RefreshCw className="size-4 shrink-0" aria-hidden="true" />{model.analysis ? "Analisar novamente" : "Analisar planilha"}
          </button>
          {model.busy && <button type="button" onClick={model.cancel} className={`${buttonClass} border border-[color:var(--app-border)]`}><X className="size-4" aria-hidden="true" />Cancelar</button>}
          <div role="status" aria-live="polite" aria-atomic="true" className="min-w-0 text-sm text-[color:var(--app-muted)]">
            {model.busy ? <span className="inline-flex items-center gap-2"><LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />{model.phase === "analyzing" ? "Conferindo planilha e benefícios…" : "Preparando sua planilha…"}</span> : model.stale && model.analysis ? "A conferência precisa ser atualizada. Analise novamente." : model.download ? "Planilha pronta. Download iniciado." : model.analysis ? "Análise concluída." : null}
          </div>
        </div>
        {model.error && <div role="alert" className="rounded-lg border border-[color:var(--app-coral)] bg-[color:var(--app-danger-soft)] p-3 text-sm">{model.error}</div>}
      </section>
      {model.analysis && <FeriasResults analysis={model.analysis} choices={model.choices} busy={model.busy} stale={model.stale} onChoose={model.choose} />}
      {model.analysis && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--app-border)] pt-4">
          <p className="text-sm text-[color:var(--app-muted)]">{model.stale ? "Uma nova análise é necessária." : model.analysis.canExport ? "Conferência concluída. Planilha liberada." : "Resolva as pendências antes de baixar."}</p>
          {model.download && canExport ? (
            <a className={`${buttonClass} bg-[color:var(--app-teal)] text-[color:var(--app-canvas)]`} href={model.download.url} download={model.download.name}><Download className="size-4" aria-hidden="true" />Baixar novamente</a>
          ) : (
            <button type="button" disabled={!canExport} onClick={() => void model.run("exportar")} className={`${buttonClass} bg-[color:var(--app-teal)] text-[color:var(--app-canvas)]`}><Download className="size-4" aria-hidden="true" />Baixar planilha</button>
          )}
        </div>
      )}
    </div>
  );
}
