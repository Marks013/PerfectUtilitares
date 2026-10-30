"use client";

import { CalendarDays } from "lucide-react";
import styles from "./escalas.module.css";
import { useEffect, useRef, useState } from "react";
import { visibleDates } from "@/lib/escalas/dates";
import { compareBranches } from "@/lib/escalas/order";
import type { EscalaExportMode } from "@/lib/escalas/presentation";
import type { WeeklyHours } from "@/lib/escalas/types";
import { AbsenceImport } from "./absence-import";
import { Rules, Shifts } from "./configuration";
import { buttonClass, controlClass, Field, panelClass, primaryClass } from "./controls";
import { CoverageTimeline } from "./coverage-timeline";
import { Coverage, ImportEmployees } from "./coverage-import";
import { DeletePlan } from "./delete-plan";
import { SAVE_LABEL } from "./draft-persistence";
import { Employees } from "./employees";
import { recoveryArea, revealRecoveryTarget, type EscalaRecoveryContext, type EscalaRecoveryRequest } from "./recovery-navigation";
import { HoursProposal } from "./hours-proposal";
import { Proposals, Publication, ValidationResults, type ReviewSection } from "./results";
import { Roster } from "./roster";
import { useEscalasWorkspace, type WorkspaceSummary } from "./use-escalas-workspace";
import type { ReviewTarget } from "./validation-guidance";
import { WorkspaceFeedback } from "./workspace-feedback";
import type { EscalaProblem, EscalaRecoveryAction } from "./workspace-feedback-model";
import { changeBranchWeeklyHours, clock, displayDate, errorMessage, HOURS, newInput } from "./workspace-model";

