"use client";

import { CalendarDays } from "lucide-react";
import styles from "./escalas.module.css";
import { useEffect, useRef, useState } from "react";
import { visibleDates } from "@/lib/escalas/dates";
import { compareBranches } from "@/lib/escalas/order";
import type { WeeklyHours } from "@/lib/escalas/types";
import { AbsenceImport } from "./absence-import";
import { Rules, Shifts } from "./configuration";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import { Coverage, ImportEmployees } from "./coverage-import";
import { DeletePlan } from "./delete-plan";
import { Employees } from "./employees";
import { recoveryArea, revealRecoveryTarget, type EscalaRecoveryContext, type EscalaRecoveryRequest } from "./recovery-navigation";
import { HoursProposal } from "./hours-proposal";
import { Proposals, Publication, ValidationResults } from "./results";
import { Roster } from "./roster";
import { useEscalasWorkspace, type WorkspaceSummary } from "./use-escalas-workspace";
import type { ReviewTarget } from "./validation-guidance";
import { WorkspaceFeedback } from "./workspace-feedback";
import type { EscalaProblem, EscalaRecoveryAction } from "./workspace-feedback-model";
import { changeBranchWeeklyHours, clock, displayDate, errorMessage, HOURS, newInput } from "./workspace-model";

type Area = "team" | "roster" | "coverage" | "adjustments";
const AREAS: { id: Area; label: string }[] = [
  { id: "team", label: "Equipe" },
  { id: "roster", label: "Escala" },
  { id: "coverage", label: "Cobertura" },
  { id: "adjustments", label: "Ajustes" },
];

