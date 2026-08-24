"use client";

import {
  AlertCircle,
  Check,
  Download,
  FileSearch,
  FileSpreadsheet,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { bytesLabel } from "./reajuste-salarial-workspace-model";
import type { useSalaryRevisionWorkspaceController } from "./salary-revision-workspace";
import {
  candidatesForRule,
  employeeMatchesSearch,
  formatClientCents,
  normalizeMoneyInput,
  selectedByOtherRules,
} from "./salary-revision-workspace-model";

type Model = ReturnType<typeof useSalaryRevisionWorkspaceController>;
const MAX_VISIBLE_CANDIDATES_PER_RULE = 100;

export function SalaryRevisionWorkspaceView({ model }: { model: Model }) {
  const analysis = model.analysis;
  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(290px,0.7fr)]">
      <section className="rounded-3xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-5 shadow-sm sm:p-7">
        <div className="flex items-start gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[color:var(--app-surface-strong)] text-[color:var(--app-teal)]">
            <FileSpreadsheet className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-black text-[color:var(--app-fg)]">Relação de empregados FPRE131</h2>
            <p className="mt-1 text-sm text-[color:var(--app-muted)]">Envie um único `.xlsx`. A estrutura interna, salários e cadastros serão validados antes das regras.</p>
          </div>
        </div>

        <input
          ref={model.inputRef}
          id="salary-revision-file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="peer sr-only"
          disabled={model.busy}
          onChange={(event) => {
            model.setFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        <label
          htmlFor="salary-revision-file"
          className="mt-5 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] px-5 py-5 text-center transition hover:border-[color:var(--app-teal)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[color:var(--app-teal)]"
        >
          <FileSearch className="size-7 text-[color:var(--app-teal)]" aria-hidden="true" />
          <span className="mt-2 text-sm font-black text-[color:var(--app-fg)]">Selecionar FPRE131</span>
          <span className="mt-1 text-xs text-[color:var(--app-subtle)]">Somente `.xlsx`, até 10 MB</span>
        </label>

        {model.file ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-3 sm:flex-row sm:items-center">
            <Check className="size-4 shrink-0 text-[color:var(--app-lime)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-[color:var(--app-fg)]">{model.file.name}</p>
              <p className="text-xs text-[color:var(--app-subtle)]">{bytesLabel(model.file.size)}</p>
            </div>
            <button
              type="button"
              onClick={model.analyze}
              disabled={model.busy}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[color:var(--app-teal)] px-4 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              {model.state.status === "analyzing" ? <Loader2 className="size-4 animate-spin" /> : <FileSearch className="size-4" />}
              Analisar arquivo
            </button>
          </div>
        ) : null}

        {analysis ? (
          <>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Colaboradores", analysis.employeeCount.toLocaleString("pt-BR")],
                ["Filiais", analysis.branchCount.toLocaleString("pt-BR")],
                ["Salários distintos", analysis.distinctSalaryCount.toLocaleString("pt-BR")],
                ["Faixa completa", `${formatClientCents(analysis.minimumSalaryCents)} – ${formatClientCents(analysis.maximumSalaryCents)}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-[color:var(--app-surface-strong)] p-3">
                  <dt className="text-xs text-[color:var(--app-subtle)]">{label}</dt>
                  <dd className="mt-1 text-sm font-black text-[color:var(--app-fg)]">{value}</dd>
                </div>
              ))}
            </dl>

            <fieldset className="mt-6">
              <legend className="text-sm font-black text-[color:var(--app-fg)]">
                Escopo do reajuste
              </legend>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                {[
                  {
                    value: "all" as const,
                    title: "Todos os colaboradores",
                    description:
                      "Aplica o percentual geral aos demais e substitui pelo novo salário nas regras.",
                  },
                  {
                    value: "rules_only" as const,
                    title: "Somente selecionados nas regras",
                    description:
                      "Aceita várias regras e inclui no PDF somente quem foi selecionado nelas.",
                  },
                ].map((option) => (
                  <label
                    key={option.value}
                    className="flex cursor-pointer gap-3 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] p-4"
                  >
                    <input
                      type="radio"
                      name="salary-revision-scope"
                      value={option.value}
                      checked={model.adjustmentScope === option.value}
                      disabled={model.busy}
                      onChange={() => model.setAdjustmentScope(option.value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-black text-[color:var(--app-fg)]">
                        {option.title}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-[color:var(--app-muted)]">
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className={`mt-6 ${model.adjustmentScope === "rules_only" ? "opacity-55" : ""}`}>
              <label htmlFor="salary-revision-percentage" className="text-sm font-black text-[color:var(--app-fg)]">Percentual geral (%)</label>
              <input
                id="salary-revision-percentage"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="4,42"
                value={model.percentage}
                disabled={model.busy || model.adjustmentScope === "rules_only"}
                onChange={(event) => model.setPercentage(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] px-4 py-3 font-bold text-[color:var(--app-fg)] outline-none focus:border-[color:var(--app-teal)] focus-visible:ring-2 focus-visible:ring-[color:var(--app-teal)]"
              />
              <p className="mt-2 text-xs text-[color:var(--app-muted)]">
                {model.adjustmentScope === "all"
                  ? "Aplicado somente aos colaboradores que não estiverem selecionados em regra especial."
                  : "Não usado quando o escopo contém somente os selecionados nas regras."}
              </p>
            </div>

            <div className="mt-7 flex flex-col gap-3 border-t border-[color:var(--app-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-black text-[color:var(--app-fg)]">Regras especiais</h2>
                <p className="mt-1 text-xs text-[color:var(--app-muted)]">Faixas inclusivas. Novo salário é fixo e digitado manualmente.</p>
              </div>
              <button type="button" onClick={model.addRule} disabled={model.busy || model.rules.length >= 20} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] px-4 py-2 text-sm font-black text-[color:var(--app-fg)] disabled:opacity-50">
                <Plus className="size-4" /> Adicionar regra
              </button>
            </div>

            <div className="mt-4 space-y-5">
              {model.rules.map((rule) => {
                const candidates = candidatesForRule(analysis, rule);
                const unavailable = selectedByOtherRules(model.rules, rule.id);
                const visible = candidates.filter((employee) => employeeMatchesSearch(employee, model.search));
                const visibleCandidates = visible.slice(
                  0,
                  MAX_VISIBLE_CANDIDATES_PER_RULE,
                );
                const selected = new Set(rule.selectedRegistrations);
                return (
                  <article key={rule.id} className="rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] p-4 sm:p-5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`rule-name-${rule.id}`} className="text-xs font-black text-[color:var(--app-muted)]">Nome da regra</label>
                        <input id={`rule-name-${rule.id}`} value={rule.name} onChange={(event) => model.updateRule(rule.id, { name: event.target.value })} className="mt-1 w-full rounded-lg border border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] px-3 py-2 font-bold text-[color:var(--app-fg)]" />
                      </div>
                      <button type="button" onClick={() => model.removeRule(rule.id)} aria-label={`Excluir ${rule.name}`} className="grid size-9 place-items-center rounded-lg text-[color:var(--app-coral)] hover:bg-[color:var(--app-danger-soft)]">
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      {[
                        ["Salário mínimo", "minimumSalary" as const, rule.minimumSalary, "1.300,00"],
                        ["Salário máximo", "maximumSalary" as const, rule.maximumSalary, "2.100,00"],
                        ["Novo salário fixo", "newSalary" as const, rule.newSalary, "2.250,00"],
                      ].map(([label, field, value, placeholder]) => (
                        <label key={field} className="text-xs font-black text-[color:var(--app-muted)]">
                          {label}
                          <span className="relative mt-1 block">
                            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-black text-[color:var(--app-subtle)]">R$</span>
                            <input
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              value={value}
                              placeholder={placeholder}
                              onChange={(event) => model.updateRule(rule.id, { [field]: event.target.value })}
                              onBlur={(event) => model.updateRule(rule.id, { [field]: normalizeMoneyInput(event.target.value) })}
                              className="w-full rounded-lg border border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] py-2 pl-10 pr-3 font-bold text-[color:var(--app-fg)]"
                            />
                          </span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-xs text-[color:var(--app-muted)]">{candidates.length.toLocaleString("pt-BR")} na faixa · {selected.size.toLocaleString("pt-BR")} selecionados</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => model.updateRule(rule.id, { selectedRegistrations: [] })} className="rounded-lg border border-[color:var(--app-border-strong)] px-3 py-2 text-xs font-black text-[color:var(--app-fg)]">Desmarcar tudo</button>
                        <button type="button" onClick={() => model.selectRange(rule.id)} className="rounded-lg bg-[color:var(--app-teal)] px-3 py-2 text-xs font-black text-white">Selecionar faixa</button>
                      </div>
                    </div>
                    {candidates.length > 0 ? (
                      <>
                        <label className="relative mt-4 block">
                          <span className="sr-only">Filtrar candidatos de {rule.name}</span>
                          <Search className="absolute left-3 top-2.5 size-4 text-[color:var(--app-subtle)]" />
                          <input type="search" value={model.search} onChange={(event) => model.setSearch(event.target.value)} placeholder="Filtrar por nome, cadastro, cargo ou filial" className="w-full rounded-lg border border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] py-2 pl-9 pr-3 text-sm text-[color:var(--app-fg)]" />
                        </label>
                        <div className="mt-3 max-h-72 overflow-auto rounded-xl border border-[color:var(--app-border)] bg-[color:var(--app-card)] lg:max-h-none lg:overflow-visible">
                          <table className="w-full min-w-[680px] bg-[color:var(--app-card)] text-left text-xs">
                            <thead className="sticky top-0 bg-[color:var(--app-surface-strong)] text-[color:var(--app-muted)]">
                              <tr><th className="px-3 py-2">Usar</th><th className="px-3 py-2">Filial</th><th className="px-3 py-2">Cadastro</th><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Cargo</th><th className="min-w-28 whitespace-nowrap border-l border-[color:var(--app-border)] bg-[color:var(--app-surface-strong)] px-4 py-2 text-right">Salário</th></tr>
                            </thead>
                            <tbody>
                              {visibleCandidates.map((employee) => {
                                const locked = unavailable.has(employee.registration);
                                return (
                                  <tr key={employee.registration} className="border-t border-[color:var(--app-border)] text-[color:var(--app-fg)]">
                                    <td className="px-3 py-2"><input type="checkbox" checked={selected.has(employee.registration)} disabled={locked || model.busy} onChange={() => model.toggleRegistration(rule.id, employee.registration)} aria-label={`Selecionar ${employee.employeeName}`} /></td>
                                    <td className="px-3 py-2">{employee.branchAlias}</td><td className="px-3 py-2 tabular-nums">{employee.registration}</td><td className="px-3 py-2 font-bold">{employee.employeeName}</td><td className="px-3 py-2">{employee.role}</td><td className="min-w-28 whitespace-nowrap border-l border-[color:var(--app-border)] bg-[color:var(--app-surface)] px-4 py-2 text-right font-bold tabular-nums">{formatClientCents(employee.currentSalaryCents)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        {visible.length > visibleCandidates.length ? (
                          <p className="mt-2 text-xs text-[color:var(--app-muted)]">
                            Exibindo os primeiros {MAX_VISIBLE_CANDIDATES_PER_RULE.toLocaleString("pt-BR")} de {visible.length.toLocaleString("pt-BR")}. Use o filtro para localizar os demais colaboradores.
                          </p>
                        ) : null}
                      </>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </>
        ) : null}

        {model.state.status === "error" ? (
          <div className="mt-5 rounded-xl border border-[color:var(--app-coral)]/30 bg-[color:var(--app-danger-soft)] p-4 text-sm text-[color:var(--app-fg)]" role="alert">
            <p className="font-black">Revise os dados:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">{model.state.messages.map((message) => <li key={message}>{message}</li>)}</ul>
          </div>
        ) : null}
        {model.state.status === "success" ? (
          <div className="mt-5 rounded-xl border border-[color:var(--app-lime)]/40 bg-[color:var(--app-success-soft)] p-4 text-sm text-[color:var(--app-fg)]" role="status"><strong>PDF gerado.</strong> Download iniciado: {model.state.fileName}</div>
        ) : null}
        {model.state.status === "generating" ? (
          <div className="mt-5" aria-live="polite"><div className="flex justify-between text-xs font-bold text-[color:var(--app-muted)]"><span>{model.state.progress < 99 ? "Enviando arquivo" : "Validando regras e gerando PDF"}</span><span>{model.state.progress < 99 ? `${model.state.progress}%` : "Processando"}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--app-surface-strong)]"><div className={`h-full rounded-full bg-[color:var(--app-teal)] ${model.state.progress >= 99 ? "animate-pulse" : ""}`} style={{ width: `${model.state.progress}%` }} /></div></div>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={model.reset} disabled={model.busy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[color:var(--app-border-strong)] px-5 py-3 text-sm font-black text-[color:var(--app-fg)] disabled:opacity-50"><RotateCcw className="size-4" /> Limpar</button>
          <button type="button" onClick={model.generate} disabled={model.busy || !model.analysis} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--app-canvas)] px-5 py-3 text-sm font-black text-white disabled:opacity-50">{model.busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Gerar PDF de reajuste</button>
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-3xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-5 shadow-sm">
          <Users className="size-6 text-[color:var(--app-teal)]" />
          <h2 className="mt-3 font-black text-[color:var(--app-fg)]">Distribuição atual</h2>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-xl bg-[color:var(--app-surface-strong)] p-3"><dt className="text-[color:var(--app-subtle)]">{model.adjustmentScope === "all" ? "Regra geral" : "Fora do escopo"}</dt><dd className="mt-1 font-black text-[color:var(--app-fg)]">{((model.analysis?.employeeCount ?? 0) - model.specialCount).toLocaleString("pt-BR")}</dd></div>
            <div className="rounded-xl bg-[color:var(--app-surface-strong)] p-3"><dt className="text-[color:var(--app-subtle)]">Regras especiais</dt><dd className="mt-1 font-black text-[color:var(--app-fg)]">{model.specialCount.toLocaleString("pt-BR")}</dd></div>
          </dl>
        </section>
        <section className="rounded-3xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-5 shadow-sm">
          <AlertCircle className="size-6 text-[color:var(--app-amber)]" />
          <h2 className="mt-3 font-black text-[color:var(--app-fg)]">Regra de cálculo</h2>
          <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">
            {model.adjustmentScope === "all"
              ? "Selecionados recebem o novo salário fixo. Desmarcados e demais colaboradores recebem o percentual geral."
               : "Somente selecionados em uma ou mais regras recebem o novo salário fixo e aparecem no PDF; demais colaboradores ficam fora do cálculo."}
          </p>
        </section>
      </aside>
    </div>
  );
}
