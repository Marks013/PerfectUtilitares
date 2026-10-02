"use client";

import { useMemo, useState } from "react";
import type { EventAdjustmentResult } from "@/lib/reajuste-salarial/event-adjustment-types";
import { competencyFromFileName } from "./reajuste-salarial-workspace-model";
import { displayedEventDifference, eventMoney, filterEventEmployees, type EventFilters, type EventSettings } from "./event-adjustment-workspace-model";
import type { useEventAdjustmentWorkspaceController } from "./event-adjustment-workspace";

const inputClass = "mt-2 w-full min-w-0 rounded-xl border border-[color:var(--app-border-strong)] bg-[color:var(--app-input)] px-3 py-3 text-[color:var(--app-fg)] focus-visible:outline-2 focus-visible:outline-[color:var(--app-teal)]";
const buttonClass = "rounded-xl border border-[color:var(--app-border-strong)] px-4 py-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--app-teal)] disabled:opacity-50";
const panelClass = "min-w-0 rounded-2xl border border-[color:var(--app-border)] bg-[color:var(--app-surface)] p-5 app-shadow";
type Model = ReturnType<typeof useEventAdjustmentWorkspaceController>;

function EventResult({ title, result }: { title: string; result: EventAdjustmentResult }) {
  return <div className="min-w-0 rounded-xl bg-[color:var(--app-surface-strong)] p-3">
    <h5 className="text-sm font-bold">{title}</h5>
    {result.exclusionReason ? <p className="mt-2 rounded-lg bg-[color:var(--app-warning-soft)] p-2 text-xs font-bold" role="status">Cálculo bloqueado nesta competência: {result.exclusionReason}. Diferença a pagar: R$ 0,00.</p> : null}
    {!result.received ? <p className="mt-2 text-sm text-[color:var(--app-muted)]">Evento não encontrado nesta folha.</p> : <>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div><dt className="text-[color:var(--app-muted)]">Pago</dt><dd className="mt-1 font-bold">{eventMoney(result.paidCents)}</dd></div>
        <div><dt className="text-[color:var(--app-muted)]">Quantidade</dt><dd className="mt-1 font-bold">{result.quantity ?? (result.exclusionReason ? "Não determinada" : "Pendente")}</dd></div>
        <div><dt className="text-[color:var(--app-muted)]">{result.exclusionReason ? "Total pela tabela (bloqueado)" : "Total reajustado"}</dt><dd className="mt-1 font-bold">{eventMoney(result.targetCents)}</dd></div>
        <div><dt className="text-[color:var(--app-muted)]">Diferença a pagar</dt><dd className="mt-1 font-black text-[color:var(--app-teal)]">{eventMoney(result.differenceCents)}</dd></div>
      </dl>
      <p className="mt-2 text-xs text-[color:var(--app-muted)]">Origem: {result.quantitySource === "reference" ? "referência da folha" : result.quantitySource === "amount" ? "divisão exata do pago pelo valor antigo" : "não determinada"}.</p>
    </>}
    {result.issue ? <p className="mt-2 rounded-lg bg-[color:var(--app-danger-soft)] p-2 text-xs font-bold" role="status">Pendência: {result.issue}</p> : null}
  </div>;
}