function CreatePlan({ disabled, create }: { disabled: boolean; create: (input: ReturnType<typeof newInput>) => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [error, setError] = useState("");
  return <details className={styles.disclosure}>
    <summary className={styles.disclosureTrigger}>Novo planejamento</summary>
    <form className={styles.disclosureBody} onSubmit={(event) => {
      event.preventDefault();
      setError("");
      try {
        if (!code.trim()) throw new Error("Informe o código da filial.");
        create(newInput(code, name.trim() || `Filial ${code.trim()}`, month, 40));
      } catch (cause) { setError(errorMessage(cause)); }
    }}>
      <fieldset disabled={disabled} className={styles.stackSmall}>
        <div className={`${styles.formGrid} ${styles.formGridWide}`}>
          <Field label="Código da filial">{(id) => <input id={id} required maxLength={40} value={code} onChange={(event) => setCode(event.target.value)} className={controlClass} />}</Field>
          <Field label="Nome da filial (opcional)">{(id) => <input id={id} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className={controlClass} />}</Field>
          <Field label="Mês de referência">{(id) => <input id={id} required type="month" min="2000-02" max="2099-11" value={month} onChange={(event) => setMonth(event.target.value)} className={controlClass} />}</Field>
        </div>
        {error && <p role="alert" className={styles.errorText}>{error}</p>}
        <button type="submit" className={primaryClass}>Iniciar planejamento</button>
      </fieldset>
    </form>
  </details>;
}

function comparePlans(a: WorkspaceSummary, b: WorkspaceSummary) {
  return compareBranches(a.input, b.input) || b.input.startDate.localeCompare(a.input.startDate) || a.id.localeCompare(b.id);
}

export function EscalasStatus({ busy, notice, cancellable, onCancel, failed = false, error = "", problem, onAction }: {
  busy: string; notice: string; cancellable: boolean; onCancel: () => void; failed?: boolean;
  error?: string; problem?: EscalaProblem | null; onAction?: (action: EscalaRecoveryAction, context?: EscalaRecoveryContext) => void;
}) {
  const stage = busy ? "Processando" : problem?.outcome === "not-generated" ? "Proposta não gerada" : failed || error || problem?.tone === "error" ? "Falha" : problem?.tone === "warning" || /avisos|alterado|cancelada|pendências/i.test(notice) ? "Concluído com avisos" : notice ? "Concluído" : "Pronto";
  return <div className={styles.stackSmall}>
    <p className={styles.muted}><strong>{stage}.</strong>{!busy && !notice && !error && !problem && <span> Selecione a filial e o mês para planejar.</span>}</p>
    <WorkspaceFeedback busy={busy} notice={notice} error={error} problem={problem} onAction={onAction} />
    {busy && cancellable && <div className={styles.actions}><button type="button" className={buttonClass} onClick={onCancel}>Cancelar análise</button></div>}
  </div>;
}

export function EscalasWorkspace() {
  const model = useEscalasWorkspace();
  const { input, workspace } = model;
  const [area, setArea] = useState<Area>("team");
  const [reviewContext, setReviewContext] = useState<EscalaRecoveryRequest | null>(null);
  const [pendingReview, setPendingReview] = useState<EscalaRecoveryRequest | null>(null);
  const reviewSequence = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (model.error || model.problem) errorRef.current?.focus(); }, [model.error, model.problem]);
  const openedWorkspace = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (openedWorkspace.current === workspace?.id) return;
    openedWorkspace.current = workspace?.id;
    setReviewContext(null);
    setPendingReview(null);
    setArea(workspace?.input.assignments.length ? "roster" : "team");
  }, [workspace?.id, workspace?.input.assignments.length]);
  useEffect(() => { if (model.generated) setArea("roster"); }, [model.generated]);
  useEffect(() => {
    if (!pendingReview || area !== recoveryArea(pendingReview.target)) return;
    if (revealRecoveryTarget(pendingReview.target, document)) setPendingReview(null);
  }, [area, pendingReview]);
  function resolve(target: ReviewTarget, context: EscalaRecoveryContext = {}) {
    if (target === "generate") { model.generate(); return; }
    const review = { ...context, target, request: ++reviewSequence.current };
    setReviewContext(review);
    setPendingReview(review);
    setArea(recoveryArea(target));
  }
  function recover(action: EscalaRecoveryAction, context?: EscalaRecoveryContext) {
    if (model.busy) return;
    if (action === "reload") { if (workspace) model.open(workspace.id); return; }
    if (action === "login") return; // The feedback link opens a separate tab, preserving this draft.
    resolve(action, context);
  }
  const included = input?.employees.filter((person) => person.planningEnabled !== false).length ?? 0;
  const hasRoster = Boolean(input?.assignments.length);
  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div className={styles.brand}>
        <CalendarDays className={styles.brandIcon} aria-hidden="true" />
        <div><h1 className={styles.title}>Escalas 5×2</h1><p className={styles.muted}>Planejamento mensal para a operação do supermercado.</p></div>
      </div>
      <span className={styles.workflowTag}>Importar · gerar · revisar · exportar</span>
    </header>

    <section className={panelClass} aria-labelledby="escala-list-title">
      <h2 id="escala-list-title" className="sr-only">Selecionar planejamento</h2>
      {model.workspaces.length > 0 ? <Field label="Selecionar filial e período">{(id) => <select id={id} disabled={Boolean(model.busy)} value={workspace?.id ?? ""} onChange={(event) => { if (event.target.value) model.open(event.target.value); }} className={controlClass}>
        <option value="">Selecione um planejamento</option>
        {[...model.workspaces].sort(comparePlans).map((item) => <option key={item.id} value={item.id}>Filial {item.input.branchCode} · {item.input.branchName} · {item.input.visibleMonth ?? `${displayDate(visibleDates(item.input)[0])} a ${displayDate(visibleDates(item.input).at(-1) ?? item.input.endDate)}`} · {item.status === "PUBLISHED" ? "Publicada" : "Rascunho"}</option>)}
      </select>}</Field> : <p className={styles.muted}>{model.canCreate ? "Comece pela filial e pelo mês. A equipe e a jornada serão definidas neste planejamento." : "Nenhum planejamento disponível para seu acesso."}</p>}
      {model.canCreate && <CreatePlan disabled={Boolean(model.busy || model.dirty)} create={model.create} />}
    </section>
    {model.pendingOpen && <div className={`${panelClass} border-[color:var(--app-coral)]`} role="alert">
      <p>Há alterações não salvas neste planejamento.</p>
      <div className={styles.actions}>
        <button type="button" className={buttonClass} onClick={() => model.setPendingOpen(null)}>Continuar editando</button>
        <button type="button" className={buttonClass} onClick={() => { if (model.pendingOpen) model.open(model.pendingOpen, true); }}>Descartar alterações e abrir</button>
      </div>
    </div>}
    <div ref={errorRef} tabIndex={-1} className={styles.feedbackFocus}><EscalasStatus busy={model.busy} notice={model.notice} error={model.error} problem={model.problem} onAction={recover} failed={Boolean(model.error)} cancellable={model.cancellable} onCancel={model.cancelAnalysis} /></div>

    {input && workspace && <div className={styles.stack}>
      <section className={`${panelClass} ${styles.scenario}`} aria-labelledby="escala-scenario-title">
        <div className={styles.header}>
          <div className="min-w-0"><h2 id="escala-scenario-title" className={styles.sectionTitle}>Filial {input.branchCode} · {input.branchName}</h2>
            <p className={styles.subtitle}>{displayDate(visibleDates(input)[0])} a {displayDate(visibleDates(input).at(-1) ?? input.endDate)} · {included} na equipe · revisão {workspace.revision}</p>
          </div>
          <span className={styles.statusTag}>{model.dirty ? "Alterações não salvas" : workspace.status === "PUBLISHED" ? "Publicada" : "Rascunho"}</span>
        </div>
        <div className={styles.contextBar}>
          <fieldset disabled={!model.canEdit} className={styles.journeyField}>
            <Field label="Jornada semanal">{(id) => <select id={id} value={input.defaultWeeklyHours} className={controlClass} onChange={(event) => model.update(changeBranchWeeklyHours(input, Number(event.target.value) as WeeklyHours))}>{HOURS.map((hours) => <option key={hours} value={hours}>{hours} horas</option>)}</select>}</Field>
          </fieldset>
          <p className={styles.muted}><strong className="text-[color:var(--app-fg)]">{clock(input.defaultWeeklyHours * 12)}</strong> de trabalho por dia, em 5 dias.<br />Intervalos não computados à parte; exceções individuais preservadas.</p>
          <div className={styles.mainActions}>
            {model.dirty && <button type="button" className={buttonClass} disabled={!model.canEdit} onClick={model.save}>Salvar revisão</button>}
            <button type="button" className={primaryClass} disabled={!model.canEdit || included === 0} onClick={model.generate}>{model.busy ? "Processando…" : hasRoster ? "Gerar nova proposta" : "Gerar proposta mensal"}</button>
          </div>
        </div>
        {!workspace.canEdit && <p className={styles.muted}>Acesso de consulta nesta filial.</p>}
      </section>

      <nav aria-label="Áreas do planejamento" className={styles.navigation}>
        {AREAS.map((item) => <button key={item.id} type="button" aria-pressed={area === item.id} aria-controls={`escala-area-${item.id}`} className={`${buttonClass} ${styles.areaTab}`} onClick={() => setArea(item.id)}>{item.label}</button>)}
      </nav>

      {area === "team" && <section id="escala-area-team" aria-labelledby="escala-team-title" className={styles.stackSmall}>
        <div id="escala-team" tabIndex={-1}><h2 id="escala-team-title" className={styles.sectionTitle}>Equipe da filial</h2><p className={styles.muted}>{input.employees.length} importados · {included} incluídos. Horários originais ficam preservados para comparação.</p></div>
        <ImportEmployees input={input} disabled={!model.canEdit} onChange={model.update} />
        <AbsenceImport input={input} disabled={!model.canEdit} onChange={model.update} />
        {input.employees.length > 0 && <details id="escala-team-restrictions" className={panelClass}><summary className={styles.disclosureTrigger}>Consultar equipe e restrições individuais</summary>
          <div id="escala-team-review" tabIndex={-1} className="scroll-mt-24 rounded-md p-2 focus:outline-2 focus:outline-[color:var(--app-action-blue)]">
            {reviewContext?.target === "team" && <p className={styles.muted}>Localize o colaborador indicado e use Editar para conferir folgas fixas e horários permitidos. Dias bloqueados e ausências aparecem na área Escala. Nada será alterado apenas por abrir esta conferência.</p>}
          </div>
          <Employees input={input} disabled={!model.canEdit} onChange={model.update} review={reviewContext?.target === "team" ? reviewContext : undefined} />
        </details>}
      </section>}

      {area === "roster" && <section id="escala-area-roster" className={styles.stackSmall} aria-label="Revisar escala mensal">
        {model.outdated && hasRoster && <div role="status" className="app-radius-lg border border-[color:var(--app-coral)] bg-[color:var(--app-danger-soft)] p-4 text-sm"><strong>Cenário alterado.</strong> A grade anterior fica visível para comparação, mas precisa ser gerada novamente antes de exportar.</div>}
        <Proposals input={input} generated={model.generated} disabled={!model.canEdit} onGenerated={model.applyGenerated} onDismiss={model.dismissProposals} />
        <div id="escala-roster" tabIndex={-1} className="min-w-0">
          {hasRoster ? <Roster input={input} validation={model.validation} disabled={!model.canEdit} canUnlock={workspace.canPublish} onChange={model.update} /> : !model.generated && <div className={`${panelClass} ${styles.emptyState}`}><h2 className={styles.sectionTitle}>Sua escala mensal aparecerá aqui</h2><p className="mt-2 text-sm text-[color:var(--app-muted)]">{included ? "Escolha a jornada e gere a proposta. O algoritmo prepara os horários, as folgas e a cobertura estimada." : "Importe a equipe para começar."}</p>{!included && <button type="button" className={`${buttonClass} mt-4`} onClick={() => setArea("team")}>Importar equipe</button>}</div>}
        </div>
        {hasRoster && <>
          <ValidationResults input={input} validation={model.validation} onResolve={model.canEdit ? resolve : undefined} />
          <Publication key={`${workspace.id}:${workspace.revision}`} workspace={workspace} validation={model.validation} dirty={model.dirty} outdated={model.outdated} busy={Boolean(model.busy)} onPublish={model.publish} onRegenerate={model.generate} />
        </>}
      </section>}

      {area === "coverage" && <section id="escala-area-coverage" aria-label="Cobertura da filial"><div id="escala-coverage" tabIndex={-1}><Coverage input={input} disabled={!model.canEdit} onChange={model.update} review={reviewContext?.target === "coverage" ? reviewContext : undefined} /></div></section>}

      {area === "adjustments" && <section id="escala-area-adjustments" className={styles.stack} aria-label="Exceções do planejamento">
        <div id="escala-rules" tabIndex={-1}><Rules input={input} disabled={!model.canEdit} onChange={model.update} /></div>
        <details id="escala-advanced" tabIndex={-1} className={panelClass}><summary className={styles.disclosureTrigger}>Alternativas de horário e turnos específicos</summary><div className={styles.stack}><HoursProposal input={input} disabled={!model.canEdit} onChange={model.update} /><Shifts input={input} disabled={!model.canEdit} onChange={model.update} /></div></details>
        <div className={styles.actions}><button type="button" className={buttonClass} disabled={!model.canEdit} onClick={model.validate}>Conferir dados atuais</button><button type="button" className={buttonClass} disabled={!model.dirty || Boolean(model.busy)} onClick={model.discard}>Descartar alterações locais</button></div>
        <DeletePlan workspace={workspace} dirty={model.dirty} busy={Boolean(model.busy)} onDelete={model.deleteWorkspace} />
      </section>}
    </div>}
  </div>;
}
