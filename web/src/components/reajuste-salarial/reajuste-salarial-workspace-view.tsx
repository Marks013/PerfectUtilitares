"use client";

import {
  AlertCircle,
  Calculator,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Percent,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TrendingUp,
  UploadCloud,
} from "lucide-react";
import {
  bytesLabel,
  competencyFromFileName,
  fileKey,
} from "./reajuste-salarial-workspace-model";
import type { useSalaryAdvanceWorkspaceController } from "./reajuste-salarial-workspace";
import { ReajusteSalarialAccessLogoutButton } from "./reajuste-salarial-access-logout-button";
import type { useSalaryRevisionWorkspaceController } from "./salary-revision-workspace";
import { SalaryRevisionWorkspaceView } from "./salary-revision-workspace-view";

type AdvanceModel = ReturnType<typeof useSalaryAdvanceWorkspaceController>;
type RevisionModel = ReturnType<typeof useSalaryRevisionWorkspaceController>;

export function ReajusteSalarialWorkspaceView({
  advanceModel: model,
  mode,
  onModeChange,
  revisionModel,
}: {
  advanceModel: AdvanceModel;
  mode: "advance" | "revision";
  onModeChange: (mode: "advance" | "revision") => void;
  revisionModel: RevisionModel;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="overflow-hidden rounded-3xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] shadow-sm">
        <div className="bg-[color:var(--app-canvas)] px-6 py-7 text-white sm:px-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-[color:var(--app-lime)]">
                Ferramenta administrativa
              </p>
              <h1 className="mt-2 text-2xl font-black sm:text-3xl">
                Antecipação e Reajuste Salarial
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">
                Escolha a operação, valide os arquivos da folha e gere relatórios exatos em PDF.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs font-bold text-white/75">
                Perfil padrão
              </span>
              <ReajusteSalarialAccessLogoutButton />
              <span className="grid size-14 place-items-center rounded-2xl border border-white/15 bg-white/10 text-[color:var(--app-lime)]">
                <Calculator className="size-7" aria-hidden="true" />
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-3 border-t border-[color:var(--app-border)] bg-[color:var(--app-warning-soft)] px-6 py-4 text-sm text-[color:var(--app-fg)] sm:px-8">
          <AlertCircle className="mt-0.5 size-5 shrink-0 text-[color:var(--app-amber)]" aria-hidden="true" />
          <p><strong>PDF estático.</strong> Arquivos e cálculos são processados em memória e precisam ser gerados novamente após qualquer mudança.</p>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-2 shadow-sm" role="tablist" aria-label="Operação salarial">
        <button type="button" role="tab" aria-selected={mode === "advance"} onClick={() => onModeChange("advance")} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] ${mode === "advance" ? "bg-[color:var(--app-canvas)] text-white" : "text-[color:var(--app-muted)] hover:bg-[color:var(--app-surface-strong)]"}`}>
          <TrendingUp className="size-4" aria-hidden="true" /> Antecipação Salarial
        </button>
        <button type="button" role="tab" aria-selected={mode === "revision"} onClick={() => onModeChange("revision")} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] ${mode === "revision" ? "bg-[color:var(--app-canvas)] text-white" : "text-[color:var(--app-muted)] hover:bg-[color:var(--app-surface-strong)]"}`}>
          <Percent className="size-4" aria-hidden="true" /> Reajuste Salarial
        </button>
      </div>

      {mode === "revision" ? (
        <SalaryRevisionWorkspaceView model={revisionModel} />
      ) : (
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]" role="tabpanel">
        <section className="rounded-3xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-5 shadow-sm sm:p-7">
          <div className="flex items-start gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
              <FileSpreadsheet className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-black text-[color:var(--app-fg)]">Competências da antecipação</h2>
              <p className="mt-1 text-sm text-[color:var(--app-muted)]">Somente .xlsx no padrão MM-AAAA.xlsx. Limite: quatro arquivos.</p>
            </div>
          </div>

          <input
            ref={model.inputRef}
            id="salary-adjustment-files"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            multiple
            className="peer sr-only"
            disabled={model.busy}
            onChange={(event) => {
              model.mergeIncoming(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <label
            htmlFor="salary-adjustment-files"
            className="mt-5 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] px-5 py-6 text-center transition hover:border-[color:var(--app-teal)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--app-teal)]"
          >
            <UploadCloud className="size-7 text-[color:var(--app-teal)]" aria-hidden="true" />
            <span className="mt-2 text-sm font-black text-[color:var(--app-fg)]">Selecionar planilhas</span>
            <span className="mt-1 text-xs text-[color:var(--app-subtle)]">Até 10 MB por arquivo e 20 MB no total</span>
          </label>

          {model.files.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {model.files.map((file) => (
                <li key={fileKey(file)} className="flex items-center gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] px-3 py-3">
                  <CheckCircle2 className="size-4 shrink-0 text-[color:var(--app-lime)]" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-[color:var(--app-fg)]">{file.name}</p>
                    <p className="mt-0.5 text-xs text-[color:var(--app-subtle)]">
                      Competência {competencyFromFileName(file.name) ?? "não reconhecida"} · {bytesLabel(file.size)}
                    </p>
                  </div>
                  <button type="button" disabled={model.busy} onClick={() => model.removeFile(fileKey(file))} className="grid size-9 place-items-center rounded-lg text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)]" aria-label={`Remover ${file.name}`}>
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-6">
            <label htmlFor="salary-adjustment-percentage" className="text-sm font-black text-[color:var(--app-fg)]">
              Percentual restante a pagar (%)
            </label>
            <input
              id="salary-adjustment-percentage"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="4,42"
              value={model.percentage}
              disabled={model.busy}
              onChange={(event) => model.setPercentage(event.target.value)}
              className="mt-2 w-full rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] px-4 py-3 text-base font-bold text-[color:var(--app-fg)] outline-none transition focus:border-[color:var(--app-teal)] focus-visible:ring-2 focus-visible:ring-[color:var(--app-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--app-surface)]"
            />
            <p className="mt-2 text-xs leading-5 text-[color:var(--app-muted)]">
              Informe somente o percentual que ainda deve ser pago após descontar eventual antecipação.
            </p>
          </div>

          {(model.state.status === "uploading" || model.state.status === "processing") ? (
            <div className="mt-5" aria-live="polite">
              <div className="flex justify-between text-xs font-bold text-[color:var(--app-muted)]">
                <span>{model.state.status === "uploading" ? "Enviando" : "Consolidando e gerando PDF"}</span>
                 <span>{model.state.status === "uploading" ? `${model.state.progress}%` : "Processando"}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--app-surface-strong)]">
                 <div className={`h-full rounded-full bg-[color:var(--app-teal)] transition-all ${model.state.status === "processing" ? "animate-pulse" : ""}`} style={{ width: `${model.state.progress}%` }} />
              </div>
            </div>
          ) : null}

          {model.state.status === "error" ? (
            <div className="mt-5 rounded-xl border border-[color:var(--app-coral)]/30 bg-[color:var(--app-danger-soft)] p-4 text-sm text-[color:var(--app-fg)]" role="alert">
              <p className="font-black">Revise os dados:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">{model.state.messages.map((message) => <li key={message}>{message}</li>)}</ul>
            </div>
          ) : null}
          {model.state.status === "success" ? (
            <div className="mt-5 flex gap-3 rounded-xl border border-[color:var(--app-lime)]/40 bg-[color:var(--app-success-soft)] p-4 text-sm text-[color:var(--app-fg)]" role="status">
              <Download className="size-5 shrink-0 text-[color:var(--app-lime)]" />
              <p><strong>PDF gerado.</strong> Download iniciado: {model.state.fileName}</p>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={model.reset} disabled={model.busy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] px-5 py-3 text-sm font-black text-[color:var(--app-fg)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)]">
              <RotateCcw className="size-4" /> Limpar
            </button>
            <button type="button" onClick={model.generate} disabled={model.busy} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--app-canvas)] px-5 py-3 text-sm font-black text-white transition hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)]">
              {model.busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Gerar PDF
            </button>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-5 shadow-sm">
            <ShieldCheck className="size-6 text-[color:var(--app-teal)]" aria-hidden="true" />
            <h2 className="mt-3 font-black text-[color:var(--app-fg)]">Processamento protegido</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">Planilhas e PDF são processados em memória. Nenhum dado salarial fica salvo no sistema.</p>
          </section>
          <section className="rounded-3xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-5 shadow-sm">
            <h2 className="font-black text-[color:var(--app-fg)]">Regra da antecipação</h2>
            <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">Cada base mensal é multiplicada pelo percentual restante, arredondada para centavos e somada ao total retroativo do colaborador.</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-[color:var(--app-surface-strong)] p-3"><dt className="text-[color:var(--app-subtle)]">Arquivos</dt><dd className="mt-1 font-black text-[color:var(--app-fg)]">{model.files.length}/4</dd></div>
              <div className="rounded-xl bg-[color:var(--app-surface-strong)] p-3"><dt className="text-[color:var(--app-subtle)]">Tamanho</dt><dd className="mt-1 font-black text-[color:var(--app-fg)]">{bytesLabel(model.totalBytes)}</dd></div>
            </dl>
          </section>
        </aside>
      </div>
      )}
    </main>
  );
}