export function EventAdjustmentWorkspaceView({ model, disabled = false }: { model: Model; disabled?: boolean }) {
  const [search, setSearch] = useState("");
  const [competency, setCompetency] = useState("");
  const [event, setEvent] = useState<EventFilters["event"]>("all");
  const [page, setPage] = useState(0);
  const report = model.report;
  const employees = useMemo(() => report ? filterEventEmployees(report, { search, competency, event }) : [], [report, search, competency, event]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(employees.length / 12) - 1));
  const visible = employees.slice(currentPage * 12, (currentPage + 1) * 12);
  const fields: Array<[keyof EventSettings, string]> = [["bonusOldValue", "Valor antigo do bônus (R$)"], ["bonusNewValue", "Novo valor do bônus (R$)"], ["sundayOldValue", "Valor antigo por domingo (R$)"], ["sundayNewValue", "Novo valor por domingo (R$)"]];
  const competencies = model.files.map(file => competencyFromFileName(file.name)).filter((key): key is string => Boolean(key));
  return <section aria-label="Diferenças opcionais dos eventos 565 e 901" className="mt-6 min-w-0 text-[color:var(--app-fg)]"><fieldset disabled={disabled} className="min-w-0 space-y-5">
    <div className="grid min-w-0 gap-5">
      <div className={panelClass}>
        <h2 className="text-lg font-black">Valores do bônus e dos domingos</h2>
        <p className="mt-2 text-sm leading-6 text-[color:var(--app-muted)]">565 — Bônus Convenc. SINDECOMU: valor por ocorrência. 901 — Indenização Compensatória: valor por domingo trabalhado.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{fields.map(([key, label]) => <label key={key} htmlFor={`event-${key}`} className="min-w-0 text-sm font-bold">{label}<input id={`event-${key}`} value={model.settings[key]} onChange={e => model.updateSetting(key, e.target.value)} inputMode="decimal" autoComplete="off" placeholder={key.endsWith("NewValue") ? "Ex.: 90,00" : undefined} className={inputClass} /></label>)}</div>
        <p className="mt-3 text-xs leading-5 text-[color:var(--app-muted)]">Novos valores são opcionais na prévia. Configure pelo menos um para gerar PDF. Valor novo menor não gera desconto.</p>
        <details className="mt-4 rounded-xl border border-[color:var(--app-border)] p-3"><summary className="cursor-pointer text-sm font-bold focus-visible:outline-2 focus-visible:outline-[color:var(--app-teal)]">Valores antigos por competência</summary><p className="mt-2 text-xs leading-5 text-[color:var(--app-muted)]">Preencha somente exceções históricas. Campo vazio usa o valor antigo geral.</p>{competencies.length === 0 ? <p className="mt-3 text-sm">Selecione as folhas primeiro.</p> : competencies.map(key => <fieldset key={key} className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2"><legend className="text-sm font-bold">{key.replace("-", "/")}</legend>{(["bonusOldValue", "sundayOldValue"] as const).map(field => <label key={field} className="min-w-0 text-xs">{field === "bonusOldValue" ? "Bônus antigo" : "Domingo antigo"} — {key}<input aria-label={`${field === "bonusOldValue" ? "Bônus antigo" : "Domingo antigo"} de ${key}`} inputMode="decimal" autoComplete="off" placeholder={model.settings[field]} value={model.overrides.find(row => row.competencyKey === key)?.[field] ?? ""} onChange={e => model.updateOverride(key, field, e.target.value)} className={inputClass} /></label>)}</fieldset>)}</details>
      </div>
    </div>
    <div className={`${panelClass} space-y-4`}>
      <p className="text-sm leading-6 text-[color:var(--app-muted)]">Quantidade obtida sem arredondamento. Pagamento e valor antigo precisam fechar exatamente; referências da folha são confrontadas quando disponíveis. Divergências ficam visíveis e bloqueiam o PDF. Dados permanecem somente nesta sessão.</p>
      {model.messages.length ? <div role={model.status === "error" ? "alert" : "status"} className={`rounded-xl p-3 text-sm ${model.status === "error" ? "bg-[color:var(--app-danger-soft)]" : "bg-[color:var(--app-success-soft)]"}`}><ul className="list-disc pl-5">{model.messages.map(message => <li key={message}>{message}</li>)}</ul></div> : null}
      <div className="flex justify-end"><button type="button" className={buttonClass} disabled={model.busy} onClick={() => { setPage(0); void model.analyze(); }}>{model.status === "analyzing" ? "Apurando eventos…" : "Apurar eventos"}</button></div>
      {model.busy ? <p role="status" className="text-sm">Processando arquivos e calculando diferenças. Aguarde.</p> : null}
    </div>
    {report ? <>
      <h2 className="text-lg font-black">Totais de todas as bases</h2>
      <div className="grid gap-3 sm:grid-cols-3">{[["Diferença do bônus 565", report.bonusTotalCents], ["Diferença de domingos 901", report.sundayTotalCents], ["Total dos eventos", report.grandTotalCents]].map(([label, value]) => <div key={label} className={panelClass}><p className="text-sm text-[color:var(--app-muted)]">{label}</p><p className="mt-2 text-xl font-black">{eventMoney(value)}</p></div>)}</div>
      <div className={panelClass}>
        <h2 className="text-lg font-black">Conferência por colaborador e competência</h2>
        <p className="mt-2 text-sm">{report.employeeCount} colaboradores · {report.branchCount} filiais · {report.issueCount} pendências</p>
        <p className="mt-2 text-xs text-[color:var(--app-muted)]">A filial de cada colaborador corresponde à última competência em que ele consta nas bases.</p>
        {report.issueCount > 0 ? <p className="mt-3 rounded-xl bg-[color:var(--app-warning-soft)] p-3 text-sm" role="status">PDF bloqueado. Corrija valores antigos ou as bases nas competências com pendência e apure novamente.</p> : null}
        <details className="mt-4 rounded-xl bg-[color:var(--app-surface-strong)] p-3"><summary className="cursor-pointer text-sm font-bold">Sugestões e evidências dos valores antigos</summary><p className="mt-3 text-sm">Bônus: {report.suggestions.bonusOldValueCents === null ? "sem sugestão confiável" : eventMoney(report.suggestions.bonusOldValueCents)}. {report.suggestions.bonusEvidence}</p><p className="mt-2 text-sm">Domingos: {report.suggestions.sundayOldValueCents === null ? "sem sugestão confiável" : eventMoney(report.suggestions.sundayOldValueCents)}. {report.suggestions.sundayEvidence}</p><p className="mt-3 text-xs text-[color:var(--app-muted)]">Sugestões não alteram a configuração. Confirme o valor antigo aplicável antes de editar.</p></details>
        <div className="mt-5 grid gap-3 md:grid-cols-3"><label className="text-sm font-bold">Buscar colaborador<input value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Nome, cadastro ou filial" className={inputClass} /></label><label className="text-sm font-bold">Competência<select className={inputClass} value={competency} onChange={e => { setCompetency(e.target.value); setPage(0); }}><option value="">Todas as competências</option>{report.competencies.map(month => <option key={month.key} value={month.key}>{month.key.replace("-", "/")}</option>)}</select></label><label className="text-sm font-bold">Situação do evento<select className={inputClass} value={event} onChange={e => { setEvent(e.target.value as EventFilters["event"]); setPage(0); }}><option value="all">Todos os colaboradores</option><option value="bonus-received">Recebeu bônus em algum mês</option><option value="bonus-missing">Bônus não encontrado em algum mês</option><option value="sunday-received">Recebeu domingos em algum mês</option><option value="sunday-missing">Domingos não encontrados em algum mês</option><option value="issues">Com pendências</option></select></label></div>
        <p className="mt-4 text-xs text-[color:var(--app-muted)]">Filtros servem apenas para conferência na tela. O PDF contém a apuração completa de todas as bases. Filtros de evento consideram somente meses em que o colaborador consta na folha.</p>
        <div className="mt-5 space-y-4">{visible.map(employee => <article key={`${employee.branchAlias}:${employee.registration}`} className="min-w-0 rounded-xl border border-[color:var(--app-border)] p-4"><div className="flex flex-col justify-between gap-2 sm:flex-row"><div className="min-w-0"><h3 className="break-words font-black">{employee.employeeName}</h3><p className="mt-1 break-words text-xs text-[color:var(--app-muted)]">Cadastro {employee.registration} · Filial {employee.branchAlias}</p></div><p className="text-sm font-black">Diferença exibida: {eventMoney(displayedEventDifference(employee, competency))}</p></div><div className="mt-4 grid min-w-0 gap-3 lg:grid-cols-2">{employee.months.filter(month => !competency || month.competency.key === competency).map(month => <section key={month.competency.key} className="min-w-0 rounded-xl border border-[color:var(--app-border)] p-3"><h4 className="mb-3 text-sm font-bold">{month.competency.key.replace("-", "/")}</h4>{month.inPayroll ? <div className="grid min-w-0 gap-3 sm:grid-cols-2"><EventResult title="565 · Bônus" result={month.bonus565} /><EventResult title="901 · Domingos" result={month.indemnity901} /></div> : <p className="text-sm text-[color:var(--app-muted)]">Colaborador não consta nesta base mensal. Não equivale a evento ausente.</p>}</section>)}</div></article>)}</div>
        {employees.length === 0 ? <p className="mt-5 text-sm" role="status">Nenhum colaborador corresponde aos filtros.</p> : <nav aria-label="Paginação dos eventos" className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-sm" aria-live="polite">{currentPage * 12 + 1}–{Math.min((currentPage + 1) * 12, employees.length)} de {employees.length} colaboradores</p><div className="flex gap-2"><button type="button" className={buttonClass} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button><button type="button" className={buttonClass} disabled={(currentPage + 1) * 12 >= employees.length} onClick={() => setPage(currentPage + 1)}>Próxima</button></div></nav>}
      </div>
    </> : null}
  </fieldset></section>;
}