type Area = "team" | "roster" | "coverage" | "review" | "adjustments";
const AREAS: { id: Area; label: string }[] = [
  { id: "team", label: "Equipe" },
  { id: "roster", label: "Escala" },
  { id: "coverage", label: "Cobertura" },
  { id: "review", label: "Revisão e suporte" },
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

export function EscalasStatus({ busy, notice, cancellable, onCancel, failed = false, error = "", problem, onAction, pendingSave = false }: {
  busy: string; notice: string; cancellable: boolean; onCancel: () => void; failed?: boolean;
  error?: string; problem?: EscalaProblem | null; pendingSave?: boolean; onAction?: (action: EscalaRecoveryAction, context?: EscalaRecoveryContext) => void;
}) {
  if (pendingSave && !busy && !error && !problem) return <p role="status" className={styles.muted}>Alterações no rascunho. Aguardando confirmação do salvamento automático.</p>;
  const stage = busy ? "Processando" : problem?.outcome === "not-generated" ? "Proposta não gerada" : failed || error || problem?.tone === "error" ? "Falha" : problem?.tone === "warning" || /avisos|alterado|cancelada|pendências/i.test(notice) ? "Concluído com avisos" : notice ? "Concluído" : "Pronto";
  return <div className={styles.stackSmall}>
    <p className={styles.muted}><strong>{stage}.</strong>{!busy && !notice && !error && !problem && <span> Selecione a filial e o mês para planejar.</span>}</p>
    <WorkspaceFeedback busy={busy} notice={notice} error={error} problem={problem} onAction={onAction} />
    {busy && cancellable && <div className={styles.actions}><button type="button" className={buttonClass} onClick={onCancel}>Cancelar análise</button></div>}
  </div>;
}

export function EscalasWorkspace() {
  const model = useEscalasWorkspace();
  const { input, workspace, conflict } = model;
  const [area, setArea] = useState<Area>("team");
  const [visited, setVisited] = useState<Set<Area>>(() => new Set(["team"]));
  useEffect(() => { setVisited(previous => previous.has(area) ? previous : new Set([...previous, area])); }, [area]);
  const [reviewSection, setReviewSection] = useState<ReviewSection>();
  const [exportMode, setExportMode] = useState<EscalaExportMode>("both");
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
    setExportMode("both");
    setPendingReview(null);
    setArea(workspace?.input.assignments.length ? "roster" : "team");
  }, [workspace?.id, workspace?.input.assignments.length]);
  useEffect(() => { if (model.generated) setArea("roster"); }, [model.generated]);
  useEffect(() => {
    if (!pendingReview || !visited.has(area) || area !== recoveryArea(pendingReview.target)) return;
    let frame = 0;
    let attempts = 0;
    const reveal = () => {
      if (revealRecoveryTarget(pendingReview.target, document, pendingReview)) {
        setPendingReview(current => current?.request === pendingReview.request ? null : current);
      } else if (++attempts < 8) frame = window.requestAnimationFrame(reveal);
    };
    reveal();
    return () => window.cancelAnimationFrame(frame);
  }, [area, pendingReview, visited]);
  function resolve(target: ReviewTarget, context: EscalaRecoveryContext = {}) {
    if (target === "generate") { model.generate(); return; }
    const review = { ...context, target, request: ++reviewSequence.current };
    setReviewContext(review);
    setPendingReview(review);
    setArea(recoveryArea(target));
  }
  function recover(action: EscalaRecoveryAction, context?: EscalaRecoveryContext) {
    if (model.busy) return;
    if (action === "reload") { model.compareLatest(); return; }
    if (action === "login") { window.dispatchEvent(new Event("escalas:unlock-required")); return; }
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
      {model.canCreate && <CreatePlan disabled={Boolean(model.busy || model.dirty || model.recovery)} create={model.create} />}
    </section>
    {model.pendingOpen && <div className={`${panelClass} border-[color:var(--app-coral)]`} role="alert">
      <p>Há alterações não salvas neste planejamento.</p>
      <div className={styles.actions}>
        <button type="button" className={buttonClass} onClick={() => model.setPendingOpen(null)}>Continuar editando</button>
        <button type="button" className={primaryClass} disabled={Boolean(model.busy)} onClick={() => { if (model.pendingOpen) model.saveAndOpen(model.pendingOpen); }}>Salvar e abrir</button>
        <button type="button" className={buttonClass} onClick={() => { if (model.pendingOpen) model.open(model.pendingOpen, true); }}>Descartar alterações e abrir</button>
      </div>
    </div>}
    {conflict && input && <section className={panelClass} role="alert" aria-label="Comparar conflito de revisão"><h2 className={styles.sectionTitle}>Escolha como continuar sem sobrescrever em silêncio</h2><p>Servidor: revisão {conflict.revision}, {conflict.input.employees.length} colaboradores, {conflict.input.defaultWeeklyHours}h. Sua edição: {input.employees.length} colaboradores, {input.defaultWeeklyHours}h.</p><p>Usar sua edição substituirá o conteúdo do rascunho salvo na próxima revisão. A versão anterior permanece no histórico; bloqueios continuam protegidos pelo servidor.</p><details><summary className={styles.disclosureTrigger}>Conferir equipe e horários da revisão salva</summary><div className={styles.reviewScroller}><ul>{conflict.input.employees.map(person => <li key={person.id}>{person.registration} · {person.name} · {person.sector} / {person.role} · {person.weeklyHours}h · {person.planningEnabled === false ? "não incluído" : "incluído"}<span className="block">Horários: {person.shiftIds.map(id => conflict?.input.shifts.find(shift => shift.id === id)?.segments.map(segment => clock(segment.start) + "–" + clock(segment.end) + (segment.kind === "BREAK" ? " (intervalo)" : "")).join(" / ")).join("; ") || "Sem horário fixo"}. Folgas fixas: {person.fixedOffDays.length ? person.fixedOffDays.map(day => ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][day]).join(", ") : "nenhuma"}. {conflict.input.assignments.filter(day => day.employeeId === person.id && day.kind === "ABSENCE").length} dias de ausência; {conflict.input.assignments.filter(day => day.employeeId === person.id && day.locked).length} dias bloqueados.</span></li>)}</ul></div></details><div className={styles.actions}><button type="button" className={buttonClass} onClick={model.closeConflict}>Manter edição aberta sem substituir</button><button type="button" className={buttonClass} onClick={model.useServerRevision}>Usar revisão do servidor e descartar edição local</button><button type="button" className={primaryClass} disabled={!conflict.canEdit} onClick={model.rebaseDraft}>Usar minha edição sobre a revisão {conflict.revision}</button></div></section>}
    {!model.localBackup && model.dirty && <p role="alert" className={styles.errorText}>O navegador não conseguiu guardar uma cópia temporária. Não recarregue nem feche esta aba antes da confirmação do salvamento.</p>}
    {model.recovery && workspace && <section className={panelClass} role="alert" aria-label="Rascunho recuperável"><h2 className={styles.sectionTitle}>Há um rascunho preservado neste navegador</h2><p>Originado na revisão {model.recovery.baseRevision}; a revisão salva atual é {workspace.revision}. {model.recovery.baseRevision !== workspace.revision ? "Restaurar usará seu rascunho como conteúdo da próxima revisão, substituindo o conteúdo atual após o salvamento. Confira antes de escolher. O histórico será mantido." : "Você pode retomar a edição sem refazer a importação."}</p><div className={styles.actions}><button type="button" className={primaryClass} onClick={model.recoverDraft}>Restaurar meu rascunho sobre a revisão {workspace.revision}</button><button type="button" className={buttonClass} onClick={model.ignoreRecovery}>Manter somente a revisão salva</button></div></section>}
    <div ref={errorRef} tabIndex={-1} className={styles.feedbackFocus}><EscalasStatus pendingSave={model.dirty} busy={model.busy} notice={model.notice} error={model.error} problem={model.problem} onAction={recover} failed={Boolean(model.error)} cancellable={model.cancellable} onCancel={model.cancelAnalysis} /></div>

    {input && workspace && <div key={workspace.id} className={styles.stack}>
      <section className={`${panelClass} ${styles.scenario}`} aria-labelledby="escala-scenario-title">
        <div className={styles.header}>
          <div className="min-w-0"><h2 id="escala-scenario-title" className={styles.sectionTitle}>Filial {input.branchCode} · {input.branchName}</h2>
            <p className={styles.subtitle}>{displayDate(visibleDates(input)[0])} a {displayDate(visibleDates(input).at(-1) ?? input.endDate)} · {included} na equipe · revisão {workspace.revision}</p>
          </div>
          <span role="status" className={styles.saveStatus} data-state={model.saveState}>{SAVE_LABEL[model.saveState]} · {workspace.status === "PUBLISHED" ? "Publicada" : "Rascunho"}</span>
        </div>
        <div className={styles.contextBar}>
          <fieldset disabled={!model.canEdit} className={styles.journeyField}>
            <Field label="Jornada semanal">{(id) => <select id={id} value={input.defaultWeeklyHours} className={controlClass} onChange={(event) => model.update(changeBranchWeeklyHours(input, Number(event.target.value) as WeeklyHours))}>{HOURS.map((hours) => <option key={hours} value={hours}>{hours} horas</option>)}</select>}</Field>
          </fieldset>
          <p className={styles.muted}><strong className="text-[color:var(--app-fg)]">{clock(input.defaultWeeklyHours * 12)}</strong> de trabalho por dia, em 5 dias.<br />Intervalos não computados à parte; exceções individuais preservadas.</p>
          <button type="button" className={buttonClass} onClick={() => resolve("intervals")}>Intervalos de jornadas curtas</button>
          <div className={styles.mainActions}>
            {model.dirty && <button type="button" className={buttonClass} disabled={!model.canEdit || model.saveState === "saving"} onClick={model.save}>{["error", "conflict", "invalid"].includes(model.saveState) ? "Tentar salvar" : "Salvar agora"}</button>}
            <button type="button" className={primaryClass} disabled={!model.canEdit || included === 0} onClick={model.generate}>{model.busy ? "Processando…" : hasRoster ? "Gerar nova proposta" : "Gerar proposta mensal"}</button>
          </div>
        </div>
        {!workspace.canEdit && <p className={styles.muted}>Acesso de consulta nesta filial.</p>}
      </section>

      {input.employees.length > 0 && <HoursProposal input={input} disabled={!model.canEdit} onChange={model.update} />}
      <Publication mode={exportMode} onModeChange={setExportMode} key={workspace.id} workspace={workspace} validation={model.validation} dirty={model.dirty} outdated={model.outdated} busy={Boolean(model.busy || model.recovery)} onPublish={model.publish} onRegenerate={model.generate} onPrepare={model.flushDraft} isCurrent={model.isCurrentRevision} />

      <nav aria-label="Áreas do planejamento" className={styles.navigation}>
        {AREAS.map((item) => <button key={item.id} type="button" aria-pressed={area === item.id} aria-controls={`escala-area-${item.id}`} className={`${buttonClass} ${styles.areaTab}`} onClick={() => setArea(item.id)}>{item.label}</button>)}
      </nav>

      {visited.has("team") && <section hidden={area !== "team"} inert={area !== "team"} id="escala-area-team" aria-labelledby="escala-team-title" className={styles.stackSmall}>
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

      {visited.has("roster") && <section hidden={area !== "roster"} inert={area !== "roster"} id="escala-area-roster" className={styles.stackSmall} aria-label="Revisar escala mensal">
        {model.outdated && hasRoster && <div role="status" className="app-radius-lg border border-[color:var(--app-coral)] bg-[color:var(--app-danger-soft)] p-4 text-sm"><strong>Cenário alterado.</strong> A grade anterior fica visível para comparação, mas precisa ser gerada novamente antes de exportar.</div>}
        <Proposals input={input} generated={model.generated} disabled={!model.canEdit} onGenerated={model.applyGenerated} onDismiss={model.dismissProposals} />
        <div id="escala-roster" tabIndex={-1} className="min-w-0">
          {hasRoster ? <Roster key={workspace.id} input={input} review={reviewContext?.target === "roster" ? reviewContext : undefined} mode={exportMode} onModeChange={setExportMode} onReviewEmployee={employeeId => resolve("team", { employeeId })} onReviewCoverage={() => { setReviewSection("coverage"); setArea("review"); }} validation={model.validation} disabled={!model.canEdit} canUnlock={workspace.canPublish} onUndo={model.undoRoster} onChange={model.update} /> : !model.generated && <div className={`${panelClass} ${styles.emptyState}`}><h2 className={styles.sectionTitle}>Sua escala mensal aparecerá aqui</h2><p className="mt-2 text-sm text-[color:var(--app-muted)]">{included ? "Escolha a jornada e gere a proposta. O algoritmo prepara os horários, as folgas e a cobertura estimada." : "Importe a equipe para começar."}</p>{!included && <button type="button" className={`${buttonClass} mt-4`} onClick={() => setArea("team")}>Importar equipe</button>}</div>}
        </div>
        {hasRoster && <button type="button" className={buttonClass} onClick={() => setArea("review")}>Conferir erros, avisos e orientações</button>}
      </section>}

      {visited.has("coverage") && <section hidden={area !== "coverage"} inert={area !== "coverage"} id="escala-area-coverage" className={styles.stackSmall} aria-label="Cobertura da filial"><CoverageTimeline key={workspace.id} input={input} review={reviewContext?.target === "coverage" ? reviewContext : undefined} /><div id="escala-coverage" tabIndex={-1}><Coverage input={input} disabled={!model.canEdit} onChange={model.update} review={reviewContext?.target === "coverage" ? reviewContext : undefined} /></div></section>}

      {visited.has("review") && <section hidden={area !== "review"} inert={area !== "review"} id="escala-area-review" className={styles.stackSmall} aria-label="Central de revisão e suporte">
        <ValidationResults section={reviewSection} onSectionChange={setReviewSection} input={input} validation={model.validation} onResolve={model.canEdit ? resolve : undefined} />
        <section className={panelClass}><h2 className={styles.sectionTitle}>Sugestões e critérios do planejamento</h2><p className={styles.muted}>Nada é corrigido apenas por abrir esta área. Uma nova proposta pode ser comparada e descartada antes de aplicar.</p><div className={styles.actions}><button type="button" className={buttonClass} disabled={!model.canEdit || !included} onClick={model.generate}>Sugerir nova distribuição de folgas e horários</button><button type="button" className={buttonClass} onClick={() => setArea("coverage")}>Conferir desfalques por horário</button></div><p className="text-sm">Prioridades: preservar restrições obrigatórias; melhorar a cobertura estimada por setor e cargo; distribuir folgas e fins de semana; reduzir alterações; respeitar preferências individuais. Pessoas com cargos diferentes não se substituem automaticamente.</p><p className="text-sm">Preferências são as escolhas explícitas cadastradas para esta equipe. Não há aprendizado automático nem envio de dados a serviços externos. Ausência de interação não significa aprovação.</p><p className="text-sm">FPRE136 fornece horários originais, não comprova a carga semanal contratual. A jornada selecionada orienta o cenário; cargas individuais explicitamente informadas são preservadas.</p></section>
      </section>}

      {visited.has("adjustments") && <section hidden={area !== "adjustments"} inert={area !== "adjustments"} id="escala-area-adjustments" className={styles.stack} aria-label="Exceções do planejamento">
        <div id="escala-rules" tabIndex={-1}><Rules input={input} disabled={!model.canEdit} onChange={model.update} /></div>
        <details id="escala-advanced" tabIndex={-1} className={panelClass}><summary className={styles.disclosureTrigger}>Alternativas de horário e turnos específicos</summary><div className={styles.stack}><Shifts input={input} disabled={!model.canEdit} onChange={model.update} /></div></details>
        <div className={styles.actions}><button type="button" className={buttonClass} disabled={!model.canEdit} onClick={model.validate}>Conferir dados atuais</button><button type="button" className={buttonClass} disabled={!model.dirty || Boolean(model.busy) || model.saveState === "saving"} onClick={model.discard}>Descartar alterações locais</button></div>
        <DeletePlan workspace={workspace} dirty={model.dirty} busy={Boolean(model.busy)} onDelete={model.deleteWorkspace} />
      </section>}
    </div>}
  </div>;
}
